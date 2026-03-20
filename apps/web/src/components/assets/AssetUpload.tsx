import { useState, useRef, DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import folderIcon from '@/assets/icons/Folder.png?url';
import videoIcon from '@/assets/icons/video.png?url';
import imageIcon from '@/assets/icons/image.png?url';
import docIcon from '@/assets/icons/doc.png?url';
import audioIcon from '@/assets/icons/text.png?url';
import './AssetUpload.css';

interface Asset {
  id: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
  original_filename: string | null;
  created_at: number;
}

interface UploadResult {
  created: boolean;
  asset: Asset;
  deduped: boolean;
  youtube_html_detected?: boolean;
  message?: string;
}

interface AssetUploadProps {
  potId: string;
  onUploadComplete?: () => void;
}

export function AssetUpload({ potId, onUploadComplete }: AssetUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const uploadAsset = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      // Simulate progress (real progress would need XHR or fetch with progress)
      const result = await api.upload<UploadResult>(`/pots/${potId}/assets`, formData);
      return { file, result };
    },
    onSuccess: ({ file, result }) => {
      setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }));
      setUploadResults((prev) => [...prev, result]);
      queryClient.invalidateQueries({ queryKey: ['pot-assets', potId] });
      onUploadComplete?.();
    },
    onError: (error, file) => {
      console.error('Upload failed:', error);
      setUploadProgress((prev) => ({ ...prev, [file.name]: -1 })); // -1 = error
    },
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;

    const fileArray = Array.from(files);
    setUploadResults([]);

    for (const file of fileArray) {
      setUploadProgress((prev) => ({ ...prev, [file.name]: 0 }));
      uploadAsset.mutate(file);
    }
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div className="asset-upload">
      <div
        className={`asset-upload__dropzone ${isDragging ? 'asset-upload__dropzone--active' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <img src={folderIcon} alt="Upload" className="asset-upload__icon" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
        <h3 className="asset-upload__title">Drop files here or click to browse</h3>
        <p className="asset-upload__hint text-muted">
          Images (PNG, JPG, GIF), audio (MP3, WAV, M4A, MP4, MOV, OGG, FLAC), documents (PDF, DOCX, TXT, MD), and YouTube archives (MHTML) up to 50MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,audio/*,video/mp4,video/quicktime,.pdf,.doc,.docx,.mhtml,.html,.txt,.md,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.mov"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </div>

      {Object.keys(uploadProgress).length > 0 && (
        <div className="asset-upload__progress">
          <h4>Uploading...</h4>
          {Object.entries(uploadProgress).map(([filename, progress]) => (
            <div key={filename} className="upload-progress-item">
              <div className="upload-progress-item__header">
                <span className="upload-progress-item__name">{filename}</span>
                {progress === -1 ? (
                  <span className="upload-progress-item__status upload-progress-item__status--error">
                    Failed
                  </span>
                ) : progress === 100 ? (
                  <span className="upload-progress-item__status upload-progress-item__status--success">
                    ✓
                  </span>
                ) : (
                  <span className="upload-progress-item__status">{progress}%</span>
                )}
              </div>
              <div className="upload-progress-item__bar">
                <div
                  className={`upload-progress-item__fill ${progress === -1 ? 'upload-progress-item__fill--error' : ''}`}
                  style={{ width: `${progress === -1 ? 100 : progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadResults.length > 0 && (
        <div className="asset-upload__results">
          <h4>Upload Results</h4>
          {uploadResults.map((result) => (
            <div key={result.asset.id} className="upload-result panel">
              <div className="upload-result__header">
                <img
                  src={result.youtube_html_detected ? videoIcon :
                       result.asset.mime_type.startsWith('image/') ? imageIcon :
                       result.asset.mime_type.startsWith('audio/') ? audioIcon : docIcon}
                  alt={result.youtube_html_detected ? 'Video' :
                       result.asset.mime_type.startsWith('image/') ? 'Image' :
                       result.asset.mime_type.startsWith('audio/') ? 'Audio' : 'Document'}
                  className="upload-result__icon"
                  style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                />
                <div className="upload-result__info">
                  <div className="upload-result__filename">
                    {result.asset.original_filename || 'Unnamed file'}
                  </div>
                  <div className="upload-result__meta text-muted">
                    {formatBytes(result.asset.size_bytes)} • {result.asset.mime_type}
                  </div>
                </div>
                {result.deduped && (
                  <span className="badge badge--gold">DEDUPLICATED</span>
                )}
                {result.youtube_html_detected && (
                  <span className="badge badge--gold">YOUTUBE TRANSCRIPT</span>
                )}
              </div>
              {result.youtube_html_detected && result.message && (
                <div className="upload-result__message" style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  background: 'var(--success-bg)',
                  border: '1px solid var(--success)',
                  borderRadius: '4px',
                  fontSize: '14px',
                  color: 'var(--success)',
                }}>
                  ✅ {result.message}
                </div>
              )}
              <div className="upload-result__sha256 text-muted">
                SHA-256: {result.asset.sha256.slice(0, 16)}...
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
