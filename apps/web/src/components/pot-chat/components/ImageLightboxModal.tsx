import React from 'react';

interface ImageLightboxModalProps {
  url: string;
  onClose(): void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({ url, onClose }) => {
  return (
    <div className="pot-chat__lightbox" onClick={onClose}>
      <button
        className="pot-chat__lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close lightbox"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <img
        src={url}
        alt="Fullscreen view"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};
