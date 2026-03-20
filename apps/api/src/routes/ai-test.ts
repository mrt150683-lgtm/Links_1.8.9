/**
 * Phase 6: AI Diagnostic Test Route
 *
 * Test endpoint for verifying OpenRouter connectivity and configuration
 */

import type { FastifyPluginAsync } from 'fastify';
import { createChatCompletion } from '@links/ai';
import { getPrompt, interpolatePrompt } from '@links/ai';

/**
 * AI test routes plugin
 */
export const aiTestRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /ai/test
   * Test OpenRouter API connectivity
   */
  fastify.post('/ai/test', async (request, reply) => {
    try {
      // Get diagnostic prompt
      const prompt = getPrompt('diagnostic', 1);
      const messages = interpolatePrompt(prompt, {});

      // Make test request
      const startTime = Date.now();
      const response = await createChatCompletion(
        {
          model: 'anthropic/claude-3-haiku', // Fast, cheap model for testing
          messages: [
            { role: 'system', content: messages.system },
            { role: 'user', content: messages.user },
          ],
          temperature: prompt.metadata.temperature,
          max_tokens: prompt.metadata.max_tokens,
        },
        5000 // 5 second timeout for diagnostic
      );

      const duration = Date.now() - startTime;
      const responseText = response.choices[0]?.message.content || '';

      return reply.status(200).send({
        success: true,
        model: response.model,
        response: responseText,
        usage: response.usage,
        duration_ms: duration,
        message: 'OpenRouter API connection successful',
      });
    } catch (error) {
      const err = error as Error;
      return reply.status(500).send({
        success: false,
        error: err.name,
        message: err.message,
      });
    }
  });
};
