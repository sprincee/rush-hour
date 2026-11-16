// The sound module must never break the game: no Web Audio (Node, old browsers) or no
// storage (private mode) just means silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSound } from '../src/game/sound.mjs';

test('sound is a silent no-op without Web Audio', () => {
  const sound = createSound();
  assert.doesNotThrow(() => { sound.play('stamp'); sound.play('print'); sound.play('no-such-sound'); });
});

test('mute is remembered between visits', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const first = createSound();
    assert.equal(first.muted, false);
    first.setMuted(true);
    assert.equal(createSound().muted, true, 'a new page load starts muted');
  } finally {
    delete globalThis.localStorage;
  }
});

test('blocked storage does not break muting', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try {
    const sound = createSound();
    assert.equal(sound.muted, false);
    assert.doesNotThrow(() => sound.setMuted(true));
    assert.equal(sound.muted, true);
  } finally {
    delete globalThis.localStorage;
  }
});
