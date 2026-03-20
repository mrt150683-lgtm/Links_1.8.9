import { describe, it, expect } from 'vitest';
import { generateCandidateGroups } from '../../briefs/grouper.js';
import type { AnalysisRow } from '../../db/dao/analyses.js';
import type { RepoRow } from '../../db/dao/repos.js';

function makeAnalysis(
  repo_id: string,
  final_score: number,
  collab: number,
  integration_surface: string[] = []
): AnalysisRow {
  return {
    analysis_id: `${repo_id}-ana`,
    repo_id,
    run_id: 'run-test',
    model: 'test',
    prompt_id: 'test',
    prompt_version: 'v1',
    input_snapshot_json: '{}',
    output_json: JSON.stringify({ signals: { integration_surface } }),
    llm_scores_json: JSON.stringify({ collaboration_potential: collab }),
    final_score,
    reasons_json: '{}',
    created_at: '2024-01-01T00:00:00.000Z',
  };
}

function makeRepo(
  repo_id: string,
  topics: string[],
  language: string | null = null
): RepoRow {
  return {
    repo_id,
    full_name: `example/${repo_id}`,
    url: `https://github.com/example/${repo_id}`,
    stars: 100,
    forks: 10,
    topics_json: JSON.stringify(topics),
    language,
    license: 'MIT',
    pushed_at: '2024-01-01T00:00:00Z',
    archived: 0,
    fork: 0,
    last_seen_run_id: null,
  };
}

describe('generateCandidateGroups', () => {
  const highAnalysis1 = makeAnalysis('repo1', 0.8, 0.8, ['api']);
  const highAnalysis2 = makeAnalysis('repo2', 0.75, 0.7, ['sdk']);
  const highAnalysis3 = makeAnalysis('repo3', 0.9, 0.9, ['api', 'sdk']);
  const lowScoreAnalysis = makeAnalysis('repo-low', 0.4, 0.8, ['api']); // below minRepoScore
  const lowCollabAnalysis = makeAnalysis('repo-lc', 0.8, 0.5, ['api']); // below minCollabPotential

  const repo1 = makeRepo('repo1', ['ml', 'python'], 'Python');
  const repo2 = makeRepo('repo2', ['ml', 'python'], 'Python');
  const repo3 = makeRepo('repo3', ['data', 'analytics'], 'TypeScript');
  const repoLow = makeRepo('repo-low', ['ml'], 'Python');
  const repoLc = makeRepo('repo-lc', ['data'], 'Go');

  it('returns empty array when fewer than 2 repos qualify', () => {
    const groups = generateCandidateGroups([highAnalysis1], [repo1]);
    expect(groups).toHaveLength(0);
  });

  it('filters repos below minRepoScore', () => {
    const groups = generateCandidateGroups(
      [highAnalysis1, lowScoreAnalysis],
      [repo1, repoLow]
    );
    // only 1 qualifies, so 0 groups
    expect(groups).toHaveLength(0);
  });

  it('filters repos below minCollabPotential', () => {
    const groups = generateCandidateGroups(
      [highAnalysis1, lowCollabAnalysis],
      [repo1, repoLc]
    );
    expect(groups).toHaveLength(0);
  });

  it('generates one pair from two qualifying repos', () => {
    const groups = generateCandidateGroups(
      [highAnalysis1, highAnalysis2],
      [repo1, repo2]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.repo_ids).toHaveLength(2);
    expect(groups[0]!.repo_ids).toContain('repo1');
    expect(groups[0]!.repo_ids).toContain('repo2');
  });

  it('repo_ids within each group are sorted', () => {
    const groups = generateCandidateGroups(
      [highAnalysis1, highAnalysis2],
      [repo1, repo2]
    );
    const ids = groups[0]!.repo_ids;
    expect(ids).toEqual([...ids].sort());
  });

  it('generates three pairs from three qualifying repos', () => {
    const groups = generateCandidateGroups(
      [highAnalysis1, highAnalysis2, highAnalysis3],
      [repo1, repo2, repo3]
    );
    expect(groups).toHaveLength(3);
  });

  it('is deterministic — same input produces same output', () => {
    const analyses = [highAnalysis1, highAnalysis2, highAnalysis3];
    const repos = [repo1, repo2, repo3];
    const g1 = generateCandidateGroups(analyses, repos);
    const g2 = generateCandidateGroups(analyses, repos);
    expect(g1).toEqual(g2);
  });

  it('sorts groups by overlap_score desc', () => {
    // repo1 + repo2 share topics ['ml','python'] and same language → higher overlap
    // repo1 + repo3 share no topics, different language → lower overlap
    const groups = generateCandidateGroups(
      [highAnalysis1, highAnalysis2, highAnalysis3],
      [repo1, repo2, repo3]
    );
    for (let i = 0; i < groups.length - 1; i++) {
      expect(groups[i]!.overlap_score).toBeGreaterThanOrEqual(groups[i + 1]!.overlap_score);
    }
  });

  it('respects maxCombos cap', () => {
    const groups = generateCandidateGroups(
      [highAnalysis1, highAnalysis2, highAnalysis3],
      [repo1, repo2, repo3],
      { maxCombos: 1 }
    );
    expect(groups).toHaveLength(1);
  });

  it('scores repos sharing topics and language higher than repos with nothing in common', () => {
    const sharedGroups = generateCandidateGroups(
      [highAnalysis1, highAnalysis2],
      [repo1, repo2] // same topics ['ml','python'], same language Python
    );
    const differentGroups = generateCandidateGroups(
      [highAnalysis1, highAnalysis3],
      [repo1, repo3] // no shared topics, different languages
    );
    expect(sharedGroups[0]!.overlap_score).toBeGreaterThan(differentGroups[0]!.overlap_score);
  });

  it('complement bonus: one has api/sdk, other does not', () => {
    const withApi = makeAnalysis('with-api', 0.8, 0.8, ['api']);
    const withoutApi = makeAnalysis('without-api', 0.8, 0.8, ['cli']);
    const bothApi = makeAnalysis('both-api', 0.8, 0.8, ['api', 'sdk']);

    const repoWithApi = makeRepo('with-api', []);
    const repoWithoutApi = makeRepo('without-api', []);
    const repoBothApi = makeRepo('both-api', []);

    const complementGroups = generateCandidateGroups(
      [withApi, withoutApi],
      [repoWithApi, repoWithoutApi]
    );
    const sameGroups = generateCandidateGroups(
      [withApi, bothApi],
      [repoWithApi, repoBothApi]
    );

    // Complement (one has API, other doesn't) scores higher than same
    expect(complementGroups[0]!.overlap_score).toBeGreaterThan(sameGroups[0]!.overlap_score);
  });
});
