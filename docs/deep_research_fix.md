# Deep Research Web Augmentation Fix

## The Problem
The Search Escalator (Phase B) currently acts entirely as a **reference follower** within the local pot corpus. Because `ctx.corpus.search(q)` only queries local database entries (via `PotCorpusProvider`), if the user's initial pot contains no documents with external hyperlinks, the entire web augmentation pipeline starves for candidate URLs. As a result, **zero external URLs are discovered, triaged, or ingested**, leaving the final report constrained to only the internal corpus.

To fulfill the true intent of "web augmentation", the system must actively search the web for new external information when local references are exhausted or absent.

## Suggested Fix: Multi-Source AI-Driven Web Search

We will introduce a comprehensive search escalator that leverages LLMs to generate keywords, aggregates results from multiple external search engines into a verifiable JSON artifact, and uses AI to triage the best sources for ingestion.

### Workflow Summary

1. **AI Keyword Generation:** 
   The LLM analyzes the research goal and the current state of learnings to generate targeted search keywords (this conceptually aligns with the existing Stage 0-3 query escalation in `queryEscalation.ts`).

2. **Multi-Source Scraping Service:**
   Instead of just searching the local database, a new `WebSearchProvider` service takes these keywords and executes searches across multiple distinct sources concurrently:
   - **DuckDuckGo** (General Web)
   - **ArXiv** (Academic / Whitepapers)
   - **Google Patents** (Intellectual Property / Technical Designs)
   - *Other relevant sources as needed.*

3. **Raw Data Aggregation (The "Data is Never Lost" Principle):**
   The service collects the top X findings from each source (Title, URL, and Search Snippet/Description) for each keyword variation. 
   **Crucially**, all of these raw findings are packaged and saved into a local JSON file artifact (e.g., `raw_search_candidates.json`). This ensures that the user can always click a "View Raw" button in the UI to see the complete list of discovered links, preventing data loss.

4. **AI Triage (Finding the Best Options):**
   The massive combined list of raw JSON candidates is passed to an LLM evaluation prompt (similar to the existing `urlTriage.ts`). The LLM processes the Titles and Descriptions to select only the highest-quality, most relevant URLs that perfectly suit the research task.

5. **Display and Ingest:**
   The "Best Options" chosen by the LLM are displayed to the user and passed into the ingestion pipeline (`SourceIngestor`), where the full webpage content is fetched, added to the local pot, and summarized for the final research report.

### Implementation Architecture

#### 1. Add `WebSearchProvider`
Add a new interface in `packages/deep-research/src/types.ts`:
```typescript
export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
  source_engine: 'duckduckgo' | 'arxiv' | 'patents' | 'other';
}

export interface WebSearchProvider {
  search(query: string, topK: number): Promise<WebSearchResult[]>;
}
```

#### 2. Introduce a `MultiSourceSearchService`
Create a service in `packages/deep-research/src/providers/` that implements `WebSearchProvider`. It will use headless scripts or free APIs (like `duck-duck-scrape`, ArXiv API, etc.) to scatter the query across multiple domains and gather the results.

#### 3. Update the Escalator Loop (`escalator.ts`)
Replace the local-only fallback logic with the new pipeline:
- **Step 1:** Generate `queries` using the existing semantic escalation.
- **Step 2:** `ctx.webSearch.search(queries)` runs against DDG, ArXiv, and Patents.
- **Step 3 (New):** Save the aggregated `WebSearchResult[]` to a persistent JSON artifact attached to the research run.
- **Step 4:** Pass the JSON list to `urlTriage.ts`, which batches the candidates and asks the LLM to score relevance and recency, discarding noise.
- **Step 5:** Ingest the passing URLs.

### Why this approach is robust:
- **Comprehensive Coverage:** It goes beyond simple Google searches by explicitly targeting whitepapers and patents, increasing the academic and technical rigor of the research.
- **Total Transparency:** By enforcing a strict "Save everything to JSON first" rule, you ensure full auditability. If the LLM triage skips a URL the user might have wanted, the user still has access to the raw data feed.
- **Maintains Quality:** The final LLM triage acts as a powerful spam filter, ensuring that only highly pertinent pages waste the system's time and tokens during the heavy full-page ingest phase.
