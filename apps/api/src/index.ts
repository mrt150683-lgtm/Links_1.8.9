import { getConfig } from '@links/config';
import { createServer } from './server.js';

async function start() {
  try {
    const config = getConfig();
    const server = await createServer(config);

    await server.listen({
      port: config.PORT,
      host: config.HOST,
    });

    console.log(`Server listening on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    // Write error synchronously to stderr and flush before exiting.
    // console.error() + process.exit() can lose buffered output in piped
    // child processes (Electron utilityProcess), causing silent crashes.
    const msg = `Failed to start server: ${error instanceof Error ? error.stack || error.message : error}\n`;
    process.stderr.write(msg, () => {
      process.exit(1);
    });
    // Fallback: if the write callback never fires, exit after a short delay
    setTimeout(() => process.exit(1), 500);
  }
}

start();
