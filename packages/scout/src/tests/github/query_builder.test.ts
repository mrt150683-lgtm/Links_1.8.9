import { describe, it, expect } from 'vitest';
import { buildSearchQuery } from '../../github/query_builder.js';

describe('buildSearchQuery', () => {
  it('includes the user query in the result', () => {
    const { q } = buildSearchQuery({ query: 'vector database' });
    expect(q).toContain('vector database');
  });

  it('adds stars qualifier with default', () => {
    const { q } = buildSearchQuery({ query: 'test' });
    expect(q).toContain('stars:>=50');
  });

  it('respects custom stars value', () => {
    const { q } = buildSearchQuery({ query: 'test', stars: 100 });
    expect(q).toContain('stars:>=100');
  });

  it('adds pushed date qualifier', () => {
    const { q } = buildSearchQuery({ query: 'test', days: 30 });
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(q).toContain(`pushed:>=${cutoffDate}`);
  });

  it('excludes forks by default (fork:false)', () => {
    const { q } = buildSearchQuery({ query: 'test' });
    expect(q).toContain('fork:false');
  });

  it('excludes archived by default', () => {
    const { q } = buildSearchQuery({ query: 'test' });
    expect(q).toContain('archived:false');
  });

  it('includes language qualifier when specified', () => {
    const { q } = buildSearchQuery({ query: 'test', language: 'TypeScript' });
    expect(q).toContain('language:TypeScript');
  });

  it('adds in:readme when requested', () => {
    const { q } = buildSearchQuery({ query: 'test', inReadme: true });
    expect(q).toContain('in:readme');
  });

  it('does not add in:readme by default', () => {
    const { q } = buildSearchQuery({ query: 'test' });
    expect(q).not.toContain('in:readme');
  });

  it('returns params with all defaults applied', () => {
    const { params } = buildSearchQuery({ query: 'hello' });
    expect(params.days).toBe(180);
    expect(params.stars).toBe(50);
    expect(params.includeForks).toBe(false);
    expect(params.includeArchived).toBe(false);
    expect(params.inReadme).toBe(false);
  });
});
