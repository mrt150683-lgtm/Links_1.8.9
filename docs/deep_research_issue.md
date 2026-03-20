# Deep Research Web Augmentation Issue

## Executive Summary

The Search Escalator (Phase B of deep research) is **not discovering external URLs** from the pot corpus. The escalator searches pot entries, extracts learnings, and attempts to find URLs to ingest and augment the research with external sources. However, in current testing, **zero URLs are discovered**, so **zero external sources are ingested**.

**Root cause:** The escalator is designed as a **reference follower**, not an **independent web searcher**. It only discovers URLs that are explicitly referenced in pot entry content. When pot entries don't contain URL references, the escalator has nothing to follow.

---

## Research Flow (Current Design)

### Phase A: Constraint Extraction (Unchanged)
- Shallow corpus search (max_depth=1, no web)
- Extracts foundational knowledge from pot entries
- No external sources attempted
- **Status:** ✅ Working as designed

### Phase B: Research (Web Augmentation Enabled)

When `web_augmentation_enabled === true` and `ctx.ingestor` is available:

#### Escalator Loop (4-Stage Query Escalation)

**File:** `packages/deep-research/src/escalator.ts` (lines 68-320)

**Loop iterations:**
- Generates stage-appropriate queries (0=generic, 1=technique-specific, 2=domain-filtered, 3=AI-generated)
- For each query batch, executes 6 steps:

#### Step 1: Generate Queries
- **File:** `packages/deep-research/src/queryEscalation.ts`
- **Input:** Current stage (0-3), goal prompt, constraint learnings, research learnings, topic keywords
- **Output:** 4-6 query strings (deduplicated against previously tried queries)
- **Details:**
  - Stage 0: Goal keyword combinations (deterministic)
  - Stage 1: Named technique × goal keywords (deterministic)
  - Stage 2: Domain-filtered patterns (site:github.com, site:arxiv.org, etc.) (deterministic)
  - Stage 3: AI-generated rephrasings (one AI call, temperature 0.4)

#### Step 2: Corpus Search
- **File:** `packages/deep-research/src/escalator.ts` (lines 114-128)
- **Code:**
  ```ts
  const allResults: CorpusResult[] = [];
  for (const q of queries) {
    const res = await ctx.corpus.search(q, ctx.config.budget.max_breadth);
    allResults.push(...res);
  }
  ```
- **Interface:** `CorpusProvider.search(query: string, topK: number)`
- **Location:** `packages/deep-research/src/types.ts` (line 21-23)
- **What it does:** Searches only the **pot corpus** (internal documents), NOT the web
- **Result:** Returns `CorpusResult[]` with:
  - `entry_id`: pot entry ID
  - `content`: snippet of pot entry
  - `source_label`: pot entry's source URL (if any), or `"entry:<id>"`
  - `sha256`: content hash

#### Step 3: URL Discovery from Pot Content
- **File:** `packages/deep-research/src/escalator.ts` (lines 130-150)
- **Code:**
  ```ts
  const candidateUrls = new Map<string, { title: string; snippet: string }>();

  // Attempt 1: Extract URLs from source_label
  for (const res of newResults) {
    if (res.source_label?.startsWith('http')) {
      candidateUrls.set(res.source_label, { title: res.source_label, snippet: res.content });
    }
  }

  // Attempt 2: Extract learnings and look for source_urls
  const rawLearnings = await extractLearnings(
    ctx.goalPrompt, queries.join(' | '), newResults, model, learningPromptV2, budget, 'research'
  );

  for (const l of rawLearnings) {
    for (const url of l.source_urls ?? []) {
      candidateUrls.set(url, { title: url, snippet: l.text });
    }
  }
  ```
- **Two sources for URLs:**
  1. **Source labels** — pot entry's `source_label` field (if it's a URL)
  2. **Learning extraction** — AI prompts model to extract `source_urls` from pot content

**THE PROBLEM:** If pot entries don't have:
- `source_label` starting with `http://` OR
- Mentioned URLs in their text that the AI can extract as `source_urls`

