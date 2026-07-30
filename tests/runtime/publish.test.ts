// tests/runtime/publish.test.ts — guard behaviour for "Publish to live" (src/publish.ts).
// DB-free: proves the publish refuses (and starts NO sync subprocess) until the app is
// configured with the live target. The full sync round-trip is covered by tests/sync/*.
import { describe, it, expect, afterEach } from 'vitest';
import { publishToLive } from '../../src/publish.js';

describe('publishToLive guard', () => {
  const saved = process.env.JVTO_DEV_DATABASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.JVTO_DEV_DATABASE_URL;
    else process.env.JVTO_DEV_DATABASE_URL = saved;
  });

  it('refuses to publish and runs no sync when JVTO_DEV_DATABASE_URL is unset', async () => {
    delete process.env.JVTO_DEV_DATABASE_URL;
    const r = await publishToLive();
    expect(r.ok).toBe(false);
    expect(r.configured).toBe(false);
    expect(r.syncLog).toBe('');
    expect(r.error).toMatch(/JVTO_DEV_DATABASE_URL/);
  });
});
