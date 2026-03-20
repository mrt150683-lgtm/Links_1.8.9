/**
 * Phase 6: Refresh Models Job Handler
 *
 * Fetches latest model list from OpenRouter and updates cache
 */

import { fetchModels } from '@links/ai';
import { replaceAllModels } from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:refresh-models' });

/**
 * Refresh models from OpenRouter
 */
export async function refreshModelsHandler(): Promise<void> {
  logger.info('Starting model refresh');

  try {
    // Fetch models from OpenRouter
    const response = await fetchModels();

    logger.info({
      count: response.data.length,
    }, 'Fetched models from OpenRouter');

    // Parse and transform models
    const models = response.data.map((model: typeof response.data[0]) => {
      // Parse pricing (comes as string, convert to number)
      const pricingPrompt = model.pricing?.prompt
        ? parseFloat(model.pricing.prompt)
        : undefined;
      const pricingCompletion = model.pricing?.completion
        ? parseFloat(model.pricing.completion)
        : undefined;

      // Extract modality from architecture
      const modalities = model.architecture?.modality ?? undefined;

      // Determine if model supports vision (check modality or name)
      const supportsVision =
        modalities?.includes('image') ||
        modalities?.includes('vision') ||
        model.id.toLowerCase().includes('vision') ||
        false;

      // Determine if model supports tools (check top_provider or assume modern models do)
      const supportsTools = model.top_provider != null;

      return {
        name: model.id,
        context_length: model.context_length,
        pricing_prompt: pricingPrompt,
        pricing_completion: pricingCompletion,
        supports_vision: supportsVision,
        supports_tools: supportsTools,
        architecture: model.architecture?.instruct_type ?? undefined,
        modalities: modalities,
        top_provider: model.top_provider != null ? JSON.stringify(model.top_provider) : undefined,
      };
    });

    // Replace all models in cache atomically
    const count = await replaceAllModels(models);

    logger.info({
      modelsUpdated: count,
    }, 'Model refresh complete');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Model refresh failed');
    throw error;
  }
}
