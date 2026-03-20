/**
 * Voice Addon v1 Routes — Phases A–G
 *
 * POST /voice/process          — full STT → Chat → TTS pipeline (Phases C+D+E)
 * GET  /voice/health           — service status
 * GET  /voice/settings         — voice settings
 * PUT  /voice/settings         — update settings
 * GET  /voice/voices           — list/discover voices
 * POST /voice/voices/preview   — preview a voice (Phase E)
 * POST /voice/session/start    — start session
 * POST /voice/session/stop     — stop session
 * POST /voice/session/interruption — signal barge-in
 * POST /voice/transcript/commit — log text-only commit (legacy/manual)
 * GET  /voice/sessions/:id     — get session record
 * POST /voice/test/stt         — test STT in isolation (Phase C)
 * POST /voice/test/tts         — test TTS in isolation (Phase E)
 */

import type { FastifyPluginAsync } from 'fastify';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import {
  getVoiceSettings,
  updateVoiceSettings,
  countVoiceVoices,
  countActiveSessions,
  listVoiceVoices,
  createVoiceSession,
  getVoiceSession,
  stopVoiceSession,
  incrementSessionInterruptionCount,
  incrementSessionTurnCount,
  insertVoiceSessionEvent,
  getVoiceVoiceById,
} from '@links/storage';
import {
  VoiceSettingsSchema,
  StartSessionBodySchema,
  StopSessionBodySchema,
  InterruptionBodySchema,
  TranscriptCommitBodySchema,
} from '@links/core';
import { createLogger } from '@links/logging';
import { logAuditEvent } from '@links/storage';
import { discoverAndIndexVoices, resolveVoicesDir, parseVoiceFilename, upsertDiscoveredVoice } from '../voice/voiceDiscovery.js';
import {
  VoiceRuntime,
  registerRuntime,
  getRuntime,
  removeRuntime,
} from '../voice/voiceRuntime.js';
import { VoiceRuntimeState } from '../voice/types.js';
import { PlaceholderVADAdapter } from '../voice/adapters/vadAdapter.js';
import { PlaceholderSTTAdapter } from '../voice/adapters/sttAdapter.js';
import { PlaceholderTTSAdapter } from '../voice/adapters/ttsAdapter.js';
import { PlaceholderPlaybackController } from '../voice/adapters/playbackController.js';
import { PlaceholderChatAdapter } from '../voice/adapters/chatAdapter.js';
import { WhisperSTTAdapter } from '../voice/adapters/whisperSTTAdapter.js';
import { ChatBridgeAdapter } from '../voice/adapters/chatBridgeAdapter.js';
import { PiperTTSAdapter } from '../voice/adapters/piperTTSAdapter.js';
import { VOICE_EVENTS } from '../voice/types.js';

const logger = createLogger({ name: 'voice-routes' });

// ── Module-level real adapters (lazily configured) ────────────────────────

const openRouterSTT = new WhisperSTTAdapter();
const chatBridge = new ChatBridgeAdapter();
const piperTTS = new PiperTTSAdapter();
let piperConfigured = false;

/** Lazy-initialise Piper with the user's selected voice (or first available). */
async function ensurePiperConfigured(): Promise<void> {
  if (piperConfigured) return;

  await discoverAndIndexVoices().catch(() => {});

  const settings = await getVoiceSettings();
  let voice = settings.selected_voice_id
    ? await getVoiceVoiceById(settings.selected_voice_id)
    : null;

  // If the selected voice file doesn't exist at its stored path (e.g. stale DB
  // entry from a different install or dev environment), fall through to discovery.
  if (voice && !existsSync(voice.source_path)) {
    voice = null;
  }

  if (!voice) {
    const voices = await listVoiceVoices(true);
    // Pick first voice whose .onnx file actually exists on this machine.
    // Avoids using stale DB entries left over from a different install path.
    voice = voices.find((v) => existsSync(v.source_path)) ?? null;
  }

  if (voice) {
    piperTTS.configure(voice.id, voice.source_path);
    piperConfigured = true;
  }
}

const SessionIdParamSchema = z.object({ id: z.string() });

