# Video Transcription Feature

## Overview

The video transcription module enables users to submit video URLs (YouTube, Rumble) to Links, have them transcribed by an AI model, and store the transcripts as searchable entries with timestamps and citations.

## Architecture

### Data Flow

```
User Interface (Web App)
    ↓
POST /pots/{potId}/videos
    ↓
API: Create link entry + enqueue transcribe_video job
    ↓
Worker: transcribe_video Job
    ├─ Validate model configured
    ├─ Call AI with video URL
    ├─ Parse transcript JSON response
    ├─ Create doc entry with searchable text
    ├─ Store full transcript as encrypted asset
    └─ Enqueue tag_entry job
    ↓
Transcript Entry (Searchable + Tagged)
```

## Components Implemented

### 1. Type Definitions

**File**: `packages/storage/src/types.ts`

Added to `AiPreferences.task_models`:
```typescript
video_transcription?: string;  // Model ID for video transcription
```

### 2. Job Handler

**File**: `apps/worker/src/jobs/transcribeVideo.ts`

Implements the core transcription logic:

- **Input**: Entry with `link_url` or `source_url` pointing to a video
- **Process**:
  1. Validate video URL is from supported platform (YouTube, Rumble)
  2. Check if video_transcription model is configured in AI preferences
  3. Load prompt template and interpolate with video URL
  4. Call AI model to generate transcript
  5. Parse and validate JSON response structure
  6. Convert transcript segments to searchable text format
  7. Store full transcript JSON as encrypted asset
  8. Create new doc entry with transcript text and metadata
  9. Enqueue tag_entry job for automatic tagging
  10. Log audit events

- **Output**:
  - New doc entry with transcript text
  - Encrypted JSON asset with full transcript data
  - Queued tagging job

**Error Handling**:
- Fails if no video_transcription model configured (with clear guidance message)
- Fails if video URL is invalid or from unsupported platform
- Fails if AI returns invalid JSON or malformed response
- Validates required fields (title, platform, transcript segments)
- Warns if optional fields (key_moments, citations) are missing

### 3. AI Prompt Template

**File**: `packages/ai/prompts/transcribe_video/v1.md`

Instructs the AI to:
- Analyze the entire video content
- Generate a complete transcript with timestamps
- Include speaker labels for multi-speaker videos
- Extract key moments with descriptions
- Identify citations/references mentioned
- Output strict JSON format

**Output Schema**:
```json
{
  "video_id": "youtube/rumble video ID",
  "platform": "youtube | rumble | other",
  "title": "video title",
  "duration_seconds": 180,
  "transcript": [
    {
      "start_time": "HH:MM:SS",
      "end_time": "HH:MM:SS",
      "speaker": "optional speaker label",
      "text": "spoken words"
    }
  ],
  "key_moments": [
    {
      "timestamp": "HH:MM:SS",
      "description": "what happens at this moment"
    }
  ],
  "citations": [
    {
      "timestamp": "HH:MM:SS",
      "reference": "paper, source, or URL mentioned"
    }
  ]
}
```

### 4. API Endpoint

**File**: `apps/api/src/routes/entries.ts`

**Endpoint**: `POST /pots/{potId}/videos`

**Request Body**:
```typescript
{
  video_url: string,   // Must be valid URL
  notes?: string       // Optional user notes
}
```

**URL Validation**:
- Accepts: youtube.com, www.youtube.com, youtu.be, rumble.com, www.rumble.com
- Rejects: Unsupported platforms with 400 error

**Response** (201 Created):
```typescript
{
  entry_id: string,    // Link entry ID
  job_id: string,      // Transcription job ID
  status: "queued"
}
```

**Logic**:
1. Verify pot exists
2. Validate request body and URL format
3. Create link entry for the video
4. Enqueue transcribe_video job with priority 75 (high)
5. Return entry and job IDs

### 5. Settings UI

**File**: `apps/web/src/pages/Settings.tsx`

Added "Video Transcription Model" dropdown:
- Label: "Video Transcription Model"
- Options: All available models from `/models` endpoint
- Default: "Not configured"
- Helper text: Explains that a video-capable model is required for transcription
- Syncs with API via PUT `/prefs/ai` endpoint

### 6. Web UI - Video Input Form

**File**: `apps/web/src/pages/PotDetail.tsx`

Added video transcription form in Assets tab:
- **Video URL input**: Accepts paste-able video URLs
- **Notes field**: Optional context or metadata
- **Real-time validation**: Validates URL format before submission
- **Status messages**: Shows success/error feedback
- **Auto-refresh**: Updates pot entries list after successful submission
- **Loading state**: Disables form during submission

### 7. Transcript Display UI

**File**: `apps/web/src/pages/EntryDetail.tsx`

Enhanced for transcript entries:
- **Header**: Shows "Video Transcript" label for identified transcripts
- **Video link**: Original video URL with "View Original Video" button
- **Metadata**: Duration, segment count, key moments count, citations count
- **Content**: Full searchable transcript text with timestamps
- **TranscriptInfoCard**: Sidebar card displaying:
  - Video platform and ID
  - Duration in MM:SS format
  - Segment, key moments, and citations counts
  - Download button for full transcript JSON asset

## Data Storage

### Entry Structure

