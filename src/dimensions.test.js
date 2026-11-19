import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeItem } from './data.js';
import { consult, extractDimensions } from './estimator.js';
import { sizeFields } from './dimensions.js';

test('소수와 단위는 콤마로 나눈 치수에서도 원래 축을 유지한다', () => {
  assert.deepEqual(extractDimensions('깊이 2.05m, 가로 153.5센티미터, 높이 525mm'), {
    0: 153.5,
    1: 52.5,
    2: 205,
  });
});

test('서로 같은 단위 환산값과 충돌을 구별한다', () => {
  assert.equal(sizeFields('가로 1.65m 너비 1650mm').issue, null);
  assert.equal(sizeFields('가로 165cm, 너비 1850mm').issue.kind, 'conflict');
  assert.equal(sizeFields('가로 1.6').issue.kind, 'unit');
});

test('한 문장에서 치수를 정정하면 새 숫자에 앞 단위를 이어 쓴다', () => {
  assert.equal(sizeFields('가로 1800mm 말고 1650으로').values[0].value, 165);
  assert.equal(sizeFields('가로 180cm 말고 너비 1.65m로').values[0].value, 165);
});

test('직접 정한 가로에는 소파 인원 추정을 덮지 않는다', () => {
  const item = makeItem('sofa');
  item.dims[0] = 182;
  item.sources[0] = '사용자 설정';
  assert.equal(consult('3인 소파', item).item.dims[0], 182);
  assert.equal(consult('3인 소파 가로 195cm', item).item.dims[0], 195);
});
