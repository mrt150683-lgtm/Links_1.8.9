/**
 * YouTube Transcript Parser
 *
 * Extracts transcript data from YouTube HTML saved pages.
 * Handles multiple transcript formats and data structures.
 */

export interface TranscriptSegment {
  start_time: string; // MM:SS format
  start_seconds: number; // for sorting
  end_time?: string;
  speaker?: string;
  text: string;
}

export interface KeyMoment {
  timestamp: string;
  description: string;
}

export interface Citation {
  timestamp: string;
  reference: string;
}

export interface YouTubeTranscript {
  video_id: string;
  url: string;
  title: string;
  duration_seconds: number;
  channel?: string;
  published_date?: string;
  description?: string;
  transcript: TranscriptSegment[];
  key_moments?: KeyMoment[];
  citations?: Citation[];
}

/**
 * Extract transcript from YouTube HTML
 *
 * Tries multiple extraction methods in priority order:
 * 1. ytInitialData JSON object
 * 2. Transcript panel HTML elements
 * 3. JSON-LD structured data
 * 4. Meta tags and fallback patterns
 */
export function extractTranscriptFromHtml(html: string, videoUrl: string): YouTubeTranscript | null {
  // Extract video ID from URL
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    throw new Error('Could not extract video ID from URL');
  }

  // Try different extraction methods
  let transcript: YouTubeTranscript | null = null;

  // Method 1: Parse ytInitialData (most comprehensive)
  transcript = parseYtInitialData(html, videoId, videoUrl);
  if (transcript && transcript.transcript.length > 0) {
    return transcript;
  }

  // Method 2: Parse HTML DOM elements (most reliable for saved MHTML pages)
  transcript = parseTranscriptHtmlElements(html, videoId, videoUrl);
  if (transcript && transcript.transcript.length > 0) {
    return transcript;
  }

  // Method 3: Parse transcript panel HTML (older regex patterns)
  transcript = parseTranscriptPanel(html, videoId, videoUrl);
  if (transcript && transcript.transcript.length > 0) {
    return transcript;
  }

  // Method 4: Parse engagement panels (transcript tab via JSON regex)
  transcript = parseEngagementPanels(html, videoId, videoUrl);
  if (transcript && transcript.transcript.length > 0) {
    return transcript;
  }

  // If no transcript found, still try to get metadata
  const metadata = extractMetadata(html, videoId, videoUrl);
  if (metadata) {
    return metadata;
  }

  return null;
}

/**
 * Extract a complete JSON object from a string starting at the given position.
 * Uses bracket counting to handle nested objects correctly.
 */
