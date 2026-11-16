import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, exampleState, spaces, validateState, layoutWarnings } from './data.js';
import { makeRoom } from './catalog.js';
import { avatarLayout, parseComparisonCommand } from './avatar.js';
import { floorplanWarnings, sharedOpening, roomBounds, connections } from './floorplan.js';
import {
  setAvatar,
  attachBathroom,
  moveSpace,
  switchSpace,
  deleteSpace,
  setRoom,
  roomWithDims,
  roomWithType,
  addSpace,
  attachedTo,
  separateSpaces,
  rotateSpace,
  setDoor,
  migrateLegacy,
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
    assert.ok(Math.abs(a.top - height / 100) < 1e-9);
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
  assert.match(a.warnings.join(), /모형 기준.*15cm/);
  assert.throws(() => setAvatar(s, { pose: 'sitting' }, bed.id));
  setAvatar(s, { pose: 'sitting' }, chair.id);
  assert.equal(avatarLayout(s).pose, 'sitting');
  assert.ok(avatarLayout(s).joints.leftFoot[1] > 0);
  s.items = [];
  assert.equal(avatarLayout(s).pose, 'standing');
  assert.equal(validateState(s).avatar.pose, 'standing');
});
test('이전 v3 배치를 가구 손실 없이 집 도면으로 옮기고 v5를 왕복한다', () => {
  const original = exampleState();
  const old = structuredClone(original);
  old.version = 3;
  delete old.floorplan;
  delete old.avatar;
  delete old.scope;
  const s = validateState(old);
  assert.equal(s.version, 5);
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
test('방 크기를 바꿔도 옆 공간과 겹치지 않고 맞닿은 벽이 그대로 남는다', () => {
  const s = freshState();
  const bath = attachBathroom(s);
  const at = { ...s.floorplan.positions[bath] };
  setRoom(s, roomWithDims(s.room, { w: 6 }));
  let list = spaces(s);
  assert.equal(floorplanWarnings(list, s.floorplan).size, 0);
  assert.equal(connections(list, s.floorplan).length, 1);
  // 오른쪽 벽에 화장실이 붙어 있으니 그 벽은 그대로 두고 왼쪽으로 2m 늘어난다. 화장실은 움직이지 않는다.
  assert.deepEqual(s.floorplan.positions[bath], at);
  assert.equal(s.floorplan.positions[s.roomId].x, -1);
  // 양쪽에 이웃이 있으면 먼 쪽 이웃이 달라진 길이만큼 따라 움직인다.
  const middle = s.roomId;
  switchSpace(s, bath);
  const far = addSpace(s, 'office', 'right');
  switchSpace(s, bath);
  const before = s.floorplan.positions[far].x;
  const rows = setRoom(s, roomWithDims(s.room, { w: 3 }));
  list = spaces(s);
  assert.equal(floorplanWarnings(list, s.floorplan).size, 0);
  assert.equal(connections(list, s.floorplan).length, 2);
  assert.ok(Math.abs(s.floorplan.positions[far].x - (before + 1.2)) < 1e-9);
  assert.deepEqual(s.floorplan.positions[middle], { x: -1, z: 0 });
  assert.ok(rows.some((r) => r.label === '집 배치'));
});
test('겹친 채 저장된 공간은 가장 적게 움직여 떼어 놓고 벽을 맞붙인다', () => {
  const s = freshState();
  s.room = makeRoom('living');
  s.otherRooms.push({ roomId: 'bath', name: '나의 화장실', room: makeRoom('bathroom'), items: [] });
  s.roomOrder = ['bath', s.roomId];
  s.floorplan = { positions: { bath: { x: 0, z: 0 }, [s.roomId]: { x: 1.8, z: 0 } } };
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 2);
  const r = separateSpaces(s);
  assert.deepEqual(r.moved, ['나의 화장실']);
  assert.equal(r.remaining, 0);
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 0);
  assert.equal(connections(spaces(s), s.floorplan).length, 1);
  // 겹친 곳이 없으면 아무것도 건드리지 않는다.
  const same = JSON.stringify(s.floorplan);
  assert.deepEqual(separateSpaces(s).moved, []);
  assert.equal(JSON.stringify(s.floorplan), same);
});
test('방을 돌리면 가로·세로와 가구·아바타가 함께 돌고 네 번 돌리면 제자리다', () => {
  const s = exampleState(),
    start = structuredClone({ room: s.room, items: s.items });
  const bath = attachBathroom(s);
  setAvatar(s, { enabled: true, x: 1, z: 0.5 });
  const bed = s.items.find((a) => a.type === 'bed'),
    was = { x: bed.x, z: bed.z, angle: bed.angle };
  const r = rotateSpace(s);
  assert.deepEqual([r.w, r.d], [start.room.d, start.room.w]);
  // 오른쪽으로 90°: (x, z) → (-z, x), 각도는 90° 줄어든다.
  assert.ok(Math.abs(bed.x - -was.z) < 1e-9 && Math.abs(bed.z - was.x) < 1e-9);
  assert.equal(bed.angle, (was.angle + 270) % 360);
  assert.ok(Math.abs(s.avatar.x - -0.5) < 1e-9 && Math.abs(s.avatar.z - 1) < 1e-9);
  assert.equal(layoutWarnings(s).all.size, 0);
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 0);
  for (let i = 0; i < 3; i++) rotateSpace(s);
  assert.deepEqual([s.room.w, s.room.d], [start.room.w, start.room.d]);
  for (const [i, a] of s.items.entries()) {
    assert.ok(Math.abs(a.x - start.items[i].x) < 1e-9 && Math.abs(a.z - start.items[i].z) < 1e-9);
    assert.equal(a.angle, start.items[i].angle);
  }
  // 다른 공간도 돌릴 수 있고, 돌린 공간에 직접 정해 둔 문은 자동 문으로 돌아간다.
  setDoor(s, s.roomId, bath, { width: 0.9 });
  assert.equal(s.floorplan.doors.length, 1);
  const turned = rotateSpace(s, bath);
  assert.deepEqual([turned.w, turned.d], [2.2, 1.8]);
  assert.equal(s.floorplan.doors, undefined);
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 0);
});
test('공간 유형을 바꾸면 기본 이름·바닥·설비가 따라 바뀌고 직접 지은 이름은 남는다', () => {
  const s = freshState();
  const first = s.roomId;
  addSpace(s, 'bathroom');
  assert.equal(s.name, '나의 화장실');
  assert.equal(s.room.floorColor, '#dce1dc');
  assert.deepEqual(s.items.map((a) => a.type).sort(), ['basin', 'shower', 'toilet']);
  const second = addSpace(s, 'bathroom', null, { anchor: first });
  assert.equal(s.name, '나의 화장실 2');
  const rows = setRoom(s, roomWithType(s.room, 'living'));
  assert.equal(s.name, '나의 거실');
  assert.equal(s.room.floorColor, '#e0d4bf');
  assert.equal(s.items.length, 0);
  assert.ok(rows.some((r) => r.label === '이름' && r.to === '나의 거실'));
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 0);
  // 손댄 설비와 직접 지은 이름은 유형을 바꿔도 남긴다.
  setRoom(s, roomWithType(s.room, 'bathroom'));
  assert.equal(s.name, '나의 화장실 2');
  s.items[0].sources = ['사용자 설정', '설비 초안', '설비 초안'];
  s.name = '손님 욕실';
  setRoom(s, roomWithType(s.room, 'office'));
  assert.equal(s.name, '손님 욕실');
  assert.equal(s.items.length, 1);
  assert.equal(s.roomId, second);
});
test('새 공간은 말한 기준 공간의 벽에 실제 크기로 자리를 잡는다', () => {
  const s = freshState();
  const first = s.roomId,
    bath = addSpace(s, 'bathroom');
  switchSpace(s, first);
  const room = roomWithDims(makeRoom('living'), { w: 6, d: 5 });
  const living = addSpace(s, 'living', 'right', { room, anchor: bath, strict: false });
  assert.deepEqual([s.room.w, s.room.d], [6, 5]);
  assert.deepEqual(attachedTo(s, living, bath), {
    roomId: bath,
    name: '나의 화장실',
    side: 'right',
  });
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 0);
  // 고른 벽이 막혀 있으면 벽의 + 손잡이는 거절하고, 대화는 다른 벽을 찾는다.
  switchSpace(s, first);
  assert.throws(() => addSpace(s, 'bedroom', 'right', { anchor: first }), /자리가 없어요/);
  addSpace(s, 'bedroom', 'right', { anchor: first, strict: false });
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 0);
  assert.notEqual(attachedTo(s, s.roomId, first), null);
});
test('v4 이하 저장본은 불러올 때 설비·이름·겹침을 한 번 손본다', () => {
  const s = freshState();
  s.room = makeRoom('living');
  s.name = '나의 화장실';
  const old = makeRoom('bathroom');
  old.floorColor = '#e0d4bf';
  s.otherRooms.push({ roomId: 'bath', name: '나의 화장실', room: old, items: [] });
  s.roomOrder = ['bath', s.roomId];
  s.floorplan = { positions: { bath: { x: 0, z: 0 }, [s.roomId]: { x: 1.8, z: 0 } } };
  migrateLegacy(s);
  const [bath, living] = spaces(s);
  assert.deepEqual([bath.name, living.name], ['나의 화장실', '나의 거실']);
  assert.equal(bath.room.floorColor, '#dce1dc');
  assert.equal(bath.items.length, 3);
  assert.equal(floorplanWarnings(spaces(s), s.floorplan).size, 0);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))), s);
});
test('문 명령은 폭·막기·다시 내기·방향을 읽고 문을 기준으로 한 가구 문장은 읽지 않는다', () => {
  assert.deepEqual(parseComparisonCommand('화장실 문 폭 90cm로 해줘'), {
    kind: 'door',
    action: 'width',
    width: 90,
  });
  assert.deepEqual(parseComparisonCommand('문 너비를 0.7m로'), {
    kind: 'door',
    action: 'width',
    width: 70,
  });
  assert.equal(parseComparisonCommand('화장실 문 막아줘').action, 'close');
  assert.equal(parseComparisonCommand('문을 없애줘').action, 'close');
  assert.equal(parseComparisonCommand('문 다시 내줘').action, 'open');
  assert.equal(parseComparisonCommand('문 여는 방향 바꿔줘').action, 'flip');
  assert.equal(parseComparisonCommand('문 위치를 옮기고 싶어').action, 'show');
  for (const text of [
    '문 옆에 소파 놓아줘',
    '창문 쪽으로 책상 옮겨줘',
    '질문 있어',
    '주문한 침대 폭 140cm',
    '방문 손님용 의자',
  ])
    assert.equal(parseComparisonCommand(text), null, text);
});
