import { describe, it, expect } from 'vitest';
import { ProjectQuestionsSchema, ProjectAnswersSchema, PlanIndexSchema, selectPlanningDocPack } from '../src/index.js';

describe('planning schemas', () => {
  it('validates question count bounds', () => {
    const valid = {
      project_type_guess: 'software',
      questions: Array.from({ length: 5 }).map((_, i) => ({
        id: `q${i + 1}`,
        question: `Question ${i + 1}?`,
        why_it_matters: 'Important context for planning',
        answer_type: 'text',
        required: true,
        allow_idk: true,
        allow_na: true,
      })),
    };

    expect(ProjectQuestionsSchema.safeParse(valid).success).toBe(true);
    expect(ProjectQuestionsSchema.safeParse({ ...valid, questions: valid.questions.slice(0, 4) }).success).toBe(false);
  });

  it('validates answers schema', () => {
    const parsed = ProjectAnswersSchema.parse({ answers: [{ question_id: 'q1', status: 'idk', value: null }] });
    expect(parsed.answers[0]?.status).toBe('idk');
  });

  it('validates plan index and doc selector rules', () => {
    expect(selectPlanningDocPack('software')).toEqual(['architecture.md', 'security.md', 'qa.md', 'git.md', 'ui.md']);
    expect(selectPlanningDocPack('hardware')).toEqual(['materials.md', 'bom.md', 'test_plan.md', 'safety.md', 'calibration.md']);

    const planIndex = PlanIndexSchema.parse({
      project_name: 'Test Project',
      project_type: 'software',
      phases: [{ phase_number: 1, title: 'One', objective: 'Obj', outputs: ['out'] }],
      recommended_docs: selectPlanningDocPack('software'),
    });

    expect(planIndex.recommended_docs).toContain('security.md');
  });
});
