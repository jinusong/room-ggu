import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSurface, validateSurface } from './ui-schema.js';
import { makeItem, makeRoom, freshState } from './data.js';
import { applyModelResult } from './estimator.js';
import { applyRoomModel } from './room-consult.js';
import { renderSurface } from './consult-panel.js';
test('대화에서 필요한 공간·가구 편집 도구를 고른다', () => {
  for (const [text, scope, expected] of [
    ['거실 가로 4m', 'room', 'dimensions'],
    ['벽은 세이지', 'room', 'finishes'],
    ['침실로 꾸며줘', 'room', 'types'],
    ['두 명이 앉는 소파', 'furniture', 'sizes'],
    ['가로 180cm', 'furniture', 'dimensions'],
    ['소파 색상', 'furniture', 'colors'],
  ])
    assert.equal(chooseSurface(text, scope), expected);
});
test('모델 UI는 허용된 컴포넌트만 고르며 원시 마크업이나 다른 도구는 거절한다', () => {
  assert.equal(validateSurface('finishes', 'room'), 'finishes');
  assert.equal(validateSurface('colors', 'room', 'types'), 'types');
  assert.equal(validateSurface('<script>alert(1)</script>', 'room', 'dimensions'), 'dimensions');
  assert.equal(validateSurface('anything', '__proto__'), 'dimensions');
  const furniture = applyModelResult('{"reply":"색을 골라주세요","ui":"colors"}', makeItem('sofa'));
  assert.equal(furniture.ui, 'colors');
  assert.equal(applyModelResult('{"reply":"초안","ui":"<img>"}', makeItem()).ui, null);
  const room = applyRoomModel('{"reply":"벽을 골라주세요","ui":"finishes"}', makeRoom());
  assert.equal(room.ui, 'finishes');
  assert.equal(applyRoomModel('{"reply":"초안","ui":"colors"}', makeRoom()).ui, null);
});
test('생성된 공간 카드는 실제 상태와 치수 입력 동작에 연결된다', () => {
  const state = freshState();
  state.room.w = 5;
  state.room.d = 4;
  const html = renderSurface({
    state,
    a: makeItem(),
    scope: 'room',
    surface: 'dimensions',
    dimsForm: () => '',
    origin: 'model',
  });
  assert.match(html, /5 × 4 m/);
  assert.match(html, /data-room-dim="w"/);
  assert.match(html, /AI가 고른 편집 도구/);
});

test('마감 요청에 방 유형·크기를 지어내거나 소파의 요청하지 않은 높이를 바꾸지 않는다', () => {
  const previous = makeRoom('living');
  const room = applyRoomModel(
    '{"room_type":"kitchen","size":"large","ui":"finishes","reply":"벽은 세이지로 바꿔주세요."}',
    previous,
    { text: '벽 색상을 고르고 싶어. 벽은 세이지로 바꿔줘' },
  );
  assert.deepEqual(room.room, previous);
  assert.equal(room.ui, 'finishes');
  const sofa = makeItem('sofa');
  const item = applyModelResult(
    '{"seats":2,"height_profile":"low","ui":"sizes","reply":"초안"}',
    sofa,
    { text: '두 명이 앉을 소파' },
  ).item;
  assert.equal(item.dims[1], sofa.dims[1]);
  const office = applyRoomModel(
    '{"room_type":"office","size":"compact","ui":"types","reply":"작은 서재"}',
    makeRoom(),
    { text: '책 읽는 아담한 방으로 꾸며줘' },
  );
  assert.equal(office.room.type, 'office');
});
