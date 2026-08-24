import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads `.env` into the e2e process.
 *
 * The e2e specs sign requests with WEBHOOK_SECRET and read PAYSTACK_SECRET_KEY,
 * and must use the values the running stack actually booted with. `npm run
 * test:e2e` does not source `.env`, so without this every signed request is
 * rejected 401 by a stack holding a different secret — a failure that reads as a
 * broken guard rather than a missing environment.
 *
 * Parsed by hand rather than with `process.loadEnvFile()`: that builtin writes
 * to the REAL `process.env`, but Jest's node environment hands each test file a
 * CLONE of it, so the values land somewhere the specs cannot see and the whole
 * setup file silently does nothing.
 *
 * Existing variables win, so CI — which injects secrets directly and has no
 * `.env` — is unaffected.
 */
const envPath = resolve(__dirname, '../../.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    // Strip one matching pair of surrounding quotes, as dotenv does.
    process.env[key] = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
}
