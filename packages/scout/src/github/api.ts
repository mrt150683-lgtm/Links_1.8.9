import type { GitHubClient } from './client.js';

export interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  language: string | null;
  license: { spdx_id: string } | null;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
}

export interface SearchReposResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepo[];
}

export interface SearchReposOptions {
  q: string;
  per_page?: number;
  page?: number;
  sort?: 'stars' | 'updated' | 'forks' | 'help-wanted-issues';
  order?: 'asc' | 'desc';
}

export async function searchRepos(
  client: GitHubClient,
  opts: SearchReposOptions
): Promise<SearchReposResponse> {
  const query: Record<string, string | number | boolean> = {
    q: opts.q,
    per_page: opts.per_page ?? 30,
    page: opts.page ?? 1,
    sort: opts.sort ?? 'stars',
    order: opts.order ?? 'desc',
  };

  const resp = await client.request<SearchReposResponse>({
    path: '/search/repositories',
    bucket: 'search',
    query,
  });

  return resp.data;
}

export async function getReadmeRaw(
  client: GitHubClient,
  owner: string,
  repo: string
): Promise<{ content: string; etag?: string } | null> {
  try {
    const resp = await client.request<string>({
      path: `/repos/${owner}/${repo}/readme`,
      accept: 'application/vnd.github.raw+json',
      bucket: 'core',
    });

    return {
      content: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data),
      etag: resp.headers.etag,
    };
  } catch (err) {
    // 404 means no README — return null (not an error)
    const isNotFound =
      err instanceof Error && err.message.includes('404');
    if (isNotFound) return null;
    throw err;
  }
}
