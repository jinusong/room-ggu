import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, exampleState, spaces, validateState } from './data.js';
import {
  AVATAR_OUT,
  HOME_VIEW,
  avatarApron,
  avatarLayout,
  avatarRect,
  standAt,
  standSpot,
} from './avatar.js';
import { roomBounds, rectanglesOverlap } from './floorplan.js';
import { addSpace, setAvatar, setRoom, roomWithDims, switchSpace } from './app/ops.js';

const room = { w: 4, d: 4, h: 2.4 };
// 서 있는 몸이 바닥에서 차지하는 범위(집 전체 좌표).
function bodyBox(s) {
  const a = avatarLayout(s),
    at = s.floorplan.positions[s.roomId];
  return {
    left: at.x + a.x - a.h * 0.18,
    right: at.x + a.x + a.h * 0.18,
    top: at.z + a.z - a.h * 0.1,
    bottom: at.z + a.z + a.h * 0.1,
  };
}

test('아바타를 처음 세우면 방 바깥 앞쪽 왼 모서리 옆에 서고 벽에 걸치지 않는다', () => {
  const s = freshState();
  setAvatar(s, { enabled: true });
  const a = avatarLayout(s),
    { w, d } = s.room;
  assert.equal(a.outside, true);
  assert.equal(a.pose, 'standing');
  // 기본 3D 시점에서 방 안을 가리지 않으려면 몸 전체가 왼쪽 벽선보다 바깥, 앞쪽 벽선보다 앞에 있어야 한다.
  assert.ok(a.x + a.h * 0.18 < -w / 2);
  assert.ok(a.z - a.h * 0.1 > d / 2);
  assert.ok(Math.abs(a.x) <= w / 2 + AVATAR_OUT && Math.abs(a.z) <= d / 2 + AVATAR_OUT);
  // 방 밖에서는 천장 안내를 하지 않는다.
  setAvatar(s, { height: 230 });
  setRoom(s, roomWithDims(s.room, { h: 2.2 }));
  assert.deepEqual(avatarLayout(s).warnings, []);
});

test('세울 자리에 다른 공간이 붙어 있으면 겹치지 않는 다음 자리를 고른다', () => {
  for (const sides of [['left'], ['front'], ['left', 'front'], ['left', 'front', 'right']]) {
    const s = freshState(),
      studio = s.roomId;
    for (const side of sides) {
      switchSpace(s, studio);
      addSpace(s, 'bedroom', side);
    }
    switchSpace(s, studio);
    setAvatar(s, { enabled: true });
    const a = avatarLayout(s),
      body = bodyBox(s);
    assert.equal(a.outside, true, sides.join());
    const rooms = spaces(s).map((r) => roomBounds(r, s.floorplan.positions[r.roomId]));
    for (const r of rooms)
      assert.equal(rectanglesOverlap(body, r), false, `${sides.join()} → 다른 공간과 겹침`);
    // 기본 3D 시점(오른쪽 앞)에서 높은 벽 뒤에 숨지 않는다: 카메라 쪽 3m 안에 공간이 없다.
    const at = s.floorplan.positions[studio],
      len = Math.hypot(HOME_VIEW[0], HOME_VIEW[2]);
    for (let t = 0.2; t <= 3; t += 0.2) {
      const x = at.x + a.x + (HOME_VIEW[0] / len) * t,
        z = at.z + a.z + (HOME_VIEW[2] / len) * t,
        point = { left: x - 0.01, right: x + 0.01, top: z - 0.01, bottom: z + 0.01 };
      for (const r of rooms)
        assert.equal(rectanglesOverlap(point, r), false, `${sides.join()} → 벽 뒤에 숨음`);
    }
  }
});

test('사방이 막힌 방에서는 방 안에 세운다', () => {
  const blocked = [
    { left: -9, right: 9, top: 2, bottom: 9 },
    { left: -9, right: 9, top: -9, bottom: -2 },
    { left: -9, right: -2, top: -9, bottom: 9 },
    { left: 2, right: 9, top: -9, bottom: 9 },
  ];
  const spot = standSpot(room, 170, blocked);
  assert.equal(spot.outside, false);
  assert.ok(Math.abs(spot.x) < 2 && Math.abs(spot.z) < 2);
  // 아주 작은 방에서도 방 안에 든다.
  const around = [{ left: -9, right: 9, top: -9, bottom: 9 }],
    tiny = standSpot({ w: 1, d: 1, h: 2.4 }, 170, around);
  assert.equal(tiny.outside, false);
  assert.ok(Math.abs(tiny.x) <= 0.5 && Math.abs(tiny.z) <= 0.5);
});