Then `candidateUrls` remains empty.

#### Step 4: URL Triage
- **File:** `packages/deep-research/src/urlTriage.ts`
- **Input:** `candidateUrls` map
- **Process:** Batch-triage candidate URLs with a cheap AI call (temperature 0.1, max_tokens 1500)
- **Prompts for:** Relevance to topic (0-1 score), Recency (0-1 score for 2023+ publication)
- **Output:** URLs that pass both thresholds (relevant >= 0.6 AND recent >= 0.6)
- **Code:** `escalator.ts` lines 176-190

**THE PROBLEM:** If no URLs entered triage, no URLs can exit it.

#### Step 5: Web Ingest
- **File:** `packages/deep-research/src/escalator.ts` (lines 192-215)
- **Interface:** `SourceIngestor.ingest(url: string, title: string, fetchedContent: string)`
- **Location:** `packages/deep-research/src/types.ts` (line 25-27)
- **Code:**
  ```ts
  const urlsToIngest = passedUrls.slice(0, batchSize);  // max 6 per batch

  if (urlsToIngest.length > 0 && ctx.ingestor) {
    for (const url of urlsToIngest) {
      if (escalatorState.sourcesTotal >= maxSourcesTotal) break;

      try {
        state.visited_urls.add(url);
        const entry = await ctx.ingestor.ingest(url, url, '');
        state.sources_ingested.push({ url, sha256: entry.content_sha256, entry_id: entry.id });
        escalatorState.sourcesTotal++;
        ingestedCount++;
      } catch (err) {
        logger.warn({ url, error: String(err) });
      }
    }
  }
  ```
- **What it does:** Fetches web content for each URL and stores it as a new pot entry
- **Limits:** Max 6 per batch, max 24 total across all batches (configurable)

**THE PROBLEM:** If no URLs passed triage, nothing gets ingested.

#### Step 6: Re-extract from Newly Ingested URLs
- **File:** `packages/deep-research/src/escalator.ts` (lines 217-277)
- **Code:**
  ```ts
  if (ingestedCount > 0) {
    const newlyIngestedIds = state.sources_ingested.slice(-ingestedCount).map((s) => s.entry_id);
    const followUpQuery = queries[0] ?? ctx.goalPrompt.substring(0, 200);

    // Re-search pot (now includes newly ingested web content)
    const followUpRaw = await ctx.corpus.search(followUpQuery, newlyIngestedIds.length * 2);
    const followUpResults = followUpRaw.filter((r) => newlyIngestedIds.includes(r.entry_id));

    if (followUpResults.length > 0) {
      // Extract learnings from newly ingested web content
      const rawLearnings = await extractLearnings(...);
      // Filter and accept learnings
    }
  }
  ```
- **What it does:** Re-searches pot for newly ingested entries and extracts learnings from them
- **Recency enabled:** true (web content should have 2023+ dates)

**THE PROBLEM:** This step only runs if `ingestedCount > 0`. If no URLs were ingested, this step is skipped.

#### Step 7: Escalator Stopping Logic
- **File:** `packages/deep-research/src/escalator.ts` (lines 291-317)
- **Code:**
  ```ts
  // Success: Target met
  if (escalatorState.candidatesTotal >= targetCandidates
      && escalatorState.sourcesTotal >= minExternalSources) {
    return buildResult('TARGET_MET', ...);
  }

  // Hard ceiling: Max sources reached
  if (escalatorState.sourcesTotal >= maxSourcesTotal) {
    return buildResult('HARD_CEILING', ...);
  }

  // Low yield escalation
  if (batchYield < minNewCandidatesPerBatch) {
    escalatorState.lowYieldCount++;
    if (escalatorState.lowYieldCount >= maxLowYieldBatches) {
      if (escalatorState.stage < 3) {
        escalatorState.stage++;  // Escalate to next stage
        escalatorState.lowYieldCount = 0;
      } else {
        return buildResult('DIMINISHING_RETURNS', ...);  // Max stage, no progress
      }
    }
  } else {
    escalatorState.lowYieldCount = 0;  // Reset on good yield
  }
  ```

