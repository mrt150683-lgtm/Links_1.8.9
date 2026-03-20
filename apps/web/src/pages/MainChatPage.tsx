import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import MainChat from '../components/main-chat/MainChat';
import { createLinksMainChatAdapter } from '../components/main-chat/linksMainChatAdapter';
import type { ModelInfo } from '../components/pot-chat/potChatTypes';

export function MainChatPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => api.get<{ models: any[] }>('/models'),
  });

  const { data: aiSettings } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => api.get<any>('/prefs/ai'),
  });

  const updateChatModel = useMutation({
    mutationFn: (id: string) =>
      api.put('/prefs/ai', { task_models: { ...aiSettings?.task_models, chat: id || undefined } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-settings'] }),
  });

  const models: ModelInfo[] = (modelsData?.models ?? []).map((m: any) => ({
    id: m.name,
    displayName: m.name,
    contextWindowTokens: m.context_length ?? 128000,
  }));

  const selectedModelId = aiSettings?.task_models?.chat || aiSettings?.default_model || 'x-ai/grok-4.1-fast';

  const adapter = useMemo(() => createLinksMainChatAdapter(), []);

  return (
    <MainChat
      adapter={adapter}
      models={models.length > 0 ? models : [{ id: 'loading', displayName: 'Loading models...', contextWindowTokens: 128000 }]}
      selectedModelId={selectedModelId}
      onSelectedModelIdChange={(id) => updateChatModel.mutate(id)}
      onNavigateHome={() => navigate('/')}
    />
  );
}
