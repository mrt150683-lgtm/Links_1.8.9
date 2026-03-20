/**
 * Parse YouTube HTML Job Handler
 *
 * Extracts transcript data from saved YouTube MHTML files.
 * Parses HTML to extract video metadata and transcript segments.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getAssetById,
  readDecryptedAsset,
  logAuditEvent,
  enqueueJob,
  getDatabase,
} from '@links/storage';
import { createDocEntry } from '@links/storage';
import { insertAsset } from '@links/storage';
import { writeEncryptedAsset } from '@links/storage';
import {
  parseMhtmlFile,
  extractTranscriptFromHtml,
  isYouTubeMhtml,
} from '@links/ai';
import type { YouTubeTranscript, TranscriptSegment } from '@links/ai';
import { createHash } from 'node:crypto';

const logger = createLogger({ name: 'job:parse-youtube-html' });

/**
 * Parse YouTube HTML job handler
 */
export async function parseYoutubeHtmlHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    message: 'Starting YouTube HTML parsing',
  });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('parse_youtube_html job requires entry_id');
  }

  // 2. Get entry (must have asset_id for MHTML file)
  const entry = await getEntryById(ctx.entryId);
  if (!entry) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      message: 'Entry not found',
    });
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  // Get MHTML asset ID from source_context
  const mhtmlAssetId = entry.source_context?.mhtml_asset_id as string | undefined;
  if (!mhtmlAssetId) {
    throw new Error(`Entry ${ctx.entryId} has no MHTML asset reference in source_context`);
  }

  // 3. Get asset
  const asset = await getAssetById(mhtmlAssetId);
  if (!asset) {
    throw new Error(`MHTML asset not found: ${mhtmlAssetId}`);
  }

  logger.info({
    job_id: ctx.jobId,
    asset_id: asset.id,
    mime_type: asset.mime_type,
    size_bytes: asset.size_bytes,
    message: 'Loading MHTML file',
  });

  // 4. Read and decrypt MHTML file
  const mhtmlBuffer = await readDecryptedAsset(asset.storage_path);

  // 5. Verify it's a YouTube MHTML file
  if (!isYouTubeMhtml(mhtmlBuffer)) {
    throw new Error('File is not a YouTube MHTML archive');
  }

  // 6. Parse MHTML structure
  const { html, metadata } = parseMhtmlFile(mhtmlBuffer);

  logger.info({
    job_id: ctx.jobId,
    video_url: metadata.url,
    title: metadata.title,
    message: 'MHTML parsed successfully',
  });

  // 7. Extract transcript from HTML
  logger.info({
    job_id: ctx.jobId,
    html_length: html.length,
    has_ytInitialData: html.includes('ytInitialData'),
    has_transcriptRenderer: html.includes('transcriptRenderer'),
    has_transcriptSegment: html.includes('transcriptSegment'),
    has_transcriptCue: html.includes('transcriptCue'),
    has_engagementPanels: html.includes('engagementPanels'),
    message: 'HTML content analysis before transcript extraction',
  });

  const transcriptData = extractTranscriptFromHtml(html, metadata.url);

  if (!transcriptData) {
    throw new Error('No transcript data found in HTML');
  }

  if (transcriptData.transcript.length === 0) {
    throw new Error('Transcript has no segments - file may not contain transcript data');
  }

  // Prefer MHTML metadata title if available - it's unique per file and less prone to duplication
  // HTML og:title can be the same for multiple videos from the same channel or series
  let finalTitle = transcriptData.title;
  if (metadata.title && metadata.title.length > 3) {
    // Clean up MHTML title:
    // - Remove leading "(1)" or "(N)" prefix added by browser when saving
    // - Fix UTF-8 encoding artifacts (smart quotes, etc.)
    // - Remove trailing ellipsis from truncation
    const mhtmlTitle = metadata.title
      .replace(/^\(\d+\)\s*/, '') // Remove "(1) " prefix
      .replace(/├ó┬Ç┬ô|├ó┬Ç┬Ö|â€"|â€œ|â€™|â€Ž/g, '"') // Fix encoding issues (various smart quotes)
      .replace(/[…\s]+$/, '') // Remove trailing ellipsis and whitespace
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();

    // Use MHTML title if it's reasonably long and different from the HTML title
    // (MHTML title is per-file, so any difference indicates uniqueness)
    if (mhtmlTitle.length > 5 && mhtmlTitle !== finalTitle) {
      finalTitle = mhtmlTitle;
      logger.info({
        job_id: ctx.jobId,
        html_title: transcriptData.title,
        mhtml_title: mhtmlTitle,
        msg: 'Using MHTML title (unique per file)',
      });
    }
  }

  // Update transcriptData with the final title
  transcriptData.title = finalTitle;

  logger.info({
    job_id: ctx.jobId,
    video_title: finalTitle,
    transcript_segments: transcriptData.transcript.length,
    key_moments: transcriptData.key_moments?.length || 0,
    message: 'Transcript extracted from HTML',
  });

  // 8. Convert transcript to searchable text format
  const transcriptText = transcriptData.transcript
    .map((seg: TranscriptSegment) => {
      const speaker = seg.speaker ? `[${seg.speaker}] ` : '';
      return `[${seg.start_time}] ${speaker}${seg.text}`;
    })
    .join('\n\n');

  // 9. Store transcript JSON as encrypted asset
  const transcriptJson = JSON.stringify({
    ...transcriptData,
    extracted_at: Date.now(),
    parser_source: 'html',
    mhtml_asset_id: asset.id,
    mhtml_filename: asset.original_filename,
  }, null, 2);

  const transcriptBuffer = Buffer.from(transcriptJson, 'utf-8');
  const sha256 = createHash('sha256').update(transcriptBuffer).digest('hex');

  const storagePath = await writeEncryptedAsset(sha256, transcriptBuffer);

  const transcriptAsset = await insertAsset({
    sha256,
    size_bytes: transcriptBuffer.length,
    mime_type: 'application/json',
    original_filename: `transcript_${transcriptData.video_id}.json`,
    storage_path: storagePath,
  });

  logger.info({
    job_id: ctx.jobId,
    asset_id: transcriptAsset.id,
    message: 'Stored transcript JSON as encrypted asset',
  });

  // 10. Create new doc entry with transcript
  const transcriptEntry = await createDocEntry({
    pot_id: entry.pot_id,
    asset_id: transcriptAsset.id,
    capture_method: 'html_parser',
    source_url: transcriptData.url,
    source_title: transcriptData.title,
    notes: transcriptData.channel ? `Video by ${transcriptData.channel}` : undefined,
  });

  // 11. Update the entry with content_text (for searchability) and metadata
  const db = getDatabase();
  await db
    .updateTable('entries')
    .set({
      content_text: transcriptText,
      source_context_json: JSON.stringify({
        transcript: true,
        video_id: transcriptData.video_id,
        platform: 'youtube',
        duration_seconds: transcriptData.duration_seconds,
        channel: transcriptData.channel,
        segments_count: transcriptData.transcript.length,
        key_moments_count: transcriptData.key_moments?.length || 0,
        citations_count: transcriptData.citations?.length || 0,
        parser_source: 'html',
        mhtml_asset_id: asset.id,
        extracted_at: Date.now(),
      }),
      updated_at: Date.now(),
    })
    .where('id', '=', transcriptEntry.id)
    .execute();

  logger.info({
    job_id: ctx.jobId,
    transcript_entry_id: transcriptEntry.id,
    message: 'Created transcript entry with searchable text',
  });

  // 12. Update original link entry to mark parsing complete
  await db
    .updateTable('entries')
    .set({
      source_context_json: JSON.stringify({
        ...entry.source_context,
        parse_status: 'done',
        transcript_entry_id: transcriptEntry.id,
        parsed_at: Date.now(),
      }),
      updated_at: Date.now(),
    })
    .where('id', '=', entry.id)
    .execute();

  // 13. Log audit event
  await logAuditEvent({
    actor: 'system',
    action: 'youtube_html_parsed',
    pot_id: entry.pot_id,
    entry_id: transcriptEntry.id,
    metadata: {
      original_entry_id: entry.id,
      mhtml_asset_id: asset.id,
      video_url: transcriptData.url,
      video_id: transcriptData.video_id,
      transcript_length: transcriptText.length,
      segments_count: transcriptData.transcript.length,
    },
  });

  // 14. Enqueue tag_entry job for the transcript
  await enqueueJob({
    job_type: 'tag_entry',
    pot_id: entry.pot_id,
    entry_id: transcriptEntry.id,
    priority: 50,
  });

  logger.info({
    job_id: ctx.jobId,
    transcript_entry_id: transcriptEntry.id,
    message: 'Enqueued tag_entry job for transcript',
  });
}
