import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, validateState, makeItem, spaces, layoutWarnings } from './data.js';
import {
  addWindow,
  setWindow,
  removeWindow,
  setRoom,
  roomWithDims,
  rotateSpace,
  addSpace,
  setDoor,
} from './app/ops.js';
import { windowOpenings, validateWindows, wallPieces } from './windows.js';
import { houseLayout } from './house-geometry.js';
import { houseStructure } from './house-three.js';
import { furniture, disposeGroup } from './furniture.js';
import { detectType, catalogMatches } from './estimator.js';
import { planTurn } from './app/planner.js';
import { roomOpenings, connections } from './floorplan.js';

test('창문 추가·편집·삭제·저장 왕복과 이전 배치 호환', () => {
  const s = freshState();
  const id = addWindow(s);
  setWindow(s, id, { offset: 1, width: 1.5, height: 1, sill: 1 });
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))).room.windows, s.room.windows);
  const old = structuredClone(s);
  delete old.room.windows;
  assert.deepEqual(validateState(old).room.windows, []);
  removeWindow(s, id);
  assert.equal(s.room.windows.length, 0);
});
test('창문 경계·겹침·잘못된 수치·중복 ID·개수 제한을 거절하며 원래 값 보존', () => {
  const s = freshState();
  const id = addWindow(s);
  const before = JSON.stringify(s);
  for (const patch of [
    { width: 20 },
    { width: NaN },
    { offset: -1 },
    { height: 0 },
    { sill: 3 },
    { wall: '__proto__' },
  ]) {
    assert.throws(() => setWindow(s, id, patch));
    assert.equal(JSON.stringify(s), before);
  }
  const w = s.room.windows[0];
  assert.throws(() => validateWindows([w, w], s.room));
  assert.throws(() => validateWindows([w, { ...w, id: 'other' }], s.room));
  assert.throws(() => validateWindows(Array(9).fill(w), s.room));
  assert.throws(() => setRoom(s, roomWithDims(s.room, { w: 1 })));
  assert.equal(JSON.stringify(s), before);
});
test('네 벽의 좌표와 공간 회전 4회의 왕복이 실제 창 위치를 보존', () => {
  const s = freshState();
  s.room.w = 5;
  s.room.d = 3;
  for (const wall of ['back', 'left', 'right', 'front']) addWindow(s, wall);
  const windows = structuredClone(s.room.windows),
    points = windowOpenings(s.room);
  assert.equal(points[0].z, -1.5);
  assert.equal(points[1].x, -2.5);
  const first = points[0];
  rotateSpace(s);
  const rotated = windowOpenings(s.room)[0];
  assert.equal(rotated.x, -first.z);
  assert.equal(rotated.z, first.x);
  for (let i = 0; i < 3; i++) rotateSpace(s);
  assert.deepEqual(s.room.windows, windows);
});
test('벽 사각 구멍의 면적과 집 전체 3D에도 창문 프레임·구멍이 남는다', () => {
  const pieces = wallPieces(0, 4, 3, [{ start: 1, end: 3, bottom: 1, top: 2 }]);
  assert.equal(
    pieces.reduce((sum, p) => sum + (p.end - p.start) * (p.top - p.bottom), 0),
    10,
  );
  const s = freshState();
  addWindow(s);
  const layout = houseLayout(s);
  assert.equal(layout.windows.length, 1);
  const tree = houseStructure(s);
  let frames = 0;
  tree.traverse((o) => {
    if (o.userData.window) frames++;
  });
  assert.equal(frames, 1);
  disposeGroup(tree);
});
test('자동 연결 문은 창문을 피하고 직접 옮긴 문이 창과 겹치면 원자적으로 거절', () => {
  const s = freshState();
  const first = s.roomId;
  addWindow(s, 'right');
  addSpace(s, 'bedroom', 'right');
  const list = spaces(s),
    a = list.find((r) => r.roomId === first);
  const openings = roomOpenings(list, s.floorplan, first);
  const w = windowOpenings(a.room)[0];
  for (const o of openings)
    if (o.wall === w.wall) assert.ok(Math.abs(o.z - w.z) >= (o.width + w.width) / 2 - 0.001);
  const link = connections(list, s.floorplan)[0];
  const center = s.floorplan.positions[first].z + w.z;
  const before = JSON.stringify(s);
  assert.throws(() => setDoor(s, ...link.ids, { center, exact: true }));
  assert.equal(JSON.stringify(s), before);
});
test('추가된 가구는 별칭·상담·실제 형상·검색에 연결되고 빈 결과는 구별된다', () => {
  const cases = {
    office_chair: '사무용 의자',
    stool: '스툴',
    ottoman: '오토만',
    vanity: '화장대',
    hanger: '옷걸이',
    mirror: '전신거울',
    kitchen_counter: '주방 조리대',
    island: '아일랜드 식탁',
    dishwasher: '식세기',
    dryer: '건조기',
    air_purifier: '공기청정기',
    fan: '선풍기',
    standing_ac: '스탠드 에어컨',
    piano: '피아노',
    treadmill: '워킹패드',
    cat_tower: '캣타워',
    drying_rack: '빨래 건조대',
  };
  for (const [type, name] of Object.entries(cases)) {
    assert.equal(detectType(name), type, name);
    assert.ok(catalogMatches(type, name));
    assert.equal(
      planTurn(`${name} 하나 놓아줘`, { state: freshState(), target: { type: 'room' } }).changes
        .draft.type,
      type,
      name,
    );
    const model = furniture(makeItem(type));
    assert.ok(model.children.length > 0, type);
    disposeGroup(model);
  }
  assert.ok(catalogMatches('sofa', 'SOFA'));
  assert.ok(catalogMatches('shelf', '책 장'));
  assert.ok(!catalogMatches('sofa', '없는물건'));
});

test('창 아래 낮은 가구는 허용하고 창 앞의 높은 가구만 가림 경고한다', () => {
  const s = freshState();
  const id = addWindow(s);
  setWindow(s, id, { offset: 1.4, width: 1.2, sill: 0.9, height: 1.1 });
  const shelf = { ...makeItem('shelf'), x: 0, z: -1.85 };
  s.items = [shelf];
  assert.ok(layoutWarnings(s).blockedWindows.has(shelf.id));
  shelf.dims[1] = 80;
  assert.equal(layoutWarnings(s).blockedWindows.size, 0);
});

test('창을 넓혀 기존 문을 없애거나 창 때문에 문 없는 공간을 붙이는 변경은 보존하고 거절', () => {
  const s = freshState(),
    first = s.roomId;
  const id = addWindow(s, 'right');
  addSpace(s, 'bedroom', 'right');
  const current = s.roomId;
  const room = spaces(s).find((r) => r.roomId === first);
  // 활성 공간으로 되돌린 별도 상태에서 기존 문을 가리는 변경을 시도한다.
  const active = { ...s, ...room, otherRooms: spaces(s).filter((r) => r.roomId !== first) };
  const before = JSON.stringify(active);
  assert.throws(() => setWindow(active, id, { offset: 0.05, width: 3.9 }));
  assert.equal(JSON.stringify(active), before);
  const full = freshState();
  const w = addWindow(full, 'right');
  setWindow(full, w, { offset: 0.05, width: 3.9 });
  const snapshot = JSON.stringify(full);
  assert.throws(() => addSpace(full, 'bedroom', 'right'));
  assert.equal(JSON.stringify(full), snapshot);
  assert.ok(current);
});