**Current flow with test data:**
1. Stage 0-3 queries run, each finds pot entries
2. Learnings extracted from pot entries
3. **No URLs in learnings or source_labels → candidateUrls empty**
4. **No URLs triaged → passedUrls empty**
5. **No URLs ingested → ingestedCount = 0**
6. **batchYield = number of pot learnings (3, 2, 1 learnings per batch)**
7. After 2 batches of low yield (< 2 new learnings), stage escalates
8. At stage 3, same process repeats
9. Eventually reaches DIMINISHING_RETURNS with `sourcesTotal = 0`

### Phase B: Hard-Fail Gate (v1.3.6 Fix)
- **File:** `packages/deep-research/src/execute.ts` (lines 322-399)
- **Previous behavior:** Block if `sourcesTotal < minExternal OR candidates2023plus < targetCandidates`
- **v1.3.6 fix:** Skip blocking if `sourcesTotal === 0 AND total_urls_triaged === 0`
- **Rationale:** When no URLs were even discovered, the pot lacks external references (not a quality failure)

### Phase B: Report Synthesis
- **File:** `packages/deep-research/src/execute.ts` (lines 709-813)
- **Input:** All collected learnings (constraint + research)
- **Process:** AI synthesizes report with sections, open loops, and findings
- **Status:** ✅ Works with or without external sources

---

## Why URLs Are Not Being Discovered

### Current Test Scenario
- Pot contains: Internal notes, documents, transcripts
- These entries have **no URL references** in:
  - `source_label` field (null or "entry:<id>")
  - Content text mentioning external URLs
  - AI-extractable `source_urls`
- Result: `candidateUrls` map stays empty throughout all batches and stages

### Design Assumption vs Reality

| Assumption | Reality |
|-----------|---------|
| Pot entries contain references to external sources | Test pot has internal documents only |
| `source_label` fields point to external URLs | `source_label` is null or "entry:<id>" |
| Learnings extracted by AI will mention source URLs | AI extracts learnings from pot, not external web |
| Escalator discovers URLs from content | Escalator has no URLs to discover |

---

## Architectural Issue: Escalator Design

The escalator is fundamentally a **reference follower**, not a **web search engine**:

1. **Search pot corpus** ← Only internal docs
2. **Extract learnings from pot** ← No external URLs mentioned
3. **Triage URLs found in pot** ← No URLs to triage
4. **Ingest web content** ← No URLs to ingest
5. **Synthesize report** ← Only pot learnings, no external

### What It's NOT Designed To Do
- ❌ Independently search the web for topic-related pages
- ❌ Generate URLs based on goal (would need web search API)
- ❌ Infer URLs from topic keywords
- ❌ Use external databases of links

### What It's Designed To Do
- ✅ Find URLs **mentioned in** pot documents
- ✅ Triage those URLs for relevance/recency
- ✅ Fetch and ingest the web content
- ✅ Extract learnings from that content
- ✅ Escalate queries when yield drops (to find more referenced content)

---

## Key Code Locations

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Escalator main loop | `packages/deep-research/src/escalator.ts` | 68-320 | Core escalation algorithm |
| Query generation | `packages/deep-research/src/queryEscalation.ts` | 180-211 | Generate stage-appropriate queries |
| URL triage | `packages/deep-research/src/urlTriage.ts` | — | Batch-triage URLs for relevance/recency |
| Learning extraction | `packages/deep-research/src/escalator.ts` | 347-408 | AI extraction from corpus |
| Corpus search | `packages/deep-research/src/execute.ts` | 316-318 | Inject CorpusProvider.search() |
| Web ingest | `packages/deep-research/src/escalator.ts` | 192-215 | Inject SourceIngestor.ingest() |
| Hard-fail gate | `packages/deep-research/src/execute.ts` | 322-399 | Block if insufficient sources/candidates |
| Type definitions | `packages/deep-research/src/types.ts` | 14-27 | CorpusProvider, SourceIngestor interfaces |

