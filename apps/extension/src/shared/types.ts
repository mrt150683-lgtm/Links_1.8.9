export interface ExtSettings {
  endpoint: string;        // default: 'http://127.0.0.1:3000'
  token: string | null;
  defaultPotId: string | null;
  defaultPotName: string | null;
  appUrl: string;          // default: 'http://127.0.0.1:5173'
}

export interface CaptureStatus {
  type: 'idle' | 'saving' | 'success' | 'error';
  message: string;
  timestamp: number;
}

export interface Pot {
  id: string;
  name: string;
  description: string | null;
}

export interface CaptureResult {
  id: string;
  pot_id: string;
  message?: string;
}

// Messages from content script → background
export type Message =
  | { type: 'CAPTURE_SELECTION'; text: string; pageUrl: string; pageTitle: string; surroundingText?: string }
  | { type: 'CAPTURE_PAGE'; url: string; title: string; excerpt?: string }
  | { type: 'CAPTURE_YOUTUBE'; url: string; title: string; mhtmlDataUrl: string }
  | { type: 'CAPTURE_IMAGE'; imageUrl: string; pageUrl: string; pageTitle: string }
  | { type: 'GET_STATUS' }
  | { type: 'SET_STATUS'; status: CaptureStatus }
  | { type: 'GET_PAGE_DATA' }
  | { type: 'SHOW_TOAST'; message: string; variant?: 'success' | 'error' };

// Response from background to content
export type MessageResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

// Page data returned by content script
export interface PageData {
  url: string;
  title: string;
  selectedText: string | null;
  surroundingText?: string;
  metaDescription?: string;
  isYouTube: boolean;
  youtubeMetadata?: YoutubeMetadata | null;
}

export interface YoutubeMetadata {
  videoId: string;
  duration: string | null;
  channel: string | null;
}
