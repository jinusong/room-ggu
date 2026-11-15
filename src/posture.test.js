import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { TYPES, exampleState, freshState, makeItem, spaces } from './data.js';
import { avatarLayout, parseComparisonCommand, BODY } from './avatar.js';
import { seatSurface, lyingSurface } from './seating.js';
import { furniture, disposeGroup } from './furniture.js';
import { roomOpenings, sharedOpening, roomBounds, rectanglesOverlap } from './floorplan.js';
import { bathroomFixtures, fixtureFootprint, houseLayout } from './house-geometry.js';
import {
  setAvatar,
  addSpace,
  attachBathroom,
  removeItem,
  updateItem,
  moveSpace,
  switchSpace,
} from './app/ops.js';

// 가구 3D 형상의 윗면 높이를 위에서 내려 쏜 광선으로 잰다.
function surfaceAt(item, x, z) {
  const group = furniture({ ...item, x: 0, z: 0, angle: 0 });
  group.updateMatrixWorld(true);
  const hit = new Raycaster(new Vector3(x, 5, z), new Vector3(0, -1, 0))
    .intersectObjects(group.children, true)
    .find((h) => h.object.isMesh);
  disposeGroup(group);
  return hit?.point.y;
}
function seated(type, dims, height = 175) {
  const s = freshState();
  s.room.w = s.room.d = 6;
  const item = { ...makeItem(type), dims };
  s.items.push(item);
  setAvatar(s, { enabled: true, height, pose: type === 'bed' ? 'lying' : 'sitting' }, item.id);
  return { s, item, a: avatarLayout(s) };
}

