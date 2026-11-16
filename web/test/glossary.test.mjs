// Tap-to-define: which words get linked, and the effects layer and ambient sound never
// breaking the game without a real page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, splitTerms, term } from '../src/lessons/glossary.mjs';
import { setUpDefine } from '../src/game/define.mjs';
import { createEffects } from '../src/game/effects.mjs';
import { createSound } from '../src/game/sound.mjs';

const linked = text => splitTerms(text).filter(p => p.key).map(p => p.key);

test('every glossary term matches its own title, and has a definition', () => {
  for (const t of TERMS) {
    assert.deepEqual(linked(t.title), [t.key], t.title);
    assert.ok(t.def.length > 20 && t.def.length < 240, `${t.title}: one or two sentences`);
    assert.equal(term(t.key), t);
  }
});

test('each term links once, and the text is kept exactly', () => {
  const text = 'The API answers 503. Another 503 later, and latency goes up. Workers rest.';
  const parts = splitTerms(text);
  assert.equal(parts.map(p => p.text).join(''), text);
  assert.deepEqual(linked(text), ['api', '503', 'latency', 'worker']);
});

test('linking is shared across calls with the same set', () => {
  const seen = new Set();
  splitTerms('Utilization is high.', seen);
  assert.deepEqual(splitTerms('utilization again', seen).filter(p => p.key), []);
});

test('whole words only, and case matters for SLO and API', () => {
  assert.deepEqual(linked('rapid slow slots 2026 api'), []);
  assert.deepEqual(linked('SLO'), ['slo']);
  assert.deepEqual(linked('API server'), ['api']);
  assert.deepEqual(linked('202 Accepted'), ['202']);
  assert.deepEqual(linked('a Redis Stream'), ['redis']);
});

test('define does nothing without a real page', () => {
  const define = setUpDefine();
  assert.doesNotThrow(() => { define.link(null); define.link({}); define.close(); });
});

test('effects draw, then remove themselves', () => {
  const fx = createEffects();
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...a) => calls.push(k)),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  for (const kind of ['served', 'turnaway', 'orderUp', 'batch', 'steam', 'unknown']) fx.add(kind, 500, 300);
  assert.equal(fx.count, 5, 'unknown kinds are ignored');
  fx.draw(ctx, 1000);
  fx.draw(ctx, 1500);
  assert.ok(calls.includes('arc') && calls.includes('fillText'));
  fx.draw(ctx, 3000);
  assert.equal(fx.count, 0, 'every effect is gone after its life');
  for (let i = 0; i < 200; i++) fx.add('served', i, 0);
  assert.ok(fx.count <= 90, 'the list is capped');
  fx.clear();
  assert.equal(fx.count, 0);
});

test('ambient sound and the new sounds are silent no-ops without Web Audio', () => {
  const sound = createSound();
  assert.doesNotThrow(() => {
    sound.ambient(1, 1); sound.ambient(0, 0);
    for (const name of ['orderUp', 'batchUp', 'turnAway', 'ticket', 'run', 'xray', 'xrayOff', 'unlock', 'starMiss']) sound.play(name);
    sound.play('star', 2);
  });
});
