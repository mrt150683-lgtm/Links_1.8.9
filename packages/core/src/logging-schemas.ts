import { z } from 'zod';

/**
 * System logging preferences schema
 */
export const LoggingPreferencesSchema = z.object({
    enabled: z.boolean(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
});

export type LoggingPreferencesValue = z.infer<typeof LoggingPreferencesSchema>;
