// Shared test setup: load the real shop settings, the same file the cluster uses.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { completeRun } from '../src/engine.mjs';

const CONFIG_URL = new URL('../../shop/config.json', import.meta.url);

export const config = JSON.parse(readFileSync(CONFIG_URL, 'utf8'));

// JSON with keys sorted and no spaces, so Python's json.dumps(sort_keys=True,
// separators=(",", ":")) produces exactly the same text. Descriptions are left out.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(k => k !== 'description').sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A fingerprint of the settings that shape one rush: the rush itself, the menu,
 * the register, batching, and timeScale. Matches rush_hash() in
 * scripts/record_orders.py, so a recording only goes stale when its own settings change.
 */
export function rushHash(rush) {
  const relevant = { timeScale: config.timeScale, register: config.register, batch: config.batch, menu: config.menu, rush: config.rushes[rush] };
  return createHash('sha256').update(canonical(relevant)).digest('hex').slice(0, 16);
}

export const run = (design, options = {}) => completeRun(design, { config, ...options });
