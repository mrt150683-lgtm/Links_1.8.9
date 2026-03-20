/**
 * Static search engine registry
 *
 * Each entry has an id, label, category, and url_template with `{q}` placeholder.
 */

export interface SearchTarget {
  id: string;
  label: string;
  category: string;
  url_template: string;
}

export const SEARCH_TARGETS: SearchTarget[] = [
  { id: 'google', label: 'Google', category: 'general', url_template: 'https://www.google.com/search?q={q}' },
  { id: 'duckduckgo', label: 'DuckDuckGo', category: 'general', url_template: 'https://duckduckgo.com/?q={q}' },
  { id: 'bing', label: 'Bing', category: 'general', url_template: 'https://www.bing.com/search?q={q}' },
  { id: 'github', label: 'GitHub', category: 'code', url_template: 'https://github.com/search?q={q}' },
  { id: 'stackoverflow', label: 'Stack Overflow', category: 'code', url_template: 'https://stackoverflow.com/search?q={q}' },
  { id: 'arxiv', label: 'arXiv', category: 'academic', url_template: 'https://arxiv.org/search/?searchtype=all&query={q}' },
  { id: 'pubmed', label: 'PubMed', category: 'academic', url_template: 'https://pubmed.ncbi.nlm.nih.gov/?term={q}' },
  { id: 'semantic_scholar', label: 'Semantic Scholar', category: 'academic', url_template: 'https://www.semanticscholar.org/search?q={q}' },
  { id: 'google_scholar', label: 'Google Scholar', category: 'academic', url_template: 'https://scholar.google.com/scholar?q={q}' },
  { id: 'google_patents', label: 'Google Patents', category: 'academic', url_template: 'https://patents.google.com/?q={q}' },
  { id: 'lens', label: 'Lens.org', category: 'academic', url_template: 'https://www.lens.org/lens/search/scholar?q={q}' },
  { id: 'core', label: 'CORE', category: 'academic', url_template: 'https://core.ac.uk/search?q={q}' },
  { id: 'crossref', label: 'Crossref', category: 'academic', url_template: 'https://search.crossref.org/?q={q}' },
  { id: 'wikipedia', label: 'Wikipedia', category: 'reference', url_template: 'https://en.wikipedia.org/w/index.php?search={q}' },
  { id: 'youtube', label: 'YouTube', category: 'media', url_template: 'https://www.youtube.com/results?search_query={q}' },
  { id: 'reddit', label: 'Reddit', category: 'community', url_template: 'https://www.reddit.com/search/?q={q}' },
  { id: 'hackernews', label: 'Hacker News', category: 'community', url_template: 'https://hn.algolia.com/?q={q}' },
];

/**
 * Build a search URL by replacing `{q}` with URL-encoded query.
 */
export function buildSearchUrl(template: string, query: string): string {
  return template.replace('{q}', encodeURIComponent(query));
}
