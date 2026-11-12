// The shop engine: a discrete-event simulation of the coffee shop.
//
// Nothing here draws anything. The engine keeps a list of upcoming events
// ("customer 12 arrives at 64s", "barista 2 finishes at 190s") and handles them
// in time order. The game animates the results; tests check them directly.
// The same design and settings always produce the same rush.
// Settings come from shop/config.json, shared with the real cluster.
//
// Two kinds of customer:
//   walk-in  orders at the register; the ticket goes on the walk-in rail
//   mobile   orders in the app; the ticket prints on the app printer (its own rail)

import { buildSchedule, menuById, mulberry32 } from './arrivals.mjs';

export const SAMPLE_EVERY = 15;

/** How a free barista picks the next ticket when both rails have one waiting. */
export const POLICIES = {
  fifo: 'Oldest ticket first',
  walkin: 'Walk-ins first',
  mobile: 'App orders first',
  weighted: 'Every Nth drink from the app',
};

/**
 * Set up a rush without running it.
 * @param {object} design
 *   baristas: number of workers
 *   rail: whether walk-in orders can wait on a rail (a queue)
 *   capacity: most tickets the walk-in rail holds (Infinity for no limit)
 *   policy: one of POLICIES (default 'fifo')
 *   mobileEvery: for 'weighted', each barista makes every Nth drink from the app rail
 *   batch: steam milk for two lattes at once when another latte ticket is waiting,
 *     from anywhere on either rail. The pair takes config.batch.prepFactor x one latte.
 *   batchWait: shop seconds a barista holds a lone latte, hoping a second one arrives
 *     (a batch window). 0 means only batch tickets that are already waiting.
 *   sync: the cashier waits at the bar until each drink is made before taking the
 *     next order (a synchronous call). false means "we'll call your name" (async).
 * @param {{config: object, rush?: string, look?: Function}} options
 *   config is shop/config.json, rush names one of its rushes. look(customer, rand)
 *   lets the game add visual details. It gets its own random sequence, so it can
 *   never change the rush.
 */
export function createRun(design, { config, rush = 'lesson-2', look, jitter } = {}) {
  if (!config) throw new Error('createRun needs the shop config');
  const settings = config.rushes[rush];
  if (!settings) throw new Error(`shop config has no rush named ${rush}`);
  design = { policy: 'fifo', mobileEvery: 3, capacity: Infinity, batch: false, batchWait: 0, sync: false, ...design };
  if (!(design.policy in POLICIES)) throw new Error(`unknown policy ${design.policy}`);

  const menu = menuById(config);
  const shop = { ...settings, orderSeconds: config.register.orderSeconds, batchFactor: config.batch?.prepFactor ?? 1 };
  const lookRand = mulberry32(settings.seed ^ 0x5bd1e995);
  // jitter: { seconds, seed } nudges every arrival by up to that many shop seconds,
  // like the small network and polling delays of the real cluster. Tests use it to
  // check a level's verdicts don't hinge on split-second timing. The game never does.
  const jitterRand = jitter ? mulberry32(jitter.seed) : null;
  const customers = buildSchedule(config, rush).map(a => {
    const at = jitterRand ? Math.max(0, a.at + (jitterRand() * 2 - 1) * jitter.seconds) : a.at;
    const c = { id: a.id, item: a.item, channel: a.channel, arriveAt: at, state: 'outside', orderedAt: 0, readyAt: 0 };
    if (look) look(c, lookRand);
    return c;
  });
  const run = {
    design, shop, menu, rushName: rush,
    // blockedBy: in sync mode, the ticket the cashier is waiting on before the next order.
    t: 0, lastEventT: 0, customers, events: [], regQueue: [], ordering: null, cashierFrom: 0, blockedBy: null,
    rail: [], mobileRail: [],
    // ticket: the drink in hand. partner: a second latte sharing the pitcher.
    // holding: waiting by the steamer for a second latte (a batch window).
    baristas: Array.from({ length: design.baristas }, (_, i) => ({ i, ticket: null, partner: null, holding: false, holdUntil: 0, reserved: null, startAt: 0, doneAt: 0, busyTime: 0, sinceMobile: 0 })),
    cups: [], pops: [], served: 0, rejected: 0, longestWait: 0, steams: 0, batches: 0,
    byChannel: { walkin: { served: 0, rejected: 0, longestWait: 0 }, mobile: { served: 0, rejected: 0, longestWait: 0 } },
    series: [[0, 0, 0]], nextSample: SAMPLE_EVERY,
    message: '', finished: false, logicDone: false,
  };
  customers.forEach(c => schedule(run, c.arriveAt, c.channel === 'mobile' ? 'appOrder' : 'arrive', c));
  return run;
}

