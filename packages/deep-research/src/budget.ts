/**
 * BudgetGuard
 *
 * Enforces hard limits on deep research runs:
 * - Wall time, model tokens, cost
 * - Entries read, web pages fetched, total sources
 * - max_concurrency is a structural semaphore, not checked here
 * - max_links_per_run is enforced centrally in deepResearchLinks.ts
 */

import type { BudgetUsage, ResearchBudget } from '@links/core';

export class BudgetExceededError extends Error {
  readonly violations: string[];
  readonly usage: BudgetUsage;

  constructor(violations: string[], usage: BudgetUsage) {
    super(`Budget exceeded: ${violations.join(', ')}`);
    this.name = 'BudgetExceededError';
    this.violations = violations;
    this.usage = usage;
  }
}

export interface UsageDelta {
  model_tokens?: number;
  cost_cents?: number;
  entries_read?: number;
  web_pages_fetched?: number;
  total_sources?: number;
}

export class BudgetGuard {
  private usage: BudgetUsage;
  private readonly config: ResearchBudget;
  private readonly startTime: number;

  constructor(config: ResearchBudget, initialUsage?: Partial<BudgetUsage>) {
    this.config = config;
    this.startTime = Date.now();
    this.usage = {
      wall_time_ms: 0,
      model_tokens: initialUsage?.model_tokens ?? 0,
      cost_cents: initialUsage?.cost_cents ?? 0,
      entries_read: initialUsage?.entries_read ?? 0,
      web_pages_fetched: initialUsage?.web_pages_fetched ?? 0,
      total_sources: initialUsage?.total_sources ?? 0,
    };
  }

  /**
   * Record usage delta. Call after each AI call or resource consumption.
   */
  record(delta: UsageDelta): void {
    if (delta.model_tokens) this.usage.model_tokens += delta.model_tokens;
    if (delta.cost_cents) this.usage.cost_cents += delta.cost_cents;
    if (delta.entries_read) this.usage.entries_read += delta.entries_read;
    if (delta.web_pages_fetched) this.usage.web_pages_fetched += delta.web_pages_fetched;
    if (delta.total_sources) this.usage.total_sources += delta.total_sources;
  }

  /**
   * Check all budget limits. Throws BudgetExceededError if any limit is exceeded.
   * Call BEFORE each AI call and AFTER each batch.
   */
  check(): void {
    this.usage.wall_time_ms = Date.now() - this.startTime;

    const violations: string[] = [];

    if (this.usage.wall_time_ms > this.config.max_wall_time_ms) {
      violations.push(`wall_time exceeded (${this.usage.wall_time_ms}ms > ${this.config.max_wall_time_ms}ms)`);
    }

    if (this.usage.model_tokens > this.config.max_model_tokens) {
      violations.push(`model_tokens exceeded (${this.usage.model_tokens} > ${this.config.max_model_tokens})`);
    }

    if (this.config.max_cost_cents && this.usage.cost_cents > this.config.max_cost_cents) {
      violations.push(`cost exceeded ($${this.usage.cost_cents}¢ > ${this.config.max_cost_cents}¢)`);
    }

    if (this.usage.entries_read > this.config.max_entries_read) {
      violations.push(`entries_read exceeded (${this.usage.entries_read} > ${this.config.max_entries_read})`);
    }

    if (this.usage.web_pages_fetched > this.config.max_web_pages_fetched) {
      violations.push(`web_pages_fetched exceeded (${this.usage.web_pages_fetched} > ${this.config.max_web_pages_fetched})`);
    }

    if (this.usage.total_sources > this.config.max_total_sources) {
      violations.push(`total_sources exceeded (${this.usage.total_sources} > ${this.config.max_total_sources})`);
    }

    if (violations.length > 0) {
      throw new BudgetExceededError(violations, this.getCurrentUsage());
    }
  }

  /**
   * Returns true if the budget is NOT exceeded (no throw). Use for early-exit checks.
   */
  isOk(): boolean {
    try {
      this.check();
      return true;
    } catch {
      return false;
    }
  }

  getCurrentUsage(): BudgetUsage {
    return { ...this.usage, wall_time_ms: Date.now() - this.startTime };
  }
}
