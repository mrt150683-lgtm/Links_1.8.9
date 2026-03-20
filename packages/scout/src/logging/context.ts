export interface RunContext {
  run_id: string | null;
  step: string | null;
  module: string | null;
  request_id: string | null;
}

export function makeRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    run_id: null,
    step: null,
    module: null,
    request_id: null,
    ...overrides,
  };
}
