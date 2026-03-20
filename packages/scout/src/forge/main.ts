import { runForgeCli } from './cli/index.js';

runForgeCli(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Forge Fatal: ${msg}
`);
  process.exit(1);
});
