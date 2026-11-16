import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exampleState,
  freshState,
  makeItem,
  layoutWarnings,
  addRoom,
  spaces,
  doorZones,
} from '../data.js';
import * as ops from './ops.js';

test('방 치수·유형·크기 초안을 검증하고 사용자 치수를 보존한다', () => {
  const s = freshState();
  const r = ops.roomWithDims(s.room, { w: 5.25 });
  assert.equal(r.w, 5.25);
  assert.throws(() => ops.roomWithDims(s.room, { w: 20 }));
  const t = ops.roomWithType(r, 'bedroom');
  assert.equal(t.w, 5.25);
  assert.equal(t.d, 3.5);
  const rows = ops.setRoom(s, ops.roomWithPreset(t, 2));
  assert.deepEqual(
    rows.map((x) => x.label),
    ['공간 유형', '가로', '천장'],
  );
  assert.throws(() => ops.roomWithFinish(s.room, 'wallColor', 'red'));
});
test('가구를 빈자리에 놓고 회전·복제·삭제를 기록한다', () => {
  const s = exampleState();
  const { item, free } = ops.placeItem(s, makeItem('desk'));
  assert.equal(free, true);
  assert.equal(layoutWarnings(s).conflicts.has(item.id), false);
  assert.ok([0, 90, 180, 270].includes(item.angle), '벽에 붙이면 방 안쪽을 본다');
  const before = item.angle;
  assert.deepEqual(ops.rotateItem(s, item.id)[0], {
    label: '회전',
    from: `${before}°`,
    to: `${(before + 90) % 360}°`,
  });
  const copy = ops.duplicateItem(s, item.id).item;
  assert.match(copy.name, /복사$/);
  ops.removeItem(s, copy.id);
  assert.equal(s.items.length, 5);
});
test('겹친 가구를 빈자리로 옮기고 방보다 큰 가구는 남긴다', () => {
  const s = freshState();
  s.items = [makeItem('sofa'), makeItem('desk'), { ...makeItem('wardrobe'), dims: [600, 200, 60] }];
  const r = ops.relocateConflicts(s);
  assert.equal(r.moved, 2);
  assert.equal(r.remaining, 1);
  assert.equal(layoutWarnings(s).oversized.size, 1);
});
test('가구 치수 범위·색상을 검증하고 변경 내역을 만든다', () => {
  const s = exampleState();
  const a = s.items[1];
  const rows = ops.updateItem(s, a.id, { ...a, dims: [130, 74, 60], color: '#3f4d63' });
  assert.deepEqual(
    rows.map((x) => x.label),
    ['가로', '색상'],
  );
  assert.throws(() => ops.updateItem(s, a.id, { ...a, dims: [0, 74, 60] }));
  assert.equal(ops.fitStatus(s, { ...a, dims: [900, 74, 60] }), 'oversize');
});
test('공간 삭제는 이웃 공간으로 이동하고 마지막 공간은 지킨다', () => {
  const s = freshState();
  const first = s.roomId;
  assert.throws(() => ops.deleteSpace(s));
  addRoom(s, 'living');
  addRoom(s, 'office');
  ops.deleteSpace(s);
  assert.equal(s.room.type, 'living');
  assert.equal(spaces(s).length, 2);
  ops.switchSpace(s, first);
  assert.equal(s.roomId, first);
});

test('문 앞을 막은 가구는 경고하고 자동 정리·새 가구 배치에서 통로를 비운다', () => {
  const s = freshState(),
    first = s.roomId;
  ops.addSpace(s, 'bedroom', 'right');
  ops.switchSpace(s, first);
  const zone = doorZones(s)[0];
  assert.ok(zone);
  const item = { ...makeItem('desk'), x: zone.x, z: zone.z, dims: [60, 74, 50] };
  s.items.push(item);
  assert.equal(layoutWarnings(s).blockedDoors.has(item.id), true);
  assert.equal(ops.relocateConflicts(s).remaining, 0);
  ops.placeItem(s, makeItem('cabinet'));
  assert.equal(layoutWarnings(s).blockedDoors.size, 0);
});