function schedule(run, t, type, data) {
  const e = { t, type, data };
  const i = run.events.findIndex(x => x.t > t);
  if (i < 0) run.events.push(e); else run.events.splice(i, 0, e);
}

/** Handle every event up to run.t. onEvent(kind, customer, extra) reports what happened. */
export function processEvents(run, onEvent) {
  while (run.events.length && run.events[0].t <= run.t) {
    const e = run.events.shift();
    run.lastEventT = e.t;
    handle(run, e, onEvent);
  }
}

function handle(run, e, onEvent) {
  const t = e.t;
  if (e.type === 'arrive') {
    const c = e.data;
    c.state = 'queue';
    run.regQueue.push(c);
    tryRegister(run, t, onEvent);
  } else if (e.type === 'appOrder') {
    // App orders skip the register and print straight onto the app rail.
    const c = e.data;
    c.state = 'waiting'; c.orderedAt = t;
    const ticket = { id: c.id, c, item: c.item, channel: 'mobile', t };
    run.mobileRail.push(ticket);
    if (onEvent) onEvent('accepted', c, ticket);
    tryBaristas(run, t);
  } else if (e.type === 'ordered') {
    const c = e.data;
    run.ordering = null; c.state = 'waiting'; c.orderedAt = t;
    const ticket = { id: c.id, c, item: c.item, channel: 'walkin', t };
    // Async: the customer has their answer (a ticket) now. Sync: only once the drink is made.
    if (run.design.sync) run.blockedBy = ticket; else c.answeredAt = t;
    if (!run.design.rail) {
      // No queue: the order goes straight to the barista reserved for it.
      const b = run.baristas.find(x => x.reserved === c);
      b.reserved = null;
      startDrink(run, b, ticket, null, t);
    } else {
      run.rail.push(ticket);
      tryBaristas(run, t);
    }
    if (onEvent) onEvent('accepted', c, ticket);
    tryRegister(run, t, onEvent);
  } else if (e.type === 'holdTimeout') {
    // No second latte came in time: steam for one.
    const b = e.data;
    if (b.holding && b.holdUntil === t) { b.holding = false; startDrink(run, b, b.ticket, null, t); }
  } else if (e.type === 'drinkDone') {
    const b = e.data;
    b.busyTime += t - b.startAt;
    // A batch finishes both drinks together.
    for (const ticket of [b.ticket, b.partner]) {
      if (!ticket) continue;
      const c = ticket.c;
      c.state = 'pickup'; c.readyAt = t;
      if (c.answeredAt === undefined) c.answeredAt = t; // App orders, and sync orders: answered with the drink.
      if (run.blockedBy === ticket) run.blockedBy = null; // The cashier can take the next order.
      // Walk-ins wait from walking in; app customers from placing the order.
      const wait = t - (c.channel === 'mobile' ? c.orderedAt : c.arriveAt);
      const ch = run.byChannel[c.channel];
      ch.served++; ch.longestWait = Math.max(ch.longestWait, wait);
      run.served++;
      run.longestWait = Math.max(run.longestWait, wait);
      if (onEvent) onEvent('done', c, b);
    }
    b.ticket = null; b.partner = null;
    tryBaristas(run, t);
    tryRegister(run, t, onEvent);
  }
}

function reject(run, c, why, onEvent) {
  c.state = 'walkout'; c.rejectedFor = why;
  run.rejected++; run.byChannel[c.channel].rejected++;
  if (onEvent) onEvent('rejected', c, why);
}

function tryRegister(run, t, onEvent) {
  while (!run.ordering && !run.blockedBy && run.regQueue.length) {
    const c = run.regQueue.shift();
    if (!run.design.rail) {
      const free = run.baristas.find(b => !b.ticket && !b.reserved);
      if (!free) { reject(run, c, 'noqueue', onEvent); continue; }
      free.reserved = c;
    } else if (run.rail.length >= run.design.capacity) {
      reject(run, c, 'full', onEvent); continue;
    }
    c.state = 'ordering'; run.ordering = c; run.cashierFrom = t;
    schedule(run, t + run.shop.orderSeconds, 'ordered', c);
  }
}

/** Which rail a free barista takes from. Each barista keeps its own count for 'weighted'. */
function nextTicket(run, b) {
  const walkin = run.rail[0], mobile = run.mobileRail[0];
  if (!walkin && !mobile) return null;
  let takeMobile;
  if (!walkin) takeMobile = true;
  else if (!mobile) takeMobile = false;
  else if (run.design.policy === 'fifo') takeMobile = mobile.t < walkin.t;
  else if (run.design.policy === 'walkin') takeMobile = false;
  else if (run.design.policy === 'mobile') takeMobile = true;
  else takeMobile = b.sinceMobile >= run.design.mobileEvery - 1;
  if (takeMobile) { b.sinceMobile = 0; return run.mobileRail.shift(); }
  b.sinceMobile++;
  return run.rail.shift();
}

