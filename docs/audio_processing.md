0\) Current system design (what we’re plugging into)



API validates requests, stores Entries + Assets, enqueues jobs. 



plan



Asset store already exists for images/docs via /pots/:id/assets and creates entries referencing assets. We’ll reuse that for audio. 



plan



Worker/job engine runs queued jobs and writes lifecycle + logs. 



plan



OpenRouter integration provides a cached model list and per-task model prefs via /models + /prefs/ai. 



phase\_6



Derived artifacts already hold tags, entities, summary, and Phase 7 handlers select models “per task type” and store artifacts. 



phase\_7



So audio slots in as: upload → asset+entry → transcribe job → transcript artifact → existing AI jobs.



1\) OpenRouter reality check for audio



OpenRouter supports audio inputs by sending base64 audio to /api/v1/chat/completions using input\_audio content, and only audio-capable models will handle it.

Their models API returns model properties (including modality/architecture fields you can use to filter audio-capable models in UI).



Implication: your transcription “model picker” should ideally filter to models that advertise audio input support — but still allow manual override (because registries are never perfectly honest).



2\) Data model changes (small, surgical)

2.1 Entries



Add a new entries.type = "audio" (alongside existing types like image, doc). Your plan already treats entries as “text in DB; files by hash/path”. 



plan



For audio entries:



Must reference an asset\_id (same pattern as image/doc).



