import { z } from 'zod';

export const PlanningQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5).max(1000),
  why_it_matters: z.string().min(3).max(1000),
  answer_type: z.enum(['text', 'boolean', 'choice', 'multi_choice', 'number']),
  choices: z.array(z.string().min(1).max(200)).max(20).optional(),
  required: z.boolean().default(true),
  allow_idk: z.boolean().default(true),
  allow_na: z.boolean().default(true),
});

export const ProjectQuestionsSchema = z.object({
  project_type_guess: z.string().min(1).max(100),
  questions: z.array(PlanningQuestionSchema).min(5).max(20),
});

export const ProjectAnswerItemSchema = z.object({
  question_id: z.string().min(1),
  status: z.enum(['answered', 'idk', 'na']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional().nullable(),
});

export const ProjectAnswersSchema = z.object({
  answers: z.array(ProjectAnswerItemSchema).min(1).max(20),
});

export const PlanPhaseSchema = z.object({
  phase_number: z.number().int().positive(),
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(1000),
  outputs: z.array(z.string().min(1).max(300)).min(1).max(30),
});

export const PlanIndexSchema = z.object({
  project_name: z.string().min(1).max(200),
  project_type: z.string().min(1).max(100),
  phases: z.array(PlanPhaseSchema).min(1).max(20),
  recommended_docs: z.array(z.string().min(1).max(200)).min(1).max(30),
});

export const PlanningFileKindSchema = z.enum([
  'questions_json',
  'answers_json',
  'plan_md',
  'plan_index_json',
  'phase_md',
  'doc_md',
  'manifest_json',
]);

export type ProjectQuestions = z.infer<typeof ProjectQuestionsSchema>;
export type ProjectAnswers = z.infer<typeof ProjectAnswersSchema>;
export type PlanIndex = z.infer<typeof PlanIndexSchema>;