function extractJsonObject(str: string, startIndex: number): string | null {
  if (str[startIndex] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return str.substring(startIndex, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse ytInitialData JSON object embedded in page
 */
function parseYtInitialData(html: string, videoId: string, videoUrl: string): YouTubeTranscript | null {
  // Look for: var ytInitialData = {...};
  // Use bracket counting instead of regex to handle huge nested JSON
  const marker = 'var ytInitialData = ';
  let startIdx = html.indexOf(marker);
  if (startIdx === -1) {
    // Try alternate pattern (some pages use window["ytInitialData"])
    const altMarker = 'window["ytInitialData"] = ';
    startIdx = html.indexOf(altMarker);
    if (startIdx === -1) return null;
    startIdx += altMarker.length;
  } else {
    startIdx += marker.length;
  }

  const jsonStr = extractJsonObject(html, startIdx);
  if (!jsonStr) {
    return null;
  }

  try {
    const ytData = JSON.parse(jsonStr);

    // Extract video details
    const videoDetails = ytData?.videoDetails;
    const title = videoDetails?.title || 'Unknown Title';
    const duration = parseInt(videoDetails?.lengthSeconds || '0', 10);
    const channel = videoDetails?.author || undefined;
    const description = videoDetails?.shortDescription || undefined;

    // Extract transcript from engagement panels
    const panels = ytData?.engagementPanels || [];
    const transcriptPanel = panels.find((p: any) =>
      p?.engagementPanelSectionListRenderer?.panelIdentifier?.includes('transcript')
    );

    const transcript: TranscriptSegment[] = [];

    if (transcriptPanel) {
      const content = transcriptPanel?.engagementPanelSectionListRenderer?.content;
      const transcriptRenderer = content?.transcriptRenderer || content?.transcriptSearchPanelRenderer;

      if (transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups) {
        const cueGroups = transcriptRenderer.body.transcriptBodyRenderer.cueGroups;

        for (const group of cueGroups) {
          const cues = group?.transcriptCueGroupRenderer?.cues || [];

          for (const cue of cues) {
            const cueRenderer = cue?.transcriptCueRenderer;
            if (!cueRenderer) continue;

            const startMs = parseInt(cueRenderer.startOffsetMs || '0', 10);
            const durationMs = parseInt(cueRenderer.durationMs || '0', 10);
            const text = cueRenderer.cue?.simpleText || '';

            if (text) {
              transcript.push({
                start_time: formatTimestamp(startMs / 1000),
                start_seconds: startMs / 1000,
                end_time: formatTimestamp((startMs + durationMs) / 1000),
                text: text.trim(),
              });
            }
          }
        }
      }
    }

    // Extract chapters/key moments
    const key_moments: KeyMoment[] = [];
    const chapters = ytData?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;

    if (chapters) {
      for (const marker of chapters) {
        const value = marker?.value;
        if (value?.chapters) {
          for (const chapter of value.chapters) {
            const chapterRenderer = chapter?.chapterRenderer;
            if (chapterRenderer) {
              const timeMs = parseInt(chapterRenderer.timeRangeStartMillis || '0', 10);
              const title = chapterRenderer.title?.simpleText || '';

              if (title) {
                key_moments.push({
                  timestamp: formatTimestamp(timeMs / 1000),
                  description: title,
                });
              }
            }
          }
        }
      }
    }

    return {
      video_id: videoId,
      url: videoUrl,
      title,
      duration_seconds: duration,
      channel,
      description,
      transcript,
      key_moments: key_moments.length > 0 ? key_moments : undefined,
    };
  } catch (error) {
    // JSON parsing failed, continue to next method
    return null;
  }
}

/**
 * Parse transcript from rendered HTML DOM elements (MHTML saved pages)
 *
 * When a YouTube page is saved as MHTML with the transcript panel open,
 * the transcript segments are rendered as HTML elements:
 *   <ytd-transcript-segment-renderer>
 *     <div class="segment-timestamp">0:00</div>
 *     <yt-formatted-string class="segment-text">text</yt-formatted-string>
 *   </ytd-transcript-segment-renderer>
 */
function parseTranscriptHtmlElements(html: string, videoId: string, videoUrl: string): YouTubeTranscript | null {
  const transcript: TranscriptSegment[] = [];

  // Match timestamp + text pairs from rendered transcript segments
  const segmentPattern = /<div class="segment-timestamp[^"]*"[^>]*>\s*([\d:]+)\s*<\/div>[\s\S]*?<yt-formatted-string class="segment-text[^"]*"[^>]*>([\s\S]*?)<\/yt-formatted-string>/g;

  let match;
  while ((match = segmentPattern.exec(html)) !== null) {
    if (!match[1] || !match[2]) continue;

    const timestamp = match[1].trim();
    const text = match[2]
      .replace(/<[^>]+>/g, '')        // strip nested HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/\u200B/g, '')         // zero-width space
      .replace(/\s+/g, ' ')
      .trim();

    if (timestamp && text) {
      const seconds = parseTimeToSeconds(timestamp);
      transcript.push({
        start_time: timestamp,
        start_seconds: seconds,
        text,
      });
    }
  }

  if (transcript.length === 0) {
    return null;
  }

  // Get metadata from page
  const metadata = extractMetadata(html, videoId, videoUrl);

  return {
    ...metadata,
    transcript,
  };
}

/**
 * Parse transcript from HTML panel structure
 */
function parseTranscriptPanel(html: string, videoId: string, videoUrl: string): YouTubeTranscript | null {
  // Look for transcript segments in HTML
  // Pattern: <div class="segment">...<span class="time">0:12</span>...<span class="text">...</span>...</div>

  const transcript: TranscriptSegment[] = [];

  // Try to match transcript segment patterns
  const segmentPattern = /<[^>]*cue[^>]*>[\s\S]*?<[^>]*time[^>]*>([^<]+)<[\s\S]*?<[^>]*text[^>]*>([^<]+)</gi;
  let match;

  while ((match = segmentPattern.exec(html)) !== null) {
    if (!match[1] || !match[2]) continue;

    const timeStr = match[1].trim();
    const text = match[2].trim();

    if (timeStr && text) {
      const seconds = parseTimeToSeconds(timeStr);
      transcript.push({
        start_time: timeStr,
        start_seconds: seconds,
        text: decodeHtmlEntities(text),
      });
    }
  }

  if (transcript.length === 0) {
    return null;
  }

  // Get basic metadata
  const metadata = extractMetadata(html, videoId, videoUrl);

  return {
    ...metadata,
    transcript,
  };
}

/**
 * Parse engagement panels for transcript data
 */
function parseEngagementPanels(html: string, videoId: string, videoUrl: string): YouTubeTranscript | null {
  // Try to find transcriptSegmentListRenderer directly in the HTML
  // This handles cases where the transcript was open when the page was saved
  const transcript: TranscriptSegment[] = [];

  // Pattern: transcriptSegmentRenderer with startMs and snippet text
  const segmentPattern = /"transcriptSegmentRenderer"\s*:\s*\{[^}]*?"startMs"\s*:\s*"(\d+)"[^}]*?"snippet"\s*:\s*\{[^}]*?"runs"\s*:\s*\[([\s\S]*?)\]/g;
  let match;

  while ((match = segmentPattern.exec(html)) !== null) {
    if (!match[1] || !match[2]) continue;

    const startMs = parseInt(match[1], 10);
    // Extract text from runs array
    const runsText = match[2];
    const textParts: string[] = [];
    const runTextPattern = /"text"\s*:\s*"([^"]+)"/g;
    let runMatch;
    while ((runMatch = runTextPattern.exec(runsText)) !== null) {
      if (runMatch[1]) textParts.push(runMatch[1]);
    }

    const text = textParts.join('');
    if (text && text.trim()) {
      transcript.push({
        start_time: formatTimestamp(startMs / 1000),
        start_seconds: startMs / 1000,
        text: text.trim(),
      });
    }
  }

  // Also try transcriptCueRenderer pattern (older format)
  if (transcript.length === 0) {
    const cuePattern = /"transcriptCueRenderer"\s*:\s*\{[^}]*?"startOffsetMs"\s*:\s*"(\d+)"[^}]*?"cue"\s*:\s*\{[^}]*?"simpleText"\s*:\s*"([^"]+)"/g;
    while ((match = cuePattern.exec(html)) !== null) {
      if (!match[1] || !match[2]) continue;

      const startMs = parseInt(match[1], 10);
      const text = match[2];
      if (text && text.trim()) {
        transcript.push({
          start_time: formatTimestamp(startMs / 1000),
          start_seconds: startMs / 1000,
          text: text.trim(),
        });
      }
    }
  }

  if (transcript.length === 0) {
    return null;
  }

  const metadata = extractMetadata(html, videoId, videoUrl);
  return {
    ...metadata,
    transcript,
  };
}

