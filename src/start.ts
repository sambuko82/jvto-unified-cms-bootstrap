// src/start.ts — process entrypoint for the CMS runtime (`npm start` / pm2 / any
// process manager). Kept separate from src/server.ts so that importing
// buildServer() (as the test suite does) never has the side effect of starting
// a real listener — and so start-up doesn't depend on detecting "am I the
// directly-invoked script", which process managers can make unreliable.

import { buildServer } from './server.js';
import { closePool } from './db.js';

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL is not set — refusing to start the CMS runtime.');
  process.exit(1);
}

const app = buildServer();
const port = Number(process.env.PORT ?? 3000);

app
  .listen({ port, host: '0.0.0.0' })
  .then((address) => {
    // eslint-disable-next-line no-console
    console.log(`CMS read-runtime listening on ${address}`);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await closePool();
    process.exit(1);
  });
