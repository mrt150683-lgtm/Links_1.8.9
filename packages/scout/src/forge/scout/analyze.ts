import { randomUUID } from 'crypto';
import type { Db } from '../../db/index.js';
import type { ForgeRunOrchestrator } from './run_context.js';
import { FORGE_STEP_NAMES } from './run_context.js';
import { loadPrompt, fillTemplate } from '../../llm/prompt_registry.js';
import { callOpenRouterJson } from '../../llm/client.js';
import { ForgePacksDao } from '../db/dao/forge_packs.js';
import { ForgeRunsDao } from '../db/dao/forge_runs.js';
import { ReposDao, ReadmesDao } from '../../db/dao/repos.js';

export async function runForgeAnalysis(
  db: Db,
  orchestrator: ForgeRunOrchestrator,
  opts: {
    model: string;
    apiKey: string;
    topN?: number;
  }
): Promise<{ packs_generated: number }> {
  const step = orchestrator.startStep(FORGE_STEP_NAMES.SYNERGY_ANALYSIS);
  const forgePacksDao = new ForgePacksDao(db);
  const forgeRunsDao = new ForgeRunsDao(db);
  const reposDao = new ReposDao(db);
  const readmesDao = new ReadmesDao(db);

  try {
    const forgeRun = forgeRunsDao.getById(orchestrator.run_id);
    if (!forgeRun) throw new Error(`Forge run not found: ${orchestrator.run_id}`);

    // 1. Prepare Seed Content
    let seedContent = '';
    if (forgeRun.mode === 'repo') {
      const repo = reposDao.getByFullName(forgeRun.seed_repo_full_name!);
      const readme = repo ? readmesDao.getByRepoId(repo.repo_id) : null;
      seedContent = `Repository: ${forgeRun.seed_repo_full_name}

README:
${readme?.content_text.slice(0, 3000) ?? 'No README found'}`;
    } else {
      seedContent = `Idea: ${forgeRun.seed_text}`;
    }

    // 2. Fetch Candidates
    // We fetch analyses for this run that were generated in Phase 6
    const analyses = db.prepare('SELECT * FROM analyses WHERE run_id = ?').all(orchestrator.run_id) as any[];
    
    const candidatesList = analyses.map(a => {
      const repo = db.prepare('SELECT * FROM repos WHERE repo_id = ?').get(a.repo_id) as any;
      const output = JSON.parse(a.output_json);
      return `- ${repo.full_name}: ${output.summary || 'No summary available'}`;
    }).join('\n');

    // 3. Call Premium LLM
    const prompt = loadPrompt('forge_pack_analysis', 'v1');
    const filled = fillTemplate(prompt.template, {
      seed_content: seedContent,
      candidates_list: candidatesList
    });

    const llmOutput = await callOpenRouterJson({
      model: opts.model,
      apiKey: opts.apiKey,
      messages: [{ role: 'user', content: filled }],
      temperature: prompt.meta.model_defaults.temperature,
      max_tokens: prompt.meta.model_defaults.max_tokens,
    }) as { packs: any[] };

    // 4. Store Packs
    for (const p of llmOutput.packs) {
      // Find repo IDs for the full names
      const repoIds = p.repos.map((name: string) => {
        const repo = reposDao.getByFullName(name);
        return repo?.repo_id;
      }).filter(Boolean);

      forgePacksDao.create({
        pack_id: randomUUID(),
        run_id: orchestrator.run_id,
        score: p.synergy_score, // Simplification: using LLM score as final score for now
        repo_ids_json: JSON.stringify(repoIds),
        reasons_json: JSON.stringify(p.synergy_reasoning),
        merge_plan_md: p.merge_plan,
        status: 'final',
        created_at: new Date().toISOString()
      });
    }

    step.finish('success', { packs_generated: llmOutput.packs.length });
    return { packs_generated: llmOutput.packs.length };

  } catch (err) {
    step.finish('failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
