import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, spaces, validateState } from './data.js';
import {
  connections,
  findDoor,
  normalizeFloorplan,
  roomOpenings,
  sharedOpening,
  rectanglesOverlap,
  DOOR,
} from './floorplan.js';
import { bathroomFixtures, fixtureFootprint, houseLayout } from './house-geometry.js';
import {
  attachBathroom,
  addSpace,
  deleteSpace,
  moveSpace,
  setDoor,
  switchSpace,
} from './app/ops.js';

// 원룸 오른쪽에 화장실을 붙인 집. 맞닿은 벽은 세로 벽이다.
function home() {
  const s = freshState(),
    studio = s.roomId,
    bath = attachBathroom(s),
    [link] = connections(spaces(s), s.floorplan);
  return { s, studio, bath, link };
}
const opening = (s, a, b) => {
  const list = spaces(s),
    A = list.find((r) => r.roomId === a),
    B = list.find((r) => r.roomId === b);
  return sharedOpening(
    A,
    s.floorplan.positions[a],
    B,
    s.floorplan.positions[b],
    findDoor(s.floorplan, a, b),
  );
};

test('문 설정이 없으면 맞닿은 벽 가운데의 80cm 가정 문이고 저장 값에 문 항목이 없다', () => {
  const { s, studio, bath, link } = home(),
    o = opening(s, studio, bath);
  assert.equal(s.floorplan.doors, undefined);
  assert.equal(o.width, 0.8);
  assert.equal(o.custom, false);
  assert.ok(Math.abs(o.z - (link.wall.start + link.wall.end) / 2) < 1e-9);
  assert.equal(link.closed, false);
});

test('문을 옮기면 벽 끝에서 5cm 단위로 맞추고 구간 밖으로 나가지 않는다', () => {
  const { s, studio, bath, link } = home(),
    { wall } = link;
  setDoor(s, studio, bath, { center: wall.start + 0.63 });
  let o = opening(s, studio, bath);
  // 벽 끝에서 문까지 0.23m → 0.25m로 맞춘다.
  assert.ok(Math.abs(o.z - o.width / 2 - wall.start - 0.25) < 1e-9);
  assert.equal(o.custom, true);
  setDoor(s, studio, bath, { center: wall.end + 5 });
  o = opening(s, studio, bath);
  assert.ok(o.z + o.width / 2 <= wall.end - DOOR.margin + 1e-9);
  setDoor(s, studio, bath, { center: wall.start - 5 });
  o = opening(s, studio, bath);
  assert.ok(o.z - o.width / 2 >= wall.start + DOOR.margin - 1e-9);
  // 숫자로 넣은 위치는 5cm에 맞추지 않는다.
  setDoor(s, studio, bath, { edge: 0.37, exact: true });
  o = opening(s, studio, bath);
  assert.ok(Math.abs(o.z - o.width / 2 - wall.start - 0.37) < 1e-9);
});

test('문 폭은 60~120cm이고 맞닿은 벽보다 넓게 낼 수 없으며 직접 정한 폭으로 표시된다', () => {
  const { s, studio, bath, link } = home();
  assert.throws(() => setDoor(s, studio, bath, { width: 0.5 }), /60~120cm/);
  assert.throws(() => setDoor(s, studio, bath, { width: 1.3 }), /60~120cm/);
  setDoor(s, studio, bath, { width: 0.9 });
  const o = opening(s, studio, bath);
  assert.equal(o.width, 0.9);
  assert.equal(o.measured, true);
  // 자동 위치의 문은 폭을 바꿔도 벽 가운데에 있다.
  assert.ok(Math.abs(o.z - (link.wall.start + link.wall.end) / 2) < 1e-9);
  // 직접 옮긴 문은 폭을 바꿔도 벽 끝에서의 거리가 그대로다.
  setDoor(s, studio, bath, { edge: 0.23, exact: true });
  setDoor(s, studio, bath, { width: 0.7 });
  const kept = opening(s, studio, bath);
  assert.ok(Math.abs(kept.z - kept.width / 2 - link.wall.start - 0.23) < 1e-9);
  setDoor(s, studio, bath, { reset: true });
  setDoor(s, studio, bath, { width: 0.9 });
  // 화장실 벽보다 넓은 문은 이유와 낼 수 있는 폭을 알린다.
  if (link.length < 1.3)
    assert.throws(
      () => setDoor(s, studio, bath, { width: 1.2 }),
      new RegExp(`${Math.round(link.length * 100)}cm`),
    );
});

