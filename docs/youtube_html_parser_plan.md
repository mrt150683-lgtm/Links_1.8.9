# Plan: YouTube HTML Transcript Parser Module

## Overview

Parse saved YouTube MHTML files to extract transcripts that have already been captured in the page HTML. This is a complementary feature to the video transcription module - instead of sending a URL to an AI model, users can upload pre-saved YouTube pages and we extract the transcript data directly from the HTML.

**Key Difference from Video Transcription**:
- ❌ No AI API calls needed
- ✅ Uses existing transcript data embedded in saved HTML
- ✅ Faster processing (no AI latency)
- ✅ Works offline (user already has the data)

---

## Architecture

### Data Flow

```
User uploads MHTML file
  ↓
Asset upload handler detects .mhtml extension
  ↓
Check if file contains YouTube content (via header metadata)
  ↓
Create link entry for original video
  ↓
Enqueue parse_youtube_html job
  ↓
Job handler:
  ├─ Extract video metadata (URL, title, duration, video_id)
  ├─ Parse HTML for transcript data
  ├─ Extract timestamps, speaker labels, text
  ├─ Extract key moments and citations (if present)
  ├─ Create doc entry with searchable text
  ├─ Store parsed transcript JSON as asset
  └─ Enqueue tag_entry job
  ↓
Transcript entry (searchable + tagged)
```

---

## Implementation Components

### 1. MHTML File Structure Recognition

**Context**: MHTML (MIME HTML) is a web archive format saved by browsers.

**Structure**:
```
From: <Saved by Blink>
Snapshot-Content-Location: https://www.youtube.com/watch?v=VIDEO_ID
Subject: Video Title
Date: Timestamp
MIME-Version: 1.0
Content-Type: multipart/related; boundary="----BoundaryString----"

------BoundaryString----
Content-Type: text/html
Content-ID: <frame-ID@mhtml.blink>
Content-Location: https://www.youtube.com/watch?v=VIDEO_ID

<!DOCTYPE html>
<html>
...YouTube page HTML...
</html>

------BoundaryString----
Content-Type: text/css
Content-ID: <css-ID@mhtml.blink>
...CSS content...

------BoundaryString----
Content-Type: image/jpeg
Content-ID: <image-ID@mhtml.blink>
...image data...
```

**Detection Steps**:
1. Check file extension: `.mhtml`
2. Read first few lines: Look for `Snapshot-Content-Location: https://youtube.com`
3. Validate it's a YouTube URL: `youtube.com`, `www.youtube.com`, `youtu.be`, `youtube.co.uk`
4. Extract video ID from URL

### 2. MHTML Parsing

**File**: `packages/ai/src/mhtml-parser.ts` (new utility)

**Responsibilities**:
- Separate MHTML parts (extract HTML from multipart structure)
- Decode quoted-printable encoding
- Parse the embedded HTML document
- Extract iframe/shadow DOM content if needed

**Key Functions**:

```typescript
/**
 * Parse MHTML file and extract HTML content
 */
function parseMhtmlFile(content: Buffer): {
  html: string;
  metadata: {
    url: string;
    title: string;
    savedAt: number;
  };
}

/**
 * Decode quoted-printable encoding
 */
function decodeQuotedPrintable(encoded: string): string
```

### 3. YouTube Transcript Extraction

**File**: `packages/ai/src/youtube-transcript-parser.ts` (new utility)

**Parse Patterns** (in priority order):

#### Pattern 1: ytInitialData JSON (Most Common)
```javascript
// Look for: window["ytInitialData"] = {...}
// Contains: captions/subtitles structure with transcript segments
{
  "engagementPanels": [{...}],
  "captions": {
    "playerCaptionsTracklistRenderer": {
      "captionTracks": [{
        "baseUrl": "...",
        "name": "English",
        "vssId": ".en"
      }]
    }
  }
}
```

#### Pattern 2: Transcript Panel HTML
```html
<div id="panels" class="style-scope ytd-watch-flexy">
  <div class="segment">
    <span class="time-range">1:23</span>
    <span class="speaker">Speaker Name</span>
    <span class="text">Transcript text here</span>
  </div>
  ...
</div>
```

#### Pattern 3: Structured Data (JSON-LD)
```html
<script type="application/ld+json">
{
  "@type": "VideoObject",
  "name": "Video Title",
  "duration": "PT10M30S",
  "uploadDate": "2024-01-15"
}
</script>
```

#### Pattern 4: Video Details Element
```html
<ytd-video-secondary-info-renderer class="style-scope ytd-watch-flexy">
  <div id="metadata-line">...</div>
</ytd-video-secondary-info-renderer>
```

**Extraction Logic**:

