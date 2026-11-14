import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { exampleState, spaces } from './data.js';
import { attachBathroom, moveSpace } from './app/ops.js';
import { houseLayout, bathroomFixtures } from './house-geometry.js';
import { houseStructure, houseFurniture, bathroomModel } from './house-three.js';
import { disposeGroup } from './furniture.js';
import { parseComparisonCommand } from './avatar.js';

test('집 전체 3D 명령은 아바타·가구 치수를 건드리지 않고 보기를 지정한다', () => {
  assert.deepEqual(parseComparisonCommand('집 전체를 화장실 포함해서 3D로 보여줘'), {
    kind: 'floorplan',
    view: '3d',
  });
  assert.deepEqual(parseComparisonCommand('집 전체 2D'), { kind: 'floorplan', view: '2d' });
});
test('공유 벽을 한 번만 만들고 80cm 연결 구간을 실제로 비운다', () => {
  const s = exampleState();
  attachBathroom(s);
  const layout = houseLayout(s),
    door = layout.openings[0];
  assert.equal(layout.rooms.length, 2);
  assert.ok(Math.abs(layout.w - 5.8) < 1e-9);
  assert.equal(layout.d, 4);
  assert.equal(door.width, 0.8);
  const walls = layout.walls.filter((w) => w.axis === 'x' && Math.abs(w.at - door.x) < 1e-9);
  assert.ok(walls.some((w) => w.shared));
  assert.ok(walls.every((w) => w.end <= door.z - 0.4 + 1e-9 || w.start >= door.z + 0.4 - 1e-9));
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++)
      assert.ok(
        Math.min(walls[i].end, walls[j].end) - Math.max(walls[i].start, walls[j].start) < 1e-9,
      );
});
test('집 3D의 가구는 공간 오프셋만 더하고 원래 크기·회전·상태를 보존한다', () => {
  const s = exampleState();
  const id = s.roomId;
  attachBathroom(s);
  moveSpace(s, id, -5, -4, { snap: false });
  const before = JSON.stringify(s),
    group = houseFurniture(s);
  group.updateMatrixWorld(true);
  const room = group.children.find((g) => g.userData.roomId === id),
    item = s.items[0],
    mesh = room.children.find((g) => g.userData.id === item.id),
    p = mesh.getWorldPosition(new Vector3());
  assert.ok(Math.abs(p.x - (-5 + item.x)) < 1e-9);
  assert.ok(Math.abs(p.z - (-4 + item.z)) < 1e-9);
  assert.equal(mesh.rotation.y, (item.angle * Math.PI) / 180);
  assert.equal(JSON.stringify(s), before);
  disposeGroup(group);
});
test('소수 치수의 스냅 반올림 오차에서도 공유 벽과 문을 유지한다', () => {
  const s = exampleState(),
    id = attachBathroom(s);
  s.floorplan.positions[id].x += 0.005;
  const layout = houseLayout(s),
    door = layout.openings[0];
  assert.equal(layout.openings.length, 1);
  const walls = layout.walls.filter((w) => w.axis === 'x' && Math.abs(w.at - door.x) < 0.02);
  assert.ok(walls.some((w) => w.shared));
  assert.ok(walls.every((w) => w.end <= door.z - 0.4 + 1e-9 || w.start >= door.z + 0.4 - 1e-9));
});
test('화장실 세 설비가 2D와 같은 위치에 생성되고 작은 화장실 안에 들어간다', () => {
  const room = { w: 1.5, d: 1.8 },
    defs = bathroomFixtures(room),
    model = bathroomModel(room);
  assert.deepEqual(
    model.children.map((g) => g.userData.fixture),
    ['toilet', 'basin', 'shower'],
  );
  for (const f of defs) {
    const g = model.children.find((g) => g.userData.fixture === f.type);
    assert.deepEqual([g.position.x, g.position.z], [f.x, f.z]);
    assert.ok(Math.abs(f.x) + f.w / 2 <= room.w / 2);
    assert.ok(Math.abs(f.z) + f.d / 2 <= room.d / 2);
    assert.equal(g.userData.draft, true);
  }
  disposeGroup(model);
});
test('전체 구조에 모든 공간·화장실·문을 포함하고 상태를 수정하지 않는다', () => {
  const s = exampleState();
  attachBathroom(s);
  const before = JSON.stringify(s);
  const root = houseStructure(s),
    ids = new Set(spaces(s).map((r) => r.roomId));
  const rooms = root.children.filter(
    (g) => g.isGroup && ids.has(g.userData.roomId) && !g.userData.opening,
  );
  assert.equal(rooms.length, 2);
  assert.equal(root.children.filter((g) => g.userData.opening).length, 1);
  let fixtures = 0;
  root.traverse((g) => {
    if (g.userData.fixture) fixtures++;
  });
  assert.equal(fixtures, 3);
  assert.equal(JSON.stringify(s), before);
  disposeGroup(root);
});
