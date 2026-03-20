import {
  getSettings,
  saveLastStatus,
  getLastStatus,
} from '../shared/storage.js';
import {
  captureSelection,
  capturePage,
  captureImage,
  uploadAsset,
  ApiError,
} from '../shared/api.js';
import type { CaptureStatus, PageData, YoutubeMetadata } from '../shared/types.js';

// ── Context menu IDs ──────────────────────────────────────────────────────────
const MENU_SELECTION = 'links-save-selection';
const MENU_IMAGE = 'links-save-image';
const MENU_PAGE = 'links-save-page';
const MENU_YOUTUBE = 'links-save-youtube';

// ── Install: register context menus ──────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SELECTION,
    title: 'Links: Save selection',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: MENU_IMAGE,
    title: 'Links: Save image',
    contexts: ['image'],
  });

  chrome.contextMenus.create({
    id: MENU_PAGE,
    title: 'Links: Save page',
    contexts: ['page', 'frame'],
  });

  chrome.contextMenus.create({
    id: MENU_YOUTUBE,
    title: 'Links: Save for transcription',
    contexts: ['page'],
    documentUrlPatterns: ['*://*.youtube.com/*', '*://*.vimeo.com/*'],
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeClientCaptureId(): string {
  return crypto.randomUUID();
}

async function setStatus(status: CaptureStatus): Promise<void> {
  await saveLastStatus(status);
  // Notify any open popup
  chrome.runtime.sendMessage({ type: 'SET_STATUS', status }).catch(() => {
    // Popup may not be open — ignore
  });
}

async function showToastInTab(tabId: number, message: string, variant: 'success' | 'error' = 'success'): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_TOAST', message, variant });
  } catch {
    // Content script might not be ready in this tab — ignore
  }
}

function mapError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('network'))) {
    return 'Cannot reach Links API — is it running?';
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error occurred';
}

// ── Context menu click handler ────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;

  void handleContextMenu(info, tabId, tab.url ?? '', tab.title ?? '');
});

async function handleContextMenu(
  info: chrome.contextMenus.OnClickData,
  tabId: number,
  tabUrl: string,
  tabTitle: string,
): Promise<void> {
  console.log('[Links] Context menu clicked', {
    menuItemId: info.menuItemId,
    tabUrl,
    tabTitle,
    tabId,
  });

  const settings = await getSettings();

  if (!settings.token) {
    await setStatus({
      type: 'error',
      message: 'Not connected — open extension Options to set up',
      timestamp: Date.now(),
    });
    await showToastInTab(tabId, 'Not connected — open extension Options to set up', 'error');
    return;
  }

  if (!settings.defaultPotId) {
    await setStatus({
      type: 'error',
      message: 'No default pot selected — open extension Options',
      timestamp: Date.now(),
    });
    await showToastInTab(tabId, 'No default pot selected — open extension Options', 'error');
    return;
  }

  await setStatus({ type: 'saving', message: 'Saving…', timestamp: Date.now() });

  try {
    switch (info.menuItemId) {
      case MENU_SELECTION:
        await handleSaveSelection(info, tabId, tabUrl, tabTitle, settings.endpoint, settings.token, settings.defaultPotId);
        break;
      case MENU_IMAGE:
        await handleSaveImage(info, tabId, tabUrl, tabTitle, settings.endpoint, settings.token, settings.defaultPotId);
        break;
      case MENU_PAGE:
        await handleSavePage(tabId, tabUrl, tabTitle, settings.endpoint, settings.token, settings.defaultPotId);
        break;
      case MENU_YOUTUBE:
        await handleSaveYouTube(tabId, tabUrl, tabTitle, settings.endpoint, settings.token, settings.defaultPotId);
        break;
    }
  } catch (err) {
    const message = mapError(err);
    await setStatus({ type: 'error', message, timestamp: Date.now() });
    await showToastInTab(tabId, message, 'error');
  }
}

// ── Selection capture ─────────────────────────────────────────────────────────
async function handleSaveSelection(
  info: chrome.contextMenus.OnClickData,
  tabId: number,
  tabUrl: string,
  tabTitle: string,
  endpoint: string,
  token: string,
  potId: string,
): Promise<void> {
  // Get selected text + surrounding context from content script
  let selectedText = info.selectionText ?? '';
  let surroundingText: string | undefined;

  try {
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_DATA' }) as PageData;
    if (pageData.selectedText) selectedText = pageData.selectedText;
    surroundingText = pageData.surroundingText;
  } catch {
    // Content script unavailable — use info.selectionText
  }

  if (!selectedText.trim()) {
    const message = 'No text selected';
    await setStatus({ type: 'error', message, timestamp: Date.now() });
    await showToastInTab(tabId, message, 'error');
    return;
  }

  // Validate URL is present
  if (!tabUrl || !tabUrl.trim()) {
    const message = 'Cannot save selection — URL not available (may be a restricted tab)';
    await setStatus({ type: 'error', message, timestamp: Date.now() });
    await showToastInTab(tabId, message, 'error');
    return;
  }

  await captureSelection(endpoint, token, {
    pot_id: potId,
    text: selectedText,
    source_url: tabUrl,
    source_title: tabTitle,
    source_context: surroundingText ? { surrounding_text: surroundingText } : undefined,
    client_capture_id: makeClientCaptureId(),
  });

  const message = `Saved to pot`;
  await setStatus({ type: 'success', message, timestamp: Date.now() });
  await showToastInTab(tabId, `✓ Selection saved`, 'success');
}

