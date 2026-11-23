import test from 'node:test';
import assert from 'node:assert/strict';
import { isComposingKey, parseStepperValue } from './ui-input.js';
for (const [name, event, expected] of [
  ['조합 중', { isComposing: true, keyCode: 13 }, true],
  ['Safari 확정 키', { isComposing: false, keyCode: 229 }, true],
  ['일반 Enter', { isComposing: false, keyCode: 13 }, false],
])
  test(name, () => assert.equal(isComposingKey(event), expected));
for (const [value, min, max, expected] of [
  ['', 0, 100, null],
  ['  ', 0, 100, null],
  ['0', 0, 100, 0],
  ['0', 1, 100, null],
  ['1,25', 0, 100, 1.25],
  ['1.25', 0, 100, 1.25],
  ['-1', 0, 100, null],
  ['100', 0, 100, 100],
  ['100.01', 0, 100, null],
  ['NaN', 0, 100, null],
  ['Infinity', 0, 100, null],
  ['12cm', 0, 100, null],
  ['1e2', 0, 100, 100],
])
  test(`치수 입력 ${JSON.stringify(value)} / ${min}~${max}`, () =>
    assert.equal(parseStepperValue(value, min, max), expected));
