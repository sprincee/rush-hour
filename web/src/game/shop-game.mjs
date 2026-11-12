// The shop game: design a system, run the rush, and X-ray the shop to see the system behind it.
// Lesson-specific levels, goals and debrief text come from a lesson module (web/src/lessons/).
// The simulation itself is the tested engine in ../engine.mjs.
import { createRun, processEvents, sample, completeRun, summarize, POLICIES } from '../engine.mjs';
import { menuById } from '../arrivals.mjs';

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
  function onEvent(kind, c, extra) {
    const run = state.run;
    const t = run.t;
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
      c.via = { ...DOOR_LANE };
      const full = extra === 'full';
      run.pops.push({ text: full ? '503 Queue full' : '503 No worker free', x: c.x, y: c.y - 74, color: COLORS.rejected, born: performance.now() });
      run.message = full
        ? `${clock(t)}  Customer ${c.id} was turned away: the rail is full. <b>→ 503: the queue is at its limit.</b>`
        : `${clock(t)}  Customer ${c.id} walked out: both baristas were busy. <b>→ 503: no free worker and no queue.</b>`;
    } else if (kind === 'done') {
      c.via = null;
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
  let scale = 1, backLayer = null, frontLayer = null, shadeLayer = null;

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

  function drawShade(c) {
    const v = c.createRadialGradient(500, 300, 260, 500, 300, 720);
    v.addColorStop(0, 'rgba(28, 14, 4, 0)'); v.addColorStop(1, 'rgba(28, 14, 4, 0.34)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }

  function drawStaff(c, x, now, busy, progress, skin, hair, ring = '#e0a85c') {
    const sway = busy && !REDUCED ? Math.sin(now / 150 + x) * 2.2 : 0;
    c.fillStyle = 'rgba(0, 0, 0, 0.10)'; ellipse(c, x, 292, 30, 6); c.fill();
    c.fillStyle = lg(c, x - 22, 0, x + 22, 0, [[0, '#ddd6cc'], [0.5, '#f4f0ea'], [1, '#d6cfc4']]); rr(c, x - 22, 232, 44, 72, 15); c.fill();
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
    c.fillStyle = 'rgba(7, 13, 22, 0.84)'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(120, 170, 230, 0.08)'; c.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); c.stroke(); }
    for (let y = 0; y <= H; y += 40) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }

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
    state.steam.forEach(s => {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, `rgba(255, 255, 255, ${0.34 * s.life})`); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g; circle(ctx, s.x, s.y, s.r); ctx.fill();
    });
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
    run.customers.filter(p => !offstage(run, p)).sort((a, b) => a.y - b.y).forEach(p => drawCustomer(ctx, p, now));
    if (shadeLayer) ctx.drawImage(shadeLayer, 0, 0, W, H);
    if (state.xa > 0.01) drawXray(ctx, run, now, state.xa);
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

  // ---------- Chart ----------
  const chartEl = byId('chart');
  const CH = { L: 46, R: 500, T: 18, B: 240, yMax: 50 };
  let xMax = 60;
  const sx = v => CH.L + (v / xMax) * (CH.R - CH.L);
  const sy = v => CH.B - (Math.min(v, CH.yMax) / CH.yMax) * (CH.B - CH.T);

  function valueAt(series, m) {
    let best = null;
    for (const p of series) { if (p[0] <= m + 0.001) best = p; else break; }
    return best;
  }

  function renderChart() {
    const run = state.run;
    const d = run.design;
    let s = '';
    for (let v = 0; v <= CH.yMax; v += 10) {
      s += `<line class="grid" x1="${CH.L}" x2="${CH.R}" y1="${sy(v)}" y2="${sy(v)}"/>`;
      s += `<text class="tick" x="${CH.L - 8}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
    }
    const step = xMax > 90 ? 30 : 15;
    for (let v = 0; v <= xMax; v += step) s += `<text class="tick" x="${sx(v)}" y="${CH.B + 18}" text-anchor="middle">${v}</text>`;
    s += `<text class="axis" x="${(CH.L + CH.R) / 2}" y="${CH.B + 38}" text-anchor="middle">Shop minutes after 8:05</text>`;
    if (d.rail && Number.isFinite(d.capacity)) {
      s += `<line class="lim" x1="${CH.L}" x2="${CH.R}" y1="${sy(d.capacity)}" y2="${sy(d.capacity)}"/>`;
      s += `<text class="lbl" x="${CH.R + 8}" y="${sy(d.capacity) + 4}">Limit ${d.capacity}</text>`;
    }
    const series = run.series.filter(p => p[0] <= xMax);
    if (!run.idle && series.length > 1) {
      s += `<polyline class="s1" points="${series.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}"/>`;
      const end = series[series.length - 1];
      s += `<text class="lbl" x="${Math.min(sx(end[0]) + 8, CH.R + 6)}" y="${sy(end[1]) - 8}">${run.hasApp ? 'Walk-in rail' : 'This rush'}</text>`;
      if (run.hasApp) {
        s += `<polyline class="s2" points="${series.map(p => `${sx(p[0]).toFixed(1)},${sy(p[2]).toFixed(1)}`).join(' ')}"/>`;
        const peak = series.reduce((best, p) => (p[2] > best[2] ? p : best), series[0]);
        s += `<text class="lbl" x="${Math.min(sx(peak[0]) + 8, CH.R - 40)}" y="${sy(peak[2]) - 8}">App rail</text>`;
      }
    }
    if (!d.rail && !run.idle && run.t > 0) {
      s += `<text class="ann" x="${(CH.L + CH.R) / 2}" y="${sy(30)}" text-anchor="middle">No queue, so the depth stays at zero.</text>`;
      s += `<text class="ann" x="${(CH.L + CH.R) / 2}" y="${sy(30) + 18}" text-anchor="middle">Extra requests are rejected instead.</text>`;
    } else if (run.idle) {
      s += `<text class="ann" x="${(CH.L + CH.R) / 2}" y="${sy(28)}" text-anchor="middle">Run the rush to draw the queue.</text>`;
    }
    if (state.hover !== null && !run.idle) {
      const m = state.hover;
      const a = valueAt(series, m);
      s += `<line class="hover" x1="${sx(m)}" x2="${sx(m)}" y1="${CH.T}" y2="${CH.B}"/>`;
      const lines = [`${Math.round(m)} min (${clock(m * 60)})`];
      if (a) lines.push(run.hasApp ? `${a[1]} walk-in, ${a[2]} app waiting` : `${a[1]} waiting in the queue`);
      const bw = 190, bh = 14 + lines.length * 17;
      const bx = sx(m) + 12 + bw > 596 ? sx(m) - 12 - bw : sx(m) + 12;
      s += `<rect class="tip" x="${bx}" y="${CH.T + 4}" width="${bw}" height="${bh}" rx="8"/>`;
      lines.forEach((ln, i) => { s += `<text class="tiptext" x="${bx + 10}" y="${CH.T + 22 + i * 17}">${ln}</text>`; });
    }
    chartEl.innerHTML = s;
    byId('legend').innerHTML =
      (run.hasApp
        ? `<span><i class="sw" aria-hidden="true"></i>Walk-in rail</span><span><i class="sw app" aria-hidden="true"></i>App rail</span>`
        : `<span><i class="sw" aria-hidden="true"></i>Queue depth this rush</span>`) +
      (d.rail && Number.isFinite(d.capacity) ? `<span><i class="sw limit" aria-hidden="true"></i>Rail limit</span>` : '');
  }
  chartEl.addEventListener('pointermove', ev => {
    const box = chartEl.getBoundingClientRect();
    const x = ((ev.clientX - box.left) / box.width) * 600;
    state.hover = x < CH.L || x > CH.R ? null : clamp(((x - CH.L) / (CH.R - CH.L)) * xMax, 0, xMax);
    renderChart();
  });
  chartEl.addEventListener('pointerleave', () => { state.hover = null; renderChart(); });

  // ---------- Panels ----------
  const panel = byId('panel');

  function renderLevels() {
    byId('levels').innerHTML = LEVELS.map((l, i) =>
      `<li><button type="button" data-level="${i}" ${i === state.level ? 'aria-current="true"' : ''} ${i > state.unlocked ? 'disabled' : ''}>` +
      `<span class="n"><span>LEVEL ${l.id}</span><span>${state.passed[i] ? 'PASSED ✓' : i > state.unlocked ? 'LOCKED' : ''}</span></span>` +
      `<span class="t">${l.name}</span></button></li>`).join('');
  }

  function renderPhase() {
    const ph = state.phase === 'design' ? 1 : state.phase === 'run' ? 2 : 3;
    byId('phase').innerHTML = ['Brief', 'Design', 'Run', 'Debrief']
      .map((n, i) => `<span class="${i === ph || (i === 0 && ph === 1) ? 'on' : ''}">${n}</span>`).join('');
    byId('pause').hidden = state.phase !== 'run';
    byId('pause').textContent = state.playing ? 'Pause' : 'Resume';
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

  function baristaPart(lv, d) {
    if (lv.controls && !lv.controls.includes('baristas')) return `
        <div class="part">
          <div><span class="name">Baristas</span><span class="sys">Workers</span></div>
          <strong>${d.baristas}, fixed</strong>
          <p class="desc">Today's crew is set. $${COST.barista} each for the rush.</p>
        </div>`;
    return `
        <div class="part">
          <div><span class="name">Baristas</span><span class="sys">Workers</span></div>
          <div class="stepper">
            <button type="button" data-act="minus" aria-label="Remove a barista" ${d.baristas <= 1 ? 'disabled' : ''}>−</button>
            <output aria-live="polite">${d.baristas}</output>
            <button type="button" data-act="plus" aria-label="Add a barista" ${d.baristas >= 4 ? 'disabled' : ''}>+</button>
          </div>
          <p class="desc">Each barista makes one drink at a time. $${COST.barista} each for the rush.</p>
        </div>`;
  }

  // For levels that list their controls, like lesson 4.
  function controlParts(lv, d) {
    const minutes = d.batchWait / 60;
    let html = lv.policies ? policyParts(lv, d) : `
        <div class="part">
          <div><span class="name">Ticket rail</span><span class="sys">Queue</span></div>
          <strong>Included</strong>
          <p class="desc">Tickets wait here until a barista is free. $${COST.rail}.</p>
        </div>`;
    if (lv.controls.includes('async')) html += `
        <div class="part">
          <div><span class="name">Call names</span><span class="sys">Asynchronous</span></div>
          <button type="button" class="switch" data-act="async" aria-pressed="${!d.sync}">${d.sync ? 'Off' : 'On'}</button>
          <p class="desc">${d.sync
            ? 'Off: the cashier waits at the bar until each drink is made, then takes the next order.'
            : 'On: the cashier prints a ticket, says "we\'ll call your name", and takes the next order right away.'}</p>
        </div>`;
    if (lv.controls.includes('batch')) html += `
        <div class="part">
          <div><span class="name">Batch the milk</span><span class="sys">Batching</span></div>
          <button type="button" class="switch" data-act="batch" aria-pressed="${d.batch}">${d.batch ? 'On' : 'Off'}</button>
          <p class="desc">When another latte is waiting, steam for both at once. Two lattes take 1.25 times as long as one. Cappuccinos can't share a pitcher.</p>
        </div>`;
    if (lv.controls.includes('batchWait')) html += `
        <div class="part">
          <div><span class="name">Wait for a second latte</span><span class="sys">Batch window</span></div>
          <div class="stepper">
            <button type="button" data-act="wait-minus" aria-label="Wait one minute less" ${minutes <= 0 ? 'disabled' : ''}>−</button>
            <output aria-live="polite">${minutes === 0 ? "Don't wait" : `${minutes} min`}</output>
            <button type="button" data-act="wait-plus" aria-label="Wait one minute more" ${minutes >= 6 ? 'disabled' : ''}>+</button>
          </div>
          <p class="desc">A barista with one latte holds it this long, hoping a second latte arrives to share the pitcher. Batching is on.</p>
        </div>`;
    return html;
  }

  function railParts(lv, d) {
    return `
        <div class="part">
          <div><span class="name">Ticket rail</span><span class="sys">Queue</span></div>
          <button type="button" class="switch" data-act="rail" aria-pressed="${d.rail}">${d.rail ? 'On' : 'Off'}</button>
          <p class="desc">Tickets wait here until a barista is free, so the cashier can keep taking orders. $${COST.rail}.</p>
        </div>
        <div class="part ${lv.capacityUnlocked && d.rail ? '' : 'locked'}">
          <div><span class="name">Rail size</span><span class="sys">Queue limit</span></div>
          <strong>${lv.capacityUnlocked && d.rail ? `${d.capacity} tickets` : 'No limit'}</strong>
          ${lv.capacityUnlocked && d.rail
            ? `<input type="range" id="capacity" min="5" max="50" step="1" value="${d.capacity}" aria-label="Rail size in tickets">
               <p class="desc">When the rail is full, the cashier turns new customers away.</p>`
            : `<p class="desc">${lv.capacityUnlocked ? 'Turn the rail on to set its size.' : 'Unlocks in level 2.3.'}</p>`}
        </div>
`;
  }

  function policyParts(lv, d) {
    const options = lv.policies.map(p => `
            <label class="choice"><input type="radio" name="policy" value="${p}" ${d.policy === p ? 'checked' : ''}>
              <span><strong>${POLICIES[p]}</strong><span class="desc">${POLICY_HELP[p]}</span></span></label>`).join('');
    return `
        <div class="part">
          <div><span class="name">Two ticket rails</span><span class="sys">Two queues</span></div>
          <strong>Included</strong>
          <p class="desc">Walk-in tickets print at the register. App orders print on their own printer and skip the register. $${COST.rail}.</p>
        </div>
        <div class="part">
          <div><span class="name">How baristas pick the next ticket</span><span class="sys">Scheduling policy</span></div>
          <div class="choices" role="radiogroup" aria-label="How baristas pick the next ticket">${options}</div>
          ${d.policy === 'weighted'
            ? `<div class="every">
                 <span class="desc">Every</span>
                 <div class="stepper">
                   <button type="button" data-act="every-minus" aria-label="App drinks more often" ${d.mobileEvery <= 2 ? 'disabled' : ''}>−</button>
                   <output aria-live="polite">${ordinal(d.mobileEvery)}</output>
                   <button type="button" data-act="every-plus" aria-label="App drinks less often" ${d.mobileEvery >= 6 ? 'disabled' : ''}>+</button>
                 </div>
                 <span class="desc">drink comes from the app rail</span>
               </div>`
            : ''}
        </div>
`;
  }

  function renderDesign() {
    const lv = LEVELS[state.level];
    const d = state.designs[state.level];
    const cost = designCost(d);
    const over = cost > lv.budget;
    panel.innerHTML = `
      <div class="ticket-head"><span>LEVEL ${lv.id} · BRIEF</span><span>BUDGET $${lv.budget}</span></div>
      <h2>${lv.name}</h2>
      <p class="quiet">${lv.brief}</p>
      <h3>Goals</h3>
      ${goalsHTML(lv, null)}
      <h3>Design your shop</h3>
      <div class="build">
        ${baristaPart(lv, d)}
        ${lv.controls ? controlParts(lv, d) : lv.policies ? policyParts(lv, d) : railParts(lv, d)}
        <div class="lockrow">
          ${LOCKED.map(l => `<div class="part locked"><div><span class="name">${l.name}</span><span class="sys">${l.sys} · ${l.lesson}</span></div></div>`).join('')}
        </div>
      </div>
      <div class="budget">
        <div class="row"><span>Cost of your design</span><span>$${cost} of $${lv.budget}</span></div>
        <div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, (cost / lv.budget) * 100)}%"></i></div>
        ${over ? `<p class="note" style="color:var(--bad);margin:0">Over budget. Remove something to run the rush.</p>` : ''}
      </div>
      <div class="actions">
        <button type="button" class="btn" data-act="run" ${over ? 'disabled' : ''}>Run the rush</button>
        <span class="note">The X-ray shows the system you're building.</span>
      </div>`;
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

  function renderDebrief() {
    const lv = LEVELS[state.level];
    const d = state.designs[state.level];
    const s = state.summary;
    const ok = lv.goals.every(g => g.ok(s));
    s.ok = ok;
    panel.innerHTML = `
      <div class="ticket-head"><span>LEVEL ${lv.id} · DEBRIEF</span><span>CLOSED ${clock(state.run.lastEventT)}</span></div>
      <p class="verdict ${ok ? 'ok' : 'no'}">${ok ? 'Goals met' : 'Not yet'}</p>
      ${goalsHTML(lv, s)}
      <p class="note">Goals marked SLO are <strong>service level objectives</strong>: targets a system promises to meet. Real teams track them on dashboards like the one behind this game.</p>
      <h3 class="receipt-title">Your shift</h3>
      ${factsHTML(s, d)}
      <div class="receipt-total"><span>TOTAL</span><span>${ok ? 'ALL GOALS MET' : `${lv.goals.filter(g => !g.ok(s)).length} GOAL${lv.goals.filter(g => !g.ok(s)).length > 1 ? 'S' : ''} MISSED`}</span></div>
      <h3>What happened</h3>
      <p>${lv.explain(d, s)}</p>
      <div class="concept">
        <div class="label">System design concept</div>
        <h3>${lv.concept.term}</h3>
        <p>${lv.concept.body}</p>
        <p class="quiet">${lv.concept.real}</p>
      </div>
      <div class="actions">
        ${ok && state.level < LEVELS.length - 1 ? `<button type="button" class="btn" data-act="next">Next level</button>` : ''}
        <button type="button" class="btn ${ok && state.level < LEVELS.length - 1 ? 'line' : ''}" data-act="change">Change your design</button>
        <button type="button" class="btn line" data-act="replay">Watch it again</button>
      </div>
      ${ok && state.level === LEVELS.length - 1
        ? (next
          ? `<p class="next-lesson">That's every level in this lesson. <a class="btn" href="${next.href}">Next lesson: ${next.title}</a></p>`
          : '<p class="note">That\'s every level in this lesson. More lessons are on the way.</p>')
        : ''}`;
  }

  function renderRunning() {
    const lv = LEVELS[state.level];
    panel.innerHTML = `
      <div class="ticket-head"><span>LEVEL ${lv.id} · RUSH</span><span>DESIGN LOCKED</span></div>
      <h2>The rush is on</h2>
      ${goalsHTML(lv, null)}
      <p class="quiet">Your design is locked in, just like a real system once traffic arrives. Press the <strong>X-ray monitor</strong> on the shop to see the system behind it.</p>
      <p class="note">The caption under the shop tells you what each event means in software terms.</p>`;
  }

  // The panel can sit in a collapsible <details> (the side ticket). Reopen it when a
  // new brief or the debrief arrives, so a player who folded it away still sees it.
  const panelHolder = panel.closest?.('details') ?? null;
  let shownPhase = null;

  function renderPanel() {
    if (state.phase === 'design') renderDesign();
    else if (state.phase === 'run') renderRunning();
    else renderDebrief();
    renderPhase();
    if (panelHolder && state.phase !== shownPhase && state.phase !== 'run') panelHolder.open = true;
    shownPhase = state.phase;
  }

  panel.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b || b.disabled) return;
    const d = state.designs[state.level];
    const act = b.dataset.act;
    if (act === 'minus') { d.baristas = Math.max(1, d.baristas - 1); designChanged(); }
    else if (act === 'plus') { d.baristas = Math.min(4, d.baristas + 1); designChanged(); }
    else if (act === 'rail') { d.rail = !d.rail; designChanged(); }
    else if (act === 'batch') { d.batch = !d.batch; designChanged(); }
    else if (act === 'async') { d.sync = !d.sync; designChanged(); }
    else if (act === 'wait-minus') { d.batchWait = Math.max(0, d.batchWait - 60); designChanged(); }
    else if (act === 'wait-plus') { d.batchWait = Math.min(360, d.batchWait + 60); designChanged(); }
    else if (act === 'every-minus') { d.mobileEvery = Math.max(2, d.mobileEvery - 1); designChanged(); }
    else if (act === 'every-plus') { d.mobileEvery = Math.min(6, d.mobileEvery + 1); designChanged(); }
    else if (act === 'run') startRush();
    else if (act === 'change') { state.phase = 'design'; state.playing = false; state.run = idleRun(); setXray(true); renderPanel(); renderChart(); }
    else if (act === 'next') setLevel(state.level + 1);
    else if (act === 'replay') startRush();
  });
  panel.addEventListener('change', ev => {
    if (ev.target.name !== 'policy') return;
    state.designs[state.level].policy = ev.target.value;
    designChanged();
  });
  panel.addEventListener('input', ev => {
    if (ev.target.id !== 'capacity') return;
    state.designs[state.level].capacity = Number(ev.target.value);
    state.run = idleRun();
    const strong = ev.target.closest('.part').querySelector('strong');
    if (strong) strong.textContent = `${ev.target.value} tickets`;
    renderChart();
  });
  byId('levels').addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (b && !b.disabled) setLevel(Number(b.dataset.level));
  });

  function designChanged() {
    const lv = LEVELS[state.level];
    const d = state.designs[state.level];
    if (lv.capacityUnlocked && d.rail && !Number.isFinite(d.capacity)) d.capacity = 30;
    if (!lv.capacityUnlocked) d.capacity = Infinity;
    state.run = idleRun();
    renderPanel(); renderChart();
  }

  function setLevel(i) {
    state.level = i;
    state.unlocked = Math.max(state.unlocked, i);
    state.phase = 'design'; state.playing = false;
    state.run = idleRun();
    state.summary = null;
    setXray(true);
    state.message = '';
    hud.caption.innerHTML = 'Design your shop below. The X-ray shows the system you are building.';
    renderLevels(); renderPanel(); renderChart();
  }

  function startRush() {
    const d = state.designs[state.level];
    const preview = summarize(completeRun(d, { config, rush: LEVELS[state.level].rush }));
    xMax = Math.max(60, Math.ceil(preview.endMin / 15) * 15);
    state.run = makeRun(d);
    state.steam = [];
    state.phase = 'run'; state.playing = true;
    if (!state.xrayUsed) setXray(false);
    lastCaption = '';
    hud.caption.innerHTML = 'The doors are open. Customers are walking in.';
    renderPanel(); renderChart();
  }

  function onFinished(run) {
    state.playing = false;
    state.summary = summarize(run);
    const lv = LEVELS[state.level];
    const ok = lv.goals.every(g => g.ok(state.summary));
    if (ok) {
      state.passed[state.level] = true;
      state.unlocked = Math.max(state.unlocked, Math.min(state.level + 1, LEVELS.length - 1));
    }
    state.phase = 'debrief';
    hud.caption.innerHTML = `${clock(run.lastEventT)}  Rush over. ${run.served} served, ${run.rejected} turned away.`;
    canvas.setAttribute('aria-label', `Coffee shop after the rush: ${run.served} served, ${run.rejected} turned away.`);
    renderLevels(); renderPanel(); renderChart();
    if (onFinish) onFinish(state.summary);
  }

  // ---------- Controls ----------
  const xrayBtn = byId('xrayBtn');
  function setXray(on) {
    state.xray = on;
    xrayBtn.setAttribute('aria-pressed', String(on));
    xrayBtn.setAttribute('aria-label', on ? 'Showing the X-ray. Switch back to the counter' : 'Showing the counter. Open the X-ray');
    byId('key').classList.toggle('show', on);
    xrayBtn.classList.toggle('nudge', !on && state.phase === 'run' && !state.xrayUsed);
  }
  xrayBtn.addEventListener('click', () => { state.xrayUsed = true; setXray(!state.xray); });
  document.addEventListener('keydown', ev => {
    if ((ev.key === 'x' || ev.key === 'X') && !ev.target.closest('input, textarea')) { state.xrayUsed = true; setXray(!state.xray); }
  });
  byId('pause').addEventListener('click', () => { state.playing = !state.playing; renderPhase(); });
  document.querySelectorAll('input[name="speed"]').forEach(r => r.addEventListener('change', () => { state.speed = Number(r.value); }));

  const hud = {
    clock: byId('clock'), served: byId('st-served'),
    rejected: byId('st-rejected'), wait: byId('st-wait'),
    queue: byId('st-queue'), caption: byId('caption'),
  };
  let lastHud = 0, lastChart = 0, lastCaptionAt = 0, lastCaption = '';
  function updateHud(now) {
    const run = state.run;
    if (now - lastHud > 90) {
      lastHud = now;
      hud.clock.textContent = clock(run.t);
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
    if (state.playing && now - lastChart > 160) { lastChart = now; renderChart(); }
  }

  // ---------- Main loop ----------
  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const run = state.run;
    if (state.phase === 'run' && state.playing && !run.finished) {
      run.t += dt * 60 * state.speed; // Keeps going after the last drink, while app customers arrive to collect.
      sample(run);
      processEvents(run, onEvent);
    }
    updateVisuals(run, state.phase === 'run' && !state.playing ? 0 : dt);
    if (state.phase === 'run' && !run.finished && run.events.length === 0 && run.customers.every(p => p.state === 'gone')) {
      run.finished = true; onFinished(run);
    }
    render(now);
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
    backLayer = layer(drawBack); frontLayer = layer(drawFront); shadeLayer = layer(drawShade);
  }
  new ResizeObserver(resize).observe(byId('scene'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  resize();
  setLevel(0);
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
    setSpeed(n) { state.speed = n; },
  };
}
