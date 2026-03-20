import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import folderIcon from '@/assets/icons/Folder.png?url';
import imageIcon from '@/assets/icons/image.png?url';
import docIcon from '@/assets/icons/doc.png?url';
import './AssetList.css';

interface Asset {
  id: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
  original_filename: string | null;
  created_at: number;
  storage_path: string;
}

interface AssetListProps {
  potId: string;
}

export function AssetList({ potId }: AssetListProps) {
  const { data: assetsData, isLoading } = useQuery({
    queryKey: ['pot-assets', potId],
    queryFn: () => api.get<{ assets: Asset[]; total: number }>(`/pots/${potId}/assets`),
  });

  const assets = assetsData?.assets ?? [];

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  const handleViewAsset = (assetId: string, _mimeType: string) => {
    // Open the asset download endpoint in a new tab
    // For images, browser will display inline; for docs, will download
    const url = `/api/assets/${assetId}/download`;
    window.open(url, '_blank');
  };

  if (isLoading) {
    return (
      <div className="asset-list__loading">
        <div className="skeleton" style={{ height: '120px' }} />
        <div className="skeleton" style={{ height: '120px' }} />
        <div className="skeleton" style={{ height: '120px' }} />
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="asset-list__empty">
        <img src={folderIcon} alt="No assets" style={{ width: '48px', height: '48px', objectFit: 'contain', marginBottom: '12px' }} />
        <h3>No assets yet</h3>
        <p className="text-muted">Upload images or documents to get started</p>
      </div>
    );
  }

  return (
    <div className="asset-list">
      {assets.map((asset) => (
        <div key={asset.id} className="asset-card panel">
          <div className="asset-card__header">
            <img
              src={asset.mime_type.startsWith('image/') ? imageIcon : docIcon}
              alt={asset.mime_type.startsWith('image/') ? 'Image' : 'Document'}
              className="asset-card__icon"
              style={{ width: '24px', height: '24px', objectFit: 'contain' }}
            />
            <div className="asset-card__info">
              <h4 className="asset-card__filename">
                {asset.original_filename || 'Unnamed file'}
              </h4>
              <div className="asset-card__meta text-muted">
                {formatBytes(asset.size_bytes)} • {asset.mime_type}
              </div>
            </div>
          </div>

          <div className="asset-card__details">
            <div className="asset-detail">
              <span className="asset-detail__label">SHA-256</span>
              <span className="asset-detail__value">{asset.sha256.slice(0, 16)}...</span>
            </div>
            <div className="asset-detail">
              <span className="asset-detail__label">Created</span>
              <span className="asset-detail__value">{formatDate(asset.created_at)}</span>
            </div>
          </div>

          <div className="asset-card__actions">
            <button
              className="btn-secondary btn-sm"
              onClick={() => handleViewAsset(asset.id, asset.mime_type)}
            >
              {asset.mime_type.startsWith('image/') ? '👁️ View' : '⬇️ Download'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
