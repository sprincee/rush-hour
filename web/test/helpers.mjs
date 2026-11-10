// Shared test setup: load the real shop settings, the same file the cluster uses.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { completeRun } from '../src/engine.mjs';

const CONFIG_URL = new URL('../../shop/config.json', import.meta.url);

export const configBytes = readFileSync(CONFIG_URL);
export const config = JSON.parse(configBytes.toString('utf8'));

/** First 16 hex characters of the config's SHA-256, matching scripts/record-rush.ps1. */
export const configHash = createHash('sha256').update(configBytes).digest('hex').slice(0, 16);

export const run = (design, options = {}) => completeRun(design, { config, ...options });
