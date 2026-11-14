import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseSurface,
  validateSurface,
  surfaceKind,
  validateSurfaceSpec,
  SURFACE_KINDS,
} from './ui-schema.js';
import { makeItem, makeRoom, freshState } from './data.js';
import { applyModelResult } from './estimator.js';
import { applyRoomModel } from './room-consult.js';
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
test('모델 선택값을 앱 컴포넌트로 바꾸고 저장된 명세는 허용 필드만 복원한다', () => {
  assert.equal(surfaceKind('room', 'dimensions'), 'room-size');
  assert.equal(surfaceKind('furniture', 'sizes'), 'furniture-size');
  assert.equal(surfaceKind('furniture', 'catalog'), null, '앱 전용 도구는 모델이 고를 수 없다');
  assert.equal(surfaceKind('__proto__', 'dimensions'), null);
  for (const [kind, s] of Object.entries(SURFACE_KINDS))
    if (s.model) assert.equal(surfaceKind(s.scope, s.model), kind);
  assert.deepEqual(
    validateSurfaceSpec({ kind: 'finishes', target: { type: 'room' }, html: '<script>' }),
    { kind: 'finishes', target: { type: 'room' } },
  );
  assert.equal(validateSurfaceSpec({ kind: 'iframe' }), null);
  assert.deepEqual(
    validateSurfaceSpec({ kind: 'furniture-dims', target: { type: 'item', id: 7 } }).target,
    {
      type: 'room',
    },
  );
  assert.equal(
    validateSurfaceSpec({ kind: 'furniture-dims', target: { type: 'draft' } }).target.type,
    'draft',
  );
  const state = freshState();
  assert.equal(state.version, 4);
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