test('문을 막으면 벽이 이어지고 다시 내면 정해 둔 위치와 폭이 돌아온다', () => {
  const { s, studio, bath, link } = home();
  setDoor(s, studio, bath, { width: 0.7, edge: 0.2, exact: true });
  const before = opening(s, studio, bath);
  setDoor(s, studio, bath, { closed: true });
  assert.equal(opening(s, studio, bath), null);
  assert.equal(roomOpenings(spaces(s), s.floorplan, studio).length, 0);
  assert.equal(houseLayout(s).openings.length, 0);
  // 막은 벽도 목록에 남아 다시 낼 수 있다.
  const [closed] = connections(spaces(s), s.floorplan);
  assert.equal(closed.closed, true);
  assert.equal(closed.opening, null);
  // 벽 조각이 문 자리를 비우지 않고 구간 전체를 덮는다.
  const walls = houseLayout(s).walls.filter(
    (w) => w.shared && Math.abs(w.at - link.wall.at) < 0.02,
  );
  assert.ok(
    Math.abs(walls.reduce((sum, w) => sum + w.end - w.start, 0) - link.length) < 1e-9,
    '막은 벽에 틈이 남았다',
  );
  setDoor(s, studio, bath, { closed: false });
  assert.deepEqual(opening(s, studio, bath), before);
});

test('여는 방향을 바꾸면 문짝이 반대쪽 공간으로 열리고 자동으로 되돌리면 설정이 사라진다', () => {
  const { s, studio, bath } = home(),
    side = opening(s, studio, bath).side;
  setDoor(s, studio, bath, { flip: true });
  assert.equal(opening(s, studio, bath).side, -side);
  const [fromBath] = roomOpenings(spaces(s), s.floorplan, bath);
  assert.equal(fromBath.inward, true);
  setDoor(s, studio, bath, { reset: true });
  assert.equal(opening(s, studio, bath).side, side);
  assert.equal(s.floorplan.doors, undefined);
});

test('문 설정은 공간 순서와 무관하고 저장·불러오기와 공간 이동 뒤에도 남는다', () => {
  const { s, studio, bath } = home();
  setDoor(s, bath, studio, { width: 0.75, edge: 0.3, exact: true });
  assert.deepEqual(opening(s, studio, bath), opening(s, bath, studio));
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.floorplan.doors, s.floorplan.doors);
  // 화장실을 벽을 따라 옮겨도 직접 정한 폭은 그대로다.
  const p = s.floorplan.positions[bath];
  moveSpace(s, bath, p.x, p.z - 0.5);
  assert.equal(opening(s, studio, bath).width, 0.75);
  assert.equal(findDoor(s.floorplan, studio, bath).width, 0.75);
  // 방을 바꿔 들어가도 같은 문이다.
  switchSpace(s, bath);
  assert.equal(opening(s, studio, bath).width, 0.75);
});

test('공간을 지우면 그 공간의 문 설정도 사라지고 맞닿지 않은 공간에는 문을 낼 수 없다', () => {
  const { s, studio, bath } = home();
  setDoor(s, studio, bath, { width: 0.7 });
  deleteSpace(s, bath);
  assert.equal(s.floorplan.doors, undefined);
  const other = addSpace(s, 'bedroom');
  switchSpace(s, studio);
  const p = s.floorplan.positions[other];
  moveSpace(s, other, p.x + 3, p.z + 9, { snap: false });
  assert.throws(() => setDoor(s, studio, other, { width: 0.9 }), /맞닿은 두 공간/);
});

