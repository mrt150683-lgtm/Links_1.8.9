import { runCli } from './cli/index.js';

runCli(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
