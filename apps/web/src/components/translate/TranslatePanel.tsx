import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  EntryTranslation,
  EntryTranslationSummary,
  SupportedTranslationLanguage,
} from '@/lib/types';
import { SUPPORTED_TRANSLATION_LANGUAGES } from '@/lib/types';

interface TranslatePanelProps {
  entryId: string;
  sourceTextLength: number;
  entryTitle: string | null;
}

export function TranslatePanel({ entryId, sourceTextLength, entryTitle }: TranslatePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedTranslationLanguage>(
    SUPPORTED_TRANSLATION_LANGUAGES[0],
  );
  const [currentTranslation, setCurrentTranslation] = useState<EntryTranslation | null>(null);

  // Lightweight metadata query — no translated_text
  const { data: listData } = useQuery({
    queryKey: ['translations-list', entryId],
    queryFn: () => api.get<{ translations: EntryTranslationSummary[] }>(`/entries/${entryId}/translations`),
    enabled: !!entryId,
  });

  const available = listData?.translations ?? [];
  const availableSet = new Set(available.map((t) => t.target_language));

  // Estimated chunk count for display
  const estimatedChunks = Math.ceil(sourceTextLength / 6000); // ~6 chars/word → ~1000 words

  // Recall mutation (GET — no AI)
  const recallMutation = useMutation({
    mutationFn: (language: string) =>
      api.get<{ translation: EntryTranslation }>(
        `/entries/${entryId}/translations/${encodeURIComponent(language)}`,
      ),
    onSuccess: (data) => {
      setCurrentTranslation(data.translation);
      setIsOpen(true);
    },
  });

  // Translate mutation (POST — AI call)
  const translateMutation = useMutation({
    mutationFn: ({ language, force }: { language: string; force?: boolean }) =>
      api.post<{ translation: EntryTranslation; cached: boolean }>(`/entries/${entryId}/translate`, {
        target_language: language,
        force: force ?? false,
      }),
    onSuccess: (data) => {
      setCurrentTranslation(data.translation);
    },
  });

  const handleBadgeClick = (language: string) => {
    recallMutation.mutate(language);
  };

  const handleGo = () => {
    if (!selectedLanguage) return;
    translateMutation.mutate({ language: selectedLanguage });
  };

  const handleRetranslate = () => {
    if (!currentTranslation) return;
    translateMutation.mutate({ language: currentTranslation.target_language, force: true });
  };

  const handleDownload = () => {
    if (!currentTranslation) return;
    const safeTitle = (entryTitle ?? 'translation')
      .replace(/[^a-z0-9\s-]/gi, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60);
    const filename = `${safeTitle}_${currentTranslation.target_language_code}.txt`;

    const blob = new Blob([currentTranslation.translated_text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isLoading = translateMutation.isPending || recallMutation.isPending;
  const error = translateMutation.error || recallMutation.error;

  return (
    <div className="translate-panel">
      {/* Toolbar row */}
      <div className="translate-panel__toolbar">
        <button
          className={`btn-secondary btn-sm${isOpen ? ' translate-panel__toggle--active' : ''}`}
          onClick={() => setIsOpen((v) => !v)}
          title="Translate this entry"
        >
          🌐 Translate
        </button>

        {available.length > 0 && (
          <div className="translate-panel__available">
            {available.map((t) => (
              <button
                key={t.target_language}
                className={`translate-panel__lang-badge${
                  currentTranslation?.target_language === t.target_language
                    ? ' translate-panel__lang-badge--active'
                    : ''
                }`}
                onClick={() => handleBadgeClick(t.target_language)}
                title={`Recall ${t.target_language} translation`}
              >
                {t.target_language_code.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Picker row */}
      {isOpen && (
        <div className="translate-panel__picker">
          <select
            className="translate-panel__select"
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value as SupportedTranslationLanguage)}
            disabled={isLoading}
          >
            {SUPPORTED_TRANSLATION_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
                {availableSet.has(lang) ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <button
            className="btn-primary btn-sm"
            onClick={handleGo}
            disabled={isLoading}
          >
            Go
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="translate-panel__loading">
          <span className="translate-panel__spinner" />
          <span className="text-muted">
            {translateMutation.isPending
              ? `Translating… (~${estimatedChunks} chunk${estimatedChunks !== 1 ? 's' : ''})`
              : 'Loading…'}
          </span>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <p className="translate-panel__error">
          {(error as Error).message || 'Translation failed.'}
        </p>
      )}

      {/* Result */}
      {currentTranslation && !isLoading && (
        <div className="translate-panel__result">
          <div className="translate-panel__result-header">
            <span className="badge badge--gold">{currentTranslation.target_language}</span>
            <span className="text-muted" style={{ fontSize: '12px' }}>
              {new Date(currentTranslation.updated_at).toLocaleString()} ·{' '}
              <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                {currentTranslation.model_id}
              </span>{' '}
              · {currentTranslation.chunk_count} chunk{currentTranslation.chunk_count !== 1 ? 's' : ''}
            </span>
            <div className="translate-panel__result-actions">
              <button
                className="btn-secondary btn-sm"
                onClick={handleDownload}
                title="Download translation as .txt"
              >
                ⬇ Download
              </button>
              <button
                className="btn-secondary btn-sm"
                onClick={handleRetranslate}
                disabled={isLoading}
                title="Re-translate using AI"
              >
                🔄 Re-translate
              </button>
            </div>
          </div>
          <pre className="content-text">{currentTranslation.translated_text}</pre>
        </div>
      )}
    </div>
  );
}
