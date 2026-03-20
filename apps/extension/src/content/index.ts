import type { PageData, YoutubeMetadata } from '../shared/types.js';

// ── YouTube metadata extraction ───────────────────────────────────────────────
function getYouTubeMetadata(): YoutubeMetadata | null {
  // Try ytInitialData first (most reliable)
  try {
    const ytData = (window as unknown as Record<string, unknown>)['ytInitialData'] as Record<string, unknown> | undefined;
    if (ytData) {
      // Extract videoId from URL
      const videoId = new URLSearchParams(window.location.search).get('v') ?? '';

      // Try to extract duration from player data
      let duration: string | null = null;
      try {
        const playerData = (window as unknown as Record<string, unknown>)['ytInitialPlayerConfig'] as Record<string, unknown> | undefined;
        if (playerData) {
          const videoDetails = (playerData as { args?: { length_seconds?: string } }).args;
          if (videoDetails?.length_seconds) {
            const seconds = parseInt(videoDetails.length_seconds, 10);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            duration = `${mins}:${secs.toString().padStart(2, '0')}`;
          }
        }
      } catch {
        // duration stays null
      }

      // Try to extract channel name
      let channel: string | null = null;
      try {
        const channelEl = document.querySelector('ytd-channel-name yt-formatted-string') ??
          document.querySelector('#owner-name a') ??
          document.querySelector('.ytd-video-owner-renderer #channel-name');
        channel = channelEl?.textContent?.trim() ?? null;
      } catch {
        // channel stays null
      }

      if (videoId) {
        return { videoId, duration, channel };
      }
    }
  } catch {
    // Fall through to meta tag fallback
  }

  // Fallback: URL params and meta tags
  const videoId = new URLSearchParams(window.location.search).get('v') ?? '';
  if (!videoId) return null;

  const channelEl = document.querySelector('[itemprop="author"] [itemprop="name"]');
  const channel = channelEl?.getAttribute('content') ?? null;

  const durationEl = document.querySelector('[itemprop="duration"]');
  const durationRaw = durationEl?.getAttribute('content') ?? null; // ISO 8601 e.g. PT4M13S
  let duration: string | null = null;
  if (durationRaw) {
    const match = durationRaw.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (match) {
      const h = parseInt(match[1] ?? '0', 10);
      const m = parseInt(match[2] ?? '0', 10);
      const s = parseInt(match[3] ?? '0', 10);
      duration = h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
    }
  }

  return { videoId, duration, channel };
}

// ── Get surrounding text around current selection ─────────────────────────────
function getSurroundingText(): string | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;

  const range = selection.getRangeAt(0);
  const container = range.startContainer.parentElement;
  if (!container) return undefined;

  // Walk up to find a meaningful paragraph or section
  let el: Element | null = container;
  for (let i = 0; i < 3; i++) {
    if (!el?.parentElement) break;
    el = el.parentElement;
    const tag = el.tagName.toLowerCase();
    if (['p', 'article', 'section', 'div', 'li', 'blockquote'].includes(tag)) break;
  }

  const fullText = el?.textContent?.trim() ?? '';
  // Limit to 500 chars to avoid huge payloads
  return fullText.length > 500 ? fullText.substring(0, 500) + '…' : fullText;
}

// ── Toast notification ────────────────────────────────────────────────────────
let toastEl: HTMLElement | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, variant: 'success' | 'error' = 'success'): void {
  // Clean up existing toast
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }

  const toast = document.createElement('div');
  toast.id = 'links-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    padding: 12px 18px;
    background: ${variant === 'success' ? '#131A21' : '#1E1215'};
    color: ${variant === 'success' ? '#D6BF74' : '#D06A6A'};
    border: 1px solid ${variant === 'success' ? 'rgba(214, 191, 116, 0.4)' : 'rgba(208, 106, 106, 0.4)'};
    border-radius: 10px;
    font-family: Inter, system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
    max-width: 320px;
    word-break: break-word;
    transition: opacity 300ms ease, transform 300ms ease;
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
  `;

  document.body.appendChild(toast);
  toastEl = toast;

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  });

  // Auto-dismiss after 3s
  toastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => {
      toast.remove();
      if (toastEl === toast) toastEl = null;
    }, 300);
  }, 3000);
}

// ── Page data collector ───────────────────────────────────────────────────────
function getPageData(): PageData {
  const isYouTube =
    window.location.hostname.includes('youtube.com') ||
    window.location.hostname.includes('youtu.be');

  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() || null;
  const surroundingText = selectedText ? getSurroundingText() : undefined;

  const metaDescEl = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const metaDescription = metaDescEl?.content ?? undefined;

  return {
    url: window.location.href,
    title: document.title,
    selectedText,
    surroundingText,
    metaDescription,
    isYouTube,
    youtubeMetadata: isYouTube ? getYouTubeMetadata() : null,
  };
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;

  switch (message.type as string) {
    case 'GET_PAGE_DATA':
      sendResponse(getPageData());
      return false;

    case 'SHOW_TOAST':
      showToast(
        message.message as string,
        (message.variant as 'success' | 'error') ?? 'success',
      );
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});
