import { PlanIndexSchema, selectPlanningDocPack } from '@links/core';

export function buildDefaultPlanIndex(projectName: string, projectType: string): any {
  const index = {
    project_name: projectName,
    project_type: projectType,
    phases: [
      { phase_number: 1, title: 'Discovery', objective: 'Understand requirements and constraints', outputs: ['requirements.md', 'risk list'] },
      { phase_number: 2, title: 'Implementation', objective: 'Deliver scoped implementation', outputs: ['implementation artifacts', 'review notes'] },
      { phase_number: 3, title: 'Validation', objective: 'Verify quality and readiness', outputs: ['test report', 'release checklist'] },
    ],
    recommended_docs: selectPlanningDocPack(projectType),
  };

  return PlanIndexSchema.parse(index);
}
