// Who arrives when, what they order, and whether they use the app. Built from shop/config.json.
//
// This file has no imports on purpose: the game, the tests, and the k6 rush on
// the real cluster all load it, so the real rush sends exactly the customers the
// game simulates.

export function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * [{ id, item, channel, at }] where at is the arrival (or app order) time in shop seconds
 * and channel is 'walkin' or 'mobile'.
 * @param {object} config shop/config.json
 * @param {string} rush one of config.rushes
 */
export function buildSchedule(config, rush = 'lesson-2') {
  const settings = config.rushes[rush];
  if (!settings) throw new Error(`shop config has no rush named ${rush}`);
  const { seed, mobileShare = 0 } = settings;
  // A rush can be one even stretch (customers over windowSeconds), or segments that
  // speed up and slow down, like a quiet start, a rush, and a quiet end.
  const segments = settings.segments || [{ customers: settings.customers, seconds: settings.windowSeconds }];
  const customers = segments.reduce((n, s) => n + s.customers, 0);
  // A rush can change the drink mix, like a latte-heavy morning. Same order, new shares.
  // menuExtras (a box of coffee, a pastry) only appear in rushes that give them a share.
  const menu = [...config.menu, ...(config.menuExtras || [])]
    .map(m => ({ ...m, share: settings.menuShares?.[m.id] ?? (config.menu.includes(m) ? m.share : 0) }));
  const lastWithShare = [...menu].reverse().find(m => m.share > 0);
  const rand = mulberry32(seed);
  // Who uses the app gets its own random sequence, so adding app orders never
  // reshuffles anyone's arrival time or drink.
  const channelRand = mulberry32(seed ^ 0x2c1b3c6d);
  const starts = [];
  let offset = 0;
  for (const s of segments) { for (let k = 0; k < s.customers; k++) starts.push({ offset, gap: s.seconds / s.customers, k }); offset += s.seconds; }
  const schedule = [];
  for (let i = 0; i < customers; i++) {
    const { offset: from, gap, k } = starts[i];
    const p = rand();
    let item = lastWithShare.id;
    let cumulative = 0;
    for (const m of menu) {
      cumulative += m.share;
      if (p < cumulative) { item = m.id; break; }
    }
    const at = from + k * gap + rand() * gap * 0.85;
    const channel = channelRand() < mobileShare ? 'mobile' : 'walkin';
    schedule.push({ id: i + 1, item, channel, at });
  }
  return schedule;
}

/** { latte: { label, short, prep, batchable, grab, box }, ... } with prep in shop seconds. */
export function menuById(config) {
  return Object.fromEntries([...config.menu, ...(config.menuExtras || [])].map(m => [m.id, {
    label: m.label, short: m.short, prep: m.prepSeconds, batchable: !!m.batchable, grab: !!m.grab, box: !!m.box,
  }]));
}
