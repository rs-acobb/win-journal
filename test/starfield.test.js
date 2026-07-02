'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { shouldAnimate } = require(path.join(__dirname, '..', 'public', 'starfield.js'));

test('starfield animates only in dark mood with no high-contrast and no reduced-motion', () => {
  assert.strictEqual(shouldAnimate({ effectiveDark: true, highContrast: false, reducedMotion: false }), true);
  assert.strictEqual(shouldAnimate({ effectiveDark: false, highContrast: false, reducedMotion: false }), false);
  assert.strictEqual(shouldAnimate({ effectiveDark: true, highContrast: true, reducedMotion: false }), false);
  assert.strictEqual(shouldAnimate({ effectiveDark: true, highContrast: false, reducedMotion: true }), false);
});
