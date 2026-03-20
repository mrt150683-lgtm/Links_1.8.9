/**
 * MHTML Parser
 *
 * Parses MHTML (MIME HTML) files saved by browsers to extract HTML content
 * and metadata from YouTube saved pages.
 */

export interface MhtmlMetadata {
  url: string;
  title: string;
  savedAt: number;
  contentType: string;
}

export interface MhtmlParseResult {
  html: string;
  metadata: MhtmlMetadata;
}

/**
 * Parse MHTML file and extract HTML content
 *
 * MHTML structure:
 * ```
 * From: <Saved by Browser>
 * Snapshot-Content-Location: https://url
 * Subject: Page Title
 * Date: timestamp
 * MIME-Version: 1.0
 * Content-Type: multipart/related; boundary="----Boundary----"
 *
 * ------Boundary----
 * Content-Type: text/html
 * Content-Location: https://url
 *
 * <html>...</html>
 *
 * ------Boundary----
 * Content-Type: text/css
 * ...
 * ```
 */
export function parseMhtmlFile(content: Buffer): MhtmlParseResult {
  const text = content.toString('utf-8');

  // Extract metadata from headers
  const metadata = extractMhtmlMetadata(text);

  // Extract HTML section
  const html = extractHtmlFromMhtml(text);

  if (!html) {
    throw new Error('No HTML content found in MHTML file');
  }

  return {
    html,
    metadata,
  };
}

/**
 * Extract metadata from MHTML headers
 */
function extractMhtmlMetadata(mhtml: string): MhtmlMetadata {
  const lines = mhtml.split('\n');

  let url = '';
  let title = '';
  let dateStr = '';
  let contentType = 'text/html';

  // Parse headers (before first boundary)
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const line = lines[i];
    if (!line) continue;

    // Extract URL
    if (line.startsWith('Snapshot-Content-Location:')) {
      url = line.substring('Snapshot-Content-Location:'.length).trim();
    }

    // Extract title (may be encoded)
    if (line.startsWith('Subject:')) {
      const titleRaw = line.substring('Subject:'.length).trim();
      title = decodeHeaderValue(titleRaw);
    }

    // Extract date
    if (line.startsWith('Date:')) {
      dateStr = line.substring('Date:'.length).trim();
    }

    // Extract content type
    if (line.startsWith('Content-Type:') && line.includes('multipart')) {
      const parts = line.substring('Content-Type:'.length).split(';');
      if (parts[0]) {
        contentType = parts[0].trim();
      }
    }

    // Stop at first boundary (any format)
    if (line.startsWith('--') && line.length > 10 && !line.startsWith('--import')) {
      break;
    }
  }

  return {
    url,
    title,
    savedAt: dateStr ? new Date(dateStr).getTime() : Date.now(),
    contentType,
  };
}

/**
 * Extract the boundary string from MHTML headers
 */
function extractBoundary(mhtml: string): string | null {
  // Look for boundary in Content-Type header
  const boundaryMatch = mhtml.match(/boundary="([^"]+)"/i) || mhtml.match(/boundary=([^\s;]+)/i);
  if (boundaryMatch && boundaryMatch[1]) {
    return boundaryMatch[1];
  }
  return null;
}

/**
 * Extract HTML content from MHTML multipart structure
 */
