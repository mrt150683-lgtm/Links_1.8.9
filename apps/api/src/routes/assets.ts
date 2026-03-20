/**
 * Phase 4: Asset routes (encrypted binary storage with multipart upload)
 */

import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { getConfig } from '@links/config';
import {
  CreateImageEntryRequestSchema,
  CreateDocEntryRequestSchema,
  CreateAudioEntryRequestSchema,
  type CreateImageEntryRequest,
  type CreateDocEntryRequest,
  type CreateAudioEntryRequest,
} from '@links/core';
import {
  getPotById,
  getBySha256,
  getAssetById,
  insertAsset,
  logDedupeEvent,
  writeEncryptedAsset,
  readDecryptedAsset,
  listAssetsByPot,
  createImageEntry,
  createDocEntry,
  createAudioEntry,
  createLinkEntry,
  getEntryWithAsset,
  verifyAssets,
  cleanupOrphanedAssets,
  enqueueJob,
} from '@links/storage';
import { isYouTubeMhtml, parseMhtmlFile } from '@links/ai';

const assetsRoute: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /pots/:potId/assets
   * Upload asset with multipart form data
   *
   * Workflow:
   * 1. Receive file upload
   * 2. Compute SHA-256 hash on raw bytes
   * 3. Check dedupe: if hash exists, return existing asset
   * 4. If new: encrypt, write blob, insert DB row
   */
  fastify.post<{ Params: { potId: string } }>(
    '/pots/:potId/assets',
    async (request, reply) => {
      const potId = request.params.potId;
      const config = getConfig();

      // Verify pot exists
      const pot = await getPotById(potId);
      if (!pot) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Pot not found',
          statusCode: 404,
        });
      }

      // Parse multipart upload
      const data = await request.file({
        limits: {
          fileSize: config.ASSET_MAX_BYTES,
        },
      });

      if (!data) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'No file provided',
          statusCode: 400,
        });
      }

      try {
        // Read file to buffer
        const buffer = await data.toBuffer();

        // Compute SHA-256 on raw bytes (before encryption)
        const hash = crypto.createHash('sha256');
        hash.update(buffer);
        const sha256 = hash.digest('hex');

        // Check for existing asset (deduplication)
        const existingAsset = await getBySha256(sha256);
        if (existingAsset) {
          // Asset already exists - log dedupe and create entry for this pot
          await logDedupeEvent(existingAsset.id, sha256);

          // Check if this is a YouTube MHTML file (even on dedup)
          const isMhtmlDedup = data.filename?.toLowerCase().endsWith('.mhtml');
          const isYouTubeDedup = isMhtmlDedup && isYouTubeMhtml(buffer);

          if (isYouTubeDedup) {
            // Try to extract URL from MHTML headers, fall back to placeholder
            let videoUrl = 'https://www.youtube.com';
            let videoTitle = data.filename || 'YouTube video';
            try {
              const { metadata } = parseMhtmlFile(buffer);
              if (metadata.url) videoUrl = metadata.url;
              if (metadata.title) videoTitle = metadata.title;
            } catch {
              // Metadata extraction failed, use filename-based defaults
              fastify.log.info({ asset_id: existingAsset.id }, 'MHTML metadata extraction failed, using defaults');
            }

            try {
              const linkEntry = await createLinkEntry({
                pot_id: potId,
                link_url: videoUrl,
                link_title: videoTitle,
                content_text: `Saved YouTube page: ${videoTitle}`,
                capture_method: 'html_upload',
                source_context: {
                  mhtml_asset_id: existingAsset.id,
                  mhtml_filename: data.filename,
                  parse_status: 'queued',
                },
              });

              await enqueueJob({
                job_type: 'parse_youtube_html',
                pot_id: potId,
                entry_id: linkEntry.id,
                priority: 60,
              });

              const entryWithAsset = await getEntryWithAsset(linkEntry.id);

              return reply.status(200).send({
                created: false,
                asset: existingAsset,
                entry: entryWithAsset,
                deduped: true,
                youtube_html_detected: true,
                message: 'YouTube MHTML file detected - transcript will be extracted automatically',
              });
            } catch (entryError) {
              fastify.log.warn({
                error: entryError instanceof Error ? entryError.message : String(entryError),
                stack: entryError instanceof Error ? entryError.stack : undefined,
                asset_id: existingAsset.id,
              }, 'Failed to create YouTube link entry, falling back to regular doc entry');
            }
          }

          // Determine entry type from MIME type
          const isImage = data.mimetype.startsWith('image/');
          const isAudio = data.mimetype.startsWith('audio/');
          const isVideo = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'].includes(data.mimetype);
          const isOggContainer = data.mimetype === 'application/ogg';
          const isAudioLike = isAudio || isVideo || isOggContainer;

          let entry;
          if (isImage) {
            entry = await createImageEntry({
              pot_id: potId,
              asset_id: existingAsset.id,
              capture_method: 'upload',
              source_title: data.filename || 'Uploaded image',
            });
          } else if (isAudioLike) {
            entry = await createAudioEntry({
              pot_id: potId,
              asset_id: existingAsset.id,
              capture_method: 'upload',
              source_title: data.filename || 'Uploaded audio',
            });
          } else {
            entry = await createDocEntry({
              pot_id: potId,
              asset_id: existingAsset.id,
              capture_method: 'upload',
              source_title: data.filename || 'Uploaded document',
            });
          }

          // Fetch entry with embedded asset metadata
          const entryWithAsset = await getEntryWithAsset(entry.id);

          // Enqueue appropriate job for the entry type
          if (isImage) {
            // For images, tag directly (vision model)
            await enqueueJob({
              job_type: 'tag_entry',
              pot_id: potId,
              entry_id: entry.id,
              priority: 50,
            });
          } else {
            // For documents and audio, extract/transcribe text first
            await enqueueJob({
              job_type: 'extract_text',
              pot_id: potId,
              entry_id: entry.id,
              priority: 60, // Higher priority - prerequisite for tagging
            });
          }

          return reply.status(200).send({
            created: false,
            asset: existingAsset,
            entry: entryWithAsset,
            deduped: true,
          });
        }

        // New asset - encrypt and store
        const storagePath = await writeEncryptedAsset(sha256, buffer);

        // Insert DB row
        const asset = await insertAsset({
          sha256,
          size_bytes: buffer.length,
          mime_type: data.mimetype,
          original_filename: data.filename,
          storage_path: storagePath,
        });

        // Check if this is a YouTube MHTML file
        const isMhtml = data.filename?.toLowerCase().endsWith('.mhtml');
        fastify.log.info({
          filename: data.filename,
          isMhtml,
          fileSize: buffer.length,
          mimeType: data.mimetype,
        }, 'Checking if file is YouTube MHTML');

        const isYouTube = isMhtml && isYouTubeMhtml(buffer);

        fastify.log.info({
          filename: data.filename,
          isYouTube,
        }, 'YouTube MHTML detection result');

        if (isYouTube) {
          // Try to extract URL from MHTML headers, fall back to placeholder
          let videoUrl = 'https://www.youtube.com';
          let videoTitle = data.filename || 'YouTube video';
          try {
            const { metadata } = parseMhtmlFile(buffer);
            if (metadata.url) videoUrl = metadata.url;
            if (metadata.title) videoTitle = metadata.title;
          } catch {
            fastify.log.info({ asset_id: asset.id }, 'MHTML metadata extraction failed, using defaults');
          }

          try {
            const linkEntry = await createLinkEntry({
              pot_id: potId,
              link_url: videoUrl,
              link_title: videoTitle,
              content_text: `Saved YouTube page: ${videoTitle}`,
              capture_method: 'html_upload',
              source_context: {
                mhtml_asset_id: asset.id,
                mhtml_filename: data.filename,
                parse_status: 'queued',
              },
            });

            await enqueueJob({
              job_type: 'parse_youtube_html',
              pot_id: potId,
              entry_id: linkEntry.id,
              priority: 60,
            });

            const entryWithAsset = await getEntryWithAsset(linkEntry.id);

            return reply.status(201).send({
              created: true,
              asset,
              entry: entryWithAsset,
              deduped: false,
              youtube_html_detected: true,
              message: 'YouTube MHTML file detected - transcript will be extracted automatically',
            });
          } catch (entryError) {
            fastify.log.warn({
              error: entryError instanceof Error ? entryError.message : String(entryError),
              stack: entryError instanceof Error ? entryError.stack : undefined,
              asset_id: asset.id,
            }, 'Failed to create YouTube link entry, falling back to regular doc entry');
            // Fall through to regular document handling
          }
        }

        // Automatically create entry to link asset to pot
        // Determine entry type from MIME type
        const isImage = data.mimetype.startsWith('image/');
        const isAudio = data.mimetype.startsWith('audio/');
        const isVideo = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'].includes(data.mimetype);
        const isOggContainer = data.mimetype === 'application/ogg';
        const isAudioLike = isAudio || isVideo || isOggContainer;

        let entry;
        if (isImage) {
          entry = await createImageEntry({
            pot_id: potId,
            asset_id: asset.id,
            capture_method: 'upload',
            source_title: data.filename || 'Uploaded image',
          });
        } else if (isAudioLike) {
          entry = await createAudioEntry({
            pot_id: potId,
            asset_id: asset.id,
            capture_method: 'upload',
            source_title: data.filename || 'Uploaded audio',
          });
        } else {
          entry = await createDocEntry({
            pot_id: potId,
            asset_id: asset.id,
            capture_method: 'upload',
            source_title: data.filename || 'Uploaded document',
          });
        }

        // Fetch entry with embedded asset metadata
        const entryWithAsset = await getEntryWithAsset(entry.id);

        // Enqueue appropriate job for the entry type
        if (isImage) {
          // For images, tag directly (vision model)
          await enqueueJob({
            job_type: 'tag_entry',
            pot_id: potId,
            entry_id: entry.id,
            priority: 50,
          });
        } else {
          // For documents and audio, extract/transcribe text first
          await enqueueJob({
            job_type: 'extract_text',
            pot_id: potId,
            entry_id: entry.id,
            priority: 60, // Higher priority - prerequisite for tagging
          });
        }

        return reply.status(201).send({
          created: true,
          asset,
          entry: entryWithAsset,
          deduped: false,
        });
      } catch (error) {
        fastify.log.error({ error, potId }, 'Failed to upload asset');

        // Check if it's a file size error
        if (
          error instanceof Error &&
          (error.message.includes('File too large') || error.message.includes('exceeded'))
        ) {
          return reply.status(413).send({
            error: 'PayloadTooLargeError',
            message: `File exceeds maximum size of ${config.ASSET_MAX_BYTES} bytes`,
            statusCode: 413,
          });
        }

        return reply.status(500).send({
          error: 'InternalServerError',
          message: 'Failed to upload asset',
          statusCode: 500,
        });
      }
    }
  );

  /**
   * POST /pots/:potId/entries/image
   * Create image entry (links existing asset to pot)
   */
  fastify.post<{ Params: { potId: string } }>(
    '/pots/:potId/entries/image',
    async (request, reply) => {
      const potId = request.params.potId;

      // Verify pot exists
      const pot = await getPotById(potId);
      if (!pot) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Pot not found',
          statusCode: 404,
        });
      }

      // Validate request body
      const result = CreateImageEntryRequestSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid request body',
          statusCode: 400,
          issues: result.error.issues,
        });
      }

      const body = result.data as CreateImageEntryRequest;

      try {
        // Create image entry
        const entry = await createImageEntry({
          pot_id: potId,
          asset_id: body.asset_id,
          capture_method: body.capture_method,
          source_url: body.source_url,
          source_title: body.source_title,
          notes: body.notes,
          captured_at: body.captured_at,
        });

        // Fetch entry with embedded asset metadata
        const entryWithAsset = await getEntryWithAsset(entry.id);

        return reply.status(201).send(entryWithAsset);
      } catch (error) {
        fastify.log.error({ error, potId, assetId: body.asset_id }, 'Failed to create image entry');

        // Check if asset not found
        if (error instanceof Error && error.message.includes('Asset not found')) {
          return reply.status(404).send({
            error: 'NotFoundError',
            message: 'Asset not found',
            statusCode: 404,
          });
        }

        return reply.status(500).send({
          error: 'InternalServerError',
          message: 'Failed to create image entry',
          statusCode: 500,
        });
      }
    }
  );

  /**
   * POST /pots/:potId/entries/doc
   * Create document entry (links existing asset to pot)
   */
  fastify.post<{ Params: { potId: string } }>(
    '/pots/:potId/entries/doc',
    async (request, reply) => {
      const potId = request.params.potId;

      // Verify pot exists
      const pot = await getPotById(potId);
      if (!pot) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Pot not found',
          statusCode: 404,
        });
      }

      // Validate request body
      const result = CreateDocEntryRequestSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid request body',
          statusCode: 400,
          issues: result.error.issues,
        });
      }

      const body = result.data as CreateDocEntryRequest;

      try {
        // Create doc entry
        const entry = await createDocEntry({
          pot_id: potId,
          asset_id: body.asset_id,
          capture_method: body.capture_method,
          source_url: body.source_url,
          source_title: body.source_title,
          notes: body.notes,
          captured_at: body.captured_at,
        });

        // Fetch entry with embedded asset metadata
        const entryWithAsset = await getEntryWithAsset(entry.id);

        return reply.status(201).send(entryWithAsset);
      } catch (error) {
        fastify.log.error({ error, potId, assetId: body.asset_id }, 'Failed to create doc entry');

        // Check if asset not found
        if (error instanceof Error && error.message.includes('Asset not found')) {
          return reply.status(404).send({
            error: 'NotFoundError',
            message: 'Asset not found',
            statusCode: 404,
          });
        }

        return reply.status(500).send({
          error: 'InternalServerError',
          message: 'Failed to create doc entry',
          statusCode: 500,
        });
      }
    }
  );

  /**
   * POST /pots/:potId/entries/audio
   * Create audio entry (links existing asset to pot and enqueues transcription)
   *
   * The asset must already be uploaded via POST /pots/:potId/assets.
   * This endpoint creates the entry record and enqueues extract_text for transcription.
   */
  fastify.post<{ Params: { potId: string } }>(
    '/pots/:potId/entries/audio',
    async (request, reply) => {
      const potId = request.params.potId;

      // Verify pot exists
      const pot = await getPotById(potId);
      if (!pot) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Pot not found',
          statusCode: 404,
        });
      }

      // Validate request body
      const result = CreateAudioEntryRequestSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid request body',
          statusCode: 400,
          issues: result.error.issues,
        });
      }

      const body = result.data as CreateAudioEntryRequest;

      try {
        // Verify asset is audio MIME type
        const asset = await getAssetById(body.asset_id);
        if (!asset) {
          return reply.status(404).send({
            error: 'NotFoundError',
            message: 'Asset not found',
            statusCode: 404,
          });
        }

        if (!asset.mime_type.startsWith('audio/')) {
          return reply.status(400).send({
            error: 'ValidationError',
            message: `Asset MIME type "${asset.mime_type}" is not audio. Only audio/* assets can be used for audio entries.`,
            statusCode: 400,
          });
        }

        // Create audio entry
        const entry = await createAudioEntry({
          pot_id: potId,
          asset_id: body.asset_id,
          capture_method: body.capture_method,
          source_url: body.source_url,
          source_title: body.source_title,
          notes: body.notes,
          captured_at: body.captured_at,
          client_capture_id: body.client_capture_id,
        });

        // Enqueue transcription job
        await enqueueJob({
          job_type: 'extract_text',
          pot_id: potId,
          entry_id: entry.id,
          priority: 60,
        });

        // Fetch entry with embedded asset metadata
        const entryWithAsset = await getEntryWithAsset(entry.id);

        return reply.status(201).send(entryWithAsset);
      } catch (error) {
        fastify.log.error({ error, potId, assetId: body.asset_id }, 'Failed to create audio entry');

        return reply.status(500).send({
          error: 'InternalServerError',
          message: 'Failed to create audio entry',
          statusCode: 500,
        });
      }
    }
  );

  /**
   * GET /pots/:potId/assets
   * List all assets linked to entries in this pot
   */
  fastify.get<{ Params: { potId: string } }>('/pots/:potId/assets', async (request, reply) => {
    const potId = request.params.potId;

    // Verify pot exists
    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
      });
    }

    const assets = await listAssetsByPot(potId);

    return reply.status(200).send({
      assets,
      pot_id: potId,
    });
  });

  /**
   * GET /assets/:id/download
   * Download/view decrypted asset
   */
  fastify.get<{ Params: { id: string } }>('/assets/:id/download', async (request, reply) => {
    const assetId = request.params.id;

    try {
      // Get asset metadata by ID
      const asset = await getAssetById(assetId);
      if (!asset) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Asset not found',
          statusCode: 404,
        });
      }

      // Read and decrypt the asset blob
      const decryptedBuffer = await readDecryptedAsset(asset.storage_path);

      // Set headers for download/view
      reply.header('Content-Type', asset.mime_type);
      reply.header('Content-Length', decryptedBuffer.length);

      // For images, allow inline viewing; for docs, suggest download
      const isImage = asset.mime_type.startsWith('image/');
      const disposition = isImage ? 'inline' : 'attachment';
      const filename = asset.original_filename || `asset-${asset.id}`;
      reply.header('Content-Disposition', `${disposition}; filename="${filename}"`);

      return reply.send(decryptedBuffer);
    } catch (error) {
      fastify.log.error(
        {
          error,
          assetId,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        'Failed to download asset'
      );

      return reply.status(500).send({
        error: 'InternalServerError',
        message: error instanceof Error ? error.message : 'Failed to download asset',
        statusCode: 500,
      });
    }
  });

  /**
   * Phase 12: POST /assets/verify
   * Verify asset integrity (check blobs exist and match hashes)
   */
  fastify.post('/assets/verify', async (request, reply) => {
    const result = await verifyAssets();

    request.log.info(
      {
        request_id: request.id,
        total: result.total,
        verified: result.verified,
        missing: result.missing.length,
        corrupted: result.corrupted.length,
      },
      'Asset verification completed'
    );

    return reply.status(200).send(result);
  });

  /**
   * Phase 12: POST /assets/cleanup-orphans
   * Find and optionally delete orphaned assets (not referenced by entries)
   */
  fastify.post<{ Body: { dry_run?: boolean } }>(
    '/assets/cleanup-orphans',
    async (request, reply) => {
      const dry_run = request.body?.dry_run ?? true;

      const result = await cleanupOrphanedAssets(dry_run);

      request.log.info(
        {
          request_id: request.id,
          dry_run: result.dry_run,
          orphans_found: result.orphans_found,
          orphans_deleted: result.orphans_deleted,
        },
        'Orphaned assets cleanup completed'
      );

      return reply.status(200).send(result);
    }
  );
};

export default assetsRoute;
