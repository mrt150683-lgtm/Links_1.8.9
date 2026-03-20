export function selectPlanningDocPack(projectType: string): string[] {
  const normalized = projectType.toLowerCase();
  if (normalized.includes('software')) {
    return ['architecture.md', 'security.md', 'qa.md', 'git.md', 'ui.md'];
  }
  if (normalized.includes('hardware')) {
    return ['materials.md', 'bom.md', 'test_plan.md', 'safety.md', 'calibration.md'];
  }
  if (normalized.includes('health') || normalized.includes('fitness') || normalized.includes('diet')) {
    return ['training_plan.md', 'nutrition_plan.md', 'tracking.md', 'safety.md', 'contraindications.md'];
  }
  return ['architecture.md', 'qa.md', 'safety.md'];
}