function extractHtmlFromMhtml(mhtml: string): string {
  // First, try to find the actual boundary from headers
  const boundary = extractBoundary(mhtml);

  if (boundary) {
    // Split by boundary and find the text/html part
    const parts = mhtml.split('--' + boundary);

    // Try to find the MAIN HTML page first (prefer part with Content-Location matching main URL pattern)
    let mainHtmlContent: string | null = null;
    let fallbackHtmlContent: string | null = null;

    for (const part of parts) {
      // Check if this part is text/html
      if (!/Content-Type:\s*text\/html/i.test(part)) continue;

      // Extract the HTML content
      const headerBodySplit = part.indexOf('\r\n\r\n');
      const altSplit = part.indexOf('\n\n');
      const splitPos = headerBodySplit !== -1 ? headerBodySplit + 4 : (altSplit !== -1 ? altSplit + 2 : -1);

      if (splitPos === -1) continue;

      let htmlContent = part.substring(splitPos);

      // Check if this part uses quoted-printable encoding
      const headerSection = part.substring(0, splitPos);
      if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headerSection)) {
        htmlContent = decodeQuotedPrintable(htmlContent);
      }

      htmlContent = htmlContent.trim();

      // Check if this is the main page (look for Content-Location that's the main URL)
      // The main HTML should be the one without a nested resource path
      const contentLocMatch = headerSection.match(/Content-Location:\s*([^\r\n]+)/i);
      const contentLoc = (contentLocMatch && contentLocMatch[1]) ? contentLocMatch[1].trim() : '';

      // Prefer HTML section that looks like the main page:
      // - Has youtube.com/watch URL pattern
      // - Or has a simple path without nested resource indicators
      if (contentLoc && contentLoc.includes('youtube.com') && contentLoc.includes('watch')) {
        mainHtmlContent = htmlContent;
        break; // Prefer the first main page match
      }

      // Save as fallback in case no main page is found
      if (!fallbackHtmlContent) {
        fallbackHtmlContent = htmlContent;
      }
    }

    if (mainHtmlContent) return mainHtmlContent;
    if (fallbackHtmlContent) return fallbackHtmlContent;
  }

  // Fallback: try generic regex patterns
  // Try with common boundary patterns
  const patterns = [
    /Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?=------MultipartBoundary--|$)/i,
    /Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?=----boundary|$)/i,
    /Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\n--[^\n]+\n|$)/i,
  ];

  for (const pattern of patterns) {
    const match = mhtml.match(pattern);
    if (match && match[1]) {
      let htmlContent = match[1];
      if (mhtml.includes('Content-Transfer-Encoding: quoted-printable')) {
        htmlContent = decodeQuotedPrintable(htmlContent);
      }
      return htmlContent.trim();
    }
  }

  throw new Error('No HTML section found in MHTML file');
}

/**
 * Decode quoted-printable encoding
 *
 * Quoted-printable uses =XX for hex-encoded bytes and =\n for soft line breaks
 */
export function decodeQuotedPrintable(encoded: string): string {
  return encoded
    // Remove soft line breaks (=\n)
    .replace(/=\r?\n/g, '')
    // Decode =XX hex sequences
    .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Decode RFC 2047 encoded header values
 *
 * Format: =?utf-8?Q?encoded_text?=
 */
function decodeHeaderValue(encoded: string): string {
  // Handle RFC 2047 encoded words
  const rfc2047Pattern = /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi;

  return encoded.replace(rfc2047Pattern, (_, charset, encoding, text) => {
    if (encoding.toUpperCase() === 'Q') {
      // Quoted-printable (with _ for spaces)
      const unescaped = text.replace(/_/g, ' ');
      return decodeQuotedPrintable(unescaped);
    } else if (encoding.toUpperCase() === 'B') {
      // Base64
      return Buffer.from(text, 'base64').toString('utf-8');
    }
    return text;
  });
}

/**
 * Check if a file appears to be a YouTube MHTML file
 */
export function isYouTubeMhtml(content: Buffer): boolean {
  const text = content.toString('utf-8', 0, Math.min(content.length, 10000)); // Check first 10KB instead of 2KB

  // Check for MHTML structure
  if (!text.includes('MIME-Version:') && !text.includes('multipart/related')) {
    console.log('[MHTML Detection] No MIME-Version or multipart/related found');
    return false;
  }

  // Check for YouTube URL in multiple possible header formats
  const patterns = [
    /Snapshot-Content-Location:\s*(https?:\/\/(?:www\.)?youtube\.com|https?:\/\/youtu\.be)/i,
    /Content-Location:\s*(https?:\/\/(?:www\.)?youtube\.com|https?:\/\/youtu\.be)/i,
    /Subject:.*youtube/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      console.log('[MHTML Detection] YouTube URL pattern matched');
      return true;
    }
  }

  console.log('[MHTML Detection] No YouTube URL pattern found');
  return false;
}

/**
 * Extract video ID from YouTube URL
 */
export function extractVideoIdFromUrl(url: string): string | null {
  // youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch && watchMatch[1]) {
    return watchMatch[1];
  }

  // youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([^?]+)/);
  if (shortMatch && shortMatch[1]) {
    return shortMatch[1];
  }

  // youtube.com/embed/VIDEO_ID
  const embedMatch = url.match(/youtube\.com\/embed\/([^?]+)/);
  if (embedMatch && embedMatch[1]) {
    return embedMatch[1];
  }

  return null;
}
