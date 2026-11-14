import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, exampleState, spaces, validateState } from './data.js';
import { avatarLayout, parseComparisonCommand } from './avatar.js';
import { floorplanWarnings, sharedOpening, roomBounds } from './floorplan.js';
import {
  setAvatar,
  attachBathroom,
  moveSpace,
  switchSpace,
  deleteSpace,
  setRoom,
  roomWithDims,
} from './app/ops.js';

test('키 명령은 cm·m를 읽고 가구 높이와 구별한다', () => {
  assert.equal(parseComparisonCommand('내 키는 175cm야').patch.height, 175);
  assert.equal(parseComparisonCommand('제 키 1.85m').patch.height, 185);
  assert.equal(parseComparisonCommand('아바타 키 160cm로 침대에 눕혀줘').patch.pose, 'lying');
  assert.equal(parseComparisonCommand('소파 높이 85cm'), null);
  assert.equal(parseComparisonCommand('천장 높이 2.4m'), null);
  assert.equal(parseComparisonCommand('내 키에 맞춰 아바타 숨겨줘').patch.enabled, false);
});
test('아바타는 선택 기능이며 키의 실제 m 축척을 보존한다', () => {
  const s = freshState();
  assert.equal(avatarLayout(s), null);
  for (const height of [80, 170, 230]) {
    setAvatar(s, { enabled: true, height });
    const a = avatarLayout(s);
    assert.ok(Math.abs(a.joints.head[1] + a.h * 0.06 - height / 100) < 1e-9);
    assert.ok(Math.abs(a.joints.leftFoot[1] - a.h * 0.035) < 1e-9);
  }
  const before = structuredClone(s.avatar);
  for (const height of [0, 79, 231, NaN, Infinity, '175'])
    assert.throws(() => setAvatar(s, { height }));
  assert.deepEqual(s.avatar, before);
});
test('앉기·눕기는 실제 가구에 연결하고 이동·회전을 따라간다', () => {
  const s = exampleState(),
    bed = s.items.find((i) => i.type === 'bed'),
    chair = s.items.find((i) => i.type === 'chair');
  setAvatar(s, { enabled: true, height: 210, pose: 'lying' }, bed.id);
  bed.x = 0.4;
  bed.angle = 90;
  const a = avatarLayout(s);
  assert.deepEqual([a.x, a.angle, a.item.id], [0.4, 90, bed.id]);
  assert.match(a.warnings.join(), /10cm/);
  assert.throws(() => setAvatar(s, { pose: 'sitting' }, bed.id));
  setAvatar(s, { pose: 'sitting' }, chair.id);
  assert.equal(avatarLayout(s).pose, 'sitting');
  assert.ok(avatarLayout(s).joints.leftFoot[1] > 0);
  s.items = [];
  assert.equal(avatarLayout(s).pose, 'standing');
  assert.equal(validateState(s).avatar.pose, 'standing');
});
test('이전 v3 배치를 가구 손실 없이 집 도면으로 옮기고 v4를 왕복한다', () => {
  const original = exampleState();
  const old = structuredClone(original);
  old.version = 3;
  delete old.floorplan;
  delete old.avatar;
  delete old.scope;
  const s = validateState(old);
  assert.equal(s.version, 4);
  assert.deepEqual(s.items, original.items);
  setAvatar(s, { enabled: true, height: 178 });
  attachBathroom(s);
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s);
  assert.deepEqual(restored.items, original.items);
});
test('화장실은 공유 벽으로 붙고 L자 외곽·가구 로컬 좌표를 유지한다', () => {
  const s = exampleState(),
    id = s.roomId,
    items = structuredClone(s.items);
  const bath = attachBathroom(s),
    list = spaces(s),
    a = list.find((r) => r.roomId === id),
    b = list.find((r) => r.roomId === bath);
  const ap = s.floorplan.positions[id],
    bp = s.floorplan.positions[bath];
  assert.equal(s.roomId, id);
  assert.equal(s.scope, 'house');
  assert.equal(b.room.type, 'bathroom');
  assert.deepEqual(s.items, items);
  assert.equal(floorplanWarnings(list, s.floorplan).size, 0);
  const door = sharedOpening(a, ap, b, bp);
  assert.equal(door.vertical, true);
  assert.equal(door.width, 0.8);
  assert.notEqual(roomBounds(a, ap).top, roomBounds(b, bp).top);
  moveSpace(s, bath, bp.x + 1, bp.z + 1);
  assert.deepEqual(s.items, items);
  const p = structuredClone(s.floorplan.positions[bath]);
  assert.throws(() => moveSpace(s, bath, ap.x, ap.z));
  assert.deepEqual(s.floorplan.positions[bath], p);
});
test('잘못된 저장 위치·아바타를 거절하고 삭제한 공간의 참조를 정리한다', () => {
  const s = freshState(),
    original = s.roomId,
    id = attachBathroom(s);
  for (const bad of [NaN, Infinity, 300, '3'])
    assert.throws(() =>
      validateState({ ...s, floorplan: { positions: { [original]: { x: bad, z: 0 } } } }),
    );
  assert.throws(() => validateState({ ...s, avatar: { ...s.avatar, height: -1 } }));
  switchSpace(s, id);
  setAvatar(s, { enabled: true });
  deleteSpace(s, id);
  assert.equal(Object.hasOwn(s.floorplan.positions, id), false);
  assert.equal(s.avatar.roomId, original);
});
test('방 크기 변경으로 생긴 공간 중첩을 표시한다', () => {
  const s = freshState();
  attachBathroom(s);
  setRoom(s, roomWithDims(s.room, { w: 6 }));
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 2);
});
