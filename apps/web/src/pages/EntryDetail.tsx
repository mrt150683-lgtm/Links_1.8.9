import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Entry, ArtifactResponse, TagsArtifact, ExtractedTextArtifact } from '@/lib/types';
import { DeleteConfirmModal } from '@/components/common/DeleteConfirmModal';
import { TranslatePanel } from '@/components/translate/TranslatePanel';
import '@/components/translate/TranslatePanel.css';
import './EntryDetail.css';

export function EntryDetailPage() {
  const { potId, entryId } = useParams<{ potId: string; entryId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const { data: entry, isLoading } = useQuery({
    queryKey: ['entry', entryId],
    queryFn: () => api.get<Entry>(`/entries/${entryId}`),
    enabled: !!entryId,
  });

  const { data: tagsArtifact } = useQuery({
    queryKey: ['tags', entryId],
    queryFn: () => api.get<ArtifactResponse>(`/entries/${entryId}/artifacts/tags/latest`),
    enabled: !!entryId,
    retry: false,
  });

  const { data: transcriptArtifact } = useQuery({
    queryKey: ['extracted_text', entryId],
    queryFn: () => api.get<ArtifactResponse>(`/entries/${entryId}/artifacts/extracted_text/latest`),
    enabled: !!entryId && entry?.type === 'audio',
    retry: false,
  });

  const deleteEntry = useMutation({
    mutationFn: () => api.delete(`/entries/${entryId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pot-entries', potId] });
      navigate(`/pots/${potId}`);
    },
  });

  const handleDeleteConfirm = async () => {
    await deleteEntry.mutateAsync();
  };

  if (isLoading) {
    return (
      <div className="entry-detail">
        <div className="skeleton" style={{ height: '60px', marginBottom: '24px' }} />
        <div className="entry-detail__layout">
          <div className="skeleton" style={{ height: '400px' }} />
          <div className="skeleton" style={{ height: '400px' }} />
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="entry-detail">
        <div className="entry-detail__error">
          <h2>Entry not found</h2>
          <button className="btn-secondary" onClick={() => navigate(`/pots/${potId}`)}>
            ← Back to Pot
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-detail">
      <div className="entry-detail__header">
        <button className="btn-ghost" onClick={() => navigate(`/pots/${potId}`)}>
          ← Back to Pot
        </button>

        <div className="entry-detail__actions">
          <button className="btn-secondary" onClick={() => setShowEditModal(true)}>
            ✏️ Edit Metadata
          </button>
          <button className="btn-secondary" disabled>
            Re-run Pipeline
          </button>
          <button className="btn-secondary" onClick={() => setShowDeleteModal(true)}>
            🗑️ Delete
          </button>
        </div>
      </div>

      {showDeleteModal && entry && (
        <DeleteConfirmModal
          title="Delete Entry"
          itemName={entry.source_title || `${entry.type} entry`}
          itemType="entry"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteModal(false)}
          isDeleting={deleteEntry.isPending}
        />
      )}

      {showEditModal && entry && (
        <EditMetadataModal
          entry={entry}
          onClose={() => setShowEditModal(false)}
          onSave={(updates) => {
            // TODO: Wire up when PATCH /entries/:id endpoint is added
            console.log('Metadata updates:', updates);
            setShowEditModal(false);
          }}
        />
      )}

      <div className="entry-detail__layout">
        <div className="entry-detail__content">
          <ContentPanel entry={entry} transcriptArtifact={transcriptArtifact} />
        </div>

        <div className="entry-detail__sidebar">
          <SourceCard entry={entry} />
          {entry.source_context && (entry.source_context as any).transcript && (
            <TranscriptInfoCard entry={entry} />
          )}
          {entry.type === 'audio' && transcriptArtifact && (
            <AudioTranscriptInfoCard artifact={transcriptArtifact} />
          )}
          {tagsArtifact && <TagsCard artifact={tagsArtifact} />}
          <MetadataCard entry={entry} />
        </div>
      </div>
    </div>
  );
}

interface ContentPanelProps {
  entry: Entry;
  transcriptArtifact?: ArtifactResponse;
}

function ContentPanel({ entry, transcriptArtifact }: ContentPanelProps) {
  // Resolve text available for translation
  const translatableText =
    entry.type === 'audio'
      ? ((transcriptArtifact?.payload as { text?: string })?.text ?? null)
      : entry.content_text ?? null;
  const hasTranslatableText = !!translatableText && translatableText.trim().length > 0;

  // Check if this is a transcript entry
  const isTranscript = entry.source_context && (entry.source_context as any).transcript;
  const parserSource = isTranscript ? (entry.source_context as any).parser_source : null;

  const typeIcons: Record<string, string> = {
    text: '📄',
    link: '🔗',
    image: '🖼️',
    doc: '📎',
    audio: '🎙️',
  };

  // Use video emoji for transcripts
  const icon = isTranscript ? '🎥' : (typeIcons[entry.type] || '📄');

  // Show better type label for transcripts
  const typeLabel = isTranscript
    ? (parserSource === 'html' ? 'YOUTUBE TRANSCRIPT' : 'VIDEO TRANSCRIPT')
    : entry.type === 'audio' ? 'AUDIO' : entry.type.toUpperCase();

  return (
    <div className="content-panel panel">
      <div className="content-panel__header">
        <div className="content-panel__type">
          <span className="content-panel__icon">{icon}</span>
          <span className="badge badge--gold">{typeLabel}</span>
        </div>

        {entry.source_title && <h2 className="content-panel__title">{entry.source_title}</h2>}
      </div>

      {entry.type === 'text' && entry.content_text && (
        <div className="content-panel__body">
          <pre className="content-text">{entry.content_text}</pre>
        </div>
      )}

      {entry.type === 'link' && (
        <div className="content-panel__body">
          <div className="link-preview">
            <div className="link-preview__url">
              <span className="text-muted">URL:</span>
              <a
                href={entry.link_url || entry.source_url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="link-preview__link"
              >
                {entry.link_url || entry.source_url}
              </a>
            </div>

            {entry.link_title && (
              <div className="link-preview__title">
                <strong>{entry.link_title}</strong>
              </div>
            )}

            {entry.content_text && (
              <div className="link-preview__excerpt">
                <p className="text-muted">Excerpt:</p>
                <p>{entry.content_text}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {entry.type === 'image' && entry.asset_id && <AssetPreview assetId={entry.asset_id} type="image" />}

      {entry.type === 'audio' && entry.asset_id && (
        <div className="content-panel__body">
          <div className="asset-preview">
            <div className="asset-preview__icon">🎙️</div>
            <div className="asset-preview__info">
              <h4>{entry.source_title || 'Audio File'}</h4>
              <p className="text-muted">Click "Download" to save the original audio file.</p>
              <div className="asset-preview__actions">
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = `/api/assets/${entry.asset_id}/download`;
                    link.download = '';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                >
                  ⬇️ Download Audio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {entry.type === 'audio' && transcriptArtifact && (
        <div className="content-panel__body">
          <h3>Transcript</h3>
          {(() => {
            const payload = transcriptArtifact.payload as ExtractedTextArtifact;
            return (
              <>
                {payload.language && (
                  <p className="text-muted" style={{ fontSize: '13px', marginBottom: '12px' }}>
                    Language: <strong>{payload.language.toUpperCase()}</strong> •
                    Model: <span style={{ fontFamily: 'monospace' }}>{transcriptArtifact.model_id}</span>
                  </p>
                )}
                <pre className="content-text">{payload.text}</pre>
              </>
            );
          })()}
        </div>
      )}

      {entry.type === 'audio' && !transcriptArtifact && (
        <div className="content-panel__body">
          <p className="text-muted">Transcript not yet available — transcription job is pending or in progress.</p>
        </div>
      )}

      {entry.type === 'doc' && entry.asset_id && <AssetPreview assetId={entry.asset_id} type="doc" />}

      {entry.type === 'doc' && entry.content_text && (
        <div className="content-panel__body">
          <h3>
            {entry.source_context && (entry.source_context as any).transcript
              ? 'Video Transcript'
              : 'Extracted Text'}
          </h3>

          {entry.source_url && entry.source_context && (entry.source_context as any).transcript && (
            <div className="transcript-header" style={{ marginBottom: '16px', padding: '12px', background: 'var(--surface-secondary)', borderRadius: '6px' }}>
              <p style={{ marginBottom: '8px' }}>
                <strong>Original Video:</strong>{' '}
                <a href={entry.source_url} target="_blank" rel="noopener noreferrer">
                  {entry.source_url}
                </a>
              </p>
              {entry.source_context && (entry.source_context as any).duration_seconds && (
                <p className="text-muted" style={{ fontSize: '14px' }}>
                  Duration: {Math.floor((entry.source_context as any).duration_seconds / 60)}:{String((entry.source_context as any).duration_seconds % 60).padStart(2, '0')} •
                  {' '}{(entry.source_context as any).segments_count || 0} segments
                  {(entry.source_context as any).key_moments_count > 0 && ` • ${(entry.source_context as any).key_moments_count} key moments`}
                  {(entry.source_context as any).citations_count > 0 && ` • ${(entry.source_context as any).citations_count} citations`}
                </p>
              )}
            </div>
          )}

          <pre className="content-text">{entry.content_text}</pre>
        </div>
      )}

      {hasTranslatableText && (
        <TranslatePanel
          entryId={entry.id}
          sourceTextLength={translatableText!.length}
          entryTitle={entry.source_title}
        />
      )}

      {entry.notes && (
        <div className="content-panel__notes">
          <h4>Notes</h4>
          <p>{entry.notes}</p>
        </div>
      )}
    </div>
  );
}

interface SourceCardProps {
  entry: Entry;
}

function SourceCard({ entry }: SourceCardProps) {
  const capturedDate = new Date(entry.captured_at).toLocaleString();
  const createdDate = new Date(entry.created_at).toLocaleString();

  return (
    <div className="meta-card panel">
      <h3 className="meta-card__title">Source</h3>

      <div className="meta-card__content">
        <div className="meta-row">
          <span className="meta-row__label">Capture Method</span>
          <span className="meta-row__value">
            <span className="badge">{entry.capture_method}</span>
          </span>
        </div>

        {entry.source_app && (
          <div className="meta-row">
            <span className="meta-row__label">Source App</span>
            <span className="meta-row__value">{entry.source_app}</span>
          </div>
        )}

        {entry.source_url && (
          <div className="meta-row">
            <span className="meta-row__label">Source URL</span>
            <span className="meta-row__value meta-row__value--url">
              <a href={entry.source_url} target="_blank" rel="noopener noreferrer">
                {entry.source_url}
              </a>
            </span>
          </div>
        )}

        <div className="meta-row">
          <span className="meta-row__label">Captured At</span>
          <span className="meta-row__value">{capturedDate}</span>
        </div>

        <div className="meta-row">
          <span className="meta-row__label">Created At</span>
          <span className="meta-row__value">{createdDate}</span>
        </div>

        {entry.client_capture_id && (
          <div className="meta-row">
            <span className="meta-row__label">Client Capture ID</span>
            <span className="meta-row__value text-muted">{entry.client_capture_id}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface MetadataCardProps {
  entry: Entry;
}

function MetadataCard({ entry }: MetadataCardProps) {
  return (
    <div className="meta-card panel">
      <h3 className="meta-card__title">Metadata</h3>

      <div className="meta-card__content">
        <div className="meta-row">
          <span className="meta-row__label">Entry ID</span>
          <span className="meta-row__value text-muted">{entry.id}</span>
        </div>

        <div className="meta-row">
          <span className="meta-row__label">Pot ID</span>
          <span className="meta-row__value text-muted">{entry.pot_id}</span>
        </div>

        <div className="meta-row">
          <span className="meta-row__label">Type</span>
          <span className="meta-row__value">
            <span className="badge badge--gold">{entry.type}</span>
          </span>
        </div>

        {entry.content_sha256 && (
          <div className="meta-row">
            <span className="meta-row__label">Content SHA-256</span>
            <span className="meta-row__value text-muted">{entry.content_sha256.slice(0, 16)}...</span>
          </div>
        )}

        {entry.source_context && (
          <div className="meta-row">
            <span className="meta-row__label">Source Context</span>
            <details className="meta-row__details">
              <summary>View JSON</summary>
              <pre className="meta-row__json">{JSON.stringify(entry.source_context, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

interface AssetPreviewProps {
  assetId: string;
  type: 'image' | 'doc';
}

function AssetPreview({ assetId, type }: AssetPreviewProps) {
  const handleViewAsset = () => {
    const url = `/api/assets/${assetId}/download`;
    window.open(url, '_blank');
  };

  const handleDownloadAsset = () => {
    const url = `/api/assets/${assetId}/download`;
    const link = document.createElement('a');
    link.href = url;
    link.download = ''; // Let the server set the filename
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (type === 'image') {
    return (
      <div className="content-panel__body">
        <div className="asset-preview-image">
          <img
            src={`/api/assets/${assetId}/download`}
            alt="Asset preview"
            className="asset-preview-image__img"
          />
          <div className="asset-preview-image__actions">
            <button className="btn-secondary btn-sm" onClick={handleDownloadAsset}>
              ⬇️ Download
            </button>
            <button className="btn-secondary btn-sm" onClick={handleViewAsset}>
              👁️ View Full Size
            </button>
          </div>
          <p className="text-muted" style={{ marginTop: '12px', fontSize: '12px' }}>
            Asset ID: {assetId}
          </p>
        </div>
      </div>
    );
  }

  // Doc preview (unchanged)
  return (
    <div className="content-panel__body">
      <div className="asset-preview">
        <div className="asset-preview__icon">
          📎
        </div>
        <div className="asset-preview__info">
          <h4>Asset Preview</h4>
          <p className="text-muted">Asset ID: {assetId}</p>
          <p className="text-muted">Click "Download" to save the document</p>
          <div className="asset-preview__actions">
            <button className="btn-secondary btn-sm" onClick={handleDownloadAsset}>
              ⬇️ Download
            </button>
            <button className="btn-secondary btn-sm" onClick={handleViewAsset}>
              📄 Open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface EditMetadataModalProps {
  entry: Entry;
  onClose: () => void;
  onSave: (updates: Partial<Entry>) => void;
}

function EditMetadataModal({ entry, onClose, onSave }: EditMetadataModalProps) {
  const [sourceTitle, setSourceTitle] = useState(entry.source_title || '');
  const [sourceUrl, setSourceUrl] = useState(entry.source_url || '');
  const [notes, setNotes] = useState(entry.notes || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const updates: Partial<Entry> = {
      source_title: sourceTitle || null,
      source_url: sourceUrl || null,
      notes: notes || null,
    };

    onSave(updates);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Edit Metadata</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal__form">
          <div className="form-field">
            <label htmlFor="source-title">Source Title</label>
            <input
              id="source-title"
              type="text"
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="Title or headline"
            />
          </div>

          <div className="form-field">
            <label htmlFor="source-url">Source URL</label>
            <input
              id="source-url"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com/article"
            />
          </div>

          <div className="form-field">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add your notes..."
              rows={5}
            />
          </div>

          <div className="edit-metadata__note">
            <p className="text-muted">
              ⚠️ Backend endpoint required: <code>PATCH /entries/:id</code>
            </p>
            <p className="text-muted">
              Clicking Save will log the updates to console until the endpoint is implemented.
            </p>
          </div>

          <div className="modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TranscriptInfoCardProps {
  entry: Entry;
}

function TranscriptInfoCard({ entry }: TranscriptInfoCardProps) {
  const transcriptContext = entry.source_context as any;

  if (!transcriptContext || !transcriptContext.transcript) {
    return null;
  }

  return (
    <div className="meta-card panel">
      <h3 className="meta-card__title">🎥 Video Transcript</h3>

      <div className="meta-card__content">
        <div className="meta-row">
          <span className="meta-row__label">Platform</span>
          <span className="meta-row__value">
            <span className="badge">{transcriptContext.platform || 'Unknown'}</span>
          </span>
        </div>

        {transcriptContext.video_id && (
          <div className="meta-row">
            <span className="meta-row__label">Video ID</span>
            <span className="meta-row__value text-muted">{transcriptContext.video_id}</span>
          </div>
        )}

        {transcriptContext.duration_seconds && (
          <div className="meta-row">
            <span className="meta-row__label">Duration</span>
            <span className="meta-row__value">
              {Math.floor(transcriptContext.duration_seconds / 60)}:{String(transcriptContext.duration_seconds % 60).padStart(2, '0')}
            </span>
          </div>
        )}

        {transcriptContext.segments_count && (
          <div className="meta-row">
            <span className="meta-row__label">Segments</span>
            <span className="meta-row__value">{transcriptContext.segments_count}</span>
          </div>
        )}

        {transcriptContext.key_moments_count > 0 && (
          <div className="meta-row">
            <span className="meta-row__label">Key Moments</span>
            <span className="meta-row__value badge badge--gold">{transcriptContext.key_moments_count}</span>
          </div>
        )}

        {transcriptContext.citations_count > 0 && (
          <div className="meta-row">
            <span className="meta-row__label">Citations</span>
            <span className="meta-row__value badge badge--gold">{transcriptContext.citations_count}</span>
          </div>
        )}

        {entry.asset_id && (
          <div className="meta-row" style={{ marginTop: '12px' }}>
            <button
              className="btn-secondary btn-sm"
              style={{ width: '100%' }}
              onClick={() => {
                const url = `/api/assets/${entry.asset_id}/download`;
                const link = document.createElement('a');
                link.href = url;
                link.download = 'transcript.json';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              📥 Download Full Transcript JSON
            </button>
          </div>
        )}

        <div className="meta-row" style={{ marginTop: '8px' }}>
          <p className="text-muted" style={{ fontSize: '12px', lineHeight: '1.4' }}>
            Full transcript with timestamps, key moments, and citations is available in the JSON asset.
          </p>
        </div>
      </div>
    </div>
  );
}

interface AudioTranscriptInfoCardProps {
  artifact: ArtifactResponse;
}

function AudioTranscriptInfoCard({ artifact }: AudioTranscriptInfoCardProps) {
  const payload = artifact.payload as ExtractedTextArtifact;
  const createdDate = new Date(artifact.created_at).toLocaleString();

  return (
    <div className="meta-card panel">
      <h3 className="meta-card__title">🎙️ Audio Transcription</h3>
      <div className="meta-card__content">
        {payload.language && (
          <div className="meta-row">
            <span className="meta-row__label">Language</span>
            <span className="meta-row__value">
              <span className="badge">{payload.language.toUpperCase()}</span>
            </span>
          </div>
        )}
        <div className="meta-row">
          <span className="meta-row__label">Characters</span>
          <span className="meta-row__value">{payload.text.length.toLocaleString()}</span>
        </div>
        <div className="meta-row">
          <span className="meta-row__label">Model</span>
          <span className="meta-row__value text-muted">{artifact.model_id}</span>
        </div>
        <div className="meta-row">
          <span className="meta-row__label">Transcribed</span>
          <span className="meta-row__value text-muted">{createdDate}</span>
        </div>
        <div className="meta-row">
          <span className="meta-row__label">Prompt</span>
          <span className="meta-row__value text-muted">
            {artifact.prompt_id} v{artifact.prompt_version}
          </span>
        </div>
      </div>
    </div>
  );
}

interface TagsCardProps {
  artifact: ArtifactResponse;
}

function TagsCard({ artifact }: TagsCardProps) {
  const payload = artifact.payload as TagsArtifact;
  const createdDate = new Date(artifact.created_at).toLocaleString();

  const typeColors: Record<string, string> = {
    topic: 'var(--primary)',
    method: 'var(--success)',
    domain: 'var(--gold-1)',
    sentiment: 'var(--accent)',
    other: 'var(--text-2)',
  };

  const typeIcons: Record<string, string> = {
    topic: '📌',
    method: '🔧',
    domain: '🏷️',
    sentiment: '💭',
    other: '🔖',
  };

  return (
    <div className="meta-card panel">
      <h3 className="meta-card__title">🤖 AI Tags</h3>

      <div className="meta-card__content">
        {payload.tags.length > 0 ? (
          <div className="tags-grid">
            {payload.tags.map((tag, idx) => (
              <div
                key={idx}
                className="tag-item"
                style={{ borderColor: typeColors[tag.type] }}
                title={`${tag.type} • Confidence: ${(tag.confidence * 100).toFixed(0)}%`}
              >
                <span className="tag-item__icon">{typeIcons[tag.type]}</span>
                <span className="tag-item__label">{tag.label}</span>
                <span className="tag-item__confidence">{(tag.confidence * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">No tags generated</p>
        )}

        <div className="tags-meta">
          <div className="meta-row">
            <span className="meta-row__label">Model</span>
            <span className="meta-row__value text-muted">{artifact.model_id}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__label">Generated</span>
            <span className="meta-row__value text-muted">{createdDate}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__label">Prompt Version</span>
            <span className="meta-row__value text-muted">
              {artifact.prompt_id} v{artifact.prompt_version}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
