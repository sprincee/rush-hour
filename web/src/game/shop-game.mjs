// The shop game: design a system, run the rush, and X-ray the shop to see the system behind it.
// Lesson-specific levels, goals and debrief text come from a lesson module (web/src/lessons/).
// The simulation itself is the tested engine in ../engine.mjs.
import { createRun, processEvents, sample, summarize, POLICIES } from '../engine.mjs';
import { menuById } from '../arrivals.mjs';
import { createSound } from './sound.mjs';
import { liveGoal, shortLabel, STATUS_WORDS } from './live-goals.mjs';
import { createEffects } from './effects.mjs';
import { setUpDefine } from './define.mjs';
import { createBriefing } from './briefing.mjs';
import { starsFor, starLabels, outcome } from '../lessons/common.mjs';

/**
 * Start the game on a page built from lessons/templates/_shop_game.html.j2.
 * @param {object} options
 *   config: shop/config.json. lesson: a lesson module (web/src/lessons/).
 *   next: { href, title } for the lesson after this one, shown after the last level.
 *   onFinish(summary): called after every rush. The homepage demo uses it to loop.
 * @returns a small controller: play(levelIndex, designChanges), setXray(on), xray, setSpeed(n).
 */
export function startGame({ config, lesson, next, onFinish }) {
  // Pages may leave parts out (the homepage has only the shop), so missing elements
  // become detached stand-ins instead of errors.
  const byId = id => document.getElementById(id) || document.createElement('div');
  // Lesson pages have the level panel; the homepage demo doesn't, and stays silent.
  const hasPanel = Boolean(document.getElementById('panel'));
  const sound = createSound({ enabled: hasPanel });
  const fx = createEffects();
  const define = setUpDefine();
  const briefing = hasPanel ? createBriefing({ link: define.link }) : { open: () => false };

  const { LEVELS, LOCKED, COST, designCost } = lesson;
  const menu = menuById(config);

  // ---------- Scene geometry ----------
  const W = 1000, H = 560;
  const SHOP_OPEN_MIN = 8 * 60 + 5;
  const DOOR = { x: 945, y: 312 }, DOOR_LANE = { x: 945, y: 432 };
  const REGISTER_SPOT = { x: 236, y: 500 };
  const PICKUP_SPOT = { x: 846, y: 404 };
  const CASHIER_X = 232;
  const RAIL_FULL = { x0: 354, y: 156, step: 20, slots: 25 };
  // Lessons with app orders split the rail: walk-in tickets on the left, app tickets on the right.
  const RAIL_SPLIT = { x0: 354, y: 156, step: 20, slots: 12 };
  const APP_RAIL = { x0: 662, y: 156, step: 20, slots: 11 };
  const APP_PRINTER = { x: 616, y: 128 };
  const APP_TRAVEL_SECONDS = 600; // App customers walk in about 10 shop minutes after ordering.
  let RAIL = RAIL_FULL;
  const POLICY_HELP = {
    fifo: 'Whichever ticket printed first, from either rail.',
    walkin: 'Always take a walk-in ticket if there is one.',
    mobile: 'Always take an app ticket if there is one.',
    weighted: 'Mostly walk-ins, but every Nth drink comes from the app rail.',
  };
  const ordinal = n => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  // App customers are still on their way until about 10 shop minutes after ordering.
  const offstage = (run, p) => p.state === 'outside' || p.state === 'gone' || (p.channel === 'mobile' && run.t < p.arriveAt + APP_TRAVEL_SECONDS);
  const WANDS = [{ x: 512, y: 272 }, { x: 658, y: 272 }];
  const BARISTA_SLOTS = { 1: [468], 2: [468, 702], 3: [436, 585, 734], 4: [412, 528, 644, 760] };
  const COLORS = { arriving: '#f2b233', queued: '#5aa2f0', working: '#f07b3f', done: '#2fbf86', rejected: '#ef5b55' };

  const SHIRTS = ['#3f6c8f', '#9b4d4d', '#5f7f4f', '#c98d3a', '#6a5a8f', '#34343c', '#b46a8a', '#4f8a86', '#8c7b5a', '#d0d3d6'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#a0694a', '#7a4a32', '#5a3626'];
  const HAIR = ['#2b1d16', '#4a2f1f', '#7a5332', '#c9a46a', '#161616', '#8a8a8a', '#6b2f22'];
  const STAFF_LOOK = [['#f1c9a5', '#c9a46a'], ['#7a4a32', '#161616'], ['#e0ac85', '#4a2f1f'], ['#a0694a', '#2b1d16']];

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (rand, list) => list[Math.floor(rand() * list.length)];
  function clock(t) {
    const m = SHOP_OPEN_MIN + t / 60;
    const h = Math.floor(m / 60), mm = Math.floor(m % 60);
    return `${h > 12 ? h - 12 : h}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }
  function look(c, rand) {
    c.shirt = pick(rand, SHIRTS); c.skin = pick(rand, SKIN); c.hair = pick(rand, HAIR);
    c.phase = rand() * Math.PI * 2;
    c.x = DOOR.x; c.y = DOOR.y; c.via = null; c.dest = null; c.moving = false; c.hasCup = false; c.entered = false;
  }

  // ---------- Page state ----------
  const state = {
    level: 0, unlocked: 0, passed: [false, false, false],
    designs: LEVELS.map(l => ({ ...l.start })),
    phase: 'design', speed: 2, playing: false,
    xray: true, xa: 1, xrayUsed: false,
    run: null, summary: null, steam: [], hover: null, cssWidth: 1000,
    // Stars and predictions, per level, for this visit.
    stars: LEVELS.map(() => [false, false, false]), guesses: LEVELS.map(() => null),
    rushes: LEVELS.map(() => 0), shownCost: LEVELS.map(() => null),
    runGuess: null, runStars: null, newStars: null,
    navUnlocked: 0, pendingUnlock: null, // The level nav shows a new level once the debrief has printed.
    briefed: new Set(), briefings: [], // Levels whose brief has opened this visit, and every opening, in order.
  };

  function makeRun(d) {
    const run = createRun(d, { config, look, rush: LEVELS[state.level].rush });
    run.hasApp = run.customers.some(c => c.channel === 'mobile');
    RAIL = run.hasApp ? RAIL_SPLIT : RAIL_FULL;
    byId('lb-wait').innerHTML = run.hasApp ? 'Longest wait <em>· walk-in / app</em>' : 'Longest wait <em>· latency</em>';
    byId('lb-queue').innerHTML = run.hasApp ? 'On the rails <em>· walk-in / app</em>' : 'On the rail <em>· queue depth</em>';
    byId('key-shape').hidden = !run.hasApp;
    return run;
  }

  function idleRun() {
    const run = makeRun(state.designs[state.level]);
    run.idle = true;
    return run;
  }

  function spawnTicket(t) {
    const from = t.channel === 'mobile' ? APP_PRINTER : { x: 282, y: 272 };
    t.x = from.x; t.y = from.y; t.tilt = (((t.id * 37) % 7) - 3) * 0.035;
  }

  // ---------- Visual reactions to engine events ----------
  const burst = (kind, x, y) => { if (!REDUCED) fx.add(kind, x, y); };
  // How big a customer is drawn at height y: nearer the front, bigger.
  const sizeAt = y => 0.78 + clamp((y - 312) / 230, 0, 1) * 0.4;

  function onEvent(kind, c, extra) {
    const run = state.run;
    const t = run.t;
    if (kind === 'accepted') sound.play('ticket');
    if (kind === 'accepted') trigger(c.channel === 'mobile' ? 'appOrder' : 'accepted', { c, item: menu[c.item].label.toLowerCase() });
    if (kind === 'done' && extra.partner) trigger('batchDone', { ticket: extra.ticket, partner: extra.partner });
    if (kind === 'accepted' && c.channel === 'mobile') {
      run.pops.push({ text: '202 · app order', x: APP_PRINTER.x, y: 104, color: COLORS.done, born: performance.now() });
      run.message = `${clock(t)}  Customer ${c.id} ordered a ${menu[c.item].label.toLowerCase()} in the app. <b>→ The request skipped the register and went straight to the app queue (line:mobile).</b>`;
    } else if (kind === 'accepted' && run.design.sync) {
      run.pops.push({ text: 'waiting…', x: 246, y: 214, color: COLORS.arriving, born: performance.now() });
      run.message = `${clock(t)}  Customer ${c.id} ordered a ${menu[c.item].label.toLowerCase()}, and the cashier went to the bar to wait for it. <b>→ Sync: the API is holding the request open until the job is done. Nobody else can order.</b>`;
    } else if (kind === 'accepted') {
      run.pops.push({ text: '202 Accepted', x: 246, y: 214, color: COLORS.done, born: performance.now() });
      run.message = `${clock(t)}  Customer ${c.id} ordered a ${menu[c.item].label.toLowerCase()}. <b>→ API replied 202 Accepted${run.design.rail ? ' and added a message to the queue' : ' and handed the job to a free worker'}.</b>`;
    } else if (kind === 'rejected') {
      trigger('rejected', { why: extra, c, track: () => ({ x: c.x ?? REGISTER_SPOT.x, y: (c.y ?? REGISTER_SPOT.y) - 40 }) });
      sound.play('turnAway');
      burst('turnaway', c.x ?? REGISTER_SPOT.x, (c.y ?? REGISTER_SPOT.y) - 40);
      c.via = { ...DOOR_LANE };
      const full = extra === 'full';
      run.pops.push({ text: full ? '503 Queue full' : '503 No worker free', x: c.x, y: c.y - 74, color: COLORS.rejected, born: performance.now() });
      run.message = full
        ? `${clock(t)}  Customer ${c.id} was turned away: the rail is full. <b>→ 503: the queue is at its limit.</b>`
        : `${clock(t)}  Customer ${c.id} walked out: both baristas were busy. <b>→ 503: no free worker and no queue.</b>`;
    } else if (kind === 'done') {
      c.via = null;
      const bx = BARISTA_SLOTS[run.design.baristas][extra.i];
      sound.play(extra.partner ? 'batchUp' : 'orderUp');
      burst('orderUp', 0, 0);
      burst('steam', bx - 30, 276);
      if (extra.partner) burst('batch', bx, 206);
      run.cups.push({ id: c.id, born: performance.now() });
      run.pops.push({ text: '200 OK', x: 852, y: 214, color: COLORS.done, born: performance.now() });
      run.message = extra.partner
        ? `${clock(t)}  Two lattes up, for customers ${extra.ticket.id} and ${extra.partner.id}. <b>→ Worker ${extra.i + 1} finished a batch of 2 jobs: two 200 OKs from one pitcher.</b>`
        : run.design.sync
          ? `${clock(t)}  Here's your latte, customer ${c.id}. Next, please! <b>→ The register finally answers with the drink itself: 200 OK. Only now can the next request start.</b>`
          : `${clock(t)}  Order up for customer ${c.id}. <b>→ Worker ${extra.i + 1} finished the job: 200 OK.</b>`;
    }
  }

  // ---------- Drawing ----------
  const canvas = byId('shop');
  const ctx = canvas.getContext('2d');
  // The effects layer: its own canvas over the shop (see effects.mjs). Pages without one skip it.
  const fxCanvas = document.getElementById('fx');
  const fxCtx = fxCanvas?.getContext ? fxCanvas.getContext('2d') : null;
  let fxDirty = false;
  let scale = 1, backLayer = null, frontLayer = null, shadeLayer = null, gridLayer = null;
  // Performance on phones: anything that never changes is drawn once and reused.
  const apronShade = new Map(); // One gradient per barista spot, instead of one per frame.
  let puff = null; // A soft steam puff, drawn once and stamped (gradients are slow to build).
  const drawList = []; // Reused every frame, so drawing customers makes no garbage.

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
  function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function lg(c, x0, y0, x1, y1, stops) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    return g;
  }
  function layer(draw) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(W * scale));
    cv.height = Math.max(1, Math.round(H * scale));
    const c = cv.getContext('2d');
    c.scale(scale, scale);
    draw(c);
    return cv;
  }

  function drawBack(c) {
    c.fillStyle = lg(c, 0, 0, 0, 300, [[0, '#f0e4d3'], [1, '#e0cdb5']]);
    c.fillRect(0, 0, W, 300);
    c.save();
    c.beginPath(); c.rect(322, 110, 572, 182); c.clip();
    c.fillStyle = '#f7f2ea'; c.fillRect(322, 110, 572, 182);
    c.strokeStyle = 'rgba(140, 118, 96, 0.22)'; c.lineWidth = 1;
    for (let y = 110, row = 0; y < 292; y += 14, row++) {
      c.beginPath(); c.moveTo(322, y + 0.5); c.lineTo(894, y + 0.5); c.stroke();
      for (let x = 322 + (row % 2) * 14; x < 894; x += 28) { c.beginPath(); c.moveTo(x + 0.5, y); c.lineTo(x + 0.5, y + 14); c.stroke(); }
    }
    c.restore();
    rr(c, 38, 170, 156, 118, 6); c.fillStyle = '#7a4e31'; c.fill();
    c.fillStyle = lg(c, 0, 178, 0, 280, [[0, '#b9dcec'], [1, '#f5e6c6']]); c.fillRect(46, 178, 140, 102);
    c.fillStyle = 'rgba(255, 233, 170, 0.85)'; circle(c, 150, 206, 15); c.fill();
    c.fillStyle = 'rgba(110, 120, 130, 0.28)';
    [[46, 250, 30, 30], [80, 240, 24, 40], [108, 256, 34, 24], [146, 246, 40, 34]].forEach(([x, y, w, h]) => c.fillRect(x, y, w, h));
    c.fillStyle = '#7a4e31'; c.fillRect(114, 178, 4, 102); c.fillRect(46, 226, 140, 4);
    c.fillStyle = '#6a4129'; c.fillRect(32, 284, 168, 8);
    rr(c, 34, 24, 260, 134, 8); c.fillStyle = '#7a4e31'; c.fill();
    rr(c, 42, 32, 244, 118, 4); c.fillStyle = '#26312c'; c.fill();
    c.fillStyle = 'rgba(255, 255, 255, 0.05)'; c.fillRect(48, 38, 120, 50);
    c.fillStyle = 'rgba(246, 240, 230, 0.92)';
    c.font = "800 17px 'Bricolage Grotesque', sans-serif"; c.textAlign = 'left'; c.fillText('MENU', 58, 58);
    c.font = "500 14px 'Bricolage Grotesque', sans-serif";
    [['Latte', '3 min'], ['Cappuccino', '2½ min'], ['Drip coffee', '2 min']].forEach(([n, t], i) => {
      c.textAlign = 'left'; c.fillText(n, 58, 84 + i * 21); c.textAlign = 'right'; c.fillText(t, 270, 84 + i * 21);
    });
    c.strokeStyle = 'rgba(246, 240, 230, 0.35)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(58, 66); c.lineTo(130, 66); c.stroke();
    c.textAlign = 'left';
    c.fillStyle = '#8a5a3a'; rr(c, 330, 92, 562, 9, 3); c.fill();
    c.fillStyle = '#6b4329'; c.fillRect(350, 101, 6, 10); c.fillRect(866, 101, 6, 10);
    [['#2f5a47', 352], ['#8a3b2f', 390], ['#c9a46a', 428]].forEach(([col, x]) => {
      rr(c, x, 52, 32, 40, 6); c.fillStyle = col; c.fill();
      c.fillStyle = 'rgba(255, 250, 240, 0.85)'; c.fillRect(x + 7, 64, 18, 12);
      c.fillStyle = 'rgba(0, 0, 0, 0.12)'; c.fillRect(x, 52, 32, 5);
    });
    for (let s = 0; s < 3; s++) for (let k = 0; k < 4; k++) {
      const x = 552 + s * 26, y = 88 - k * 9;
      c.fillStyle = k % 2 ? '#f4f1ea' : '#ffffff';
      c.beginPath(); c.moveTo(x - 9, y - 8); c.lineTo(x + 9, y - 8); c.lineTo(x + 7, y); c.lineTo(x - 7, y); c.closePath(); c.fill();
    }
    c.fillStyle = '#b5673f'; c.beginPath(); c.moveTo(846, 92); c.lineTo(878, 92); c.lineTo(874, 72); c.lineTo(850, 72); c.closePath(); c.fill();
    c.fillStyle = '#3f7a52'; [[862, 56, 13], [850, 62, 10], [874, 62, 10], [862, 44, 9]].forEach(([x, y, r]) => { circle(c, x, y, r); c.fill(); });
    c.fillStyle = '#7d858c'; c.fillRect(344, 148, 4, 10); c.fillRect(884, 148, 4, 10);
    c.fillStyle = lg(c, 0, 146, 0, 153, [[0, '#e1e5e8'], [1, '#8b9298']]); rr(c, 340, 146, 552, 7, 3); c.fill();
    c.fillStyle = '#5a3a26'; c.fillRect(898, 106, 94, 196);
    c.fillStyle = lg(c, 908, 116, 982, 230, [[0, '#cfe4e6'], [1, '#9fc3c7']]); c.fillRect(908, 116, 74, 116);
    c.fillStyle = 'rgba(255, 255, 255, 0.35)'; c.beginPath(); c.moveTo(914, 120); c.lineTo(934, 120); c.lineTo(914, 160); c.closePath(); c.fill();
    c.fillStyle = '#6b452e'; c.fillRect(908, 238, 74, 56);
    c.fillStyle = '#d8b46a'; c.fillRect(912, 212, 4, 18);
    rr(c, 924, 128, 46, 18, 4); c.fillStyle = '#1f5f4a'; c.fill();
    c.fillStyle = '#ffffff'; c.font = "600 10px 'IBM Plex Mono', monospace"; c.textAlign = 'center'; c.fillText('OPEN', 947, 141); c.textAlign = 'left';
    c.fillStyle = lg(c, 0, 300, 0, H, [[0, '#a5744d'], [1, '#7a4f33']]); c.fillRect(0, 300, W, H - 300);
    c.strokeStyle = 'rgba(60, 34, 18, 0.28)'; c.lineWidth = 1;
    let y = 302, gap = 9, row = 0;
    while (y < H) {
      c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke();
      const seamGap = 90 + gap * 6;
      for (let x = (row % 2) * seamGap * 0.5; x < W; x += seamGap) { c.beginPath(); c.moveTo(x + 0.5, y); c.lineTo(x + 0.5, y + gap); c.stroke(); }
      y += gap; gap *= 1.16; row++;
    }
    c.fillStyle = '#5e3a24'; c.fillRect(0, 294, W, 8);
    c.fillStyle = 'rgba(255, 236, 190, 0.16)';
    c.beginPath(); c.moveTo(40, 302); c.lineTo(196, 302); c.lineTo(360, H); c.lineTo(120, H); c.closePath(); c.fill();
    [480, 660, 822].forEach(x => {
      const glow = c.createRadialGradient(x, 72, 4, x, 72, 150);
      glow.addColorStop(0, 'rgba(255, 214, 150, 0.42)'); glow.addColorStop(1, 'rgba(255, 214, 150, 0)');
      c.fillStyle = glow; c.fillRect(x - 150, 0, 300, 230);
      c.strokeStyle = '#3a2a20'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 46); c.stroke();
      c.fillStyle = lg(c, x - 26, 0, x + 26, 0, [[0, '#1d4a39'], [0.5, '#2f6b52'], [1, '#1d4a39']]);
      c.beginPath(); c.moveTo(x - 14, 46); c.lineTo(x + 14, 46); c.lineTo(x + 26, 66); c.lineTo(x - 26, 66); c.closePath(); c.fill();
      c.fillStyle = '#fff3cf'; ellipse(c, x, 67, 11, 3.5); c.fill();
    });
  }

  function drawFront(c) {
    c.fillStyle = lg(c, 0, 384, 0, 404, [[0, 'rgba(30, 14, 4, 0.28)'], [1, 'rgba(30, 14, 4, 0)']]); c.fillRect(140, 384, 740, 20);
    c.fillStyle = lg(c, 0, 304, 0, 380, [[0, '#7e4e31'], [1, '#5a3520']]); c.fillRect(140, 304, 740, 76);
    for (let x = 152; x < 880; x += 18) {
      c.fillStyle = 'rgba(0, 0, 0, 0.13)'; c.fillRect(x, 306, 1.5, 72);
      c.fillStyle = 'rgba(255, 220, 190, 0.06)'; c.fillRect(x + 2, 306, 1, 72);
    }
    c.fillStyle = '#3e2516'; c.fillRect(140, 378, 740, 7);
    c.fillStyle = lg(c, 0, 288, 0, 305, [[0, '#f3eee6'], [1, '#c9bfb1']]); rr(c, 132, 288, 756, 17, 4); c.fill();
    c.fillStyle = 'rgba(255, 255, 255, 0.6)'; c.fillRect(136, 289, 748, 1.5);
    c.font = "700 12px 'Bricolage Grotesque', sans-serif"; c.textAlign = 'center'; c.fillStyle = 'rgba(255, 236, 214, 0.8)';
    if ('letterSpacing' in c) c.letterSpacing = '3px';
    c.fillText('REGISTER', 232, 348); c.fillText('BAR', 585, 348); c.fillText('PICKUP', 846, 348);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.textAlign = 'left';
    c.fillStyle = '#5e6469'; rr(c, 514, 222, 142, 10, 3); c.fill();
    c.fillStyle = '#f4f1ea'; [540, 560, 610].forEach(x => c.fillRect(x, 214, 12, 8));
    c.fillStyle = lg(c, 520, 0, 650, 0, [[0, '#8f979d'], [0.45, '#eef0f1'], [1, '#9aa2a8']]); rr(c, 520, 230, 130, 58, 8); c.fill();
    c.fillStyle = '#353a3e'; rr(c, 532, 242, 106, 15, 4); c.fill();
    c.fillStyle = '#f6f1e6'; circle(c, 585, 249.5, 5.5); c.fill();
    c.strokeStyle = '#b23a2a'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(585, 249.5); c.lineTo(588, 246); c.stroke();
    c.fillStyle = '#4a4f54'; rr(c, 548, 262, 20, 9, 3); c.fill(); rr(c, 602, 262, 20, 9, 3); c.fill();
    c.strokeStyle = '#1f1f22'; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(548, 268); c.lineTo(534, 274); c.stroke();
    c.beginPath(); c.moveTo(622, 268); c.lineTo(636, 274); c.stroke();
    c.strokeStyle = '#8d949a'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(522, 250); c.lineTo(512, 272); c.stroke();
    c.beginPath(); c.moveTo(648, 250); c.lineTo(658, 272); c.stroke();
    c.lineCap = 'butt';
    c.fillStyle = '#5b6166'; rr(c, 528, 279, 114, 8, 3); c.fill();
    c.font = "700 7px 'IBM Plex Mono', monospace"; c.fillStyle = '#c9cdd0'; c.textAlign = 'center'; c.fillText('RUSH', 585, 238); c.textAlign = 'left';
    c.fillStyle = '#2f3035'; rr(c, 192, 266, 74, 24, 5); c.fill();
    c.fillStyle = 'rgba(255, 255, 255, 0.18)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) c.fillRect(200 + i * 9, 273 + j * 7, 6, 4);
    c.save(); c.translate(229, 254); c.rotate(-0.1);
    c.fillStyle = '#25292c'; rr(c, -27, -17, 54, 28, 4); c.fill();
    c.fillStyle = 'rgba(127, 207, 191, 0.9)'; rr(c, -23, -13, 46, 20, 3); c.fill();
    c.fillStyle = 'rgba(20, 50, 45, 0.55)'; c.fillRect(-18, -8, 22, 2.5); c.fillRect(-18, -3, 30, 2.5); c.fillRect(-18, 2, 16, 2.5);
    c.restore();
    c.fillStyle = '#43444b'; rr(c, 268, 272, 28, 18, 4); c.fill();
    c.fillStyle = '#17171a'; c.fillRect(273, 272, 18, 2);
    rr(c, 306, 264, 22, 26, 6); c.fillStyle = 'rgba(214, 232, 238, 0.55)'; c.fill();
    c.strokeStyle = 'rgba(255, 255, 255, 0.7)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#d8b46a'; [[312, 284], [319, 286], [316, 280], [322, 282]].forEach(([x, y]) => { circle(c, x, y, 2.6); c.fill(); });
    c.fillStyle = '#6b4329'; c.fillRect(868, 254, 4, 34);
    rr(c, 830, 232, 80, 24, 5); c.fillStyle = '#1f5f4a'; c.fill();
    c.fillStyle = '#ffffff'; c.font = "700 11px 'Bricolage Grotesque', sans-serif"; c.textAlign = 'center'; c.fillText('ORDER UP', 870, 248); c.textAlign = 'left';
  }

  // The X-ray's dark glass and grid never change, so they're one layer.
  function drawGrid(c) {
    c.fillStyle = 'rgba(7, 13, 22, 0.84)'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(120, 170, 230, 0.08)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 40) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 40) { c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); }
    c.stroke();
  }

  // A soft white puff: opaque in the middle, fading to nothing at the edge.
  function makePuff() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)'); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return cv;
  }

  function drawShade(c) {
    const v = c.createRadialGradient(500, 300, 260, 500, 300, 720);
    v.addColorStop(0, 'rgba(28, 14, 4, 0)'); v.addColorStop(1, 'rgba(28, 14, 4, 0.34)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }

  function drawStaff(c, x, now, busy, progress, skin, hair, ring = '#e0a85c') {
    const sway = busy && !REDUCED ? Math.sin(now / 150 + x) * 2.2 : 0;
    c.fillStyle = 'rgba(0, 0, 0, 0.10)'; ellipse(c, x, 292, 30, 6); c.fill();
    if (!apronShade.has(x)) apronShade.set(x, lg(c, x - 22, 0, x + 22, 0, [[0, '#ddd6cc'], [0.5, '#f4f0ea'], [1, '#d6cfc4']]));
    c.fillStyle = apronShade.get(x); rr(c, x - 22, 232, 44, 72, 15); c.fill();
    c.fillStyle = '#2f6b52'; rr(c, x - 15, 249, 30, 55, 6); c.fill();
    c.strokeStyle = '#2f6b52'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x - 11, 250); c.lineTo(x - 6, 236); c.moveTo(x + 11, 250); c.lineTo(x + 6, 236); c.stroke();
    c.fillStyle = 'rgba(255, 255, 255, 0.16)'; c.fillRect(x - 10, 262, 20, 9);
    c.fillStyle = '#e8e2d9';
    c.save(); c.translate(x - 22, 242); c.rotate(0.25 + sway * 0.06); rr(c, -5, 0, 10, 40, 5); c.fill(); c.restore();
    c.save(); c.translate(x + 22, 242); c.rotate(-0.25 - sway * 0.06); rr(c, -5, 0, 10, 40, 5); c.fill(); c.restore();
    c.fillStyle = skin; c.fillRect(x - 4, 224, 8, 10); circle(c, x, 214, 13); c.fill();
    c.fillStyle = hair; c.beginPath(); c.arc(x, 212, 13.6, Math.PI * 1.02, Math.PI * 1.98); c.fill();
    c.fillStyle = '#2a1a12'; circle(c, x - 4.5, 215, 1.6); c.fill(); circle(c, x + 4.5, 215, 1.6); c.fill();
    c.fillStyle = 'rgba(214, 120, 100, 0.35)'; circle(c, x - 7, 220, 2.4); c.fill(); circle(c, x + 7, 220, 2.4); c.fill();
    if (busy) {
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(255, 255, 255, 0.7)'; circle(c, x, 184, 10); c.stroke();
      c.strokeStyle = ring; c.beginPath(); c.arc(x, 184, 10, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); c.stroke();
    }
  }

  function drawTicket(c, t) {
    c.save(); c.translate(t.x, t.y); c.rotate(t.tilt);
    c.fillStyle = 'rgba(40, 20, 10, 0.2)'; c.fillRect(-7, 2, 18, 28);
    c.fillStyle = t.channel === 'mobile' ? '#e6f0fc' : '#fffdf6'; c.fillRect(-9, 0, 18, 28);
    c.fillStyle = '#8e959b'; c.fillRect(-3, -3, 6, 4);
    c.fillStyle = '#2a1d17'; c.textAlign = 'center';
    c.font = "600 7px 'IBM Plex Mono', monospace"; c.fillText('#' + t.id, 0, 10);
    c.font = "500 5px 'IBM Plex Mono', monospace"; c.fillText(menu[t.item].short, 0, 18);
    c.fillStyle = t.channel === 'mobile' ? '#2a78d6' : '#b8792f'; c.fillRect(-6, 22, 12, 1.5);
    c.restore();
  }

  function holdProgress(run, b) {
    return clamp(1 - (b.holdUntil - run.t) / Math.max(1, run.design.batchWait), 0, 1);
  }

  function drawPitcher(c, x, y, s, steaming) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = 'rgba(40, 20, 10, 0.22)'; ellipse(c, 0, 0, 8, 2.5); c.fill();
    c.fillStyle = lg(c, -7, 0, 7, 0, [[0, '#9aa1a7'], [0.5, '#f1f3f4'], [1, '#8f979d']]);
    c.beginPath(); c.moveTo(-6, -18); c.lineTo(6, -18); c.lineTo(7, 0); c.lineTo(-7, 0); c.closePath(); c.fill();
    c.strokeStyle = '#7d858c'; c.lineWidth = 1.6; c.beginPath(); c.arc(8, -10, 4, -Math.PI / 2, Math.PI / 2); c.stroke();
    if (steaming) { c.fillStyle = 'rgba(255, 255, 255, 0.85)'; ellipse(c, 0, -18, 5.5, 1.6); c.fill(); }
    c.restore();
  }

  function labelChip(c, x, y, text) {
    c.font = "700 11px 'IBM Plex Mono', monospace";
    const w = c.measureText(text).width + 12;
    rr(c, x - w / 2, y - 13, w, 18, 6); c.fillStyle = 'rgba(22, 15, 10, 0.82)'; c.fill();
    c.fillStyle = '#fff7ec'; c.textAlign = 'center'; c.fillText(text, x, y); c.textAlign = 'left';
  }

  function drawCup(c, x, y, s) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = 'rgba(40, 20, 10, 0.22)'; ellipse(c, 0, 0, 6, 2); c.fill();
    c.fillStyle = '#fbfaf7'; c.beginPath(); c.moveTo(-5, -14); c.lineTo(5, -14); c.lineTo(4, 0); c.lineTo(-4, 0); c.closePath(); c.fill();
    c.fillStyle = '#a8734a'; c.fillRect(-4.6, -9, 9.2, 4);
    c.fillStyle = '#e6e1d9'; rr(c, -6, -17, 12, 3.5, 1.5); c.fill();
    c.restore();
  }

  function drawCustomer(c, p, now) {
    const s = 0.78 + clamp((p.y - 312) / 230, 0, 1) * 0.4;
    const alpha = clamp((p.y - 312) / 38, 0, 1);
    if (alpha <= 0) return;
    const walk = p.moving && !REDUCED;
    const bob = walk ? Math.abs(Math.sin(now / 90 + p.phase)) * 2.5 : 0;
    const swing = walk ? Math.sin(now / 90 + p.phase) * 3 : 0;
    c.save(); c.globalAlpha = alpha; c.translate(p.x, p.y); c.scale(s, s);
    c.fillStyle = 'rgba(40, 20, 8, 0.24)'; ellipse(c, 0, 0, 15, 5); c.fill();
    c.fillStyle = '#2c2725'; rr(c, -8 + swing * 0.4, -19, 7, 19, 3); c.fill(); rr(c, 1 - swing * 0.4, -19, 7, 19, 3); c.fill();
    c.translate(0, -bob);
    c.fillStyle = p.shirt; rr(c, -13, -48, 26, 32, 10); c.fill();
    c.fillStyle = 'rgba(0, 0, 0, 0.12)'; rr(c, 3, -48, 10, 32, 8); c.fill();
    c.fillStyle = p.skin; circle(c, 0, -57, 9.5); c.fill();
    c.fillStyle = p.hair; c.beginPath(); c.arc(0, -58.5, 9.9, Math.PI * 0.95, Math.PI * 2.05); c.fill();
    if (p.hasCup) drawCup(c, 15, -26, 1);
    else if (p.channel === 'mobile' && p.state !== 'walkout') {
      c.fillStyle = '#1d1f24'; rr(c, 10, -38, 8, 13, 2); c.fill();
      c.fillStyle = '#8fc3ff'; c.fillRect(11.5, -36.5, 5, 9);
    }
    if (p.state === 'walkout') {
      c.fillStyle = 'rgba(255, 252, 246, 0.95)'; rr(c, -11, -92, 22, 18, 6); c.fill();
      c.beginPath(); c.moveTo(-3, -74); c.lineTo(3, -74); c.lineTo(0, -69); c.closePath(); c.fill();
      c.strokeStyle = '#a23b2a'; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-4, -87); c.lineTo(4, -79); c.moveTo(4, -87); c.lineTo(-4, -79); c.stroke();
    }
    c.restore();
  }

  // ---------- X-ray: the same shop, drawn as a system ----------
  function requestColor(run, p) {
    if (p.state === 'walkout') return COLORS.rejected;
    if (p.state === 'pickup' || p.state === 'leaving') return COLORS.done;
    if (p.state === 'queue' || p.state === 'ordering') return COLORS.arriving;
    if (run.baristas.some(b => (b.ticket && b.ticket.c === p) || (b.partner && b.partner.c === p))) return COLORS.working;
    return COLORS.queued;
  }

  function node(c, x, y, w, h, title, sub, opts = {}) {
    const big = state.cssWidth < 640;
    rr(c, x, y, w, h, 10);
    c.fillStyle = opts.fill || 'rgba(20, 40, 66, 0.72)'; c.fill();
    c.lineWidth = 2; c.strokeStyle = opts.stroke || 'rgba(150, 200, 255, 0.85)';
    if (opts.dashed) c.setLineDash([7, 6]);
    c.stroke(); c.setLineDash([]);
    c.fillStyle = '#eef5fd'; c.textAlign = opts.align || 'left';
    const tx = opts.align === 'center' ? x + w / 2 : x + 10;
    c.font = `800 ${big ? 22 : 15}px 'Bricolage Grotesque', sans-serif`;
    c.fillText(title, tx, y + (big ? 26 : 21));
    if (sub && !big) {
      c.font = "500 10.5px 'IBM Plex Mono', monospace"; c.fillStyle = '#a9c4e0';
      c.fillText(sub, tx, y + 36);
    }
    c.textAlign = 'left';
  }

  function arrow(c, x1, y1, x2, y2, now) {
    c.strokeStyle = 'rgba(150, 200, 255, 0.8)'; c.lineWidth = 2.2;
    c.setLineDash([6, 6]); c.lineDashOffset = REDUCED ? 0 : -now / 40;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.setLineDash([]);
    const a = Math.atan2(y2 - y1, x2 - x1);
    c.fillStyle = 'rgba(150, 200, 255, 0.95)';
    c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 10 * Math.cos(a - 0.45), y2 - 10 * Math.sin(a - 0.45)); c.lineTo(x2 - 10 * Math.cos(a + 0.45), y2 - 10 * Math.sin(a + 0.45)); c.closePath(); c.fill();
  }

  function drawXray(c, run, now, a) {
    const big = state.cssWidth < 640;
    const d = run.design;
    const xs = BARISTA_SLOTS[d.baristas];
    c.save(); c.globalAlpha = a;
    if (gridLayer) c.drawImage(gridLayer, 0, 0, W, H); // The dark glass and grid, drawn once in resize().

    // Arrows first, so boxes sit on top of them
    arrow(c, 236, 468, 236, 312, now);
    if (run.hasApp) {
      arrow(c, 306, 250, 336, 196, now);
      arrow(c, 760, 70, 760, 112, now);
      xs.forEach(x => { arrow(c, 470, 204, x - 8, 214, now); arrow(c, 760, 204, x + 8, 214, now); });
    } else if (d.rail) {
      arrow(c, 306, 250, 336, 196, now);
      xs.forEach(x => arrow(c, x, 204, x, 214, now));
    } else {
      arrow(c, 306, 262, xs[0] - 46, 262, now);
    }
    const lastX = xs[xs.length - 1];
    if (lastX + 44 < 808) arrow(c, lastX + 44, 262, 810, 262, now);

    node(c, 168, 222, 138, 88, 'API server', 'the register', {});
    if (!big) {
      c.font = "500 10.5px 'IBM Plex Mono', monospace"; c.fillStyle = '#a9c4e0';
      c.fillText('POST /orders', 178, 272); c.fillText(d.sync ? '→ waits, then 200' : d.rail ? '→ 202 Accepted' : '→ 202 or 503', 178, 288);
      if (run.blockedBy) { c.fillStyle = '#ffd9a0'; c.fillText(`holding #${run.blockedBy.id} open`, 178, 304); }
    }

    if (run.hasApp) {
      node(c, 334, 112, 276, 92, 'Walk-in queue', 'line:walkin · from the register');
      node(c, 620, 112, 276, 92, 'App queue', 'line:mobile · from phones');
      run.rail.slice(0, RAIL.slots).forEach(t => { c.fillStyle = COLORS.queued; rr(c, (t.x ?? RAIL.x0) - 7, 159, 14, 22, 3); c.fill(); });
      run.mobileRail.slice(0, APP_RAIL.slots).forEach(t => {
        const x = t.x ?? APP_RAIL.x0;
        c.fillStyle = COLORS.queued; c.beginPath(); c.moveTo(x, 157); c.lineTo(x + 8, 170); c.lineTo(x, 183); c.lineTo(x - 8, 170); c.closePath(); c.fill();
      });
      c.textAlign = 'right'; c.fillStyle = '#eef5fd';
      c.font = `800 ${big ? 20 : 14}px 'Bricolage Grotesque', sans-serif`;
      c.fillText(`${run.rail.length} waiting`, 600, 134);
      c.fillText(`${run.mobileRail.length} waiting`, 886, 134);
      c.textAlign = 'left';
      c.font = `800 ${big ? 20 : 13}px 'Bricolage Grotesque', sans-serif`; c.fillStyle = '#eef5fd';
      c.fillText('Phones', 776, 62);
      if (!big) { c.font = "500 10.5px 'IBM Plex Mono', monospace"; c.fillStyle = '#a9c4e0'; c.fillText('app clients', 776, 76); }
      c.textAlign = 'center'; c.font = `700 ${big ? 18 : 13}px 'IBM Plex Mono', monospace`; c.fillStyle = '#ffd9a0';
      c.fillText(`Rule: ${POLICIES[d.policy]}${d.policy === 'weighted' ? ` (every ${ordinal(d.mobileEvery)})` : ''}`, 585, 334);
      c.textAlign = 'left';
    } else if (d.rail) {
      const limited = Number.isFinite(d.capacity);
      node(c, 334, 112, 562, 92, 'Queue', limited ? `the ticket rail · Redis Stream · holds ${d.capacity}` : 'the ticket rail · Redis Stream · no limit');
      if (limited) {
        const shown = Math.min(d.capacity, RAIL.slots);
        c.strokeStyle = 'rgba(150, 200, 255, 0.35)'; c.lineWidth = 1;
        for (let i = 0; i < shown; i++) { rr(c, RAIL.x0 + i * RAIL.step - 8, 158, 16, 24, 3); c.stroke(); }
      }
      run.rail.slice(0, RAIL.slots).forEach(t => {
        c.fillStyle = COLORS.queued; rr(c, (t.x ?? RAIL.x0) - 7, 159, 14, 22, 3); c.fill();
      });
      c.textAlign = 'right'; c.fillStyle = '#eef5fd';
      c.font = `800 ${big ? 22 : 15}px 'Bricolage Grotesque', sans-serif`;
      c.fillText(`${run.rail.length} waiting`, 884, 134);
      c.textAlign = 'left';
    } else {
      node(c, 334, 112, 562, 92, 'No queue', 'requests can only be accepted when a worker is free', { dashed: true, stroke: 'rgba(239, 91, 85, 0.85)', fill: 'rgba(60, 20, 22, 0.55)' });
    }

    xs.forEach((x, i) => {
      const b = run.baristas[i];
      const busy = b && b.ticket;
      node(c, x - 44, 214, 88, 96, `Worker ${i + 1}`, null, { align: 'center', fill: busy ? 'rgba(120, 60, 24, 0.75)' : 'rgba(20, 40, 66, 0.72)', stroke: busy ? 'rgba(240, 123, 63, 0.95)' : 'rgba(150, 200, 255, 0.85)' });
      c.textAlign = 'center';
      c.font = `600 ${big ? 16 : 11}px 'IBM Plex Mono', monospace`;
      c.fillStyle = busy ? '#ffd2b8' : '#a9c4e0';
      const label = !busy ? 'idle'
        : b.holding ? `#${b.ticket.id} waits`
        : b.partner ? `#${b.ticket.id}+#${b.partner.id} ×2`
        : `#${b.ticket.id} ${menu[b.ticket.item].short}`;
      c.fillText(label, x, 262);
      if (busy) {
        const p = b.holding ? holdProgress(run, b) : clamp((run.t - b.startAt) / (b.doneAt - b.startAt), 0, 1);
        c.fillStyle = 'rgba(255, 255, 255, 0.2)'; rr(c, x - 32, 284, 64, 8, 4); c.fill();
        c.fillStyle = b.holding ? COLORS.queued : COLORS.working; rr(c, x - 32, 284, Math.max(8, 64 * p), 8, 4); c.fill();
      }
      if (b && b.holding && !big) {
        c.font = "500 10px 'IBM Plex Mono', monospace"; c.fillStyle = '#a9c4e0';
        c.fillText('batch window', x, 278);
      }
      c.textAlign = 'left';
    });

    node(c, 810, 222, 98, 88, 'Response', 'order up', {});
    if (!big) { c.font = "500 10.5px 'IBM Plex Mono', monospace"; c.fillStyle = '#a9c4e0'; c.fillText('200 OK', 820, 272); }

    c.font = `800 ${big ? 22 : 14}px 'Bricolage Grotesque', sans-serif`; c.fillStyle = '#eef5fd';
    c.fillText('Clients', 40, 402);
    if (!big) { c.font = "500 10.5px 'IBM Plex Mono', monospace"; c.fillStyle = '#a9c4e0'; c.fillText('each dot is one request', 40, 418); }

    run.customers.forEach(p => {
      if (offstage(run, p)) return;
      const al = clamp((p.y - 312) / 38, 0, 1);
      if (al <= 0) return;
      c.globalAlpha = a * al;
      c.fillStyle = requestColor(run, p);
      const r = big ? 11 : 8;
      if (p.channel === 'mobile') {
        const rd = r * 1.25;
        c.beginPath(); c.moveTo(p.x, p.y - 14 - rd); c.lineTo(p.x + rd, p.y - 14); c.lineTo(p.x, p.y - 14 + rd); c.lineTo(p.x - rd, p.y - 14); c.closePath(); c.fill();
      } else {
        circle(c, p.x, p.y - 14, r); c.fill();
      }
      c.strokeStyle = 'rgba(7, 13, 22, 0.9)'; c.lineWidth = 2; c.stroke();
      if (p.state === 'walkout') {
        c.strokeStyle = '#fff'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(p.x - 3.5, p.y - 17.5); c.lineTo(p.x + 3.5, p.y - 10.5); c.moveTo(p.x + 3.5, p.y - 17.5); c.lineTo(p.x - 3.5, p.y - 10.5); c.stroke();
      }
    });
    c.globalAlpha = a;

    run.pops.forEach(pp => {
      const age = (now - pp.born) / 1000;
      if (age > 1.4) return;
      c.globalAlpha = a * clamp(1.4 - age, 0, 1);
      c.font = `700 ${big ? 18 : 13}px 'IBM Plex Mono', monospace`; c.textAlign = 'center';
      const y = pp.y - age * 22;
      const w = c.measureText(pp.text).width + 14;
      rr(c, pp.x - w / 2, y - 15, w, 21, 6); c.fillStyle = 'rgba(7, 13, 22, 0.9)'; c.fill();
      c.strokeStyle = pp.color; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = pp.color; c.fillText(pp.text, pp.x, y);
      c.textAlign = 'left';
    });
    c.restore();
  }

  function render(now) {
    const run = state.run;
    const xs = BARISTA_SLOTS[run.design.baristas];
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (backLayer) ctx.drawImage(backLayer, 0, 0, W, H);
    if (!run.design.rail) {
      ctx.fillStyle = 'rgba(42, 33, 27, 0.55)'; ctx.fillRect(340, 146, 552, 7);
      rr(ctx, 540, 158, 150, 24, 5); ctx.fillStyle = '#7a2e22'; ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = "600 11px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center';
      ctx.fillText('NO WAITING TODAY', 615, 174); ctx.textAlign = 'left';
    } else {
      ctx.font = "600 11px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(70, 48, 32, 0.75)';
      if (run.hasApp) {
        ctx.fillText('WALK-IN RAIL', 344, 139);
        ctx.fillText('APP RAIL', 652, 139);
        rr(ctx, 598, 110, 36, 30, 5); ctx.fillStyle = '#34353c'; ctx.fill();
        ctx.fillStyle = '#17171a'; ctx.fillRect(604, 136, 24, 2);
        ctx.fillStyle = '#7fd1c1'; circle(ctx, 627, 116, 2); ctx.fill();
        ctx.fillStyle = '#e6f0fb'; ctx.font = "700 8px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center';
        ctx.fillText('APP', 614, 129); ctx.textAlign = 'left';
      } else {
        ctx.fillText(Number.isFinite(run.design.capacity) ? `TICKET RAIL · HOLDS ${run.design.capacity}` : 'TICKET RAIL', 344, 139);
      }
    }
    drawStaff(ctx, CASHIER_X, now, !!run.ordering || !!run.blockedBy, 0, '#c68b62', '#2b1d16');
    run.baristas.forEach((b, i) => {
      const busy = !!b.ticket;
      const progress = b.holding ? holdProgress(run, b) : busy ? clamp((run.t - b.startAt) / (b.doneAt - b.startAt), 0, 1) : 0;
      drawStaff(ctx, xs[i], now, busy, progress, STAFF_LOOK[i][0], STAFF_LOOK[i][1], b.holding ? '#5aa2f0' : '#e0a85c');
    });
    if (frontLayer) ctx.drawImage(frontLayer, 0, 0, W, H);
    if (run.blockedBy) labelChip(ctx, CASHIER_X, 160, `Waiting for #${run.blockedBy.id}`);
    run.baristas.forEach((b, i) => {
      if (!b.ticket || !menu[b.ticket.item].batchable) return;
      drawPitcher(ctx, xs[i] - 30, 288, b.partner ? 1.3 : 1, !b.holding);
      if (b.partner) labelChip(ctx, xs[i] - 30, 252, '×2');
      if (b.holding) labelChip(ctx, xs[i], 160, '2nd latte?');
    });
    if (run.ordering) {
      const p = clamp((run.t - run.cashierFrom) / config.register.orderSeconds, 0, 1);
      ctx.fillStyle = '#fffdf6'; ctx.fillRect(274, 272 - p * 16, 16, p * 16);
    }
    if (state.steam.length) {
      puff ??= makePuff();
      for (const s of state.steam) {
        ctx.globalAlpha = 0.34 * s.life;
        ctx.drawImage(puff, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      }
      ctx.globalAlpha = 1;
    }
    run.cups.slice(0, 10).forEach((cup, k) => {
      const age = (now - cup.born) / 1000;
      const pop = REDUCED ? 1 : clamp(age * 4, 0, 1);
      drawCup(ctx, 800 + (k % 5) * 12 + Math.floor(k / 5) * 6, 289 - Math.floor(k / 5) * 3, pop < 1 ? 0.6 + pop * 0.55 : 1);
    });
    run.rail.slice(0, RAIL.slots).forEach(t => { if (t.x !== undefined) drawTicket(ctx, t); });
    run.mobileRail.slice(0, APP_RAIL.slots).forEach(t => { if (t.x !== undefined) drawTicket(ctx, t); });
    if (run.mobileRail.length > APP_RAIL.slots) {
      const x = APP_RAIL.x0 + APP_RAIL.slots * APP_RAIL.step;
      rr(ctx, x - 8, 160, 36, 20, 6); ctx.fillStyle = '#1d3a5c'; ctx.fill();
      ctx.fillStyle = '#eef5fd'; ctx.font = "600 11px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center';
      ctx.fillText('+' + (run.mobileRail.length - APP_RAIL.slots), x + 10, 174); ctx.textAlign = 'left';
    }
    run.baristas.forEach(b => {
      if (b.ticket && b.ticket.x !== undefined) drawTicket(ctx, b.ticket);
      if (b.partner && b.partner.x !== undefined) drawTicket(ctx, b.partner);
    });
    if (run.rail.length > RAIL.slots) {
      const x = RAIL.x0 + RAIL.slots * RAIL.step;
      rr(ctx, x - 8, 160, 36, 20, 6); ctx.fillStyle = '#2a211b'; ctx.fill();
      ctx.fillStyle = '#fff7ec'; ctx.font = "600 11px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center';
      ctx.fillText('+' + (run.rail.length - RAIL.slots), x + 10, 174); ctx.textAlign = 'left';
    }
    drawList.length = 0;
    for (const p of run.customers) if (!offstage(run, p)) drawList.push(p);
    drawList.sort((a, b) => a.y - b.y);
    for (const p of drawList) drawCustomer(ctx, p, now);
    if (shadeLayer) ctx.drawImage(shadeLayer, 0, 0, W, H);
    if (state.xa > 0.01) drawXray(ctx, run, now, state.xa);
    if (fxCtx && (fx.count || fxDirty)) {
      fxCtx.setTransform(scale, 0, 0, scale, 0, 0);
      fxCtx.clearRect(0, 0, W, H);
      fx.draw(fxCtx, now, 1 - state.xa); // Effects fade out under the X-ray, which has its own pops.
      fxDirty = fx.count > 0;
    }
  }

  // ---------- Movement (visual only; the engine never waits for it) ----------
  function moveToward(p, dt, speed) {
    const target = p.via || p.dest;
    if (!target) { p.moving = false; return true; }
    const dx = target.x - p.x, dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    const stepLen = REDUCED ? Infinity : speed * dt;
    if (d <= stepLen || d < 0.5) {
      p.x = target.x; p.y = target.y;
      if (p.via) { p.via = null; return false; }
      p.moving = false;
      return true;
    }
    if (dt > 0) { p.x += (dx / d) * stepLen; p.y += (dy / d) * stepLen; p.moving = true; }
    return false;
  }

  function updateVisuals(run, dt) {
    const speed = 300 * Math.sqrt(state.speed);
    const xs = BARISTA_SLOTS[run.design.baristas];
    run.regQueue.forEach((p, i) => { p.dest = { x: Math.min(REGISTER_SPOT.x + 44 + i * 34, 900), y: 512 + (i % 2) * 6 }; });
    if (run.ordering) run.ordering.dest = { ...REGISTER_SPOT };
    let k = 0;
    for (const p of run.customers) {
      if (offstage(run, p)) continue;
      if (!p.entered) { p.entered = true; p.x = DOOR.x; p.y = DOOR.y; p.via = { ...DOOR_LANE }; }
      if (run.blockedBy && run.blockedBy.c === p) {
        p.dest = { ...REGISTER_SPOT }; // Sync: you wait at the register for your drink.
      } else if (p.state === 'waiting') {
        const col = k % 9, row = Math.floor(k / 9);
        p.dest = { x: 432 + col * 40 + (row % 2) * 18, y: 394 + row * 19 }; k++;
      } else if (p.state === 'pickup') p.dest = { ...PICKUP_SPOT };
      else if (p.state === 'walkout' || p.state === 'leaving') p.dest = { ...DOOR };
    }
    for (const p of run.customers) {
      if (offstage(run, p)) continue;
      if (!moveToward(p, dt, speed)) continue;
      if (p.state === 'pickup') {
        burst('served', p.x, p.y - 84 * sizeAt(p.y));
        run.cups = run.cups.filter(cup => cup.id !== p.id);
        p.hasCup = true; p.state = 'leaving'; p.via = { ...DOOR_LANE };
      } else if ((p.state === 'leaving' || p.state === 'walkout') && p.y <= DOOR.y + 1) {
        p.state = 'gone';
      }
    }
    const ease = REDUCED ? 1 : clamp(dt * 7, 0, 1);
    run.rail.forEach((t, i) => {
      if (t.x === undefined) spawnTicket(t);
      const tx = RAIL.x0 + Math.min(i, RAIL.slots - 1) * RAIL.step;
      t.x += (tx - t.x) * ease; t.y += (RAIL.y - t.y) * ease;
    });
    run.mobileRail.forEach((t, i) => {
      if (t.x === undefined) spawnTicket(t);
      const tx = APP_RAIL.x0 + Math.min(i, APP_RAIL.slots - 1) * APP_RAIL.step;
      t.x += (tx - t.x) * ease; t.y += (APP_RAIL.y - t.y) * ease;
    });
    run.baristas.forEach((b, i) => {
      if (!b.ticket) return;
      const t = b.ticket;
      if (t.x === undefined) spawnTicket(t);
      t.x += (xs[i] + 16 - t.x) * ease; t.y += (258 - t.y) * ease;
      if (b.partner) {
        const p = b.partner;
        if (p.x === undefined) spawnTicket(p);
        p.x += (xs[i] + 34 - p.x) * ease; p.y += (262 - p.y) * ease;
      }
    });
    run.pops = run.pops.filter(pp => performance.now() - pp.born < 1500);
    if (!REDUCED && dt > 0) {
      run.baristas.forEach((b, i) => {
        if (b.ticket && !b.holding && Math.random() < dt * 12) {
          const w = WANDS[i % 2];
          state.steam.push({ x: w.x + (Math.random() - 0.5) * 6, y: w.y, r: 6, life: 1, drift: Math.random() * 6 });
        }
      });
      state.steam.forEach(s => { s.y -= 26 * dt; s.x += Math.sin((s.y + s.drift) / 9) * 0.4; s.r += 10 * dt; s.life -= dt * 0.9; });
      state.steam = state.steam.filter(s => s.life > 0);
    }
    const target = state.xray ? 1 : 0;
    state.xa = REDUCED ? target : state.xa + (target - state.xa) * clamp(dt * 8 || 0.2, 0, 1);
  }

  // ---------- Panels ----------
  const panel = byId('panel');
  const stageEl = byId('scene').closest?.('.stage') || byId('stage');

  const starCount = i => state.stars[i].filter(Boolean).length;
  const navStars = i => `<span class="nav-stars" aria-label="${starCount(i)} of 3 stars">${state.stars[i]
    .map(on => `<i class="${on ? 'on' : ''}" aria-hidden="true">★</i>`).join('')}</span>`;

  /** printIn: a level that just unlocked, which prints onto the rail. */
  function renderLevels(printIn = null) {
    byId('levels').innerHTML = LEVELS.map((l, i) =>
      `<li><button type="button" data-level="${i}" ${i === state.level ? 'aria-current="true"' : ''} ${i > state.navUnlocked ? 'disabled' : ''} ${i === printIn ? 'class="print-in"' : ''}>` +
      `<span class="n"><span>LEVEL ${l.id}</span>${i > state.navUnlocked ? '<span>LOCKED</span>' : navStars(i)}</span>` +
      `<span class="t">${l.name}</span></button></li>`).join('');
  }

  function renderPhase() {
    const ph = state.phase === 'design' ? 1 : state.phase === 'run' ? 2 : 3;
    byId('phase').innerHTML = ['Brief', 'Design', 'Run', 'Debrief']
      .map((n, i) => `<span class="${i === ph || (i === 0 && ph === 1) ? 'on' : ''}">${n}</span>`).join('');
    byId('pause').hidden = state.phase !== 'run';
    byId('pause').innerHTML = state.playing ? `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg><span class="lbl">Pause</span>` : `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z" fill="currentColor"/></svg><span class="lbl">Resume</span>`;
    byId('pause').setAttribute('aria-label', state.playing ? 'Pause' : 'Resume');
    stageEl.dataset.phase = state.phase; // Phones hide the empty stats while designing.
  }

  function badge(ok) {
    if (ok === null) return '<span class="badge">GOAL</span>';
    return ok ? '<span class="badge ok">✓ MET</span>' : '<span class="badge bad">✕ MISSED</span>';
  }

  function goalsHTML(lv, s) {
    return `<ul class="goals">${lv.goals.map(g => {
      const ok = s ? g.ok(s) : null;
      return `<li>${badge(ok)}<span class="goal-text"><span class="slo">SLO</span>${g.label}${s ? ` <span class="got">${g.got(s)}</span>` : ''}</span></li>`;
    }).join('')}<li>${s ? badge(true) : '<span class="badge">BUDGET</span>'}<span class="goal-text">Stay within the $${lv.budget} budget</span></li></ul>`;
  }

  function starListHTML(lv, on, extra = () => '') {
    return `<ul class="stars" aria-label="Stars for this level">${starLabels(lv).map((label, i) =>
      `<li class="${on[i] ? 'on' : ''}"><span class="star" aria-hidden="true">★</span><span class="star-label">${label}</span>${extra(i)}<span class="sr">${on[i] ? ', earned' : ''}</span></li>`).join('')}</ul>`;
  }

  // Your call: one tap to predict the rush before it runs. Optional, and worth a star.
  function callHTML(lv, d) {
    const g = state.guesses[state.level];
    return `
      <div class="call">
        <p class="call-q"><span class="slo">YOUR CALL</span>${lv.predict.q(d)}</p>
        <div class="call-opts" role="group" aria-label="Your prediction">
          ${lv.predict.options.map((o, i) => `<button type="button" class="opt" data-act="guess" data-guess="${i}" aria-pressed="${g === i}">${o.label}</button>`).join('')}
        </div>
      </div>`;
  }

  const pct = (cost, lv) => `${Math.min(100, (cost / lv.budget) * 100)}%`;

  function renderDesign() {
    const lv = LEVELS[state.level];
    const d = state.designs[state.level];
    const cost = designCost(d);
    const over = cost > lv.budget;
    panel.innerHTML = `
      <div class="ticket-head"><span>LEVEL ${lv.id} · BRIEF</span><span>BUDGET $${lv.budget}</span></div>
      <h2>${lv.name}</h2>
      <button type="button" class="reread" data-act="brief">Reread the brief</button>
      <h3>Goals</h3>
      ${goalsHTML(lv, null)}
      ${starListHTML(lv, state.stars[state.level])}`;
    // You design on the shop; your call, the cost, and Run sit under it.
    setupEl.innerHTML = `
      <ul class="setup-goals">${lv.goals.map(g => `<li><span class="slo">GOAL</span>${g.label}</li>`).join('')}</ul>
      ${callHTML(lv, d)}
      <div class="setup-run">
        <div class="budget">
          <div class="row"><span>Cost</span><span><span class="cost-num">$${cost}</span> of $${lv.budget}</span></div>
          <div class="bar ${over ? 'over' : ''}"><i style="width:${pct(cost, lv)}"></i></div>
        </div>
        <button type="button" class="btn run-btn" data-act="run" ${over ? 'disabled' : ''}>Run the rush</button>
      </div>
      ${over ? '<p class="setup-note">Over budget. Remove something to run the rush.</p>' : ''}`;
    reactDesign(lv, cost, over);
  }

  // ---------- Input reactions ----------
  // The control you touched bumps, the cost rolls to its new number, the budget bar slides,
  // and going over budget gives it a shake. Without a real page these are skipped.
  let bumpAct = null;
  let roll = null;

  function reactDesign(lv, cost, over) {
    const from = state.shownCost[state.level];
    state.shownCost[state.level] = cost;
    if (!panel.querySelector) return;
    const restart = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
    // The first match across the ticket, the setup under the shop, and the shop tags.
    const q = sel => panel.querySelector(sel) || setupEl.querySelector?.(sel) || tagsEl.querySelector?.(sel);
    if (bumpAct) {
      const el = bumpAct === 'policy' ? q('select[name="policy"]')?.closest('.shop-tag')
        : bumpAct === 'guess' ? q('.opt[aria-pressed="true"]')
        : q(`[data-act="${bumpAct}"]`)?.closest('.part, .shop-tag');
      restart(el, 'bump');
      bumpAct = null;
    }
    if (from === null || from === cost || REDUCED) return;
    const num = q('.cost-num');
    const bar = q('.budget .bar i');
    if (num) { num.textContent = `$${from}`; roll = { el: num, from, to: cost, start: null }; }
    if (bar) {
      bar.style.transition = 'none'; bar.style.width = pct(from, lv);
      void bar.offsetWidth;
      bar.style.transition = ''; bar.style.width = pct(cost, lv);
    }
    if (over && from <= lv.budget) restart(q('.budget'), 'jolt');
  }

  function tickRoll(now) {
    if (!roll) return;
    roll.start ??= now;
    const p = clamp((now - roll.start) / 260, 0, 1);
    roll.el.textContent = `$${Math.round(roll.from + (roll.to - roll.from) * (1 - (1 - p) ** 3))}`;
    if (p >= 1) roll = null;
  }


  function batchFacts(s) {
    const lv = LEVELS[state.level];
    if (lv.controls && lv.controls.includes('async')) return `
        <div><dt>Longest time to an answer · response time</dt><dd>${s.longestAnswerMin.toFixed(1)} min</dd></div>`;
    if (!lv.controls || !lv.controls.some(c => c === 'batch' || c === 'batchWait')) return '';
    return `
        <div><dt>Pitchers steamed</dt><dd>${s.steams}</dd></div>
        <div><dt>Batches of two · batch size</dt><dd>${s.batches}</dd></div>`;
  }

  function factsHTML(s, d) {
    if (!state.run.hasApp) return `
      <dl class="facts">
        <div><dt>Served · 200 OK</dt><dd>${s.served}</dd></div>
        <div><dt>Turned away · 503</dt><dd>${s.rejected}</dd></div>
        <div><dt>Longest wait · latency</dt><dd>${s.longestWaitMin.toFixed(1)} min</dd></div>
        <div><dt>Workers busy · utilization</dt><dd>${Math.round(s.utilization * 100)}%</dd></div>
        <div><dt>Most tickets waiting · peak queue</dt><dd>${s.peakQueue}</dd></div>
        <div><dt>Cost</dt><dd>$${designCost(d)}</dd></div>
${batchFacts(s)}
      </dl>`;
    return `
      <dl class="facts">
        <div><dt>Longest walk-in wait · latency</dt><dd>${s.walkin.longestWaitMin.toFixed(1)} min</dd></div>
        <div><dt>Longest app wait · latency</dt><dd>${s.mobile.longestWaitMin.toFixed(1)} min</dd></div>
        <div><dt>Served · 200 OK</dt><dd>${s.walkin.served} walk-in, ${s.mobile.served} app</dd></div>
        <div><dt>Workers busy · utilization</dt><dd>${Math.round(s.utilization * 100)}%</dd></div>
        <div><dt>Most tickets waiting · peak queues</dt><dd>${s.peakQueue} walk-in, ${s.peakMobileQueue} app</dd></div>
        <div><dt>Cost</dt><dd>$${designCost(d)}</dd></div>
${batchFacts(s)}
      </dl>`;
  }

  function callResultHTML(lv, d, s) {
    const g = state.runGuess;
    if (g === null) return '';
    const got = outcome(lv.predict, s, d);
    const right = g === got;
    return `<p class="call-result ${right ? 'ok' : 'bad'}"><span class="slo">YOUR CALL</span>You said <b>${lv.predict.options[g].label.toLowerCase()}</b>. ` +
      `It was <b>${lv.predict.options[got].label.toLowerCase()}</b>: ${lv.predict.actual(s, d)}. ${right ? 'Called it.' : 'Not this time.'}</p>`;
  }

  // Wrap the first number in a label so the reveal can count it up from zero.
  const countUp = text => String(text).replace(/\d+(?:\.\d+)?/, m =>
    `<span class="count" data-to="${m}" data-dp="${(m.split('.')[1] || '').length}">${m}</span>`);

  function renderDebrief() {
    const lv = LEVELS[state.level];
    const d = state.designs[state.level];
    const s = state.summary;
    const ok = lv.goals.every(g => g.ok(s));
    s.ok = ok;
    const missed = lv.goals.filter(g => !g.ok(s)).length;
    const cost = designCost(d);
    const lines = [
      ...lv.goals.map(g => ({ label: g.label, got: g.got(s), ok: g.ok(s), slo: true })),
      { label: `Stay within the $${lv.budget} budget`, got: `$${cost} spent`, ok: cost <= lv.budget, slo: false },
    ];
    // The SLO note shows on the first debrief of the visit only.
    state.sloNoteRun ??= state.run;
    const sloNote = state.sloNoteRun === state.run
      ? `<p class="note">Goals marked SLO are <strong>service level objectives</strong>: targets a system promises to meet. Real teams track them on dashboards like the one behind this game.</p>`
      : '';
    const hasNext = ok && state.level < LEVELS.length - 1;
    panel.innerHTML = `
      <div class="ticket-head"><span>LEVEL ${lv.id} · DEBRIEF</span><span>CLOSED ${clock(state.run.lastEventT)}</span></div>
      <h2 class="debrief-title">${lv.name}</h2>
      <ol class="tally">
        ${lines.map(l => `<li class="${l.ok ? 'ok' : 'bad'}">
          <span class="tally-label">${l.slo ? '<span class="slo">SLO</span>' : ''}${l.label}</span>
          <span class="tally-got">${countUp(l.got)}</span>
          <span class="mark" aria-hidden="true">${l.ok ? '✓' : '✕'}</span><span class="sr">${l.ok ? 'met' : 'missed'}</span>
        </li>`).join('')}
      </ol>
      <div class="stamp-row">
        <p class="stamp ${ok ? 'ok' : 'no'}">${ok ? 'Goals met' : 'Not yet'}</p>
        <span class="stamp-sub">${ok ? 'ALL GOALS MET' : `${missed} GOAL${missed > 1 ? 'S' : ''} MISSED`}</span>
      </div>
      ${starListHTML(lv, state.runStars, i => (state.newStars[i] ? '<span class="new-tag">NEW</span>' : '')).replace('class="stars"', 'class="stars debrief-stars"')}
      <div class="reveal-late">
        ${callResultHTML(lv, d, s)}
        <p class="what">${lv.explain(d, s)}</p>
        <div class="actions">
          ${hasNext ? `<button type="button" class="btn" data-act="next">Next: ${LEVELS[state.level + 1].id} ${LEVELS[state.level + 1].name}</button>` : ''}
          <button type="button" class="btn ${hasNext ? 'line' : ''}" data-act="change">Change your design</button>
          <button type="button" class="btn line" data-act="replay">Watch it again</button>
        </div>
        ${ok && state.level === LEVELS.length - 1
          ? (next
            ? `<p class="next-lesson">That's every level in this lesson. <a class="btn" href="${next.href}">Next lesson: ${next.title}</a></p>`
            : '<p class="note">That\'s every level in this lesson. More lessons are on the way.</p>')
          : ''}
        <details class="fold">
          <summary><span>Your receipt</span><span class="fold-sub">the numbers</span></summary>
          ${sloNote}
          ${factsHTML(s, d)}
        </details>
        ${lv.intro ? '' : `<details class="fold">
          <summary><span>In software terms</span><span class="fold-sub">${lv.concept.term}</span></summary>
          <div class="concept">
            <h3>${lv.concept.term}</h3>
            <p>${lv.concept.body}</p>
            <p class="quiet">${lv.concept.real}</p>
          </div>
        </details>`}
      </div>`;
  }

  // ---------- The debrief reveal ----------
  // The receipt prints line by line, each number counts up and gets its mark, then the
  // stamp lands. Timed in real milliseconds, not shop time. A tap on the ticket skips it.
  const REVEAL = { first: 250, gap: 420, count: 360, stampAfter: 300, starFirst: 420, starGap: 300, settle: 400 };
  let reveal = null;

  function beginReveal(ok) {
    panel.classList.remove('revealing', 'jolt');
    if (!hasPanel || !panel.querySelectorAll || REDUCED) { sound.play(ok ? 'stamp' : 'stampMiss'); afterReveal(); return; }
    const lines = [...panel.querySelectorAll('.tally li')];
    const counts = lines.map(li => [...li.querySelectorAll('.count')]);
    for (const c of counts.flat()) c.textContent = (0).toFixed(Number(c.dataset.dp));
    panel.classList.add('revealing');
    const stars = [...panel.querySelectorAll('.debrief-stars li')];
    reveal = { start: null, ok, lines, counts, shown: 0, marked: 0, stamped: false, stamp: panel.querySelector('.stamp'), stars, starsShown: 0 };
  }

  // After the receipt: a level that just unlocked prints onto the level rail.
  function afterReveal() {
    if (state.pendingUnlock === null) return;
    const i = state.pendingUnlock;
    state.pendingUnlock = null;
    state.navUnlocked = Math.max(state.navUnlocked, state.unlocked);
    renderLevels(i);
    sound.play('unlock');
  }

  function landStamp() {
    reveal.stamped = true;
    reveal.stamp?.classList.add('in');
    panel.classList.add('jolt');
    sound.play(reveal.ok ? 'stamp' : 'stampMiss');
  }

  function tickReveal(now) {
    if (!reveal) return;
    reveal.start ??= now;
    const t = now - reveal.start;
    const { lines, counts } = reveal;
    const lineAt = i => REVEAL.first + i * REVEAL.gap;
    while (reveal.shown < lines.length && t >= lineAt(reveal.shown)) {
      lines[reveal.shown].classList.add('in');
      sound.play('print');
      reveal.shown++;
    }
    for (let i = 0; i < reveal.shown; i++) {
      const p = clamp((t - lineAt(i)) / REVEAL.count, 0, 1);
      const eased = 1 - (1 - p) ** 3;
      for (const c of counts[i]) c.textContent = (Number(c.dataset.to) * eased).toFixed(Number(c.dataset.dp));
    }
    while (reveal.marked < reveal.shown && t >= lineAt(reveal.marked) + REVEAL.count) {
      sound.play(lines[reveal.marked].classList.contains('ok') ? 'good' : 'bad');
      reveal.marked++;
    }
    const stampAt = lineAt(lines.length - 1) + REVEAL.count + REVEAL.stampAfter;
    if (!reveal.stamped && t >= stampAt) landStamp();
    const starAt = i => stampAt + REVEAL.starFirst + i * REVEAL.starGap;
    while (reveal.starsShown < reveal.stars.length && t >= starAt(reveal.starsShown)) {
      const li = reveal.stars[reveal.starsShown];
      li.classList.add('in');
      if (li.classList.contains('on')) sound.play('star', reveal.starsShown); else sound.play('starMiss');
      reveal.starsShown++;
    }
    if (t >= starAt(Math.max(0, reveal.stars.length - 1)) + REVEAL.settle) finishReveal();
  }

  function finishReveal() {
    if (!reveal) return;
    for (const li of reveal.lines) li.classList.add('in');
    for (const li of reveal.stars) li.classList.add('in');
    for (const c of reveal.counts.flat()) c.textContent = c.dataset.to;
    if (!reveal.stamped) landStamp();
    panel.classList.remove('revealing');
    reveal = null;
    afterReveal();
  }

  // ---------- Freeze frames ----------
  // The first time a lesson's moment happens (MOMENTS in the lesson file), the rush pauses:
  // the shop dims around a spotlight, and a card explains it in shop words and software
  // terms. Tap, Space, or Enter carries on. Each moment shows once per visit. The
  // simulation just pauses, so results are unchanged.
  const MOMENTS = hasPanel ? (lesson.MOMENTS || []) : [];
  const seenMoments = new Set();
  const momentCard = byId('moment');
  const spot = byId('spot');
  const sceneEl = byId('scene');
  let moment = null;

  // Where a ticket on the rail settles: its slot. Tickets are drawn 28 tall from RAIL.y.
  const slotSpot = i => ({ x: RAIL.x0 + Math.min(i, RAIL.slots - 1) * RAIL.step, y: RAIL.y + 14 });
  // A goal under pressure: point at the end of the line.
  const railSpot = () => slotSpot(Math.max(0, state.run.rail.length - 1));
  // A ticket, wherever it's drawn right now (it slides from the printer to its slot).
  const ticketSpot = t => () => ({ x: t.x ?? RAIL.x0, y: (t.y ?? RAIL.y) + 14 });

  // Named places a moment can point the spotlight at, instead of what triggered it.
  const SPOTS = {
    cashier: () => ({ x: CASHIER_X, y: 214 }),
    register: () => ({ x: REGISTER_SPOT.x + 40, y: REGISTER_SPOT.y - 40 }),
    rail: () => railSpot(),
    bar: () => ({ x: 585, y: 250 }),
    appPrinter: () => ({ x: APP_PRINTER.x, y: APP_PRINTER.y - 4 }),
    appRail: () => ({ x: APP_RAIL.x0 + Math.min(Math.max(0, state.run.mobileRail.length - 1), APP_RAIL.slots - 1) * APP_RAIL.step, y: APP_RAIL.y + 14 }),
  };

  function trigger(on, info = {}) {
    if (moment || state.phase !== 'run' || !MOMENTS.length) return;
    const lv = LEVELS[state.level];
    const mode = state.run.design.sync ? 'sync' : 'async';
    const m = MOMENTS.find(x => x.on === on && !seenMoments.has(x.id)
      && (x.level === undefined || x.level === lv.id)
      && (x.mode === undefined || x.mode === mode)
      && (x.why === undefined || x.why === info.why)
      && (x.goal === undefined || x.goal === info.goal)
      && (x.when === undefined || x.when({ run: state.run, d: state.designs[state.level], ...info })));
    if (m) freeze(m, m.spot ? { ...info, at: SPOTS[m.spot](), track: SPOTS[m.spot] } : info);
  }

  function freeze(m, info) {
    seenMoments.add(m.id);
    moment = { m };
    state.playing = false;
    if (m.xray && !state.xray) setXray(true, true);
    const ctx = { run: state.run, d: state.designs[state.level], ...info };
    const track = info.track || (() => info.at || { x: W / 2, y: H / 2 });
    moment.track = track;
    const w = sceneEl.clientWidth || W;
    const h = sceneEl.clientHeight || H;
    const at = info.at || track();
    const sx = (at.x / W) * w;
    const sy = (at.y / H) * h;
    placeSpot();
    spot.hidden = false;
    momentCard.innerHTML = `
      <p class="moment-title"><span aria-hidden="true">⏸</span> ${typeof m.title === 'function' ? m.title(ctx) : m.title}</p>
      <p class="moment-text">${m.text(ctx)}</p>
      <p class="moment-soft"><span class="slo">IN SOFTWARE</span>${m.soft}</p>
      <button type="button" class="moment-go">Got it <span class="key" aria-hidden="true">Space</span></button>`;
    define.link(momentCard);
    // On wide screens the card floats beside the spotlight; on phones it sits under the shop.
    const below = sy < h / 2;
    momentCard.dataset.side = below ? 'below' : 'above';
    momentCard.style.setProperty('--x', `${clamp(sx, 180, Math.max(180, w - 180)) + (sceneEl.offsetLeft || 0)}px`);
    momentCard.style.setProperty('--y', `${(below ? sy + 52 : sy - 52) + (sceneEl.offsetTop || 0)}px`);
    momentCard.hidden = false;
    sound.play('moment');
    renderPhase();
    momentCard.querySelector?.('.moment-go')?.focus({ preventScroll: true });
  }

  // Keep the spotlight on its target, in CSS pixels of the shop window, every frame.
  function placeSpot() {
    if (!moment) return;
    const w = sceneEl.clientWidth || W;
    const h = sceneEl.clientHeight || H;
    const at = moment.track();
    spot.style.setProperty('--x', `${((at.x / W) * w).toFixed(1)}px`);
    spot.style.setProperty('--y', `${((at.y / H) * h).toFixed(1)}px`);
    spot.style.setProperty('--r', `${Math.max(24, w * 0.055).toFixed(1)}px`);
  }

  function clearMoment() {
    moment = null;
    spot.hidden = true;
    momentCard.hidden = true;
  }

  function resume() {
    if (!moment) return;
    clearMoment();
    if (state.phase === 'run') state.playing = true;
    sound.play('tick');
    renderPhase();
  }
  momentCard.addEventListener('click', resume);
  spot.addEventListener('click', resume);

  // ---------- Live goal meters ----------
  // While the rush runs, each goal shows a meter and ON TRACK / AT RISK / MISSED.
  // The numbers come from live-goals.mjs; the debrief stays the final word.
  const goalStrip = byId('goal-strip');
  let live = null;

  function liveRowHTML(g) {
    const first = liveGoal(g.live, state.run);
    return `<li class="live-goal" data-status="ok">
        <div class="live-top"><span class="goal-text"><span class="slo">SLO</span>${g.label}</span><span class="badge live-badge ok">${STATUS_WORDS.ok}</span></div>
        <div class="meter"><i class="meter-fill"></i>${first.mark === null ? '' : `<b class="meter-limit" style="left:${first.mark * 100}%"></b>`}</div>
        <span class="live-val">${first.text}</span>
      </li>`;
  }

  function startLive() {
    const lv = LEVELS[state.level];
    goalStrip.innerHTML = lv.goals.map(g =>
      `<span class="strip-goal" data-status="ok"><span class="strip-label">${shortLabel(g.live)}</span><span class="badge live-badge ok">${STATUS_WORDS.ok}</span></span>`).join('');
    goalStrip.hidden = false;
    const all = (root, sel) => (root.querySelectorAll ? [...root.querySelectorAll(sel)] : []);
    live = { statuses: lv.goals.map(() => 'ok'), rows: all(panel, '.live-goal'), chips: all(goalStrip, '.strip-goal') };
    updateLive();
  }

  function stopLive() {
    clearMoment();
    live = null;
    goalStrip.hidden = true;
  }

  function updateLive() {
    if (!live || state.phase !== 'run') return;
    LEVELS[state.level].goals.forEach((g, i) => {
      const r = liveGoal(g.live, state.run);
      const row = live.rows[i];
      const chip = live.chips[i];
      if (row) {
        row.querySelector('.meter-fill').style.width = `${(r.fill * 100).toFixed(1)}%`;
        row.querySelector('.live-val').textContent = r.text;
      }
      if (r.status === live.statuses[i]) return;
      live.statuses[i] = r.status;
      for (const el of [row, chip]) {
        if (!el) continue;
        el.dataset.status = r.status;
        const badgeEl = el.querySelector('.live-badge');
        badgeEl.textContent = STATUS_WORDS[r.status];
        badgeEl.className = `badge live-badge ${r.status}`;
        // Restart the pop animation: remove the class, force a layout, add it back.
        el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip');
      }
      if (r.status === 'risk') { sound.play('warn'); trigger('goalRisk', { goal: i, at: railSpot() }); }
      if (r.status === 'missed') { sound.play('bad'); trigger('goalMissed', { goal: i, at: railSpot() }); }
    });
  }

  function renderRunning() {
    const lv = LEVELS[state.level];
    panel.innerHTML = `
      <div class="ticket-head"><span>LEVEL ${lv.id} · RUSH</span><span>DESIGN LOCKED</span></div>
      <h2>The rush is on</h2>
      <ul class="goals live">${lv.goals.map(liveRowHTML).join('')}</ul>
      <p class="quiet">Your design is locked in, just like a real system once traffic arrives. Press the <strong>X-ray monitor</strong> on the shop to see the system behind it.</p>
      <p class="note">The caption under the shop tells you what each event means in software terms.</p>`;
  }

  // ---------- Design tags on the shop ----------
  // Each control is a small tag on the shop (an HTML layer, so the shop drawing doesn't
  // change). On phones they sit in a row under the shop. They step aside during the rush,
  // and show software words under the X-ray. The floor is empty while you design, so the
  // tags that aren't about the counter sit there.
  const tagsEl = byId('shop-tags');
  const setupEl = byId('setup');
  const onShop = hasPanel;
  const FLOOR_L = { x: 330, y: 445 }, FLOOR_L2 = { x: 330, y: 520 }, FLOOR_R = { x: 790, y: 445 };
  const TAG_AT = {
    baristas: { x: 585, y: 362 }, crew: { x: 585, y: 362 }, async: { x: 232, y: 362 },
    rail: FLOOR_L, capacity: FLOOR_L2, policy: FLOOR_L, every: FLOOR_L2, batch: FLOOR_R, batchWait: FLOOR_R,
  };

  // Which tags a level shows, in order. A level without a baristas control shows its fixed crew.
  function controlsFor(lv, d) {
    const list = lv.controls ? [...lv.controls]
      : lv.policies ? ['baristas', 'policy']
      : ['baristas', 'rail', ...(lv.capacityUnlocked && d.rail ? ['capacity'] : [])];
    if (!list.includes('baristas')) list.unshift('crew');
    if (list.includes('policy') && d.policy === 'weighted') list.splice(list.indexOf('policy') + 1, 0, 'every');
    return list.filter(k => TAG_AT[k]);
  }
  const greeted = new Set(); // Levels whose tags have pulsed hello.

  function tagHTML(key, d, locked, lv) {
    const dis = locked ? 'disabled' : '';
    const at = TAG_AT[key];
    const style = `style="--x:${(at.x / W * 100).toFixed(1)}%;--y:${(at.y / H * 100).toFixed(1)}%"`;
    const name = (shop, sys) => `<span class="tag-name"><span class="shop-word">${shop}</span><span class="sys-word">${sys}</span></span>`;
    if (key === 'baristas') return `
      <div class="shop-tag" data-ctl="baristas" ${style}>
        ${name('Baristas', 'Workers')}
        <span class="stepper">
          <button type="button" data-act="minus" aria-label="Remove a barista" ${locked || d.baristas <= 1 ? 'disabled' : ''}>−</button>
          <output aria-live="polite">${d.baristas}</output>
          <button type="button" data-act="plus" aria-label="Add a barista" ${locked || d.baristas >= 4 ? 'disabled' : ''}>+</button>
        </span>
        <span class="tag-price">$${COST.barista} each</span>
      </div>`;
    const stepper = (minus, plus, value, labels, lo, hi) => `
        <span class="stepper">
          <button type="button" data-act="${minus}" aria-label="${labels[0]}" ${lo ? 'disabled' : ''}>−</button>
          <output aria-live="polite">${value}</output>
          <button type="button" data-act="${plus}" aria-label="${labels[1]}" ${hi ? 'disabled' : ''}>+</button>
        </span>`;
    const toggle = (act, on, label, sysOn, sysOff) => `
        <button type="button" class="switch" data-act="${act}" aria-pressed="${on}" aria-label="${label}">
          <span class="shop-val">${on ? 'On' : 'Off'}</span><span class="sys-val">${on ? sysOn : sysOff}</span>
        </button>`;
    const tag = (ctl, body) => `<div class="shop-tag" data-ctl="${ctl}" ${style}>${body}</div>`;
    if (key === 'crew') return tag('crew', `${name('Baristas', 'Workers')}<strong class="tag-fixed">${d.baristas}, fixed</strong><span class="tag-price">$${COST.barista} each</span>`);
    if (key === 'rail') return tag('rail', `${name('Ticket rail', 'Queue')}${toggle('rail', d.rail, 'Ticket rail', 'On', 'Off')}<span class="tag-price">$${COST.rail}</span>`);
    if (key === 'capacity') return tag('capacity', `${name('Rail holds', 'Queue limit')}
        <span class="tag-range"><input type="range" name="capacity" min="5" max="50" step="1" value="${d.capacity}" aria-label="Rail size in tickets"><output>${d.capacity}</output></span>
        <span class="tag-price">Free</span>`);
    if (key === 'policy') return tag('policy', `${name('Next ticket', 'Scheduling')}
        <select name="policy" aria-label="How baristas pick the next ticket" title="${POLICY_HELP[d.policy]}">
          ${lv.policies.map(p => `<option value="${p}" ${d.policy === p ? 'selected' : ''}>${POLICIES[p]}</option>`).join('')}
        </select>`);
    if (key === 'every') return tag('every', `${name('App drink', 'Fair share')}
        ${stepper('every-minus', 'every-plus', `every ${ordinal(d.mobileEvery)}`, ['App drinks more often', 'App drinks less often'], d.mobileEvery <= 2, d.mobileEvery >= 6)}`);
    if (key === 'batch') return tag('batch', `${name('Batch the milk', 'Batching')}${toggle('batch', d.batch, 'Batch the milk', 'On', 'Off')}<span class="tag-price">Free</span>`);
    if (key === 'batchWait') return tag('batchWait', `${name('Wait for a 2nd latte', 'Batch window')}
        ${stepper('wait-minus', 'wait-plus', d.batchWait ? `${d.batchWait / 60} min` : "Don't", ['Wait one minute less', 'Wait one minute more'], d.batchWait <= 0, d.batchWait >= 360)}`);
    if (key === 'async') return `
      <div class="shop-tag" data-ctl="async" ${style}>
        ${name('Call names', 'Async API')}
        <button type="button" class="switch" data-act="async" aria-pressed="${!d.sync}" aria-label="Call names" ${dis}>
          <span class="shop-val">${d.sync ? 'Off' : 'On'}</span><span class="sys-val">${d.sync ? 'Sync' : 'Async'}</span>
        </button>
        <span class="tag-price">Free</span>
      </div>`;
    return '';
  }

  function renderTags() {
    if (!onShop) return;
    const lv = LEVELS[state.level];
    const d = state.designs[state.level];
    // Out of the way during the rush; back for the debrief, where a tap starts the next design.
    tagsEl.hidden = state.phase === 'run';
    // The setup under the shop (your call, cost, Run) is only there while designing.
    setupEl.hidden = state.phase !== 'design';
    if (state.phase !== 'design') setupEl.innerHTML = '';
    tagsEl.innerHTML = controlsFor(lv, d).map(k => tagHTML(k, d, false, lv)).join('');
    tagsEl.classList.remove('hello');
    if (state.phase === 'design' && !greeted.has(lv.id)) { greeted.add(lv.id); void tagsEl.offsetWidth; tagsEl.classList.add('hello'); }
  }

  // The panel can sit in a collapsible <details> (the side ticket). Reopen it when a
  // new brief or the debrief arrives, so a player who folded it away still sees it.
  const panelHolder = panel.closest?.('details') ?? null;

  // ---------- The ticket as a sheet on phones ----------
  // Lessons with the controls on the shop: on phones the ticket isn't under the shop (you'd
  // have to scroll away from the rush). It moves into a full-screen dialog that opens by
  // itself for the debrief, and from the Ticket button any time. Desktop keeps it beside the shop.
  const sheet = byId('ticket-sheet');
  const sheetBody = sheet.querySelector?.('.sheet-body') ?? null;
  const ticketBtn = byId('ticket-btn');
  const phoneMQ = window.matchMedia('(max-width: 699px)');
  let sheetMode = false;
  let sheetOpens = 0;

  function placeTicket() {
    sheetMode = onShop && phoneMQ.matches;
    ticketBtn.hidden = !sheetMode;
    const tickets = panel.parentElement;
    if (!tickets || !sheetBody || !panelHolder) return;
    if (sheetMode && tickets.parentElement !== sheetBody) {
      sheetBody.append(tickets);
      panelHolder.hidden = true;
    } else if (!sheetMode && tickets.parentElement === sheetBody) {
      closeSheet();
      panelHolder.append(tickets);
      panelHolder.hidden = false;
    }
  }

  function openSheet() {
    if (!sheetMode) return;
    sheetOpens++;
    if (typeof sheet.showModal === 'function' && !sheet.open) sheet.showModal();
  }
  function closeSheet() { if (sheet.open) sheet.close(); }

  ticketBtn.addEventListener('click', openSheet);
  sheet.addEventListener('click', ev => {
    if (ev.target === sheet || ev.target.closest?.('[data-close]')) closeSheet();
  });
  phoneMQ.addEventListener?.('change', placeTicket);
  placeTicket();
  let shownPhase = null;

  function renderPanel() {
    if (reveal && state.phase !== 'debrief') { reveal = null; panel.classList.remove('revealing', 'jolt'); }
    define.close();
    renderTags();
    if (state.phase === 'design') renderDesign();
    else if (state.phase === 'run') renderRunning();
    else renderDebrief();
    define.link(panel);
    renderPhase();
    if (panelHolder && state.phase !== shownPhase && state.phase !== 'run') panelHolder.open = true;
    shownPhase = state.phase;
  }

  panel.addEventListener('click', ev => {
    if (reveal) { ev.preventDefault?.(); finishReveal(); return; } // Tap the receipt to skip the reveal.
    const b = ev.target.closest('button');
    if (!b || b.disabled) return;
    doAct(b);
  });
  setupEl.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b || b.disabled || state.phase !== 'design') return;
    doAct(b);
  });
  // The tags on the shop only work while designing.
  tagsEl.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b || b.disabled || state.phase === 'run') return;
    leaveDebrief();
    doAct(b);
  });

  // Changing the design after a rush starts the next one.
  function leaveDebrief() {
    if (state.phase !== 'debrief') return;
    if (reveal) finishReveal();
    closeSheet();
    state.phase = 'design'; state.playing = false; state.run = idleRun(); setXray(true);
  }

  function doAct(b) {
    const d = state.designs[state.level];
    const act = b.dataset.act;
    if (act === 'minus') { d.baristas = Math.max(1, d.baristas - 1); designChanged(act); }
    else if (act === 'plus') { d.baristas = Math.min(4, d.baristas + 1); designChanged(act); }
    else if (act === 'rail') { d.rail = !d.rail; designChanged(act); }
    else if (act === 'batch') { d.batch = !d.batch; designChanged(act); }
    else if (act === 'async') { d.sync = !d.sync; designChanged(act); }
    else if (act === 'wait-minus') { d.batchWait = Math.max(0, d.batchWait - 60); designChanged(act); }
    else if (act === 'wait-plus') { d.batchWait = Math.min(360, d.batchWait + 60); designChanged(act); }
    else if (act === 'every-minus') { d.mobileEvery = Math.max(2, d.mobileEvery - 1); designChanged(act); }
    else if (act === 'every-plus') { d.mobileEvery = Math.min(6, d.mobileEvery + 1); designChanged(act); }
    else if (act === 'guess') {
      const g = Number(b.dataset.guess);
      state.guesses[state.level] = state.guesses[state.level] === g ? null : g; // Tap again to take it back.
      sound.play('tick'); bumpAct = 'guess'; renderPanel();
    }
    else if (act === 'run') startRush();
    else if (act === 'brief') openBrief(true);
    else if (act === 'change') { closeSheet(); state.phase = 'design'; state.playing = false; state.run = idleRun(); setXray(true); renderPanel(); }
    else if (act === 'next') setLevel(state.level + 1);
    else if (act === 'replay') startRush({ replay: true });
  }
  tagsEl.addEventListener('change', ev => {
    if (state.phase === 'run') return;
    if (ev.target.name === 'policy') { leaveDebrief(); state.designs[state.level].policy = ev.target.value; designChanged('policy'); }
    if (ev.target.name === 'capacity') sound.play('tick');
  });
  // The rail size slides without redrawing the tags, so the drag isn't interrupted.
  tagsEl.addEventListener('input', ev => {
    if (ev.target.name !== 'capacity' || state.phase === 'run') return;
    leaveDebrief();
    state.designs[state.level].capacity = Number(ev.target.value);
    state.run = idleRun();
    const out = ev.target.parentElement?.querySelector?.('output');
    if (out) out.textContent = ev.target.value;
  });
  byId('levels').addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (b && !b.disabled) setLevel(Number(b.dataset.level));
  });

  function designChanged(act = null) {
    wake();
    sound.play('tick');
    bumpAct = act;
    const lv = LEVELS[state.level];
    const d = state.designs[state.level];
    if (lv.capacityUnlocked && d.rail && !Number.isFinite(d.capacity)) d.capacity = 30;
    if (act === 'rail') renderTags(); // The rail size tag comes and goes with the rail.
    if (!lv.capacityUnlocked) d.capacity = Infinity;
    state.run = idleRun();
    renderPanel();
  }

  function setLevel(i) {
    state.level = i;
    state.unlocked = Math.max(state.unlocked, i);
    state.navUnlocked = Math.max(state.navUnlocked, state.unlocked);
    state.pendingUnlock = null;
    fx.clear();
    closeSheet();
    state.phase = 'design'; state.playing = false;
    state.run = idleRun();
    state.summary = null;
    stopLive();
    setXray(true);
    state.message = '';
    hud.caption.innerHTML = onShop ? '' : 'Design your shop below. The X-ray shows the system you are building.';
    renderLevels(); renderPanel();
    openBrief();
  }

  /** The level's brief dialog: on the first visit to a level, or when asked again. */
  function openBrief(again = false) {
    const lv = LEVELS[state.level];
    if (!lv.intro || !hasPanel || (state.briefed.has(lv.id) && !again)) return;
    state.briefed.add(lv.id);
    state.briefings.push(lv.id);
    closeSheet();
    briefing.open({ title: `Level ${lv.id} · ${lv.name}`, cards: lv.intro });
  }

  /** replay: "Watch it again", which doesn't count as a new try or carry a prediction. */
  function startRush({ replay = false } = {}) {
    const d = state.designs[state.level];
    if (!replay) state.rushes[state.level]++;
    state.runGuess = replay ? null : state.guesses[state.level];
    state.guesses[state.level] = null; // Each rush gets a fresh call.
    sound.play('run');
    closeSheet();
    fx.clear();
    state.run = makeRun(d);
    state.steam = [];
    state.phase = 'run'; state.playing = true;
    if (!state.xrayUsed) setXray(false);
    lastCaption = '';
    hud.caption.innerHTML = 'The doors are open. Customers are walking in.';
    renderPanel();
    startLive();
  }

  function onFinished(run) {
    state.playing = false;
    state.summary = summarize(run);
    const lv = LEVELS[state.level];
    const ok = lv.goals.every(g => g.ok(state.summary));
    const before = state.unlocked;
    if (ok) {
      state.passed[state.level] = true;
      state.unlocked = Math.max(state.unlocked, Math.min(state.level + 1, LEVELS.length - 1));
    }
    if (state.unlocked > before) state.pendingUnlock = state.unlocked;
    const d = state.designs[state.level];
    const best = state.stars[state.level];
    state.runStars = lv.predict && lv.stretch
      ? starsFor(lv, d, state.summary, { rushes: state.rushes[state.level], guess: state.runGuess })
      : [ok, false, false];
    state.newStars = state.runStars.map((on, i) => on && !best[i]);
    state.runStars.forEach((on, i) => { if (on) best[i] = true; });
    stopLive();
    state.phase = 'debrief';
    hud.caption.innerHTML = `${clock(run.lastEventT)}  Rush over. ${run.served} served, ${run.rejected} turned away.`;
    canvas.setAttribute('aria-label', `Coffee shop after the rush: ${run.served} served, ${run.rejected} turned away.`);
    renderLevels(); renderPanel();
    openSheet(); // Phones: the debrief comes up full screen.
    beginReveal(ok);
    if (onFinish) onFinish(state.summary);
  }

  // ---------- Controls ----------
  const xrayBtn = byId('xrayBtn');
  /** flair: the player flipped it (or a freeze frame did): play the sound and the sweep. */
  function setXray(on, flair = false) {
    wake();
    if (flair && on !== state.xray) {
      sound.play(on ? 'xray' : 'xrayOff');
      if (!REDUCED && sceneEl.classList) { sceneEl.classList.remove('sweep'); void sceneEl.offsetWidth; sceneEl.classList.add('sweep'); }
    }
    state.xray = on;
    tagsEl.classList.toggle('xray-on', on);
    xrayBtn.setAttribute('aria-pressed', String(on));
    xrayBtn.setAttribute('aria-label', on ? 'Showing the X-ray. Switch back to the counter' : 'Showing the counter. Open the X-ray');
    xrayBtn.classList.toggle('nudge', !on && state.phase === 'run' && !state.xrayUsed);
  }
  xrayBtn.addEventListener('click', () => { state.xrayUsed = true; setXray(!state.xray, true); });
  document.addEventListener('keydown', ev => {
    if (moment && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault?.(); resume(); return; }
    if ((ev.key === 'x' || ev.key === 'X') && !ev.target.closest('input, textarea')) { state.xrayUsed = true; setXray(!state.xray, true); }
  });
  // The X-ray key: a "?" in the corner of the page opens it.
  const helpBtn = byId('help');
  const keyEl = byId('key');
  function showKey(open) {
    keyEl.hidden = !open;
    helpBtn.setAttribute('aria-expanded', String(open));
  }
  helpBtn.addEventListener('click', () => showKey(keyEl.hidden));
  document.addEventListener('click', ev => {
    if (!keyEl.hidden && !ev.target.closest?.('#key, #help')) showKey(false);
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !keyEl.hidden) { showKey(false); helpBtn.focus?.(); } });

  const muteBtn = byId('mute');
  function renderMute() {
    muteBtn.setAttribute('aria-pressed', String(sound.muted));
    muteBtn.setAttribute('aria-label', sound.muted ? 'Sound off' : 'Sound on');
    muteBtn.innerHTML = `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5c1 .8 1.5 1.6 1.5 2.5s-.5 1.7-1.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="waves"/></svg><span class="lbl">${sound.muted ? 'Sound off' : 'Sound on'}</span>`;
  }
  muteBtn.addEventListener('click', () => { sound.setMuted(!sound.muted); renderMute(); sound.play('tick'); });
  renderMute();
  byId('pause').addEventListener('click', () => { if (moment) { resume(); return; } state.playing = !state.playing; renderPhase(); });
  // Speed: three buttons on wide screens; on phones one button that cycles 1×, 2×, 4×.
  const speedBtn = byId('speed-btn');
  function setSpeed(n) {
    state.speed = n;
    speedBtn.textContent = `${n}×`;
    speedBtn.setAttribute('aria-label', `Speed: ${n}×, tap to change`);
    const radio = document.getElementById(`speed-${n}`);
    if (radio) radio.checked = true;
  }
  document.querySelectorAll('input[name="speed"]').forEach(r => r.addEventListener('change', () => setSpeed(Number(r.value))));
  speedBtn.addEventListener('click', () => { setSpeed({ 1: 2, 2: 4, 4: 1 }[state.speed] || 2); sound.play('tick'); });

  const hud = {
    clock: byId('clock'), served: byId('st-served'),
    rejected: byId('st-rejected'), wait: byId('st-wait'),
    queue: byId('st-queue'), caption: byId('caption'),
  };
  let lastHud = 0, lastCaptionAt = 0, lastCaption = '';
  let shownServed = 0, shownRejected = 0, ambientOn = false;
  const bump = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  // The rush's background: steam hiss with each busy barista, chatter as the shop fills.
  function updateAmbient(run) {
    const on = state.phase === 'run' && state.playing && !document.hidden;
    if (!on) { if (ambientOn) { sound.ambient(0, 0); ambientOn = false; } return; }
    const busy = run.baristas.filter(b => b.ticket && !b.holding).length;
    let inShop = 0;
    for (const p of run.customers) if (!offstage(run, p)) inShop++;
    sound.ambient(busy ? 0.3 + busy * 0.17 : 0, Math.min(1, 0.15 + inShop / 24));
    ambientOn = true;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sound.ambient(0, 0); ambientOn = false; } });

  function updateHud(now) {
    const run = state.run;
    if (now - lastHud > 90) {
      lastHud = now;
      updateLive();
      updateAmbient(run);
      hud.clock.textContent = clock(run.t);
      if (run.served !== shownServed) { if (run.served > shownServed && !REDUCED) bump(hud.served, 'bump'); shownServed = run.served; }
      if (run.rejected !== shownRejected) { if (run.rejected > shownRejected && !REDUCED) bump(hud.rejected, 'bump-bad'); shownRejected = run.rejected; }
      hud.served.textContent = run.served;
      hud.rejected.textContent = run.rejected;
      if (run.hasApp) {
        const mins = ch => (ch.longestWait ? Math.round(ch.longestWait / 60) : '–');
        hud.wait.textContent = `${mins(run.byChannel.walkin)} / ${mins(run.byChannel.mobile)}`;
        hud.queue.textContent = `${run.rail.length} / ${run.mobileRail.length}`;
      } else {
        hud.wait.textContent = run.longestWait ? `${Math.round(run.longestWait / 60)} min` : '–';
        hud.queue.textContent = run.rail.length;
      }
    }
    if (state.phase === 'run' && run.message && run.message !== lastCaption && now - lastCaptionAt > 900) {
      hud.caption.innerHTML = run.message; lastCaption = run.message; lastCaptionAt = now;
    }
  }

  // ---------- Main loop ----------
  // During a rush the shop redraws every frame. When it's calm (designing, reading the
  // debrief, nothing moving), it redraws about 15 times a second, which saves battery and
  // heat on phones; wake() asks for the next frame straight away after a change.
  let lastFrame = performance.now();
  let sinceDraw = Infinity;
  function wake() { sinceDraw = Infinity; }
  function calm(run) {
    if ((state.phase === 'run' && state.playing) || moment || reveal || roll) return false;
    if (fx.count || state.steam.length || run.pops.length) return false;
    if (Math.abs((state.xray ? 1 : 0) - state.xa) > 0.01) return false;
    return !run.customers.some(p => p.moving);
  }

  // ?fps on the page's address shows the frame rate, for checking performance on a phone.
  const fpsEl = /[?&]fps\b/.test(globalThis.location?.search || '') ? document.createElement('div') : null;
  const fpsLog = { frames: 0, worst: 0, since: 0 };
  if (fpsEl) {
    fpsEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;padding:4px 8px;border-radius:6px;background:rgb(0 0 0/0.75);color:#9fe6c4;font:600 12px monospace';
    document.body.append(fpsEl);
  }
  function countFrame(now, ms) {
    fpsLog.frames++; fpsLog.worst = Math.max(fpsLog.worst, ms);
    if (now - fpsLog.since < 500) return;
    fpsEl.textContent = `${Math.round(fpsLog.frames * 1000 / (now - fpsLog.since))} fps · slowest draw ${Math.round(fpsLog.worst)} ms`;
    fpsLog.frames = 0; fpsLog.worst = 0; fpsLog.since = now;
  }
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const run = state.run;
    if (state.phase === 'run' && state.playing && !run.finished) {
      run.t += dt * 60 * state.speed; // Keeps going after the last drink, while app customers arrive to collect.
      sample(run);
      processEvents(run, onEvent);
      if (run.rail.length) trigger('queued', { ticket: run.rail[0], at: slotSpot(0), track: ticketSpot(run.rail[0]) });
      const holder = run.baristas.find(b => b.holding);
      if (holder) trigger('hold', { b: holder, ticket: holder.ticket });
    }
    updateVisuals(run, state.phase === 'run' && !state.playing && !moment ? 0 : dt);
    placeSpot();
    tickReveal(now);
    tickRoll(now);
    if (state.phase === 'run' && !run.finished && run.events.length === 0 && run.customers.every(p => p.state === 'gone')) {
      run.finished = true; onFinished(run);
    }
    sinceDraw += now - (frame.prev ?? now);
    frame.prev = now;
    if (!calm(run) || sinceDraw >= 66) {
      sinceDraw = 0;
      const t0 = performance.now();
      render(now);
      if (fpsEl) countFrame(now, performance.now() - t0);
    }
    updateHud(now);
    requestAnimationFrame(frame);
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    state.cssWidth = box.width || W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.max(0.2, state.cssWidth / W) * dpr;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    if (fxCanvas) { fxCanvas.width = canvas.width; fxCanvas.height = canvas.height; fxDirty = true; }
    backLayer = layer(drawBack); frontLayer = layer(drawFront); shadeLayer = layer(drawShade); gridLayer = layer(drawGrid);
    wake();
  }
  new ResizeObserver(resize).observe(byId('scene'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  resize();
  setLevel(0);
  define.link(hud.served.closest?.('dl'));
  requestAnimationFrame(frame);

  return {
    /** Jump to a level, change its design, and run the rush. */
    play(levelIndex, designChanges = {}) {
      setLevel(levelIndex);
      Object.assign(state.designs[levelIndex], designChanges);
      startRush();
    },
    setXray(on) { setXray(on); },
    get xray() { return state.xray; },
    /** Level ids whose brief opened, in order (each opening counts). */
    get briefings() { return [...state.briefings]; },
    /** How many times the ticket sheet opened (phones only). */
    get sheetOpens() { return sheetOpens; },
    setSpeed(n) { state.speed = n; speedBtn.textContent = `${n}×`; },
  };
}