export const voiceRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /voice/health ───────────────────────────────────────────────────
  fastify.get('/voice/health', async (_request, reply) => {
    const [voices_available, active_sessions, settings] = await Promise.all([
      countVoiceVoices(),
      countActiveSessions(),
      getVoiceSettings(),
    ]);

    return reply.status(200).send({
      ok: true,
      service: 'voice',
      voices_available,
      active_sessions,
      settings_loaded: settings.id === 1,
      piper_ready: piperTTS.isReady(),
      time: new Date().toISOString(),
    });
  });

  // ── GET /voice/settings ─────────────────────────────────────────────────
  fastify.get('/voice/settings', async (_request, reply) => {
    const settings = await getVoiceSettings();
    return reply.status(200).send({ settings });
  });

  // ── PUT /voice/settings ─────────────────────────────────────────────────
  fastify.put('/voice/settings', async (request, reply) => {
    const input = VoiceSettingsSchema.parse(request.body);
    const settings = await updateVoiceSettings(input);

    // If voice changed, re-configure Piper on next process call
    if (input.selected_voice_id) {
      piperConfigured = false;
    }

    await logAuditEvent({
      actor: 'user',
      action: 'update_voice_settings',
      metadata: { fields: Object.keys(input) },
    });

    logger.info({ msg: 'voice settings updated', fields: Object.keys(input) });
    return reply.status(200).send({ settings });
  });

  // ── GET /voice/voices ───────────────────────────────────────────────────
  fastify.get('/voice/voices', async (_request, reply) => {
    await discoverAndIndexVoices();
    const voices = await listVoiceVoices();
    return reply.status(200).send({ voices, count: voices.length });
  });

  // ── POST /voice/voices/preview ───────────────────────────────────────── (Phase E)
  fastify.post('/voice/voices/preview', async (request, reply) => {
    const body = z
      .object({ voice_id: z.string(), text: z.string().max(200).optional() })
      .parse(request.body);

    const voice = await getVoiceVoiceById(body.voice_id);
    if (!voice) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Voice not found',
        statusCode: 404,
      });
    }

    const previewPiper = new PiperTTSAdapter();
    previewPiper.configure(voice.id, voice.source_path);

    if (!previewPiper.isReady()) {
      return reply.status(200).send({
        tts_available: false,
        message: 'Piper binary not found. Place piper.exe in a piper/ folder next to the app.',
      });
    }

    const previewText =
      body.text ??
      `Hello, this is a preview of the ${voice.display_name} voice.`;

    const result = await previewPiper.synthesize(previewText);
    return reply.status(200).send({
      tts_available: !!result.audio_buffer,
      audio_base64: result.audio_buffer?.toString('base64') ?? null,
      voice_id: voice.id,
      display_name: voice.display_name,
      latency_ms: result.latency_ms,
    });
  });

  // ── POST /voice/voices/import ─────────────────────────────────────────────
  fastify.post('/voice/voices/import', async (request, reply) => {
    let voiceFilename = '';
    let voiceBuffer: Buffer | null = null;
    let configBuffer: Buffer | null = null;

    try {
      // Allow up to 500 MB — Piper models can be 30–200 MB
      const parts = request.parts({ limits: { fileSize: 500 * 1024 * 1024 } });
      for await (const part of parts) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          if (part.fieldname === 'voice_file') {
            voiceFilename = part.filename || '';
            voiceBuffer = buf;
          } else if (part.fieldname === 'config_file') {
            configBuffer = buf;
          }
        }
      }
    } catch (err) {
      return reply.status(400).send({ error: 'BadRequest', message: `Failed to parse multipart: ${String(err)}`, statusCode: 400 });
    }

    if (!voiceBuffer || !voiceFilename.endsWith('.onnx')) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'voice_file (.onnx) is required. Filename must match: {lang}-{speaker}-{quality}.onnx',
        statusCode: 400,
      });
    }

    if (!parseVoiceFilename(voiceFilename)) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'Cannot parse filename. Use pattern: en_US-amy-medium.onnx (lang_code-speaker-quality)',
        statusCode: 400,
      });
    }

    const voicesDir = resolveVoicesDir();
    if (!existsSync(voicesDir)) {
      mkdirSync(voicesDir, { recursive: true });
    }

    const destPath = join(voicesDir, voiceFilename);
    writeFileSync(destPath, voiceBuffer);
    if (configBuffer) {
      writeFileSync(destPath + '.json', configBuffer);
    }

    const voice = await upsertDiscoveredVoice(destPath, true);
    if (!voice) {
      return reply.status(500).send({ error: 'InternalError', message: 'Failed to index imported voice', statusCode: 500 });
    }

    // Reset Piper so next /voice/process uses updated voice list
    piperConfigured = false;

    await logAuditEvent({ actor: 'user', action: 'import_voice', metadata: { filename: voiceFilename } });
    logger.info({ msg: 'voice imported', filename: voiceFilename, voice_id: voice.id });

    return reply.status(200).send({ ok: true, voice });
  });

  // ── POST /voice/session/start ───────────────────────────────────────────
  fastify.post('/voice/session/start', async (request, reply) => {
    const body = StartSessionBodySchema.parse(request.body ?? {});

    const session = await createVoiceSession({
      voice_id: body.voice_id,
      stt_engine: body.stt_engine ?? 'openrouter',
      input_device: body.input_device,
      output_device: body.output_device,
      pot_id: body.pot_id,
    });

    // Instantiate runtime (adapters are server-side placeholders;
    // real STT/chat/TTS run in the /voice/process endpoint)
    const runtime = new VoiceRuntime({
      sessionId: session.id,
      vad: new PlaceholderVADAdapter(),
      stt: new PlaceholderSTTAdapter(),
      tts: new PlaceholderTTSAdapter(),
      playback: new PlaceholderPlaybackController(),
      chat: new PlaceholderChatAdapter(),
    });
    registerRuntime(runtime);

    await runtime.logEvent(VOICE_EVENTS.SESSION_STARTED, {
      voice_id: session.voice_id,
      stt_engine: session.stt_engine,
    });

    // Kick off Piper configuration in background (non-blocking)
    ensurePiperConfigured().catch(() => {});

    logger.info({ msg: 'voice session started', session_id: session.id });
    return reply.status(201).send({ session });
  });

  // ── POST /voice/session/stop ────────────────────────────────────────────
  fastify.post('/voice/session/stop', async (request, reply) => {
    const { session_id, error_message } = StopSessionBodySchema.parse(request.body);

    const session = await getVoiceSession(session_id);
    if (!session) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Voice session not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const runtime = getRuntime(session_id);
    if (runtime) {
      runtime.playback.stop();
      removeRuntime(session_id);
    }

    await stopVoiceSession(session_id, { error_message });
    await insertVoiceSessionEvent(session_id, VOICE_EVENTS.SESSION_STOPPED, {
      error_message: error_message ?? null,
    });

    logger.info({ msg: 'voice session stopped', session_id });
    return reply.status(200).send({ ok: true });
  });

  // ── POST /voice/session/interruption ────────────────────────────────────
  fastify.post('/voice/session/interruption', async (request, reply) => {
    const { session_id } = InterruptionBodySchema.parse(request.body);

    const session = await getVoiceSession(session_id);
    if (!session) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Voice session not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const runtime = getRuntime(session_id);
    if (runtime) {
      runtime.playback.stop();
    }

    await incrementSessionInterruptionCount(session_id);
    await insertVoiceSessionEvent(session_id, VOICE_EVENTS.INTERRUPTION_DETECTED);

    logger.info({ msg: 'voice interruption logged', session_id });
    return reply.status(200).send({ ok: true });
  });

  // ── POST /voice/transcript/commit ─────────────────────────────────────── (text-only)
  fastify.post('/voice/transcript/commit', async (request, reply) => {
    const body = TranscriptCommitBodySchema.parse(request.body);

    const session = await getVoiceSession(body.session_id);
    if (!session) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Voice session not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    await insertVoiceSessionEvent(
      body.session_id,
      VOICE_EVENTS.TRANSCRIPT_FINAL,
      { text: body.text, pot_id: body.pot_id ?? null, thread_id: body.thread_id ?? null },
      body.latency_ms,
    );

    logger.info({
      msg: 'voice transcript committed',
      session_id: body.session_id,
      text_len: body.text.length,
    });

    return reply.status(200).send({ ok: true, chat_response: null });
  });

  // ── POST /voice/process ──────────────────────────────────────────────── (Phases C+D+E)
  //
  // Full pipeline: transcript → Chat → TTS → response
  //
  // Accepts EITHER:
  //   application/json:  { session_id, transcript, pot_id?, thread_id? }
  //     → browser SpeechRecognition already did STT; skip server-side STT
  //   multipart/form-data:  { audio (file), session_id, pot_id?, thread_id? }
  //     → server-side STT via OpenRouter (fallback)
  //
  fastify.post('/voice/process', async (request, reply) => {
    let sessionId = '';
    let threadId: string | undefined;
    let potId: string | undefined;
    let transcript = '';

    const contentType = (request.headers['content-type'] ?? '').toLowerCase();

    if (contentType.includes('application/json')) {
      // ── JSON mode: browser already did STT ──────────────────────────────
      const body = request.body as Record<string, unknown>;
      sessionId = String(body.session_id ?? '').trim();
      transcript = String(body.transcript ?? '').trim();
      threadId = body.thread_id ? String(body.thread_id).trim() : undefined;
      potId = body.pot_id ? String(body.pot_id).trim() : undefined;

      if (!sessionId || !transcript) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'session_id and transcript are required',
          statusCode: 400,
        });
      }

      logger.info({ session_id: sessionId, text_len: transcript.length }, 'voice:process transcript received (browser STT)');

    } else {
      // ── Multipart mode: server-side STT (fallback) ────────────────────
      let audioBuffer: Buffer | null = null;
      let audioMimeType = 'audio/webm';

      try {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'audio') {
            audioBuffer = await part.toBuffer();
            audioMimeType = part.mimetype || 'audio/webm';
          } else if (part.type === 'field') {
            const val = String(part.value ?? '').trim();
            if (part.fieldname === 'session_id') sessionId = val;
            if (part.fieldname === 'thread_id' && val) threadId = val;
            if (part.fieldname === 'pot_id' && val) potId = val;
          }
        }
      } catch (err) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'Failed to parse multipart request',
          statusCode: 400,
        });
      }

      if (!sessionId || !audioBuffer || audioBuffer.length < 100) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'session_id and non-empty audio are required',
          statusCode: 400,
        });
      }

      // Server-side STT via OpenRouter
      const sttStart = Date.now();
      try {
        const sttResult = await openRouterSTT.transcribeFinal(audioBuffer, audioMimeType);
        transcript = sttResult.text.trim();
        const sttLatency = Date.now() - sttStart;

        await insertVoiceSessionEvent(
          sessionId,
          VOICE_EVENTS.TRANSCRIPT_FINAL,
          { text: transcript, pot_id: potId ?? null, thread_id: threadId ?? null },
          sttLatency,
        );

        logger.info({ session_id: sessionId, text_len: transcript.length, latency_ms: sttLatency }, 'voice:process STT done');
      } catch (err) {
        logger.error({ err, session_id: sessionId }, 'voice:process STT failed');
        await insertVoiceSessionEvent(sessionId, VOICE_EVENTS.ERROR, {
          stage: 'stt',
          error: String(err).slice(0, 200),
        });
        return reply.status(500).send({
          ok: false,
          session_id: sessionId,
          transcript: '',
          chat_response: '',
          audio_base64: null,
          tts_available: false,
          error: 'STT transcription failed',
        });
      }
    }

    const session = await getVoiceSession(sessionId);
    if (!session) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Voice session not found',
        statusCode: 404,
      });
    }

    const runtime = getRuntime(sessionId);

    if (!transcript) {
      // Silence / no speech — not an error
      return reply.status(200).send({
        ok: true,
        session_id: sessionId,
        transcript: '',
        chat_response: '',
        audio_base64: null,
        tts_available: false,
      });
    }

    // ── Step 2+3: Streaming Chat → TTS pipeline via SSE ───────────────────
    // Hijack the raw response so we can stream SSE events as sentences arrive.
    // This lets the browser start playing audio before the LLM finishes.
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache');
    raw.setHeader('Connection', 'keep-alive');
    raw.flushHeaders();

    const sendEvent = (event: string, data: object) => {
      try {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* client disconnected */ }
    };

    // Send transcript immediately — client can render it while audio buffers
    sendEvent('transcript', { text: transcript });

    await ensurePiperConfigured();

    let sentenceBuffer = '';
    let chunkIndex = 0;
    let fullText = '';
    let hadTTS = false;
    const chatStart = Date.now();

    // Flush a sentence through Piper and emit an SSE event
    const synthesizeAndSend = async (sentence: string): Promise<void> => {
      sentence = sentence.trim();
      if (!sentence) return;
      fullText += (fullText ? ' ' : '') + sentence;

      if (piperTTS.isReady()) {
        try {
          const ttsResult = await piperTTS.synthesize(sentence);
          if (ttsResult.audio_buffer && ttsResult.audio_buffer.length > 44) {
            sendEvent('audio_chunk', {
              index: chunkIndex++,
              text: sentence,
              audio_base64: ttsResult.audio_buffer.toString('base64'),
            });
            hadTTS = true;
            return;
          }
        } catch (err) {
          logger.warn({ err }, 'piper: synthesis failed for sentence — sending text');
        }
      }
      // No TTS for this sentence — send text so browser can use Web Speech API
      sendEvent('text_chunk', { index: chunkIndex++, text: sentence });
    };

    try {
      await runtime?.transition(VoiceRuntimeState.SubmittingToLLM);
      await insertVoiceSessionEvent(sessionId, VOICE_EVENTS.LLM_REQUEST_STARTED);

      for await (const token of chatBridge.streamSubmit({
        transcript,
        session_id: sessionId,
        thread_id: threadId,
        pot_id: potId,
      })) {
        sentenceBuffer += token;

        // Split on sentence-ending punctuation followed by whitespace.
        // Require ≥10 chars before the boundary to avoid splitting "Dr. " etc.
        const m = sentenceBuffer.match(/[.!?]["']?\s+/);
        if (m && m.index !== undefined && m.index >= 10) {
          const splitAt = m.index + m[0].length;
          const sentence = sentenceBuffer.slice(0, splitAt).trimEnd();
          sentenceBuffer = sentenceBuffer.slice(splitAt);
          await synthesizeAndSend(sentence);
        }
      }

      // Flush any remaining text
      if (sentenceBuffer.trim()) {
        await synthesizeAndSend(sentenceBuffer.trim());
      }

      const chatLatency = Date.now() - chatStart;
      await insertVoiceSessionEvent(
        sessionId,
        VOICE_EVENTS.LLM_REQUEST_COMPLETED,
        { text_len: fullText.length },
        chatLatency,
      );
      if (hadTTS) await runtime?.transition(VoiceRuntimeState.Speaking);

      logger.info({ session_id: sessionId, chunks: chunkIndex, latency_ms: chatLatency }, 'voice:process stream done');

      sendEvent('done', {
        ok: true,
        session_id: sessionId,
        full_text: fullText,
        tts_available: hadTTS,
      });
    } catch (err) {
      logger.error({ err, session_id: sessionId }, 'voice:process streaming failed');
      await insertVoiceSessionEvent(sessionId, VOICE_EVENTS.ERROR, {
        stage: 'chat_stream',
        error: String(err).slice(0, 200),
      });
      sendEvent('error', {
        ok: false,
        session_id: sessionId,
        transcript,
        message: 'Streaming pipeline failed',
      });
    } finally {
      await incrementSessionTurnCount(sessionId).catch(() => {});
      raw.end();
    }
  });

  // ── GET /voice/sessions/:id ──────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/voice/sessions/:id', async (request, reply) => {
    const { id } = SessionIdParamSchema.parse(request.params);
    const session = await getVoiceSession(id);

    if (!session) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Voice session not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    return reply.status(200).send({ session });
  });

  // ── POST /voice/test/stt ─────────────────────────────────────────────── (Phase C)
  fastify.post('/voice/test/stt', async (request, reply) => {
    let audioBuffer: Buffer | null = null;
    let mimeType = 'audio/webm';

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'audio') {
        audioBuffer = await part.toBuffer();
        mimeType = part.mimetype || 'audio/webm';
      }
    }

    if (!audioBuffer || audioBuffer.length < 100) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'audio field required (non-empty binary)',
        statusCode: 400,
      });
    }

    const result = await openRouterSTT.transcribeFinal(audioBuffer, mimeType);
    return reply.status(200).send({
      transcript: result.text,
      latency_ms: result.latency_ms,
    });
  });

  // ── POST /voice/test/tts ─────────────────────────────────────────────── (Phase E)
  fastify.post('/voice/test/tts', async (request, reply) => {
    const body = z
      .object({
        text: z.string().min(1).max(500),
        voice_id: z.string().optional(),
      })
      .parse(request.body);

    // Optionally reconfigure Piper with a specific voice
    if (body.voice_id) {
      const voice = await getVoiceVoiceById(body.voice_id);
      if (voice) {
        piperTTS.configure(voice.id, voice.source_path);
        piperConfigured = true;
      }
    } else {
      await ensurePiperConfigured();
    }

    if (!piperTTS.isReady()) {
      return reply.status(200).send({
        tts_available: false,
        message: 'Piper binary not found. Set PIPER_BIN env var or place piper.exe in a piper/ folder.',
      });
    }

    const result = await piperTTS.synthesize(body.text);
    if (!result.audio_buffer) {
      return reply.status(200).send({ tts_available: false });
    }

    return reply.status(200).send({
      tts_available: true,
      audio_base64: result.audio_buffer.toString('base64'),
      latency_ms: result.latency_ms,
      voice_id: result.voice_id,
    });
  });
};