test('끌어 놓은 자리는 방 안이나 벽 바깥이고, 벽에 걸치면 가까운 쪽으로 붙는다', () => {
  assert.deepEqual(standAt(room, 170, 0.5, -0.3), { x: 0.5, z: -0.3, outside: false });
  // 벽선(2m) 바로 안쪽에 놓으면 방 안으로, 바로 바깥에 놓으면 방 밖으로 간다.
  const inner = standAt(room, 170, 1.9, 0),
    outer = standAt(room, 170, 2.3, 0);
  assert.equal(inner.outside, false);
  assert.ok(Math.abs(inner.x - (2 - 1.7 * 0.18)) < 1e-9);
  assert.equal(outer.outside, true);
  assert.ok(Math.abs(outer.x - (2 + 0.1 + 1.7 * 0.18)) < 1e-9);
  assert.equal(outer.z, 0);
  // 앞뒤 벽도 같다.
  assert.equal(standAt(room, 170, 0, -2.2).outside, true);
  assert.ok(standAt(room, 170, 0, -2.2).z < -2.1);
  // 너무 멀리 끌어도 방 둘레의 정해진 범위를 넘지 않는다.
  const far = standAt(room, 170, 30, -30);
  assert.deepEqual([far.x, far.z, far.outside], [2 + AVATAR_OUT, -2 - AVATAR_OUT, true]);
});

test('옮긴 자리는 키를 바꿔도 남고, 숨겼다 다시 세우거나 다른 방에 세우면 그 방 바깥에서 시작한다', () => {
  const s = exampleState();
  setAvatar(s, { enabled: true });
  const start = { x: s.avatar.x, z: s.avatar.z };
  setAvatar(s, { x: 0.4, z: -0.2 });
  setAvatar(s, { height: 182 });
  assert.deepEqual([s.avatar.x, s.avatar.z], [0.4, -0.2]);
  assert.equal(avatarLayout(s).outside, false);
  setAvatar(s, { enabled: false });
  setAvatar(s, { enabled: true });
  // 키가 커진 만큼 벽에서 조금 더 떨어질 뿐 같은 모서리 옆이다.
  assert.equal(avatarLayout(s).outside, true);
  assert.ok(Math.abs(s.avatar.x - start.x) < 0.05 && Math.abs(s.avatar.z - start.z) < 0.05);
  // 저장하고 불러와도 방 밖 자리가 그대로다.
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))).avatar, s.avatar);
  // 새로 붙인 방으로 옮겨 가서 세우면 그 방 기준의 바깥 자리다.
  const bedroom = addSpace(s, 'bedroom', 'right');
  assert.equal(avatarLayout(s), null);
  setAvatar(s, { enabled: true });
  assert.equal(s.avatar.roomId, bedroom);
  assert.equal(avatarLayout(s).outside, true);
  const body = bodyBox(s);
  for (const r of spaces(s))
    assert.equal(rectanglesOverlap(body, roomBounds(r, s.floorplan.positions[r.roomId])), false);
});

test('방 밖에 선 아바타가 벗어난 만큼만 화면에 자리를 더 잡는다', () => {
  const s = freshState();
  setAvatar(s, { enabled: true });
  const a = avatarLayout(s),
    apron = avatarApron(a, s.room),
    rect = avatarRect(a);
  assert.ok(apron.left > 0.5 && apron.bottom > 0.3);
  assert.equal(apron.right, 0);
  assert.equal(apron.top, 0);
  assert.ok(Math.abs(apron.left - (-s.room.w / 2 - rect.left)) < 1e-9);
  // 방 안으로 들어오거나 앉으면 더 잡지 않는다.
  setAvatar(s, { x: 0, z: 0 });
  assert.equal(avatarRect(avatarLayout(s)), null);
  assert.deepEqual(avatarApron(avatarLayout(s), s.room), { left: 0, right: 0, top: 0, bottom: 0 });
  assert.deepEqual(avatarApron(null, s.room), { left: 0, right: 0, top: 0, bottom: 0 });
});