test('불러온 문 설정이 올바르지 않으면 거절하고 없는 공간의 설정은 버린다', () => {
  const { s, studio, bath } = home(),
    list = spaces(s),
    positions = s.floorplan.positions;
  assert.throws(() => normalizeFloorplan({ positions, doors: 'x' }, list), /문 설정/);
  assert.throws(
    () => normalizeFloorplan({ positions, doors: [{ rooms: [studio, bath], width: 3 }] }, list),
    /문 폭/,
  );
  assert.throws(
    () =>
      normalizeFloorplan({ positions, doors: [{ rooms: [studio, bath], offset: 'left' }] }, list),
    /문 위치/,
  );
  const kept = normalizeFloorplan(
    {
      positions,
      doors: [
        { rooms: [studio, 'gone'], width: 0.9 },
        { rooms: [studio, bath], width: 0.9, extra: 1 },
        { rooms: [bath, studio], width: 0.7 },
      ],
    },
    list,
  );
  assert.deepEqual(kept.doors, [{ rooms: [studio, bath], width: 0.9 }]);
});

test('문을 어디로 옮겨도 화장실 설비는 문 앞을 덜 막는 벽으로 옮겨 간다', () => {
  const { s, studio, bath, link } = home(),
    room = spaces(s).find((r) => r.roomId === bath).room;
  for (let edge = 0.05; edge <= link.length - 0.8 - 0.05 + 1e-9; edge += 0.05) {
    setDoor(s, studio, bath, { edge, exact: true });
    const openings = roomOpenings(spaces(s), s.floorplan, bath),
      [o] = openings,
      // 문 앞 통로: 문 폭만큼, 안쪽으로 50cm.
      way = {
        left: Math.min(o.x, o.x - Math.sign(o.x) * 0.5),
        right: Math.max(o.x, o.x - Math.sign(o.x) * 0.5),
        top: o.z - o.width / 2,
        bottom: o.z + o.width / 2,
      };
    for (const f of bathroomFixtures(room, openings)) {
      const p = fixtureFootprint(f),
        box = {
          left: f.x - p.w / 2,
          right: f.x + p.w / 2,
          top: f.z - p.d / 2,
          bottom: f.z + p.d / 2,
        };
      assert.equal(rectanglesOverlap(box, way), false, `문 ${Math.round(edge * 100)}cm ${f.type}`);
      assert.ok(box.left >= -room.w / 2 - 1e-9 && box.right <= room.w / 2 + 1e-9);
      assert.ok(box.top >= -room.d / 2 - 1e-9 && box.bottom <= room.d / 2 + 1e-9);
    }
  }
});

test('문이 두 벽에 나도 설비는 두 문 앞을 모두 비운다', () => {
  for (const [w, d] of [
    [1.8, 2.2],
    [2.4, 2.6],
  ]) {
    const room = { w, d },
      doors = [
        { wall: 'left', vertical: true, x: -w / 2, z: 0, width: 0.8, inward: false },
        { wall: 'front', vertical: false, x: 0, z: d / 2, width: 0.8, inward: false },
      ],
      ways = [
        { left: -w / 2, right: -w / 2 + 0.5, top: -0.4, bottom: 0.4 },
        { left: -0.4, right: 0.4, top: d / 2 - 0.5, bottom: d / 2 },
      ];
    for (const f of bathroomFixtures(room, doors)) {
      const p = fixtureFootprint(f),
        box = {
          left: f.x - p.w / 2,
          right: f.x + p.w / 2,
          top: f.z - p.d / 2,
          bottom: f.z + p.d / 2,
        };
      for (const way of ways)
        assert.equal(rectanglesOverlap(box, way), false, `${w}x${d} ${f.type}`);
    }
  }
});
