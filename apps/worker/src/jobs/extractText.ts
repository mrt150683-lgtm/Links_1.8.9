/**
 * Phase 5 + Audio: Extract Text Job Handler
 *
 * For document entries (doc): extracts text from PDF/DOCX/TXT assets locally.
 * For audio entries (audio): transcribes via OpenRouter input_audio content type.
 *
 * In both cases, writes the result to entries.content_text (so downstream
 * tag/entity/summary jobs work unchanged), and for audio also stores a
 * provenance-tracked extracted_text artifact.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getAssetById,
  readDecryptedAsset,
  enqueueJob,
  getAIPreferences,
  getPotById,
  insertArtifact,
  logAuditEvent,
} from '@links/storage';
import { getDatabase } from '@links/storage';
import { loadPromptFromFile, createChatCompletion, resolveEffectiveRole, injectRoleIntoSystemPrompt, interpolatePrompt, type ContentPart } from '@links/ai';
import { ExtractedTextArtifactSchema } from '@links/core';
import type { ExtractedTextArtifact } from '@links/core';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:extract-text' });
const PROMPTS_DIR = getPromptsDir();

/**
 * Extract text job handler
 * Handles both document extraction (local) and audio transcription (AI)
 */
export async function extractTextHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
  });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('extract_text job requires entry_id');
  }

  // 2. Get entry (must have asset_id)
  const entry = await getEntryById(ctx.entryId);
  if (!entry) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      message: 'Entry not found',
    });
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  if (!entry.asset_id) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      type: entry.type,
      message: 'Entry has no asset_id',
    });
    return; // Job succeeds but does nothing
  }

  // 3. Get asset
  const asset = await getAssetById(entry.asset_id);
  if (!asset) {
    throw new Error(`Asset not found: ${entry.asset_id}`);
  }

  // Route to audio transcription or document extraction
  if (entry.type === 'audio') {
    await handleAudioTranscription(ctx, entry, asset);
  } else {
    await handleDocumentExtraction(ctx, entry, asset);
  }
}

/**
 * Handle audio transcription via OpenRouter input_audio
 */
async function handleAudioTranscription(
  ctx: JobContext,
  entry: Awaited<ReturnType<typeof getEntryById>> & {},
  asset: Awaited<ReturnType<typeof getAssetById>> & {}
): Promise<void> {
  const isAudio =
    asset.mime_type.startsWith('audio/') ||
    asset.mime_type.startsWith('video/') ||
    asset.mime_type === 'application/ogg';
  if (!isAudio) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      asset_id: asset.id,
      mime_type: asset.mime_type,
      message: 'Audio entry has non-audio asset MIME type — skipping',
    });
    return;
  }

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    asset_id: asset.id,
    mime_type: asset.mime_type,
    size_bytes: asset.size_bytes,
    message: 'Starting audio transcription',
  });

  // Get AI preferences and model
  const prefs = await getAIPreferences();
  const model = prefs.task_models?.audio_transcription || prefs.default_model || 'openai/gpt-4o-audio-preview';

  const temperature = prefs.temperature ?? 0.2;
  const maxTokens = prefs.max_tokens ?? 8000;

  // Resolve pot role for prompt injection
  const pot = await getPotById(entry.pot_id);
  const role = await resolveEffectiveRole(pot ?? { id: entry.pot_id, role_ref: null });

  // Load prompt
  const promptPath = join(PROMPTS_DIR, 'transcribe_audio', 'v1.md');
  const prompt = loadPromptFromFile(promptPath);
  const textMessages = interpolatePrompt(prompt, {});

  // Read and base64 encode audio asset
  const decryptedBuffer = await readDecryptedAsset(asset.storage_path);
  const base64Audio = decryptedBuffer.toString('base64');

  // Map MIME types to OpenRouter audio format identifiers
  const mimeToFormat: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/aac': 'aac',
    'audio/x-m4a': 'aac',
    'audio/m4a': 'aac',
    'video/mp4': 'mp4',
    'video/quicktime': 'mp4',
    'video/x-m4v': 'mp4',
    'video/webm': 'webm',
    'application/ogg': 'ogg',
  };
  const audioFormat = mimeToFormat[asset.mime_type] || asset.mime_type.replace('audio/', '');

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    model,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
    size_bytes: asset.size_bytes,
    message: 'Calling OpenRouter for audio transcription',
  });

  // Call OpenRouter with input_audio content type
  // Use a longer timeout for audio — large files (e.g. 16 MB WAV) take >30s to upload and process
  const response = await createChatCompletion({
    model,
    messages: [
      {
        role: 'system',
        content: injectRoleIntoSystemPrompt(textMessages.system, role.text),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: textMessages.user },
          {
            type: 'input_audio',
            input_audio: {
              data: base64Audio,
              format: audioFormat,
            },
          } as ContentPart,
        ],
      },
    ],
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    response_format: prompt.metadata.response_format === 'json_object' ? { type: 'json_object' } : undefined,
  }, 240_000);

  const aiOutput = response.choices[0]?.message?.content;
  if (!aiOutput) {
    throw new Error('AI returned empty transcription response');
  }

  // Parse response — try JSON first, fall back to treating the raw text as the transcript
  let cleanedOutput = aiOutput.trim();
  const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleanedOutput = codeBlockMatch[1].trim();
  }

  let payload: ExtractedTextArtifact;
  try {
    const parsed = JSON.parse(cleanedOutput);
    const validation = ExtractedTextArtifactSchema.safeParse(parsed);
    if (!validation.success) {
      logger.warn({
        job_id: ctx.jobId,
        error: validation.error.format(),
        message: 'Transcription JSON failed schema validation — using text field directly',
      });
      // JSON but wrong shape — try to extract a text field or use raw JSON string
      const rawText = (parsed as Record<string, unknown>)?.text;
      payload = { text: typeof rawText === 'string' ? rawText : cleanedOutput };
    } else {
      payload = validation.data;
    }
  } catch {
    // Not JSON — treat the whole response as the transcript text
    logger.info({
      job_id: ctx.jobId,
      message: 'Transcription returned plain text (not JSON) — wrapping as transcript',
    });
    payload = { text: cleanedOutput };
  }

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    text_length: payload.text.length,
    language: payload.language,
    segments_count: payload.segments?.length ?? 0,
    message: 'Audio transcription completed',
  });

  // Store as extracted_text artifact for provenance
  const artifact = await insertArtifact({
    pot_id: entry.pot_id,
    entry_id: entry.id,
    artifact_type: 'extracted_text',
    schema_version: 1,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    payload,
    evidence: null,
    role_hash: role.hash,
  }, false);

  // Write transcript to entries.content_text so downstream jobs (tag, entity, summary) work unchanged
  const db = getDatabase();
  await db
    .updateTable('entries')
    .set({
      content_text: payload.text,
      updated_at: Date.now(),
    })
    .where('id', '=', entry.id)
    .execute();

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    artifact_id: artifact?.id ?? 'skipped',
    message: 'Stored extracted_text artifact and updated content_text',
  });

  await logAuditEvent({
    actor: 'system',
    action: 'artifact_created',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    metadata: {
      artifact_id: artifact?.id,
      artifact_type: 'extracted_text',
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
      text_length: payload.text.length,
      language: payload.language,
    },
  });

  // Chain downstream: tag_entry (which will chain to entities then summary)
  await enqueueJob({
    job_type: 'tag_entry',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    priority: 50,
  });

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    message: 'Enqueued tag_entry job after audio transcription',
  });
}

