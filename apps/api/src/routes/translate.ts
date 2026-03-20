/**
 * Entry Translation Routes
 *
 * POST /entries/:entryId/translate           — translate entry content (synchronous, chunked)
 * GET  /entries/:entryId/translations        — list available translations (metadata only)
 * GET  /entries/:entryId/translations/:lang  — retrieve a stored translation
 *
 * Migration: 035_entry_translations.sql
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getEntryById,
  getLatestArtifact,
  getAIPreferences,
  logAuditEvent,
  getTranslation,
  upsertTranslation,
  listTranslationsForEntry,
  hashSourceText,
} from '@links/storage';
import { createChatCompletion } from '@links/ai';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'translate-routes' });

// ── Supported Languages ───────────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  Spanish: 'es',
  French: 'fr',
  'English (British)': 'en-GB',
  'American English': 'en-US',
  German: 'de',
  Greek: 'el',
  Portuguese: 'pt',
  'Chinese (Simplified)': 'zh-Hans',
  Japanese: 'ja',
  Arabic: 'ar',
  Hebrew: 'he',
};

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_MAP);

// ── Chunking ──────────────────────────────────────────────────────────────

/**
 * Split text into chunks of at most maxWords words, breaking on sentence boundaries.
 * A sentence boundary is a word ending with . ! or ?
 */
function chunkText(text: string, maxWords = 1000): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= maxWords) return [words.join(' ')];

  const chunks: string[] = [];
  let currentWords: string[] = [];
  let waitingForBoundary = false;

  for (const word of words) {
    currentWords.push(word);
    if (currentWords.length >= maxWords) {
      waitingForBoundary = true;
    }
    if (waitingForBoundary && /[.!?]$/.test(word)) {
      chunks.push(currentWords.join(' '));
      currentWords = [];
      waitingForBoundary = false;
    }
  }

  if (currentWords.length > 0) {
    chunks.push(currentWords.join(' '));
  }

  return chunks;
}

// ── Route Plugin ──────────────────────────────────────────────────────────

export const translateRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /entries/:entryId/translate ─────────────────────────────────

  fastify.post<{
    Params: { entryId: string };
    Body: { target_language: string; force?: boolean };
  }>('/entries/:entryId/translate', async (request, reply) => {
    const { entryId } = request.params;

    const BodySchema = z.object({
      target_language: z.string(),
      force: z.boolean().optional(),
    });

    let body: { target_language: string; force?: boolean };
    try {
      body = BodySchema.parse(request.body);
    } catch (err) {
      return reply.status(400).send({ error: 'ValidationError', message: 'Invalid request body' });
    }

    const { target_language, force = false } = body;

    // Validate language
    if (!SUPPORTED_LANGUAGES.includes(target_language)) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: `Unsupported language: "${target_language}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const langCode = LANGUAGE_MAP[target_language]!; // validated above

    // Load entry
    const entry = await getEntryById(entryId);
    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'Entry not found' });
    }

    // Resolve source text
    let sourceText: string | null = null;

    if (entry.type === 'audio') {
      const artifact = await getLatestArtifact(entryId, 'extracted_text');
      if (artifact) {
        const payload = artifact.payload as { text?: string };
        sourceText = payload?.text ?? null;
      }
    } else {
      sourceText = entry.content_text ?? null;
    }

    if (!sourceText || sourceText.trim().length === 0) {
      return reply.status(422).send({
        error: 'NoTranslatableText',
        message: 'This entry has no text content available for translation.',
      });
    }

    // Cache check (skip if force=true)
    if (!force) {
      const existing = await getTranslation(entryId, target_language);
      if (existing) {
        logger.info({ entryId, target_language }, 'Returning cached translation');
        return reply.send({ translation: existing, cached: true });
      }
    }

    // Resolve model
    const aiPrefs = await getAIPreferences();
    const modelId =
      aiPrefs.task_models?.translation ??
      aiPrefs.default_model ??
      'openai/gpt-4o-mini';

    // Chunk and translate
    const chunks = chunkText(sourceText);
    logger.info({ entryId, target_language, modelId, chunkCount: chunks.length }, 'Starting translation');

    const translatedChunks: string[] = [];
    let chunkIndex = 0;

    for (const chunk of chunks) {
      chunkIndex++;
      logger.debug({ entryId, chunk: chunkIndex, of: chunks.length }, 'Translating chunk');

      const systemPrompt = `You are a professional translator. Translate the provided text into ${target_language} (BCP-47: ${langCode}). Output ONLY the translated text. Preserve paragraph breaks. Do NOT add commentary, notes, or the original text.`;

      const response = await createChatCompletion(
        {
          model: modelId,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: chunk,
            },
          ],
          temperature: 0.2,
          max_tokens: 4096,
        },
        120_000,
      );

      const translatedChunk = response.choices?.[0]?.message?.content ?? '';
      translatedChunks.push(translatedChunk.trim());
    }

    const translatedText = translatedChunks.join('\n\n');
    const sourceHash = hashSourceText(sourceText);

    // Upsert into DB
    const translation = await upsertTranslation({
      entry_id: entryId,
      target_language,
      target_language_code: langCode,
      translated_text: translatedText,
      model_id: modelId,
      chunk_count: chunks.length,
      source_hash: sourceHash,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'translate_entry',
      entry_id: entryId,
      metadata: { target_language, model_id: modelId, chunks: chunks.length },
    });

    logger.info({ entryId, target_language, modelId }, 'Translation complete');

    return reply.send({ translation, cached: false });
  });

  // ── GET /entries/:entryId/translations ───────────────────────────────

  fastify.get<{ Params: { entryId: string } }>(
    '/entries/:entryId/translations',
    async (request, reply) => {
      const { entryId } = request.params;

      const entry = await getEntryById(entryId);
      if (!entry) {
        return reply.status(404).send({ error: 'NotFound', message: 'Entry not found' });
      }

      const translations = await listTranslationsForEntry(entryId);
      return reply.send({ translations });
    },
  );

  // ── GET /entries/:entryId/translations/:language ─────────────────────

  fastify.get<{ Params: { entryId: string; language: string } }>(
    '/entries/:entryId/translations/:language',
    async (request, reply) => {
      const { entryId, language } = request.params;
      const targetLanguage = decodeURIComponent(language);

      const translation = await getTranslation(entryId, targetLanguage);
      if (!translation) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `No translation found for language "${targetLanguage}"`,
        });
      }

      return reply.send({ translation });
    },
  );
};