const batchable = (run, ticket) => run.menu[ticket.item].batchable;

/** Take the oldest batchable ticket waiting on either rail, skipping past others. */
function takePartner(run) {
  let best = null, from = null;
  for (const rail of [run.rail, run.mobileRail]) {
    const tk = rail.find(x => batchable(run, x));
    if (tk && (!best || tk.t < best.t)) { best = tk; from = rail; }
  }
  if (best) from.splice(from.indexOf(best), 1);
  return best;
}

function tryBaristas(run, t) {
  // A barista holding a lone latte gets first pick of any waiting latte, longest holder
  // first, the way a barista at the steamer grabs the next latte ticket. The real
  // baristas do the same: a free barista hands waiting lattes to holders before
  // taking a ticket of its own.
  const holders = run.baristas.filter(b => b.holding).sort((a, b) => a.holdUntil - b.holdUntil || a.i - b.i);
  for (const b of holders) {
    const partner = takePartner(run);
    if (!partner) break;
    b.holding = false;
    startDrink(run, b, b.ticket, partner, t);
  }
  for (const b of run.baristas) {
    if (b.holding || b.ticket || b.reserved) continue;
    const ticket = nextTicket(run, b);
    if (!ticket) continue;
    if (run.design.batch && batchable(run, ticket)) {
      const partner = takePartner(run);
      if (partner) { startDrink(run, b, ticket, partner, t); continue; }
      if (run.design.batchWait > 0) {
        b.ticket = ticket; b.holding = true; b.holdUntil = t + run.design.batchWait;
        schedule(run, b.holdUntil, 'holdTimeout', b);
        continue;
      }
    }
    startDrink(run, b, ticket, null, t);
  }
}

function startDrink(run, b, ticket, partner, t) {
  const prep = run.menu[ticket.item].prep * (partner ? run.shop.batchFactor : 1);
  b.ticket = ticket; b.partner = partner; b.startAt = t; b.doneAt = t + prep;
  if (run.menu[ticket.item].batchable) run.steams++;
  if (partner) run.batches++;
  schedule(run, b.doneAt, 'drinkDone', b);
}

/** Record queue depth every SAMPLE_EVERY shop seconds, for the chart: [minute, walk-in rail, app rail]. */
export function sample(run) {
  while (!run.logicDone && run.nextSample <= run.t) {
    run.series.push([run.nextSample / 60, run.rail.length, run.mobileRail.length]);
    run.nextSample += SAMPLE_EVERY;
  }
  if (!run.logicDone && run.events.length === 0) {
    run.logicDone = true;
    run.series.push([run.lastEventT / 60, run.rail.length, run.mobileRail.length]);
  }
}

/** Run a whole rush instantly. */
export function completeRun(design, options) {
  const run = createRun(design, options);
  while (run.events.length) {
    run.t = run.events[0].t;
    sample(run);
    processEvents(run, options && options.onEvent);
  }
  sample(run);
  run.finished = true;
  return run;
}

/** The numbers a debrief needs. Times are in shop minutes. */
export function summarize(run) {
  const busy = run.baristas.reduce((s, b) => s + b.busyTime, 0);
  const end = Math.max(run.lastEventT, 1);
  const channel = ch => ({ served: ch.served, rejected: ch.rejected, longestWaitMin: ch.longestWait / 60 });
  // Time to an answer: from walking in until the register answers, with a ticket
  // (async) or with the drink itself (sync). The response time of the API.
  const walkins = run.customers.filter(c => c.channel === 'walkin' && c.answeredAt !== undefined);
  const longestAnswer = Math.max(0, ...walkins.map(c => c.answeredAt - c.arriveAt));
  return {
    served: run.served,
    rejected: run.rejected,
    longestWaitMin: run.longestWait / 60,
    endMin: end / 60,
    utilization: busy / (end * run.baristas.length),
    peakQueue: Math.max(...run.series.map(p => p[1])),
    peakMobileQueue: Math.max(...run.series.map(p => p[2])),
    longestAnswerMin: longestAnswer / 60,
    steams: run.steams, // Pitchers of milk steamed: one per latte, or one per batch of two.
    batches: run.batches,
    walkin: channel(run.byChannel.walkin),
    mobile: channel(run.byChannel.mobile),
  };
}