// ── Image capture ─────────────────────────────────────────────────────────────
async function handleSaveImage(
  info: chrome.contextMenus.OnClickData,
  tabId: number,
  tabUrl: string,
  tabTitle: string,
  endpoint: string,
  token: string,
  potId: string,
): Promise<void> {
  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    const message = 'No image URL found';
    await setStatus({ type: 'error', message, timestamp: Date.now() });
    await showToastInTab(tabId, message, 'error');
    return;
  }

  // Fetch image as blob in background
  let imageBlob: Blob;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    imageBlob = await response.blob();
  } catch (err) {
    const message = `Could not fetch image: ${err instanceof Error ? err.message : 'unknown error'}`;
    await setStatus({ type: 'error', message, timestamp: Date.now() });
    await showToastInTab(tabId, message, 'error');
    return;
  }

  const filename = imageUrl.split('/').pop()?.split('?')[0] ?? 'image.jpg';
  const formData = new FormData();
  // Non-file fields MUST come before the file — @fastify/multipart only captures
  // fields that appear before the file part in the multipart stream.
  formData.append('pot_id', potId);
  formData.append('capture_method', 'extension_image');
  formData.append('source_url', tabUrl);
  formData.append('source_title', tabTitle);
  formData.append('client_capture_id', makeClientCaptureId());
  formData.append('file', imageBlob, filename); // file goes LAST

  await captureImage(endpoint, token, formData);

  await setStatus({ type: 'success', message: 'Image saved', timestamp: Date.now() });
  await showToastInTab(tabId, '✓ Image saved', 'success');
}

// ── Page capture ──────────────────────────────────────────────────────────────
async function handleSavePage(
  tabId: number,
  tabUrl: string,
  tabTitle: string,
  endpoint: string,
  token: string,
  potId: string,
): Promise<void> {
  // Validate URL is present (some tabs like chrome://, data:, etc. may not have accessible URLs)
  if (!tabUrl || !tabUrl.trim()) {
    const message = 'Cannot save page — URL not available (may be a restricted tab)';
    await setStatus({ type: 'error', message, timestamp: Date.now() });
    await showToastInTab(tabId, message, 'error');
    return;
  }

  let excerpt: string | undefined;

  try {
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_DATA' }) as PageData;
    excerpt = pageData.metaDescription;
  } catch {
    // Content script unavailable — proceed without excerpt
  }

  console.log('[Links] Saving page', { link_url: tabUrl, link_title: tabTitle, excerpt });

  await capturePage(endpoint, token, {
    pot_id: potId,
    link_url: tabUrl,
    link_title: tabTitle,
    content_text: excerpt,
    client_capture_id: makeClientCaptureId(),
  });

  await setStatus({ type: 'success', message: 'Page saved', timestamp: Date.now() });
  await showToastInTab(tabId, '✓ Page saved', 'success');
}

// ── YouTube / MHTML capture ───────────────────────────────────────────────────
async function handleSaveYouTube(
  tabId: number,
  tabUrl: string,
  tabTitle: string,
  endpoint: string,
  token: string,
  potId: string,
): Promise<void> {
  // Try MHTML capture
  let mhtmlBlob: Blob | null = null;
  let videoId = '';
  let videoTitle = tabTitle;

  // Get YouTube metadata from content script
  try {
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_DATA' }) as PageData;
    if (pageData.youtubeMetadata) {
      videoId = pageData.youtubeMetadata.videoId;
    }
    if (pageData.title) videoTitle = pageData.title;
  } catch {
    // Proceed without metadata
  }

  // Capture full MHTML snapshot
  try {
    const mhtmlBuffer = await chrome.pageCapture.saveAsMHTML({ tabId });
    mhtmlBlob = new Blob([mhtmlBuffer], { type: 'application/x-mimearchive' });
  } catch (err) {
    console.warn('[Links] MHTML capture failed, falling back to page capture:', err);
  }

  if (mhtmlBlob) {
    const filename = videoId ? `youtube_${videoId}.mhtml` : 'youtube_capture.mhtml';
    const formData = new FormData();
    // Non-file fields MUST come before the file
    formData.append('capture_method', 'extension_youtube');
    formData.append('source_url', tabUrl);
    formData.append('source_title', videoTitle);
    formData.append('client_capture_id', makeClientCaptureId());
    formData.append('file', mhtmlBlob, filename); // file goes LAST

    // Upload to /pots/:potId/assets — MHTML detection + parse_youtube_html job happen there
    await uploadAsset(endpoint, token, potId, formData);

    await setStatus({ type: 'success', message: `Saved for transcription · ${videoTitle}`, timestamp: Date.now() });
    await showToastInTab(tabId, `✓ Saved for transcription · ${videoTitle}`, 'success');
  } else {
    // Fallback: save as plain page capture
    await handleSavePage(tabId, tabUrl, videoTitle, endpoint, token, potId);
  }
}

// ── Message listener (from popup or content script) ───────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_STATUS') {
    getLastStatus().then((status) => sendResponse({ ok: true, data: status }));
    return true; // async response
  }
  return false;
});
