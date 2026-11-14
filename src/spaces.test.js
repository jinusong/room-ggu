import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPES,
  ROOM_TYPES,
  freshState,
  makeItem,
  addRoom,
  switchRoom,
  spaces,
  validateState,
  layoutWarnings,
} from './data.js';
import { furniture, disposeGroup } from './furniture.js';
import { detectType, applyModelResult } from './estimator.js';
test('20종 가구의 60개 이상 초안이 유효하며 실제 3D 형상이 있다', () => {
  assert.equal(Object.keys(TYPES).length, 20);
  assert.ok(Object.values(TYPES).reduce((n, t) => n + t.presets.length, 0) >= 60);
  for (const [type, t] of Object.entries(TYPES))
    for (const preset of t.presets) {
      const item = { ...makeItem(type), dims: preset.dims };
      const s = freshState();
      s.items = [item];
      assert.deepEqual(validateState(s).items[0].dims, preset.dims);
      const mesh = furniture(item);
      assert.ok(mesh.children.length > 0, type);
      disposeGroup(mesh);
    }
});
test('공간 전환·저장·복원 시 방별 치수와 가구를 보존한다', () => {
  const s = freshState(),
    first = s.roomId;
  s.items.push(makeItem('bed'));
  addRoom(s, 'living');
  const second = s.roomId;
  s.room.w = 6;
  s.items.push(makeItem('sofa'));
  switchRoom(s, first);
  assert.equal(s.items[0].type, 'bed');
  assert.equal(s.room.w, 4);
  const restored = validateState(JSON.parse(JSON.stringify(s)));
  switchRoom(restored, second);
  assert.equal(restored.items[0].type, 'sofa');
  assert.equal(restored.room.w, 6);
  assert.deepEqual(
    spaces(restored).map((r) => r.roomId),
    [first, second],
  );
});
test('이전 배치 파일을 이동하고 손상된 공간 모음과 13번째 공간을 거절한다', () => {
  const old = { version: 2, name: '이전 방', room: { w: 4, d: 3, h: 2.4 }, items: [] };
  assert.equal(validateState(old).version, 4);
  assert.equal(validateState(old).room.d, 3);
  const s = freshState();
  assert.throws(() => validateState({ ...s, otherRooms: [{ ...s }] }));
  for (let i = 0; i < 11; i++) addRoom(s, 'bedroom');
  assert.throws(() => addRoom(s, 'office'));
  assert.equal(spaces(validateState(s)).length, 12);
  assert.equal(Object.keys(ROOM_TYPES).length, 8);
});
test('러그 위 가구는 충돌에서 제외하고 방 밖 위치는 경고한다', () => {
  const s = freshState();
  s.items = [makeItem('rug'), makeItem('coffee')];
  assert.equal(layoutWarnings(s).conflicts.size, 0);
  s.items[1].x = 3;
  assert.equal(layoutWarnings(s).oversized.size, 1);
});
test('새 가구 유형을 구분하고 AI 단서가 유효한 치수만 제안한다', () => {
  for (const [text, type] of [
    ['소파테이블', 'coffee'],
    ['식탁', 'dining'],
    ['신발장', 'shoe_cabinet'],
    ['세탁기', 'washer'],
  ])
    assert.equal(detectType(text), type);
  for (const type of Object.keys(TYPES)) {
    const r = applyModelResult(
      '{"size":"large","height_profile":"low","depth_profile":"deep","reply":"초안을 조절했어요."}',
      makeItem(type),
    );
    assert.ok(r.item.dims.every(Number.isFinite));
  }
});
