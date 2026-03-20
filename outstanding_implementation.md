# Outstanding Implementation Items

This document tracks features that have UI/frontend implementation but are missing backend API endpoints or other implementation pieces.

## Missing Backend API Endpoints

### 1. Audit Log Endpoint
**Status:** Backend functions exist, no API endpoint
**Required:** `GET /audit` or `GET /audit/events`

**Backend Functions Available:**
- `getRecentAuditEvents(limit: number)` - Get recent audit events
- `getAuditEventsByPot(potId: string)` - Get events for a pot
- `getAuditEventsByEntry(entryId: string)` - Get events for an entry

**Frontend Impact:**
- Audit page exists at `/audit` but shows placeholder
- Could display searchable/filterable audit log table

**Suggested Endpoint Design:**
```typescript
GET /audit?limit=100&offset=0&pot_id=xxx&entry_id=xxx&action=xxx&actor=xxx
Response: {
  events: AuditEvent[],
  total: number
}
```

---

### 2. Entry Metadata Update Endpoint
**Status:** No PATCH/PUT endpoint for entries
**Required:** `PATCH /entries/:id`

**Frontend Impact:**
- Edit Metadata button enabled on Entry Detail page
- Modal form implemented with fields:
  - `source_title`
  - `source_url`
  - `notes`
- Currently logs changes to console as placeholder

**Suggested Endpoint Design:**
```typescript
PATCH /entries/:entryId
Body: {
  source_title?: string | null,
  source_url?: string | null,
  notes?: string | null
}
Response: Entry (updated entry object)
```

**Storage Layer:**
- May need `updateEntry()` function in `entriesRepo.ts`

---

### 3. Asset Download/View Endpoint
**Status:** Assets are encrypted at rest, no decrypt+serve endpoint
**Required:** `GET /assets/:id/download` or `GET /assets/:id`

**Frontend Impact:**
- Entry Detail page shows asset preview but can't display actual images/docs
- Asset preview shows placeholder with disabled Download/View buttons
- AssetList shows asset metadata but no way to view/download

**Suggested Endpoint Design:**
```typescript
GET /assets/:assetId/download
Response: Binary blob with appropriate Content-Type header
Headers:
  - Content-Type: (mime_type from asset record)
  - Content-Disposition: attachment; filename="original_filename"
  - Content-Length: (size_bytes from asset record)
```

**Backend Work Required:**
- Read encrypted blob from storage_path
- Decrypt using `decryptBlob()` from encryption.ts
- Stream to response with proper headers

---

### 4. Asset Metadata Endpoint
**Status:** Can list assets by pot, but no individual asset fetch
**Required:** `GET /assets/:id`

**Frontend Impact:**
- Asset preview component can't fetch individual asset metadata
- Currently only shows asset ID

**Suggested Endpoint Design:**
```typescript
GET /assets/:assetId
Response: Asset {
  id: string,
  sha256: string,
  size_bytes: number,
  mime_type: string,
  original_filename: string | null,
  created_at: number,
  storage_path: string,
  encryption_version: number
}
```

---

## Frontend Features Waiting on Backend

### Asset Viewing/Download
- **Pages Affected:** Entry Detail, Asset List
- **UI Status:** Buttons disabled, placeholders shown
- **Backend Needs:** Asset download endpoint (#3 above)

### Audit Log Viewer
- **Pages Affected:** Audit page (`/audit`)
- **UI Status:** Informative placeholder explaining missing endpoint
- **Backend Needs:** Audit log API endpoint (#1 above)

### Entry Metadata Editing
- **Pages Affected:** Entry Detail
- **UI Status:** Modal implemented, logs to console
- **Backend Needs:** Entry update endpoint (#2 above)

---

## Other Outstanding Items

### Image Preview in Entry Detail
**Status:** Shows asset preview component but can't display actual image
**Requires:**
- Asset download endpoint (GET /assets/:id/download)
- Frontend update to fetch and display image in `<img>` tag

### Document Preview/Download in Entry Detail
**Status:** Shows asset preview component but can't download/view doc
**Requires:**
- Asset download endpoint (GET /assets/:id/download)
- Frontend update to provide download link

### Asset Reference Count
**Status:** Delete pot shows asset count but not reference count
**Potential Enhancement:** Show "N assets (M shared across pots)" in delete consequences

### Pot Update Endpoint
**Status:** No PATCH endpoint for pots (name, description, icon_emoji)
**Current Workaround:** Must delete and recreate pot to change metadata

---

## Summary

### Critical Missing Endpoints (block user features):
1. ✅ **PATCH /entries/:id** - Edit entry metadata
2. ✅ **GET /audit** - View audit log
3. ✅ **GET /assets/:id/download** - View/download assets

### Nice-to-Have Endpoints (UX improvements):
1. **GET /assets/:id** - Fetch individual asset metadata
2. **PATCH /pots/:id** - Edit pot metadata
3. **GET /entries/:id/references** - Show where an asset is referenced

---

## Notes

- All frontend UI is implemented and styled consistently
- All placeholders have informative messages about missing backend
- Forms are fully functional and ready to wire up
- Delete flows work for pots and entries
- Asset delete intentionally not implemented (design decision - assets cleaned up via CASCADE or cleanup-orphans endpoint)

---

**Last Updated:** 2026-02-15
**Frontend UI Completion:** ~70% (MVP-1 + MVP-2)
**Backend API Completion:** 12/12 phases complete (per original plan)
