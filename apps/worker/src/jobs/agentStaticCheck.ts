/**
 * Shared Agent Static Code Checker
 *
 * Pre-sandbox static analysis for agent-generated tool code.
 * Checks for banned patterns, size limits, and other safety rules.
 *
 * Used by: agentToolBuild.ts, agentToolTest.ts
 */

interface BannedPattern {
  pattern: RegExp;
  rule: string;
  detail: string;
}

const BANNED_PATTERNS: BannedPattern[] = [
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, rule: 'no_fs_require', detail: 'require("fs") is banned' },
  { pattern: /\beval\s*\(/, rule: 'no_eval', detail: 'eval() is banned' },
  { pattern: /\bexec\s*\(/, rule: 'no_exec', detail: 'exec() is banned' },
  { pattern: /\bspawn\s*\(/, rule: 'no_spawn', detail: 'spawn() is banned' },
  { pattern: /import\s+os\b/, rule: 'no_os_import', detail: 'import os is banned (Python)' },
  { pattern: /import\s+subprocess\b/, rule: 'no_subprocess', detail: 'import subprocess is banned (Python)' },
  { pattern: /import\s+socket\b/, rule: 'no_socket_import', detail: 'import socket is banned' },
  { pattern: /\bopen\s*\(/, rule: 'no_open', detail: 'open() is banned' },
  { pattern: /process\.env/, rule: 'no_process_env', detail: 'process.env access is banned' },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, rule: 'no_child_process', detail: 'require("child_process") is banned' },
  { pattern: /require\s*\(\s*['"]net['"]\s*\)/, rule: 'no_net_require', detail: 'require("net") is banned' },
  { pattern: /require\s*\(\s*['"]http['"]\s*\)/, rule: 'no_http_require', detail: 'require("http") is banned' },
  { pattern: /require\s*\(\s*['"]https['"]\s*\)/, rule: 'no_https_require', detail: 'require("https") is banned' },
  { pattern: /__dirname/, rule: 'no_dirname', detail: '__dirname is banned' },
  { pattern: /__filename/, rule: 'no_filename', detail: '__filename is banned' },
  { pattern: /process\.exit/, rule: 'no_process_exit', detail: 'process.exit() is banned' },
  // Enhanced patterns beyond original set
  { pattern: /new\s+Function\s*\(/, rule: 'no_new_function', detail: 'new Function() is banned (indirect eval)' },
  { pattern: /\bfetch\s*\(/, rule: 'no_fetch', detail: 'fetch() network access is banned' },
  { pattern: /XMLHttpRequest/, rule: 'no_xhr', detail: 'XMLHttpRequest is banned' },
  { pattern: /new\s+WebSocket\s*\(/, rule: 'no_websocket', detail: 'WebSocket is banned' },
  { pattern: /import\s+requests\b/, rule: 'no_requests', detail: 'import requests is banned (Python)' },
  { pattern: /import\s+urllib\b/, rule: 'no_urllib', detail: 'import urllib is banned (Python)' },
  { pattern: /require\s*\(\s*[^'"]{0,10}\s*\+/, rule: 'no_dynamic_require', detail: 'Dynamic require() with variable is banned' },
  { pattern: /globalThis\s*\[/, rule: 'no_globalthis_bracket', detail: 'globalThis bracket access is banned' },
  { pattern: /process\.binding\s*\(/, rule: 'no_process_binding', detail: 'process.binding() is banned' },
];

export interface StaticCheckResult {
  passed: boolean;
  violations: Array<{ rule: string; line?: number; detail: string }>;
  warnings: string[];
}

export function staticCheck(code: string): StaticCheckResult {
  const violations: Array<{ rule: string; line?: number; detail: string }> = [];
  const warnings: string[] = [];

  const lines = code.split('\n');

  for (const { pattern, rule, detail } of BANNED_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        violations.push({ rule, line: i + 1, detail: `Line ${i + 1}: ${detail}` });
        break; // report first occurrence per pattern only
      }
    }
  }

  if (code.length > 50_000) {
    violations.push({ rule: 'max_code_size', detail: `Code exceeds 50KB limit (${code.length} bytes)` });
  }

  // Soft warnings (don't fail, but surface to evaluator)
  if (/while\s*\(\s*true\s*\)|for\s*\(\s*;;\s*\)/.test(code)) {
    warnings.push('Infinite loop pattern detected — ensure tool has termination conditions');
  }
  if (code.length > 20_000) {
    warnings.push(`Code is large (${code.length} chars) — consider simplifying`);
  }

  return { passed: violations.length === 0, violations, warnings };
}
