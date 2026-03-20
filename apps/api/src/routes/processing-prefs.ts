/**
 * Journal Module: Processing Config Routes
 *
 * GET  /prefs/processing          — returns current processing.config merged with defaults
 * PATCH /prefs/processing/journal — deep-merge journal config patch
 */

import type { FastifyPluginAsync } from 'fastify';
import { getPreference, setPreference, logAuditEvent, DEFAULT_JOURNAL_CONFIG } from '@links/storage';
import type { ProcessingConfig, JournalConfig } from '@links/storage';
import { JournalConfigPatchSchema } from '@links/core';

const PROCESSING_CONFIG_KEY = 'processing.config';

export const processingPrefsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /prefs/processing
   * Returns the full processing config, merging defaults for any missing fields.
   */
  fastify.get('/prefs/processing', async (_request, reply) => {
    const stored = await getPreference<ProcessingConfig>(PROCESSING_CONFIG_KEY);

    const config: ProcessingConfig = {
      journal: {
        ...DEFAULT_JOURNAL_CONFIG,
        ...(stored?.journal ?? {}),
        budgets: {
          ...DEFAULT_JOURNAL_CONFIG.budgets,
          ...(stored?.journal?.budgets ?? {}),
        },
        behavior: {
          ...DEFAULT_JOURNAL_CONFIG.behavior,
          ...(stored?.journal?.behavior ?? {}),
        },
      },
    };

    return reply.status(200).send(config);
  });

  /**
   * PATCH /prefs/processing/journal
   * Deep-merge a journal config patch into the stored config.
   */
  fastify.patch('/prefs/processing/journal', async (request, reply) => {
    const validation = JournalConfigPatchSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid journal config patch',
        details: validation.error.format(),
      });
    }

    const patch = validation.data;

    // Read existing
    const stored = await getPreference<ProcessingConfig>(PROCESSING_CONFIG_KEY);
    const existingJournal: JournalConfig = {
      ...DEFAULT_JOURNAL_CONFIG,
      ...(stored?.journal ?? {}),
    };

    // Deep merge
    const updated: JournalConfig = {
      ...existingJournal,
      ...patch,
      scopes: { ...existingJournal.scopes, ...patch.scopes },
      daily: { ...existingJournal.daily, ...patch.daily },
      rollups: {
        ...existingJournal.rollups,
        ...patch.rollups,
        weekly: { ...existingJournal.rollups?.weekly, ...patch.rollups?.weekly },
        monthly: { ...existingJournal.rollups?.monthly, ...patch.rollups?.monthly },
        quarterly: { ...existingJournal.rollups?.quarterly, ...patch.rollups?.quarterly },
        yearly: { ...existingJournal.rollups?.yearly, ...patch.rollups?.yearly },
      },
      budgets: { ...existingJournal.budgets, ...patch.budgets },
      models: { ...existingJournal.models, ...patch.models },
      behavior: { ...existingJournal.behavior, ...patch.behavior },
    };

    const newConfig: ProcessingConfig = {
      ...(stored ?? {}),
      journal: updated,
    };

    await setPreference(PROCESSING_CONFIG_KEY, newConfig);

    await logAuditEvent({
      actor: 'user',
      action: 'processing_config_updated',
      metadata: {
        section: 'journal',
        patch: patch as Record<string, unknown>,
        journal_enabled: updated.enabled,
      },
    });

    return reply.status(200).send({ journal: updated });
  });
};