/**
 * Extract metadata from HTML (title, duration, etc.)
 */
function extractMetadata(html: string, videoId: string, videoUrl: string): YouTubeTranscript {
  // Extract title from meta tags
  let title = 'Unknown Title';
  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = decodeHtmlEntities(titleMatch[1].replace(' - YouTube', '').trim());
  }

  // Extract duration from meta tags or JSON-LD
  let duration = 0;
  const durationMatch = html.match(/<meta\s+itemprop="duration"\s+content="PT(\d+)M(\d+)S"/i);
  if (durationMatch && durationMatch[1] && durationMatch[2]) {
    duration = parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10);
  }

  // Extract channel
  let channel: string | undefined;
  const channelMatch = html.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i);
  if (channelMatch && channelMatch[1]) {
    channel = decodeHtmlEntities(channelMatch[1]);
  }

  // Extract description
  let description: string | undefined;
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  if (descMatch && descMatch[1]) {
    description = decodeHtmlEntities(descMatch[1]);
  }

  return {
    video_id: videoId,
    url: videoUrl,
    title,
    duration_seconds: duration,
    channel,
    description,
    transcript: [],
  };
}

/**
 * Extract video ID from URL
 */
function extractVideoId(url: string): string | null {
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

  return null;
}

/**
 * Convert seconds to MM:SS or HH:MM:SS format
 */
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parse time string to seconds
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map((p) => parseInt(p, 10));

  if (parts.length === 3 && parts[0] !== undefined && parts[1] !== undefined && parts[2] !== undefined) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1 && parts[0] !== undefined) {
    // SS
    return parts[0];
  }

  return 0;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\u200B/g, ''); // zero-width space
}