Optional metadata columns (nice-to-have, not re



plan



ation\_ms` (nullable)



language\_hint (nullable)



transcription\_status (nullable enum-ish: queued|running|done|failed) — or derive from job/artifact presence.



2.2 Derived artifacts



Add a new artifact type: extracted\_text (covers both audio transcription and future doc OCR/PDF extraction).

Phase 7 already supports listing artifacts and “latest by type”. We’re just adding another type string. 



phase\_7



Schema (Zod in packages/core):



{

&nbsp; "text": "string",

&nbsp; "language": "optional string",

&nbsp; "segments": "optional arr:contentReference\[oaicite:13]{index=13}

2.3 Jobs



Add a new job type:



extract\_text (recommended naming because your architecture explicitly includes “extraction (doc -> text)” already) 



plan



For now: handles audio.



Later: can also handle PDFs / OCR without inventing new job types.



3\) API surface 



plan



\# 3.1 Upload + create audio entry (one call)



Add: POST /pots/:potId/entries/audio (multipart/form-data)



Fields:



file (required)



captured\_at (required)



capture\_method default "upload"



source\_title, source\_url, notes (optional)



client\_capture\_id (optional idempotency)



Behavior:



Save file via the existing asset pipeline (/pots/:id/assets logic). 



plan



Create entries row with type="audio" + asset\_id.



Enqueue extract\_text job for this entry.



3.2 Fetch transcri



plan



ET /entries/:entryId/artifacts`



GET /entries/:entryId/artifacts/:type/latest 



phase\_7



So transcript is simply:



GET /entries/:id/artifacts/extracted\_text/latest



No new endpoint needed unless you want a con



phase\_7



run processing

Extend Phase 7’s POST /entries/:entryId/process to accept "extracted\_text" too. 



phase\_7



Rule:



If entry is audio and user requests tags/entities/summary, auto-ensure extracted\_text exists (enqueue it firs



phase\_7



orker pipeline wiring (where the magic happens)



4.1 Enqueue rules



On audio entry create → enqueue extract\_text(entry\_id).



On extract\_text success → enqueue:



tag\_entry



extract\_entities



summarize\_entry

…exactly like Phase 7 does for text entries today. 



phase\_7



4.2 One shared “get processing text” function (key to minimal interference)



Right now Phase 7 handlers “load entry text (



phase\_7



phase\_7



Change that to:



loadProcessableText(entry):



if entry.type === "text" → use entry.content\_text



else → pull latest



phase\_7



nd use payload.text



if missing → throw a typed error “NO\_TEXT\_AVAILABLE” (job fails/retries, or is canceled based on policy)



That’s a tiny change, but it prevents you from forking the whole pipeline for audio.



4.3 The transcription handler (extract\_text)



handleExtractText(job):



Load entry + asset metadata



Read encrypted blob from asset store



Base64 encode audio



Call OpenRouter using /api/v1/chat/completions with input\_audio



Prompt: “Return strict JSON: {text, language?, segments?}”



Validate Zod schema



Store derived artifact extracted\_text with provenance (model\_id, prompt\_id, prompt\_version)



Emit audit events (job started/finished + artifact created)



Retry rules should match your Phase 6 wrapper expectations (timeouts, retry-on-429/5xx, no retry-on-auth). 



phase\_6



5\) Settings: “Transcription model” lives next to the others



Phase 6 already defines:



GET /models, POST /models/refresh



GET /prefs/ai, PUT /prefs/ai



task\_models map of task → model 



phase\_6



phase\_6



So you add:



task\_models.extract\_text = "<model id>"



Frontend settings page:



Load models from GET /models



Filter to audio-capable models (best effort via model metadata), but allow “show all”



St



phase\_6



fs/ai`



This matches your requirement: OpenRouter provides model list; user picks transcription model in settings alongside tagging/summarization/etc. 



phase\_6



6\) Tests + smoke (so this doesn’t become “works on my laptop” folklore)

6.1 Unit tests



Zod validation for ExtractedTextArtifactSchema



loadProcessableText() behavior matrix (text/audio w



phase\_6



E/type allowlist for audio uploads



6.2 Integration tests (mock OpenRouter)



Flow:



Create pot



Upload small audio fixture → audio entry created + extract\_text job enqueued



Run worker (once mode)



Assert extracted\_text artifact exists



Assert tags/entities/summary jobs run and artifacts exist (using mocked OpenRouter responses)



This aligns with Phase 7’s guidance: tests validate shapes/invariants, not exact AI wording. 



phase\_7



6.3 Smoke script



scripts/smoke-audio.(sh|ps1):



create pot



upload audio



run worker --once until queue empty



fetch /entries/:id/artifacts and print `extracted\_text + tags + entities + summa



phase\_7



&nbsp;likely touch (scoped)



packages/core



schemas/artifacts.ts: add ExtractedTextArtifactSchema



schemas/entries.ts: allow type="audio"



packages/storage



migration: add audio to entries type constraint + any new columns



artifacts repo: allow new artifact type string (or extend enum)



packages/ai



prompts/extract\_text\_audio/v1.md (or extract\_text/v1.md with “if input is audio…”)



OpenRouter client: add helper to send input\_audio payload



apps/api



new route: /pots/:id/entries/audio



enqueue extract\_text job after entry create



apps/worker



new handler: handleExtractText



modify Phase 7 handlers to call loadProcessableText()



8\) Risk list (aka “ways this can annoy you later”)



Large files: base64 inflates size; enforce max upload size + consider chunking later.



Model mismatch: user picks a non-audio-capable model → you need a clear error (“MODEL\_DOES\_NOT\_SUPPORT\_AUDIO”) and fail fast.



Duplicate costs: idempotency matters for uploads; use client\_capture\_id and/or asset sha256 dedupe.



Pipeline loops: ensure extract\_text doesn’t re-enqueue forever (upsert artifacts by (entry\_id, artifact\_type, prompt\_id, prompt\_version) like Phase 7 suggests). 



phase\_7



9\) Commit plan (small, reversible steps)



feat(core): add audio entry type + extracted\_text artifact schema



feat(api): add audio upload entry endpoint and enqueue extract\_text



feat(worker): implement extract\_text (audio transcription) job handler



refactor(worker): :contentReference\[oaicite:37]{index=37}tag/entities/summary handlers



test(audio): integration test with mocked OpenRouter



docs: update pipeline + qa + security for audio

