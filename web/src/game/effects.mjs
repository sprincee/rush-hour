// The effects layer: short bursts drawn on their own canvas over the shop, so the shop
// drawing itself never changes (DESIGN_RH.md, Motion). Positions are in shop coordinates
// (1000 x 560). Each effect runs on real time, not shop time, and then removes itself.

const LIFE = { served: 1.1, turnaway: 0.7, orderUp: 0.8, batch: 1.0, steam: 0.9 };
const MAX = 90;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Out-and-back overshoot for pops: 0 → 1.18 → 1.
const pop = p => (p < 0.6 ? (p / 0.6) * 1.18 : 1.18 - ((p - 0.6) / 0.4) * 0.18);
const fadeOut = (age, life, tail = 0.35) => clamp((life - age) / (life * tail), 0, 1);

export function createEffects() {
  let list = [];

  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }

  const DRAW = {
    // A green check that pops above a customer as they pick up their drink.
    served(c, e, age) {
      const life = LIFE.served;
      const a = fadeOut(age, life);
      const s = pop(clamp(age / 0.22, 0, 1));
      const y = e.y - age * 24;
      if (age < 0.45) { // A ring that spreads out once.
        c.globalAlpha = e.alpha * (1 - age / 0.45) * 0.7;
        c.strokeStyle = '#2fbf86'; c.lineWidth = 2.5;
        circle(c, e.x, e.y, 10 + age * 50); c.stroke();
      }
      c.globalAlpha = e.alpha * a;
      c.save(); c.translate(e.x, y); c.scale(s, s);
      c.fillStyle = 'rgba(16, 40, 30, 0.25)'; circle(c, 0, 2, 12); c.fill();
      c.fillStyle = '#2fbf86'; circle(c, 0, 0, 12); c.fill();
      c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-5, 0); c.lineTo(-1.5, 4); c.lineTo(5.5, -4); c.stroke();
      c.restore();
    },
    // A red shock ring and a few scuffs where a customer was turned away.
    turnaway(c, e, age) {
      const p = age / LIFE.turnaway;
      c.globalAlpha = e.alpha * (1 - p) * 0.85;
      c.strokeStyle = '#ef5b55'; c.lineWidth = 3 * (1 - p) + 1;
      circle(c, e.x, e.y, 12 + p * 34); c.stroke();
      c.fillStyle = 'rgba(120, 90, 70, 0.5)';
      for (let k = 0; k < 3; k++) {
        const ang = Math.PI * (0.15 + k * 0.35);
        circle(c, e.x + Math.cos(ang) * (8 + p * 26) * (k % 2 ? 1 : -1), e.y + 46 - p * 6, 4 + p * 5); c.fill();
      }
    },
    // The ORDER UP sign flashes, with a few short rays.
    orderUp(c, e, age) {
      const p = age / LIFE.orderUp;
      c.globalAlpha = e.alpha * (1 - p);
      c.fillStyle = 'rgba(255, 226, 140, 0.55)';
      c.beginPath(); c.roundRect?.(828, 230, 84, 28, 6); c.fill();
      c.strokeStyle = '#ffd36b'; c.lineWidth = 2.5; c.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        const ang = -Math.PI + (k / 5) * Math.PI;
        const r0 = 30 + p * 10, r1 = 38 + p * 22;
        c.beginPath();
        c.moveTo(870 + Math.cos(ang) * r0 * 1.4, 244 + Math.sin(ang) * r0 * 0.7);
        c.lineTo(870 + Math.cos(ang) * r1 * 1.4, 244 + Math.sin(ang) * r1 * 0.7);
        c.stroke();
      }
    },
    // "×2" rises from the bar when one pitcher made two lattes.
    batch(c, e, age) {
      const a = fadeOut(age, LIFE.batch, 0.4);
      const s = pop(clamp(age / 0.25, 0, 1));
      c.globalAlpha = e.alpha * a;
      c.save(); c.translate(e.x, e.y - age * 30); c.scale(s, s);
      c.font = "800 22px 'Bricolage Grotesque', sans-serif"; c.textAlign = 'center';
      c.lineWidth = 5; c.strokeStyle = 'rgba(40, 20, 8, 0.75)'; c.strokeText('×2', 0, 0);
      c.fillStyle = '#ffd36b'; c.fillText('×2', 0, 0);
      c.restore();
    },
    // A puff of steam from the wand as a drink finishes.
    steam(c, e, age) {
      const p = age / LIFE.steam;
      for (let k = 0; k < 5; k++) {
        const dx = (k - 2) * 7 + Math.sin(k * 2.1 + age * 4) * 4;
        const r = 7 + p * 16 + k;
        const g = c.createRadialGradient(e.x + dx, e.y - p * 46 - k * 3, 0, e.x + dx, e.y - p * 46 - k * 3, r);
        g.addColorStop(0, `rgba(255, 255, 255, ${0.5 * (1 - p)})`); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        c.globalAlpha = e.alpha;
        c.fillStyle = g; circle(c, e.x + dx, e.y - p * 46 - k * 3, r); c.fill();
      }
    },
  };

  return {
    /** Add a burst at shop position (x, y). */
    add(kind, x, y) {
      if (!DRAW[kind]) return;
      list.push({ kind, x, y, born: null, alpha: 1 });
      if (list.length > MAX) list.shift();
    },
    clear() { list = []; },
    get count() { return list.length; },
    /** Draw every live effect at `alpha` (they fade out under the X-ray), and drop finished ones. */
    draw(c, now, alpha = 1) {
      list = list.filter(e => {
        e.born ??= now;
        const age = (now - e.born) / 1000;
        if (age > LIFE[e.kind]) return false;
        if (alpha > 0.01) {
          e.alpha = alpha;
          c.save();
          DRAW[e.kind](c, e, age);
          c.restore();
        }
        return true;
      });
    },
  };
}