```typescript
interface YouTubeTranscript {
  video_id: string;
  url: string;
  title: string;
  duration_seconds: number;
  channel: string;
  published_date?: string;
  description?: string;
  transcript: TranscriptSegment[];
  key_moments?: KeyMoment[];
  citations?: Citation[];
}

interface TranscriptSegment {
  start_time: string;      // MM:SS format
  start_seconds: number;   // for sorting
  end_time?: string;
  speaker?: string;
  text: string;
}

interface KeyMoment {
  timestamp: string;
  description: string;
}

interface Citation {
  timestamp: string;
  reference: string;
}

/**
 * Extract all possible transcript sources from HTML
 */
function extractTranscriptFromHtml(html: string): YouTubeTranscript | null

/**
 * Parse ytInitialData JSON
 */
function parseYtInitialData(html: string): YouTubeTranscript | null

/**
 * Parse transcript panel HTML elements
 */
function parseTranscriptPanel(html: string): YouTubeTranscript | null

/**
 * Parse JSON-LD structured data
 */
function parseJsonLd(html: string): Partial<YouTubeTranscript> | null

/**
 * Extract video metadata from HTML meta tags
 */
function extractMetadata(html: string): {
  title: string;
  duration: number;
  published_date?: string;
  description?: string;
}
```

### 4. Job Handler

**File**: `apps/worker/src/jobs/parseYoutubeHtml.ts` (new)

**Input**: Entry with asset_id pointing to MHTML file

**Logic**:
1. Get asset and read MHTML file
2. Parse MHTML structure and extract HTML
3. Extract video URL and metadata
4. Parse transcript from HTML
5. Validate extracted data (required: title, transcript segments)
6. Convert transcript to searchable text format
7. Store parsed transcript JSON as new asset
8. Create doc entry with searchable content
9. Update entry with transcript metadata
10. Enqueue tag_entry job
11. Log audit events

**Error Handling**:
- Invalid MHTML format → "File is not a valid MHTML archive"
- Not YouTube URL → "Not a YouTube MHTML file"
- No transcript found → "No transcript data found in HTML"
- Malformed transcript data → "Transcript data is incomplete or corrupted"

**Validation**:
- YouTube URL pattern match
- Minimum fields present (title, video_id, transcript segments)
- At least one transcript segment with text

### 5. API Endpoint Enhancement

**File**: `apps/api/src/routes/assets.ts` (modified)

Add to existing asset upload handler:

```typescript
// After file is stored, check if it's an MHTML file
if (originalFilename?.endsWith('.mhtml')) {
  // Validate it's YouTube
  const isYouTubeHtml = await isYouTubeHtmlFile(storagePath);

  if (isYouTubeHtml) {
    // Create link entry for the video
    const entry = await createLinkEntry({
      pot_id: potId,
      link_url: videoUrlFromMhtml,
      link_title: titleFromMhtml,
      content_text: `Saved HTML archive for: ${titleFromMhtml}`,
      capture_method: 'html_upload',
      source_context: {
        mhtml_asset_id: asset.id,
        parse_status: 'queued'
      }
    });

    // Enqueue parse job
    await enqueueJob({
      job_type: 'parse_youtube_html',
      pot_id: potId,
      entry_id: entry.id,
      priority: 60
    });
  }
}
```

### 6. Job Type Registration

**File**: `apps/worker/src/index.ts` (modified)

Register new job type:
```typescript
import { parseYoutubeHtmlHandler } from './jobs/parseYoutubeHtml.js';

// Register handler
registerJobType('parse_youtube_html', parseYoutubeHtmlHandler);
```

### 7. Web UI - Upload Handler

**File**: `apps/web/src/components/assets/AssetUpload.tsx` (modified)

Add MHTML detection and messaging:

```typescript
// When file is selected
if (file.name.endsWith('.mhtml')) {
  // Show preview showing it will be parsed as transcript
  // If valid YouTube MHTML:
  // ✅ Saved YouTube page - will extract transcript
  // Parse & tag with AI - then searchable
}
```

**UI Feedback**:
- If MHTML detected: "✅ YouTube transcript file detected. Will extract transcript automatically."
- After upload: Show job queued with link to entry
- Show parsing status (queued → running → done)

### 8. Transcript Display (Reuse Existing)

**File**: `apps/web/src/pages/EntryDetail.tsx` (already supports)

The existing transcript display UI works for both:
- AI-transcribed videos (via transcribe_video job)
- HTML-parsed transcripts (via parse_youtube_html job)

Both create the same output structure.

---

## Data Structures

### Entry from MHTML

**Link Entry** (Original):
```
type: "link"
link_url: "https://www.youtube.com/watch?v=VIDEO_ID"
link_title: "Video Title"
content_text: "Saved HTML archive for: Video Title"
capture_method: "html_upload"
source_context: {
  mhtml_asset_id: "asset-id-of-mhtml-file",
  mhtml_filename: "filename.mhtml",
  parse_status: "queued|running|done|failed",
  parse_error?: "error message if failed"
}
```

**Transcript Entry** (Generated):
```
type: "doc"
asset_id: "asset-id-of-transcript-json"
source_url: "https://www.youtube.com/watch?v=VIDEO_ID"
source_title: "Video Title"
content_text: "[00:00:12] Speaker: Transcript text here\n[00:01:23] ..."
source_context: {
  transcript: true,
  video_id: "VIDEO_ID",
  platform: "youtube",
  duration_seconds: 600,
  segments_count: 42,
  key_moments_count: 5,
  citations_count: 3,
  parser_source: "html",  // vs "ai"
  mhtml_asset_id: "...",
  extracted_at: 1234567890
}
```

