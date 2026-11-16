// Game sounds, made in the browser with Web Audio: no audio files, nothing to license.
// Placeholders for testing; recorded sounds can replace them later behind the same names.
// Browsers only allow audio after the player interacts, so the audio context starts on
// the first click or key press. Mute is remembered per browser.

const MUTE_KEY = 'rush-hour:muted';

function readMuted() {
  try { return globalThis.localStorage?.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function saveMuted(on) {
  try { globalThis.localStorage?.setItem(MUTE_KEY, on ? '1' : '0'); } catch { /* Private mode: just don't remember. */ }
}

/**
 * @param {{ enabled?: boolean }} options  enabled: false makes every call a no-op (the homepage demo).
 * @returns {{ play(name: string, n?: number): void, ambient(hiss: number, crowd: number): void,
 *   muted: boolean, setMuted(on: boolean): void }}
 */
export function createSound({ enabled = true } = {}) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  let muted = readMuted();
  let ctx = null;
  let master = null;
  let noise = null;
  let amb = null; // The two background loops, built on first use.
  const lastAt = {}; // For sounds that can fire many times a second.

  function start() {
    if (ctx || !Ctx || !enabled) return;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    // One second of white noise, reused for the printer, the stamp, and steam.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (enabled && Ctx && globalThis.document?.addEventListener) {
    const unlock = () => { start(); if (ctx?.state === 'suspended') ctx.resume(); };
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
  }

  // A tone that starts at `freq`, optionally slides to `to`, and fades out over `len` seconds.
  function tone(at, { freq, to = freq, len = 0.15, type = 'sine', vol = 1 }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, at + len * 0.8);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + len + 0.02);
  }

  // A burst of filtered noise: clicks, thumps, hiss.
  function hiss(at, { len = 0.05, freq = 3000, q = 1, type = 'bandpass', vol = 1 }) {
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = noise;
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(filter).connect(gain).connect(master);
    src.start(at, Math.random() * 0.5);
    src.stop(at + len + 0.02);
  }

  const SOUNDS = {
    // The receipt printer: three quick mechanical ticks.
    print(t) { for (let i = 0; i < 3; i++) hiss(t + i * 0.035, { len: 0.025, freq: 4200, q: 4, vol: 0.5 }); },
    // A goal met: a short rising blip.
    good(t) { tone(t, { freq: 880, to: 1320, len: 0.12, vol: 0.35 }); },
    // A goal missed: a short falling buzz.
    bad(t) { tone(t, { freq: 240, to: 150, len: 0.16, type: 'square', vol: 0.12 }); },
    // The rubber stamp: a thump, then the "order up" bell when the goals are met.
    stamp(t) {
      hiss(t, { len: 0.09, freq: 500, type: 'lowpass', vol: 0.9 });
      tone(t, { freq: 110, to: 55, len: 0.14, vol: 0.6 });
      tone(t + 0.09, { freq: 1318, len: 0.9, vol: 0.28 });
      tone(t + 0.09, { freq: 1976, len: 0.7, vol: 0.14 });
    },
    // The stamp for a miss: the same thump, then a low, soft "not yet".
    stampMiss(t) {
      hiss(t, { len: 0.09, freq: 500, type: 'lowpass', vol: 0.9 });
      tone(t, { freq: 110, to: 55, len: 0.14, vol: 0.6 });
      tone(t + 0.1, { freq: 330, to: 262, len: 0.35, type: 'triangle', vol: 0.2 });
    },
    // A goal at risk: a soft, quick double blip. A warning, not an alarm.
    warn(t) { tone(t, { freq: 660, len: 0.09, type: 'triangle', vol: 0.22 }); tone(t + 0.12, { freq: 660, len: 0.09, type: 'triangle', vol: 0.22 }); },
    // A freeze frame: a soft two-note chime, like a "ding" at the counter.
    moment(t) { tone(t, { freq: 988, len: 0.25, vol: 0.22 }); tone(t + 0.11, { freq: 1480, len: 0.45, vol: 0.18 }); },
    // UI ticks for steppers and switches.
    tick(t) { hiss(t, { len: 0.02, freq: 2500, q: 2, vol: 0.4 }); },

    // ---- The shop, during the rush ----
    // A drink is up: a small counter bell. Pitch wanders a little so a run of them isn't a drone.
    orderUp(t) {
      const f = 1568 * (1 + (Math.random() - 0.5) * 0.06);
      tone(t, { freq: f, len: 0.45, vol: 0.09 });
      tone(t, { freq: f * 1.5, len: 0.3, vol: 0.04 });
    },
    // Two lattes from one pitcher: the bell twice.
    batchUp(t) { SOUNDS.orderUp(t); SOUNDS.orderUp(t + 0.09); },
    // A customer turned away: a soft, low bump.
    turnAway(t) { tone(t, { freq: 196, to: 131, len: 0.18, type: 'triangle', vol: 0.16 }); },
    // A ticket prints: one very quiet tick.
    ticket(t) { hiss(t, { len: 0.018, freq: 4600, q: 5, vol: 0.16 }); },

    // ---- Input ----
    // Run the rush: the register drawer, then a bright "ka-ching".
    run(t) {
      hiss(t, { len: 0.07, freq: 1800, q: 1.5, vol: 0.5 });
      tone(t + 0.06, { freq: 2637, len: 0.5, vol: 0.1 });
      tone(t + 0.06, { freq: 3951, len: 0.35, vol: 0.05 });
      tone(t + 0.13, { freq: 3136, len: 0.6, vol: 0.09 });
    },
    // The X-ray flips on: an old monitor warming up. Off: the same, falling.
    xray(t) { tone(t, { freq: 140, to: 1400, len: 0.16, type: 'sawtooth', vol: 0.035 }); hiss(t, { len: 0.12, freq: 7000, type: 'highpass', vol: 0.18 }); },
    xrayOff(t) { tone(t, { freq: 1400, to: 160, len: 0.14, type: 'sawtooth', vol: 0.03 }); hiss(t, { len: 0.06, freq: 7000, type: 'highpass', vol: 0.12 }); },
    // A level ticket prints in: the printer, then a rising blip.
    unlock(t) { SOUNDS.print(t); tone(t + 0.14, { freq: 660, to: 1320, len: 0.22, vol: 0.2 }); },
    // Stars: a chime that climbs with each star. A missed star is a dull tap.
    star(t, n = 0) {
      const f = [1047, 1319, 1568][n] || 1047;
      tone(t, { freq: f, len: 0.5, vol: 0.2 });
      tone(t, { freq: f * 2, len: 0.25, vol: 0.06 });
    },
    starMiss(t) { hiss(t, { len: 0.05, freq: 900, q: 1, vol: 0.35 }); },
  };
  // Least time between two plays, in seconds, for sounds that can pile up.
  const SPACING = { orderUp: 0.16, batchUp: 0.2, turnAway: 0.3, ticket: 0.12 };

  // Two quiet loops under the rush: steam hiss from the bar, and a crowd murmur that
  // swells as the shop fills. Both are filtered noise; the murmur wobbles like voices.
  function buildAmbient() {
    const loop = () => { const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true; return src; };
    const hissSrc = loop();
    const hissBand = ctx.createBiquadFilter(); hissBand.type = 'bandpass'; hissBand.frequency.value = 5200; hissBand.Q.value = 0.7;
    const hissGain = ctx.createGain(); hissGain.gain.value = 0;
    hissSrc.connect(hissBand).connect(hissGain).connect(master);

    const crowdSrc = loop();
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 900;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 420; band.Q.value = 0.6;
    const wobble = ctx.createGain(); wobble.gain.value = 0.6;
    const crowdGain = ctx.createGain(); crowdGain.gain.value = 0;
    // Two slow, uneven wobbles on the volume make it sound like talking, not wind.
    for (const [rate, depth] of [[3.1, 0.25], [5.3, 0.15]]) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
      const amount = ctx.createGain(); amount.gain.value = depth;
      lfo.connect(amount).connect(wobble.gain); lfo.start();
    }
    crowdSrc.connect(low).connect(band).connect(wobble).connect(crowdGain).connect(master);
    hissSrc.start(); crowdSrc.start(0, 0.37);
    return { hiss: hissGain.gain, crowd: crowdGain.gain };
  }

  return {
    play(name, n) {
      if (muted || !enabled) return;
      start();
      if (!ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
      const now = ctx.currentTime;
      if (SPACING[name] && now - (lastAt[name] ?? -1) < SPACING[name]) return;
      lastAt[name] = now;
      SOUNDS[name](now + 0.005, n);
    },
    /** Set the background loops, each 0 (silent) to 1. Call with zeros to stop them. */
    ambient(hissLevel, crowdLevel) {
      if (!enabled || !ctx || ctx.state !== 'running') return;
      if (!amb) { if (!(hissLevel || crowdLevel)) return; amb = buildAmbient(); }
      const off = muted ? 0 : 1;
      amb.hiss.setTargetAtTime(off * 0.05 * Math.max(0, Math.min(1, hissLevel)), ctx.currentTime, 0.25);
      amb.crowd.setTargetAtTime(off * 0.11 * Math.max(0, Math.min(1, crowdLevel)), ctx.currentTime, 0.4);
    },
    get muted() { return muted; },
    setMuted(on) { muted = on; saveMuted(on); },
  };
}
