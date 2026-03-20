/**
 * Intel E2E test seed script
 * Creates a pot with 4 rich entries, triggers intelligence gen, polls for completion.
 */

const BASE = 'http://localhost:3000';
const POT_ID = '3df0fed8-6736-4009-ac5f-572a6e8f194b';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

const ENTRIES = [
  {
    source_title: 'GPT-4 Technical Report',
    content_text: `GPT-4 Technical Report Summary. OpenAI released GPT-4 in March 2023, claiming it scores in the 90th percentile on the Uniform Bar Exam compared to GPT-3.5 scoring in the 10th percentile. On the MMLU benchmark, GPT-4 achieves 86.4% accuracy across 57 academic subjects. OpenAI used RLHF and adversarial training to reduce harmful outputs by 82% compared to GPT-3.5. The model accepts both text and image inputs with 8k and 32k token context window variants. Training data cutoff: September 2021. A key limitation acknowledged is hallucination — the model can confidently state incorrect facts. OpenAI estimates training cost exceeded 100 million USD.`,
  },
  {
    source_title: 'Google Gemini Ultra Benchmark Analysis',
    content_text: `Google announced Gemini Ultra in December 2023, achieving 90.0% on the MMLU benchmark — the first model to surpass human expert performance at 89.8%. Gemini Ultra is natively multimodal, trained jointly on text, images, audio, and video from the ground up, unlike GPT-4 which added vision as a separate capability. On HumanEval coding benchmark, Gemini Ultra scores 74.4% vs GPT-4 at 67%. However, independent researchers noted that Gemini results used chain-of-thought prompting not used in the GPT-4 comparisons, raising questions about benchmark comparability. Context window: up to 1 million tokens in the 1.5 Pro variant released in February 2024.`,
  },
  {
    source_title: 'Stanford HAI: LLM Hallucination Benchmark 2024',
    content_text: `A Stanford HAI study published in April 2024 tested 10 major LLMs for factual accuracy across 1,000 medical and legal questions. GPT-4 hallucinated on 9.2% of questions (down from 22% for GPT-3.5). Gemini Pro hallucinated on 12.4%. Claude 3 Opus had the lowest hallucination rate at 6.1%. The study found that model size correlates with reduced hallucination, but that RLHF fine-tuning has a larger effect than raw parameter count. The researchers noted all models showed higher error rates on questions requiring calculations or precise date recall. The study recommends implementing retrieval-augmented generation (RAG) to supplement model knowledge and reduce hallucination in production systems.`,
  },
  {
    source_title: 'McKinsey Enterprise AI Adoption Report Q1 2024',
    content_text: `A McKinsey survey of 1,400 enterprises found that 65% are now using generative AI in at least one business function, up from 33% in 2023. Legal and compliance departments show the lowest adoption at 18%, citing hallucination risk as the primary barrier. The average enterprise spends 2.4 million USD annually on AI infrastructure. Companies that adopted RAG architectures reported 43% fewer AI-related errors compared to those using base LLMs directly. GPT-4 remains the most widely deployed model in enterprise settings at 54% market share, followed by internal fine-tuned models at 28%. 71% of respondents cited data privacy concerns as a major obstacle.`,
  },
];

console.log(`\n=== INTEL E2E TEST — Pot: ${POT_ID} ===\n`);

// 1. Add entries
console.log('Step 1: Adding entries...');
const entryIds = [];
for (const e of ENTRIES) {
  const r = await post(`/pots/${POT_ID}/entries/text`, {
    text: e.content_text,
    source_title: e.source_title,
    capture_method: 'manual',
  });
  if (r.status !== 201) {
    console.error(`  FAILED adding entry "${e.source_title}": ${JSON.stringify(r.data)}`);
    process.exit(1);
  }
  entryIds.push(r.data.id);
  console.log(`  ✓ ${r.data.id} — ${e.source_title}`);
}

// 2. Trigger intelligence run
console.log('\nStep 2: Triggering intelligence generation...');
const runRes = await post(`/pots/${POT_ID}/intelligence/generate`, {
  mode: 'full',
  max_questions: 5,
});
if (runRes.status !== 202) {
  console.error('  FAILED:', JSON.stringify(runRes.data));
  process.exit(1);
}
const { run_id, job_id, mode, estimated_input_tokens, entry_count } = runRes.data;
console.log(`  ✓ run_id: ${run_id}`);
console.log(`  mode: ${mode}, entries: ${entry_count}, est_tokens: ${estimated_input_tokens}`);
console.log(`  job_id: ${job_id}`);

console.log('\n=== SEED COMPLETE ===');
console.log(`Run ID: ${run_id}`);
console.log(`\nNow run the worker to process jobs:`);
console.log(`  cd apps/worker && npx tsx src/index.ts --once   (run ~7 times for all jobs)`);
console.log(`\nThen check results:`);
console.log(`  GET /pots/${POT_ID}/intelligence/questions`);
console.log(`  GET /pots/${POT_ID}/intelligence/answers`);