### Transcript Asset JSON

```json
{
  "video_id": "VIDEO_ID",
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "platform": "youtube",
  "title": "Video Title",
  "channel": "Channel Name",
  "published_date": "2024-01-15",
  "duration_seconds": 600,
  "description": "Video description...",
  "transcript": [
    {
      "start_time": "00:00:12",
      "start_seconds": 12,
      "end_time": "00:00:30",
      "speaker": "Speaker Name",
      "text": "Transcript text segment"
    }
  ],
  "key_moments": [
    {
      "timestamp": "00:05:23",
      "description": "Major topic introduced"
    }
  ],
  "citations": [
    {
      "timestamp": "00:02:45",
      "reference": "Smith et al. 2024 - Nature paper"
    }
  ],
  "extracted_at": 1234567890,
  "parser_source": "html",
  "mhtml_filename": "saved_file.mhtml"
}
```

---

## File Modifications

### New Files
- `packages/ai/src/mhtml-parser.ts` - MHTML parsing utility
- `packages/ai/src/youtube-transcript-parser.ts` - YouTube HTML transcript extraction
- `apps/worker/src/jobs/parseYoutubeHtml.ts` - Job handler

### Modified Files
- `apps/api/src/routes/assets.ts` - Add MHTML detection to upload handler
- `apps/worker/src/index.ts` - Register new job type
- `apps/web/src/components/assets/AssetUpload.tsx` - Add MHTML detection UI

---

## Implementation Order

1. **Parsing Utilities** (`packages/ai/src/`)
   - MHTML parser
   - YouTube HTML transcript parser
   - Add TypeScript types

2. **Job Handler** (`apps/worker/src/jobs/`)
   - Create parse_youtube_html handler
   - Implement error handling and validation
   - Reuse transcript entry/asset creation logic

3. **Job Registration** (`apps/worker/src/index.ts`)
   - Register new job type

4. **API Enhancement** (`apps/api/src/routes/assets.ts`)
   - Detect MHTML files in upload handler
   - Create link entry and enqueue job

5. **Web UI** (`apps/web/src/`)
   - Show MHTML detection feedback
   - Update upload status messages

---

## Testing Strategy

### Unit Tests
- MHTML parsing (valid/invalid formats)
- YouTube URL extraction
- Transcript HTML parsing (various formats)
- Metadata extraction
- Time format normalization

### Integration Tests
- Full flow: Upload MHTML → Job processes → Entry created
- Transcript text searchable
- Asset encryption/storage
- Tag job auto-enqueue
- Error handling (bad MHTML, no transcript)

### Manual QA Steps
1. **Setup**: Have a saved YouTube MHTML file
2. **Upload**: Go to pot → Assets tab → Upload MHTML file
3. **Verify**:
   - ✅ Job queued immediately
   - ✅ Link entry created for video
   - ✅ Transcript entry appears after job completes
   - ✅ Searchable text contains timestamps and speaker names
   - ✅ Metadata shows segments, key moments counts
   - ✅ Tag job runs automatically
4. **Search**: Search pot for words from transcript
5. **Error Cases**:
   - Upload non-YouTube MHTML → Should reject or warn
   - Upload MHTML with no transcript → Job fails gracefully
   - Upload corrupted MHTML → Clear error message

---

## Advantages Over Video Transcription

| Aspect | AI Transcription | HTML Parsing |
|--------|-----------------|--------------|
| Speed | Slower (AI latency) | Fast (instant) |
| Cost | AI API charges | Free |
| Accuracy | Model-dependent | 100% (from source) |
| Offline | No (requires API) | Yes |
| Video URL Required | Yes | No |
| Pre-saved Data | No | Yes |
| Setup | Configure model | None |

**Use Case**: Perfect for users who already have saved YouTube pages and want to quickly extract transcripts without waiting for or paying for AI transcription.

---

## Future Enhancements

- [ ] Support other saved HTML formats (Rumble, podcasts, etc)
- [ ] Extract video thumbnail from MHTML
- [ ] Parse embedded comments and engagement metrics
- [ ] Support other browsers' MHTML formats (Chrome, Firefox, Safari)
- [ ] Batch MHTML file detection and parsing
- [ ] Transcript diff/version comparison if same video uploaded twice
- [ ] Export transcript back to readable format (SRT, VTT)

---

## Notes

**MHTML Structure Complexity**: YouTube MHTML files can be quite large (8+ MB) due to embedded assets. Parsing will:
1. Extract HTML section (decompresses quoted-printable)
2. Parse with HTML parser (cheerio or similar)
3. Search for transcript data in JavaScript objects or DOM
4. Discard media/CSS/JS sections after extraction

**Browser Compatibility**: Different browsers save MHTML differently:
- Chrome/Blink: Standard MHTML with `mhtml.blink` boundaries
- Firefox: Similar format with different metadata
- Safari: May need special handling

**Video ID Extraction**:
- From URL: `youtube.com/watch?v=VIDEO_ID`
- From `Snapshot-Content-Location` header
- Fallback: Parse from meta tags in HTML
