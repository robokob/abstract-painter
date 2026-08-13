import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EFFECTS, normalizeEffects } from '../effects.mjs';

test('default dreamy effects are present and stay within range', () => {
  assert.deepEqual(DEFAULT_EFFECTS, {
    glow: 0.25,
    blur: 0.2,
    grain: 0.12,
    vignette: 0.35,
    saturation: 1.15
  });

  const normalized = normalizeEffects({ glow: 3, blur: -1, grain: 0.5, vignette: 0.9, saturation: 2.4 });
  assert.equal(normalized.glow, 1);
  assert.equal(normalized.blur, 0);
  assert.equal(normalized.grain, 0.5);
  assert.equal(normalized.vignette, 0.9);
  assert.equal(normalized.saturation, 2.2);
});
