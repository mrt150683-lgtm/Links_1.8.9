/**
 * Video Transcription Job Handler
 *
 * Transcribes video content from URLs (YouTube, Rumble, etc) using AI
 */

import { createLogger } from '@links/logging';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getAIPreferences,
  logAuditEvent,
  enqueueJob,
} from '@links/storage';
import { createDocEntry } from '@links/storage';
import { insertAsset } from '@links/storage';
import { writeEncryptedAsset } from '@links/storage';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:transcribe-video' });
const PROMPTS_DIR = getPromptsDir();

/**
 * Transcript JSON response types
 */
interface TranscriptSegment {
  start_time: string;
  end_time: string;
  speaker?: string;
  text: string;
}

interface KeyMoment {
  timestamp: string;
  description: string;
}

interface Citation {
  timestamp: string;
  reference: string;
}

interface TranscriptResponse {
  video_id: string;
  platform: string;
  title: string;
  duration_seconds: number;
  transcript: TranscriptSegment[];
  key_moments?: KeyMoment[];
  citations?: Citation[];
}

/**
 * Transcribe video job handler
 */
export async function transcribeVideoHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    message: 'Starting video transcription',
  });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('transcribe_video job requires entry_id');
  }

  // 2. Get entry (must have source_url or link_url for video)
  const entry = await getEntryById(ctx.entryId);
  if (!entry) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      message: 'Entry not found',
    });
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  // Get video URL from either source_url (for text entries) or link_url (for link entries)
  const videoUrl = entry.link_url || entry.source_url;
  if (!videoUrl) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      type: entry.type,
      message: 'Entry has no video URL (link_url or source_url)',
    });
    throw new Error(`Entry ${ctx.entryId} has no video URL`);
  }

  // 3. Get AI preferences and check for configured model
  const prefs = await getAIPreferences();
  const model = prefs.task_models?.video_transcription;

  if (!model) {
    throw new Error(
      'No video_transcription model configured. Set a video transcription model in Settings > AI Provider to transcribe videos.'
    );
  }

  const temperature = prefs.temperature ?? 0.2;
  const maxTokens = prefs.max_tokens ?? 8000;

  logger.info({
    job_id: ctx.jobId,
    model,
    video_url_domain: new URL(videoUrl).hostname,
    message: 'Loading video transcription prompt',
  });

  // 4. Load prompt and interpolate
  const promptPath = join(PROMPTS_DIR, 'transcribe_video', 'v1.md');
  const prompt: PromptTemplate = loadPromptFromFile(promptPath);

  const messages = interpolatePrompt(prompt, { video_url: videoUrl });
  const aiMessages = [
    { role: 'system' as const, content: messages.system || '' },
    { role: 'user' as const, content: messages.user || '' },
  ];

  logger.info({
    job_id: ctx.jobId,
    model,
    temperature: prompt.metadata.temperature ?? temperature,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
    message: 'Calling AI for video transcription',
  });

  // 5. Call AI
  const response = await createChatCompletion({
    model,
    messages: aiMessages,
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    response_format: prompt.metadata.response_format === 'json_object' ? { type: 'json_object' } : undefined,
  });

  const aiOutput = response.choices[0]?.message?.content;
  if (!aiOutput) {
    throw new Error('AI response is empty');
  }

  // 6. Parse JSON (strip markdown code blocks if present)
  let cleanedOutput = aiOutput.trim();

  // Remove markdown code blocks: ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleanedOutput = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedOutput);
  } catch (error) {
    logger.error({
      job_id: ctx.jobId,
      error: error instanceof Error ? error.message : String(error),
      response_preview: aiOutput.substring(0, 200),
      cleaned_preview: cleanedOutput.substring(0, 200),
    });
    throw new Error('AI returned invalid JSON');
  }

  // 7. Validate schema (basic runtime checks)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('transcript' in parsed) ||
    !Array.isArray((parsed as any).transcript)
  ) {
    logger.error({
      job_id: ctx.jobId,
      error: 'Invalid transcript response structure',
      response: parsed,
    });
    throw new Error('AI returned invalid transcript structure - missing transcript array');
  }

  const transcriptData = parsed as TranscriptResponse;

  // Basic validation of required fields
  if (!transcriptData.title || !transcriptData.platform || transcriptData.transcript.length === 0) {
    logger.warn({
      job_id: ctx.jobId,
      message: 'Transcript missing some fields',
      has_title: !!transcriptData.title,
      has_platform: !!transcriptData.platform,
      segments_count: transcriptData.transcript.length,
    });
  }

  logger.info({
    job_id: ctx.jobId,
    video_title: transcriptData.title,
    transcript_segments: transcriptData.transcript.length,
    key_moments: transcriptData.key_moments?.length || 0,
    citations: transcriptData.citations?.length || 0,
    message: 'Video transcription completed',
  });

  // 8. Convert transcript to plain text for content_text
  const transcriptText = transcriptData.transcript
    .map((seg: TranscriptSegment) => {
      const speaker = seg.speaker ? `[${seg.speaker}] ` : '';
      return `[${seg.start_time}] ${speaker}${seg.text}`;
    })
    .join('\n\n');

  // 9. Store transcript JSON as encrypted asset
  const transcriptJson = JSON.stringify({
    ...transcriptData,
    generated_at: Date.now(),
    model_id: model,
    prompt_version: `${prompt.metadata.id}/${prompt.metadata.version}`,
  }, null, 2);

  const transcriptBuffer = Buffer.from(transcriptJson, 'utf-8');
  const sha256 = createHash('sha256').update(transcriptBuffer).digest('hex');

  const storagePath = await writeEncryptedAsset(sha256, transcriptBuffer);

  const asset = await insertAsset({
    sha256,
    size_bytes: transcriptBuffer.length,
    mime_type: 'application/json',
    original_filename: `transcript_${transcriptData.video_id}.json`,
    storage_path: storagePath,
  });

  logger.info({
    job_id: ctx.jobId,
    asset_id: asset.id,
    message: 'Stored transcript JSON as encrypted asset',
  });

  // 10. Create new doc entry with transcript
  const transcriptEntry = await createDocEntry({
    pot_id: entry.pot_id,
    asset_id: asset.id,
    capture_method: 'ai_transcription',
    source_url: videoUrl,
    source_title: transcriptData.title,
    notes: `Video transcript generated by ${model}`,
  });

  // Update the entry with content_text (for searchability)
  const { getDatabase } = await import('@links/storage');
  const db = getDatabase();
  await db
    .updateTable('entries')
    .set({
      content_text: transcriptText,
      source_context_json: JSON.stringify({
        transcript: true,
        video_id: transcriptData.video_id,
        platform: transcriptData.platform,
        duration_seconds: transcriptData.duration_seconds,
        segments_count: transcriptData.transcript.length,
        key_moments_count: transcriptData.key_moments?.length || 0,
        citations_count: transcriptData.citations?.length || 0,
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

  // 11. Log audit event
  await logAuditEvent({
    actor: 'system',
    action: 'video_transcription_completed',
    pot_id: entry.pot_id,
    entry_id: transcriptEntry.id,
    metadata: {
      original_entry_id: entry.id,
      video_url_domain: new URL(videoUrl).hostname,
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
      transcript_length: transcriptText.length,
      segments_count: transcriptData.transcript.length,
    },
  });

  // 12. Enqueue tag_entry job for the transcript
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