**Link Entry** (Original):
- `type`: "link"
- `link_url`: Video URL
- `capture_method`: "api"
- `content_text`: User's optional notes

**Transcript Entry** (Generated):
- `type`: "doc"
- `asset_id`: References encrypted transcript JSON
- `source_url`: Original video URL
- `source_title`: Video title from transcript
- `content_text`: Full searchable transcript (segments with timestamps)
- `source_context`: Metadata object:
  ```json
  {
    "transcript": true,
    "video_id": "...",
    "platform": "youtube|rumble",
    "duration_seconds": 180,
    "segments_count": 42,
    "key_moments_count": 5,
    "citations_count": 3
  }
  ```

### Asset Storage

**Transcript JSON Asset**:
```json
{
  "video_id": "...",
  "platform": "youtube",
  "title": "Video Title",
  "duration_seconds": 180,
  "transcript": [...],
  "key_moments": [...],
  "citations": [...],
  "generated_at": 1234567890,
  "model_id": "google/gemini-2.0-flash-001",
  "prompt_version": "transcribe_video/v1"
}
```

- Stored as encrypted blob with SHA-256 hash as filename
- Linked to transcript entry via `asset_id`
- Downloadable from UI for offline reference

## Workflow Example

### Step 1: Configure Model
1. Open Settings page
2. Go to "AI Provider" section
3. Select a video transcription model (e.g., `google/gemini-2.0-flash-001`)
4. Changes auto-save

### Step 2: Submit Video
1. Open a Pot's detail page
2. Go to Assets tab
3. Find "Transcribe Video" section
4. Paste video URL: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
5. Optionally add notes
6. Click "Transcribe Video"
7. See success message with entry ID

### Step 3: Monitor Progress
1. Job is immediately queued with priority 75
2. Worker picks up job and calls AI model
3. Transcript entry appears in pot entries list as it's created
4. Transcript is tagged automatically (tag_entry job)

### Step 4: View Transcript
1. Click on transcript entry in entries list
2. View content panel with full transcript text
3. See timestamps for each segment
4. View video metadata in sidebar (platform, duration, key moments)
5. Download full transcript JSON asset if needed

## Job Dependencies

### Job Types

**transcribe_video** → **tag_entry**

- transcribe_video: Creates transcript entry
- Enqueues tag_entry: Extracts topic tags from transcript text

## Configuration

### AI Preferences

Users must configure the video transcription model in Settings:

```json
{
  "task_models": {
    "video_transcription": "google/gemini-2.0-flash-001"
  }
}
```

**Supported Models**:
- Any model from OpenRouter's model list
- Recommended: Multi-modal models (Claude, Gemini, etc)
- Must support: JSON output, video understanding, long context

### Environment

No special environment variables required. Standard OpenRouter API key usage applies.

## Error Handling

### Validation Errors (400)

```json
{
  "error": "ValidationError",
  "message": "Unsupported video platform. Supported: YouTube, Rumble",
  "statusCode": 400
}
```

### Configuration Errors (Job Failure)

Job fails if `video_transcription` model not configured:

```
No video_transcription model configured. Set a video transcription
model in Settings > AI Provider to transcribe videos.
```

### AI Errors (Job Failure)

- Invalid JSON response → "AI returned invalid JSON"
- Missing required fields → "Transcript schema validation failed"
- API errors → Standard AI client error messages

## Searchability

Transcript text is stored in `content_text` with format:

```
[00:00:12] [Host] Welcome to this video about...
[00:00:18] [Host] Machine learning is...
[00:01:23] [Speaker 2] Let me elaborate...
```

This allows full-text search across:
- Spoken words
- Timestamps
- Speaker names

## Future Enhancements

- [ ] Support for local video files (upload before transcription)
- [ ] Automatic language detection and multilingual support
- [ ] Video preview/player integration in entry detail
- [ ] Timestamp-based navigation in transcript view
- [ ] Export transcript to markdown/PDF with timestamps
- [ ] Real-time transcription for live streams
- [ ] Keyword highlighting in transcript text
- [ ] Translation of transcripts to other languages

## Testing Checklist

- [ ] Settings model selection saves and loads correctly
- [ ] API rejects unsupported video platforms (400 error)
- [ ] Job handler fails gracefully when no model configured
- [ ] AI response parsing handles markdown code blocks
- [ ] Transcript entry created with searchable text
- [ ] Asset encryption and storage works
- [ ] Tag job enqueues automatically
- [ ] UI displays transcript metadata correctly
- [ ] Download transcript JSON works
- [ ] Transcript text is searchable via pot search

## Code References

- **Job handler**: `apps/worker/src/jobs/transcribeVideo.ts`
- **Prompt template**: `packages/ai/prompts/transcribe_video/v1.md`
- **API endpoint**: `apps/api/src/routes/entries.ts` (POST /pots/:potId/videos)
- **Settings UI**: `apps/web/src/pages/Settings.tsx` (AiProviderSection)
- **Web form**: `apps/web/src/pages/PotDetail.tsx` (AssetsTab)
- **Display UI**: `apps/web/src/pages/EntryDetail.tsx` (TranscriptInfoCard, ContentPanel)
- **Type definitions**: `packages/storage/src/types.ts` (AiPreferences)