test('앉은 아바타는 모든 좌석 규격에서 3D 좌판 위에 닿고 등받이를 뚫지 않는다', () => {
  for (const type of ['chair', 'sofa', 'armchair', 'bench'])
    for (const { dims } of TYPES[type].presets) {
      const { item, a } = seated(type, dims),
        seat = seatSurface(item),
        hip = a.joints.leftHip;
      assert.equal(a.pose, 'sitting');
      // 좌판 높이는 실제 형상에서 잰 값과 같고, 허벅지 아랫면이 그 위에 2cm 안쪽으로 놓인다.
      assert.ok(Math.abs(surfaceAt(item, hip[0], hip[2]) - seat.y) < 0.015, `${type} ${dims}`);
      const under = hip[1] - a.h * 0.042 - seat.y;
      assert.ok(under > -0.003 && under < 0.02, `${type} ${dims} ${under}`);
      if (seat.back !== null)
        assert.ok(a.joints.hip[2] - a.h * BODY.torsoDepth >= seat.back - 1e-9, `${type} ${dims}`);
      // 무릎은 좌석 앞 끝을 넘어가고 발은 바닥 위에 있다.
      assert.ok(a.joints.leftKnee[2] >= seat.front, `${type} ${dims}`);
      assert.ok(a.joints.leftFoot[1] >= a.h * BODY.foot - 1e-9);
    }
});
test('낮은 좌석에서는 무릎을 세우고 높은 좌석에서는 발이 뜬다고 알린다', () => {
  const low = seated('bench', [110, 25, 38]).a,
    high = seated('bench', [110, 80, 38]).a,
    length = (p, q) => Math.hypot(p[1] - q[1], p[2] - q[2]);
  assert.ok(low.joints.leftKnee[1] > low.joints.leftHip[1]);
  assert.ok(Math.abs(low.joints.leftFoot[1] - low.h * BODY.foot) < 1e-9);
  // 다리 길이는 자세가 바뀌어도 늘거나 줄지 않는다.
  assert.ok(Math.abs(length(low.joints.leftHip, low.joints.leftKnee) - low.h * BODY.thigh) < 1e-6);
  assert.ok(Math.abs(length(low.joints.leftKnee, low.joints.leftFoot) - low.h * BODY.shin) < 1e-6);
  assert.match(high.warnings.join(), /발이 바닥에서 약 \d+cm 떠요/);
  assert.equal(low.warnings.length, 0);
});
test('누운 아바타는 침대 윗면에 놓이고 머리가 헤드보드 쪽 베개 위에 온다', () => {
  for (const { dims } of TYPES.bed.presets) {
    const { item, a } = seated('bed', dims),
      bed = lyingSurface(item),
      hip = a.joints.hip;
    assert.equal(a.pose, 'lying');
    // 이불이 덮인 다리 쪽에서 윗면 높이를 잰다.
    assert.ok(Math.abs(surfaceAt(item, 0, a.joints.leftKnee[2]) - bed.y) < 0.015);
    assert.ok(Math.abs(hip[1] - a.h * BODY.torsoDepth - bed.y) < 1e-9);
    assert.ok(a.joints.head[2] < a.joints.leftFoot[2]);
    assert.ok(a.joints.head[2] > bed.pillow[0] && a.joints.head[2] < bed.pillow[1]);
    assert.ok(a.joints.head[1] - a.h * BODY.headRadius >= bed.pillowY - 1e-9);
    assert.deepEqual(a.warnings, []);
  }
});
test('치수 안내는 모형 기준임을 밝히고 평균 키·기본 의자에는 뜨지 않는다', () => {
  assert.deepEqual(seated('chair', [48, 82, 50]).a.warnings, []);
  assert.match(seated('chair', [40, 76, 43]).a.warnings.join(), /모형 어깨 너비 약 46cm.*40cm/);
  assert.match(seated('bed', [100, 55, 180], 190).a.warnings.join(), /모형 기준.*약 15cm/);
});
test('가구를 빼거나 종류를 바꾸면 아바타가 그 자리에 서고 저장 값도 정리된다', () => {
  const s = exampleState(),
    chair = s.items.find((i) => i.type === 'chair'),
    bed = s.items.find((i) => i.type === 'bed');
  setAvatar(s, { enabled: true, pose: 'sitting' }, chair.id);
  updateItem(s, chair.id, { ...chair, dims: [60, 90, 60], x: 0.5 });
  assert.equal(s.avatar.pose, 'sitting');
  assert.equal(avatarLayout(s).x, 0.5);
  updateItem(s, chair.id, { ...s.items.find((i) => i.id === chair.id), type: 'desk' });
  assert.deepEqual([s.avatar.pose, s.avatar.itemId, s.avatar.x], ['standing', null, 0.5]);
  setAvatar(s, { pose: 'lying' }, bed.id);
  removeItem(s, bed.id);
  assert.deepEqual([s.avatar.pose, s.avatar.itemId, s.avatar.x], ['standing', null, bed.x]);
});
test('다른 공간에 있는 아바타는 지금 방의 편집으로 바뀌지 않는다', () => {
  const s = exampleState(),
    first = s.roomId,
    bed = s.items.find((i) => i.type === 'bed');
  setAvatar(s, { enabled: true, pose: 'lying' }, bed.id);
  const before = structuredClone(s.avatar);
  addSpace(s, 'bedroom');
  assert.equal(avatarLayout(s), null);
  s.items.push(makeItem('sofa'));
  removeItem(s, s.items[0].id);
  assert.deepEqual(s.avatar, before);
  switchSpace(s, first);
  assert.equal(avatarLayout(s).pose, 'lying');
});
test('키 명령은 말한 가구를 읽고 앉은·누운 표현도 자세로 본다', () => {
  assert.equal(parseComparisonCommand('내 키 170cm로 라운지체어에 앉혀줘').furniture, 'armchair');
  assert.equal(parseComparisonCommand('아바타를 벤치에 앉은 모습으로 보여줘').furniture, 'bench');
  assert.equal(parseComparisonCommand('아바타 침대에 누운 모습 보여줘').patch.pose, 'lying');
  assert.equal(parseComparisonCommand('의자 높이 82cm'), null);
  // 아바타가 보이는 동안에만 아바타라는 말 없이도 자세 명령으로 읽는다.
  assert.equal(parseComparisonCommand('의자에 앉혀줘'), null);
  assert.deepEqual(parseComparisonCommand('의자에 앉혀줘', { avatarOn: true }), {
    kind: 'avatar',
    patch: { enabled: true, pose: 'sitting' },
    furniture: 'chair',
  });
  assert.equal(parseComparisonCommand('일으켜줘', { avatarOn: true }).patch.pose, 'standing');
  // 가구 이야기는 아바타가 보여도 모델과 규칙에 맡긴다.
  for (const text of [
    '두 명이 앉는 소파',
    '침대 하나 놓아줘',
    '의자 색을 바꿔줘',
    '누워서 책 볼 소파',
  ])
    assert.equal(parseComparisonCommand(text, { avatarOn: true }), null, text);
});
test('새 공간은 지금 방의 벽에 맞닿게 놓이고 다른 공간과 겹치지 않는다', () => {
  const s = exampleState(),
    first = s.roomId;
  for (const type of ['bedroom', 'bathroom', 'kitchen', 'office']) {
    switchSpace(s, first);
    const id = addSpace(s, type),
      list = spaces(s),
      room = list.find((r) => r.roomId === id),
      home = list.find((r) => r.roomId === first);
    assert.equal(s.roomId, id);
    assert.ok(
      sharedOpening(home, s.floorplan.positions[first], room, s.floorplan.positions[id]),
      type,
    );
    for (const other of list.filter((r) => r.roomId !== id))
      assert.equal(
        rectanglesOverlap(
          roomBounds(room, s.floorplan.positions[id]),
          roomBounds(other, s.floorplan.positions[other.roomId]),
        ),
        false,
      );
  }
  assert.equal(houseLayout(s).rooms.length, 5);
});
test('연결 문은 넓은 공간 쪽으로 열리고 두 공간의 순서와 무관하다', () => {
  const s = exampleState(),
    studio = s.roomId,
    bath = attachBathroom(s),
    list = spaces(s),
    a = list.find((r) => r.roomId === studio),
    b = list.find((r) => r.roomId === bath),
    ap = s.floorplan.positions[studio],
    bp = s.floorplan.positions[bath];
  assert.deepEqual(sharedOpening(a, ap, b, bp), sharedOpening(b, bp, a, ap));
  // 화장실이 오른쪽에 붙으므로 문짝은 왼쪽(-x)의 원룸 안으로 열린다.
  assert.equal(sharedOpening(a, ap, b, bp).side, -1);
  const [fromStudio] = roomOpenings(list, s.floorplan, studio),
    [fromBath] = roomOpenings(list, s.floorplan, bath);
  assert.deepEqual([fromStudio.wall, fromStudio.inward], ['right', true]);
  assert.deepEqual([fromBath.wall, fromBath.inward], ['left', false]);
  assert.ok(Math.abs(fromStudio.x - a.room.w / 2) < 1e-9);
  assert.ok(Math.abs(fromBath.x + b.room.w / 2) < 1e-9);
  moveSpace(s, bath, ap.x - (a.room.w + b.room.w) / 2, ap.z);
  assert.equal(sharedOpening(a, ap, b, s.floorplan.positions[bath]).side, 1);
});
test('화장실 설비는 문 앞을 비우고 서로 겹치지 않으며 어느 벽에 문이 나도 방 안에 든다', () => {
  for (const [w, d] of [
    [1.5, 1.8],
    [1.8, 2.2],
    [2.4, 2.6],
  ])
    for (const o of [
      { wall: 'left', vertical: true, x: -w / 2, z: 0 },
      { wall: 'right', vertical: true, x: w / 2, z: 0.2 },
      { wall: 'back', vertical: false, x: 0, z: -d / 2 },
      { wall: 'front', vertical: false, x: -0.2, z: d / 2 },
    ]) {
      const room = { w, d },
        door = { ...o, width: 0.8, inward: false },
        list = bathroomFixtures(room, [door]),
        box = (f) => {
          const p = fixtureFootprint(f);
          return {
            left: f.x - p.w / 2,
            right: f.x + p.w / 2,
            top: f.z - p.d / 2,
            bottom: f.z + p.d / 2,
          };
        },
        // 문 앞 통로: 문 폭만큼, 안쪽으로 50cm.
        way = o.vertical
          ? {
              left: Math.min(o.x, o.x - Math.sign(o.x) * 0.5),
              right: Math.max(o.x, o.x - Math.sign(o.x) * 0.5),
              top: o.z - 0.4,
              bottom: o.z + 0.4,
            }
          : {
              left: o.x - 0.4,
              right: o.x + 0.4,
              top: Math.min(o.z, o.z - Math.sign(o.z) * 0.5),
              bottom: Math.max(o.z, o.z - Math.sign(o.z) * 0.5),
            };
      for (const f of list) {
        const b = box(f);
        assert.ok(b.left >= -w / 2 - 1e-9 && b.right <= w / 2 + 1e-9, `${w}x${d} ${o.wall}`);
        assert.ok(b.top >= -d / 2 - 1e-9 && b.bottom <= d / 2 + 1e-9, `${w}x${d} ${o.wall}`);
        assert.equal(rectanglesOverlap(b, way), false, `${w}x${d} ${o.wall} ${f.type}`);
      }
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          assert.equal(rectanglesOverlap(box(list[i]), box(list[j])), false);
    }
});