---

## Data Flow Diagram

```
Phase A: Constraints
  ↓
  pot.search(queries) → constraint learnings
  ↓
Phase B: Escalator (if web_augmentation_enabled)
  ↓
  [LOOP: Stage 0-3]
    ↓
    pot.search(stage_queries) → pot entries
    ↓
    AI.extract_learnings(pot_entries) → learnings + source_urls
    ↓
    [URL Discovery]
      ├─ source_label if starts with 'http'
      └─ source_urls from learnings
      ↓
      IF no URLs found → candidateUrls empty → triage empty → ingest empty
      ↓
    [URL Triage]
      url_triage.evaluate(candidateUrls) → passedUrls
      ↓
      IF no URLs passed → urlsToIngest empty
      ↓
    [Web Ingest]
      FOR each url IN urlsToIngest:
        ingestor.ingest(url) → new pot entry
      ↓
    [Re-extract]
      pot.search(pot + newly_ingested) → learnings from web content
      ↓
    [Yield Check]
      IF batchYield < threshold AND stage < 3 → escalate stage
      ELSE IF stage == 3 → DIMINISHING_RETURNS
  ↓
[Hard-Fail Gate]
  IF sourcesTotal == 0 AND total_urls_triaged == 0 → skip blocking
  ELSE IF sourcesTotal < min → block
  ↓
Report Synthesis
  AI.synthesize(all_learnings) → report
```

---

## Proposed Solutions (For User Review)

### Option A: URL Extraction from Learning Text
**Approach:** After AI extracts learnings from pot content, use regex or secondary AI call to find URLs mentioned in the learning text itself.

**Pros:** No API changes, works with existing pot structure
**Cons:** May extract low-confidence URLs from natural language

**Files to modify:**
- `packages/deep-research/src/escalator.ts` (step 3, after learning extraction)

---

### Option B: Independent Web Search
**Approach:** Add a `WebSearchProvider` interface alongside `CorpusProvider`. When pot yields no URLs, fallback to web search.

**Pros:** Finds external sources without pot references
**Cons:** Requires new API integration (Google, Bing, etc.), budget implications

**Files to modify:**
- `packages/deep-research/src/types.ts` (add WebSearchProvider)
- `packages/deep-research/src/execute.ts` (inject web search provider)
- `packages/deep-research/src/escalator.ts` (fallback logic)

---

### Option C: Infer URLs from Domain Patterns
**Approach:** Stage 2 queries already use domain patterns (site:github.com, site:arxiv.org). Instead of just querying the pot, also generate URLs to ingest directly.

**Pros:** Deterministic, no AI required
**Cons:** Limited to known domains, may be too broad

**Files to modify:**
- `packages/deep-research/src/queryEscalation.ts` (return both queries and candidate URLs)
- `packages/deep-research/src/escalator.ts` (ingest candidate URLs)

---

### Option D: Reframe Web Augmentation
**Approach:** Clarify that "web augmentation" only works when pot contains URL references. For pots without references, skip the escalator and use corpus-only research.

**Pros:** No changes needed, aligns with current design
**Cons:** Reduces capability, doesn't solve the fundamental issue

---

## Testing Notes

**Current test status (v1.3.6):**
- ✅ Escalator runs without crashing
- ✅ Processes all 4 query stages
- ✅ Extracts learnings from pot (batch yields: 3, 2, 1 per batch)
- ✅ Completes without hard-fail gate blocking
- ✅ Generates report from pot learnings
- ❌ **Discovers zero external URLs**
- ❌ **Ingests zero web sources**
- ❌ **Report contains only pot-based learnings**

**What the test needs:**
- Pot entries with URL references in content, OR
- `source_label` fields pointing to external URLs, OR
- Different approach to URL discovery

---

## References

- **Plan doc:** `docs/plan.md` — Phase B search escalator specification
- **Architecture:** `docs/architecture.md` — Service design
- **Implementation:** Previous conversation context (commits eb3b955, c32f4dc)
