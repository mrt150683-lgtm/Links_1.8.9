import { createHash } from 'crypto';
import type { Db } from '../index.js';

export interface RepoRow {
  repo_id: string;
  full_name: string;
  url: string;
  stars: number;
  forks: number;
  topics_json: string | null;
  language: string | null;
  license: string | null;
  pushed_at: string | null;
  archived: number;
  fork: number;
  last_seen_run_id: string | null;
}

export interface ReadmeRow {
  readme_id: string;
  repo_id: string;
  sha256: string;
  content_text: string;
  fetched_at: string;
  etag: string | null;
  source_url: string | null;
}

export interface GitHubQueryRow {
  query_id: string;
  run_id: string;
  pass: number;
  query_string: string;
  params_json: string | null;
  created_at: string;
}

export class ReposDao {
  constructor(private readonly db: Db) {}

  upsert(repo: {
    full_name: string;
    url: string;
    stars: number;
    forks: number;
    topics: string[];
    language: string | null;
    license: string | null;
    pushed_at: string | null;
    archived: boolean;
    fork: boolean;
    run_id: string;
  }): RepoRow {
    const repo_id = createHash('sha256')
      .update(repo.full_name)
      .digest('hex')
      .slice(0, 16);

    const existing = this.db
      .prepare('SELECT * FROM repos WHERE full_name = ?')
      .get(repo.full_name) as RepoRow | undefined;

    if (existing) {
      this.db
        .prepare(
          'UPDATE repos SET stars=?, forks=?, topics_json=?, language=?, license=?, pushed_at=?, archived=?, fork=?, last_seen_run_id=? WHERE full_name=?'
        )
        .run(
          repo.stars,
          repo.forks,
          JSON.stringify(repo.topics),
          repo.language,
          repo.license,
          repo.pushed_at,
          repo.archived ? 1 : 0,
          repo.fork ? 1 : 0,
          repo.run_id,
          repo.full_name
        );
      return this.db.prepare('SELECT * FROM repos WHERE full_name = ?').get(repo.full_name) as RepoRow;
    }

    const row: RepoRow = {
      repo_id,
      full_name: repo.full_name,
      url: repo.url,
      stars: repo.stars,
      forks: repo.forks,
      topics_json: JSON.stringify(repo.topics),
      language: repo.language,
      license: repo.license,
      pushed_at: repo.pushed_at,
      archived: repo.archived ? 1 : 0,
      fork: repo.fork ? 1 : 0,
      last_seen_run_id: repo.run_id,
    };

    this.db
      .prepare(
        'INSERT INTO repos (repo_id, full_name, url, stars, forks, topics_json, language, license, pushed_at, archived, fork, last_seen_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        row.repo_id, row.full_name, row.url, row.stars, row.forks,
        row.topics_json, row.language, row.license, row.pushed_at,
        row.archived, row.fork, row.last_seen_run_id
      );

    return row;
  }

  getByFullName(full_name: string): RepoRow | null {
    return (this.db.prepare('SELECT * FROM repos WHERE full_name = ?').get(full_name) as RepoRow | undefined) ?? null;
  }

  countByRunId(run_id: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM repos WHERE last_seen_run_id = ?')
      .get(run_id) as { cnt: number };
    return row.cnt;
  }
}

export class ReadmesDao {
  constructor(private readonly db: Db) {}

  upsert(readme: {
    repo_id: string;
    content_text: string;
    etag?: string | null;
    source_url?: string | null;
  }): ReadmeRow {
    const sha256 = createHash('sha256').update(readme.content_text, 'utf-8').digest('hex');
    const readme_id = `${readme.repo_id}:${sha256.slice(0, 8)}`;
    const fetched_at = new Date().toISOString();

    // Remove old readme for this repo (only keep latest)
    this.db.prepare('DELETE FROM readmes WHERE repo_id = ?').run(readme.repo_id);

    const row: ReadmeRow = {
      readme_id,
      repo_id: readme.repo_id,
      sha256,
      content_text: readme.content_text,
      fetched_at,
      etag: readme.etag ?? null,
      source_url: readme.source_url ?? null,
    };

    this.db
      .prepare(
        'INSERT INTO readmes (readme_id, repo_id, sha256, content_text, fetched_at, etag, source_url) VALUES (?,?,?,?,?,?,?)'
      )
      .run(row.readme_id, row.repo_id, row.sha256, row.content_text, row.fetched_at, row.etag, row.source_url);

    return row;
  }

  getByRepoId(repo_id: string): ReadmeRow | null {
    return (this.db.prepare('SELECT * FROM readmes WHERE repo_id = ?').get(repo_id) as ReadmeRow | undefined) ?? null;
  }
}

export class GithubQueriesDao {
  constructor(private readonly db: Db) {}

  create(opts: {
    query_id: string;
    run_id: string;
    pass: number;
    query_string: string;
    params: Record<string, unknown>;
  }): GitHubQueryRow {
    const row: GitHubQueryRow = {
      query_id: opts.query_id,
      run_id: opts.run_id,
      pass: opts.pass,
      query_string: opts.query_string,
      params_json: JSON.stringify(opts.params),
      created_at: new Date().toISOString(),
    };

    this.db
      .prepare(
        'INSERT INTO github_queries (query_id, run_id, pass, query_string, params_json, created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(row.query_id, row.run_id, row.pass, row.query_string, row.params_json, row.created_at);

    return row;
  }

  linkRepoToQuery(repo_id: string, query_id: string, search_rank: number, pass_number: number): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO repo_query_links (repo_id, query_id, search_rank, pass_number) VALUES (?,?,?,?)'
      )
      .run(repo_id, query_id, search_rank, pass_number);
  }
}