/**
 * Handle document text extraction (PDF, DOCX, plain text) — original behaviour
 */
async function handleDocumentExtraction(
  ctx: JobContext,
  entry: Awaited<ReturnType<typeof getEntryById>> & {},
  asset: Awaited<ReturnType<typeof getAssetById>> & {}
): Promise<void> {
  // Check supported MIME types
  const isPdf = asset.mime_type.includes('pdf');
  const isDocx = asset.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || asset.mime_type === 'application/docx';
  const isPlainText = asset.mime_type.startsWith('text/');
  const filename = (asset.original_filename ?? '').toLowerCase();
  const isTextByExtension = asset.mime_type === 'application/octet-stream'
    && /\.(md|txt|markdown|text|csv|log|json|xml|yaml|yml|ini|cfg|conf|rst|adoc)$/.test(filename);

  if (!isPdf && !isDocx && !isPlainText && !isTextByExtension) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      asset_id: asset.id,
      mime_type: asset.mime_type,
      message: 'Unsupported document type for text extraction',
    });
    return; // Skip for now
  }

  const typeLabel = isPdf ? 'PDF' : isDocx ? 'DOCX' : 'plain-text';
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    asset_id: asset.id,
    mime_type: asset.mime_type,
    size_bytes: asset.size_bytes,
    message: `Starting ${typeLabel} text extraction`,
  });

  // Read and decrypt asset
  const decryptedBuffer = await readDecryptedAsset(asset.storage_path);

  let extractedText: string;

  if (isPdf) {
    const pdfParse = (await import('pdf-parse')).default;
    const pdfData = await pdfParse(decryptedBuffer);
    extractedText = pdfData.text;

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      asset_id: asset.id,
      text_length: extractedText.length,
      pages: pdfData.numpages,
      message: 'PDF text extraction completed',
    });
  } else if (isDocx) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: decryptedBuffer });
    extractedText = result.value;

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      asset_id: asset.id,
      text_length: extractedText.length,
      message: 'DOCX text extraction completed',
    });
  } else {
    extractedText = decryptedBuffer.toString('utf-8');

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      asset_id: asset.id,
      text_length: extractedText.length,
      message: 'Plain-text extraction completed',
    });
  }

  // Store extracted text in entry
  const db = getDatabase();
  await db
    .updateTable('entries')
    .set({
      content_text: extractedText,
      updated_at: Date.now(),
    })
    .where('id', '=', entry.id)
    .execute();

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    message: 'Stored extracted text in entry',
  });

  // Enqueue tagging job now that we have text
  await enqueueJob({
    job_type: 'tag_entry',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    priority: 50,
  });

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    message: 'Enqueued tag_entry job',
  });
}
