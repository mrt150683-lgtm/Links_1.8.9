/**
 * Builds GitHub search repository query strings with qualifiers.
 * See: https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories
 */

export interface QueryBuilderOptions {
  query: string;
  days?: number;
  stars?: number;
  maxStars?: number;
  language?: string;
  includeForks?: boolean;
  includeArchived?: boolean;
  inReadme?: boolean;
}

export interface BuiltQuery {
  q: string;
  params: {
    query: string;
    days: number;
    stars: number;
    language?: string;
    includeForks: boolean;
    includeArchived: boolean;
    inReadme: boolean;
    pushedSince: string;
  };
}

export function buildSearchQuery(opts: QueryBuilderOptions): BuiltQuery {
  const days = opts.days ?? 180;
  const stars = opts.stars ?? 50;
  const includeForks = opts.includeForks ?? false;
  const includeArchived = opts.includeArchived ?? false;
  const inReadme = opts.inReadme ?? false;

  const pushedSince = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD

  const parts: string[] = [opts.query];

  if (opts.maxStars != null) {
    parts.push(`stars:${stars}..${opts.maxStars}`);
  } else {
    parts.push(`stars:>=${stars}`);
  }
  parts.push(`pushed:>=${pushedSince}`);
  parts.push(`archived:${includeArchived ? 'true' : 'false'}`);

  if (!includeForks) {
    parts.push('fork:false');
  }

  if (opts.language) {
    parts.push(`language:${opts.language}`);
  }

  if (inReadme) {
    parts.push('in:readme');
  }

  return {
    q: parts.join(' '),
    params: {
      query: opts.query,
      days,
      stars,
      language: opts.language,
      includeForks,
      includeArchived,
      inReadme,
      pushedSince,
    },
  };
}
