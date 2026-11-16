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
 * @returns {{ play(name: string): void, muted: boolean, setMuted(on: boolean): void }}
 */
export function createSound({ enabled = true } = {}) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  let muted = readMuted();
  let ctx = null;
  let master = null;
  let noise = null;

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
  };

  return {
    play(name) {
      if (muted || !enabled) return;
      start();
      if (!ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
      SOUNDS[name](ctx.currentTime + 0.005);
    },
    get muted() { return muted; },
    setMuted(on) { muted = on; saveMuted(on); },
  };
}
