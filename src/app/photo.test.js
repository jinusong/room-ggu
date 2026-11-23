import test from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_LABELS, photoCandidates, PHOTO_CONFIDENT } from './photo.js';
test('20종 사진 분류 이름은 중복되지 않는다', () =>
  assert.equal(new Set(PHOTO_LABELS.map(([k]) => k)).size, 20));
for (const raw of [
  null,
  {},
  [],
  [{ type: 'bed', score: 0.99 }],
  [
    { type: 'bed', score: 0.9 },
    { type: 'bed', score: 0.9 },
  ],
  [
    { type: 'bed', score: -1 },
    { type: 'sofa', score: 2 },
  ],
  [
    { type: 'bed', score: NaN },
    { type: 'sofa', score: Infinity },
  ],
  [
    { type: 'toilet', score: 0.99 },
    { type: '__proto__', score: 1 },
  ],
])
  test(`잘못된 결과로 확신 초안을 만들지 않는다 ${JSON.stringify(raw)}`, () =>
    assert.deepEqual(photoCandidates(raw), []));
test('높은 점수는 확신 기준을 넘고 내림차순 후보 3개로 제한한다', () => {
  const c = photoCandidates(
    PHOTO_LABELS.map(([type], i) => ({ type, score: i === 2 ? 0.99 : 0.01 })),
  );
  assert.equal(c.length, 3);
  assert.equal(c[0].type, 'bed');
  assert.ok(c[0].p >= PHOTO_CONFIDENT);
});
test('비슷한 점수는 낮은 확신으로 남긴다', () =>
  assert.ok(
    photoCandidates([
      { type: 'bed', score: 0.2 },
      { type: 'sofa', score: 0.19 },
      { type: 'chair', score: 0.18 },
    ])[0].p < PHOTO_CONFIDENT,
  ));
test('0과 1의 경계값도 NaN 없이 정규화한다', () => {
  const c = photoCandidates([
    { type: 'bed', score: 1 },
    { type: 'sofa', score: 0 },
  ]);
  assert.ok(c.every((x) => Number.isFinite(x.p)));
  assert.ok(Math.abs(c.reduce((a, b) => a + b.p, 0) - 1) < 1e-10);
});
