// Who arrives when, and what they order. Built from shop/config.json.
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

/** [{ id, item, at }] where at is the arrival time in shop seconds. */
export function buildSchedule(config) {
  const { customers, windowSeconds, seed } = config.rush;
  const rand = mulberry32(seed);
  const gap = windowSeconds / customers;
  const schedule = [];
  for (let i = 0; i < customers; i++) {
    const p = rand();
    let item = config.menu[config.menu.length - 1].id;
    let cumulative = 0;
    for (const m of config.menu) {
      cumulative += m.share;
      if (p < cumulative) { item = m.id; break; }
    }
    schedule.push({ id: i + 1, item, at: i * gap + rand() * gap * 0.85 });
  }
  return schedule;
}

/** { latte: { label, short, prep }, ... } with prep in shop seconds. */
export function menuById(config) {
  return Object.fromEntries(config.menu.map(m => [m.id, { label: m.label, short: m.short, prep: m.prepSeconds }]));
}
