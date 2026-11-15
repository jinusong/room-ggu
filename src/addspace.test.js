import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, spaces, makeRoom } from './data.js';
import { connections, roomBounds, rectanglesOverlap } from './floorplan.js';
import { addSpace, sideSlot, switchSpace, moveSpace, SIDES } from './app/ops.js';

const bounds = (s, id) =>
  roomBounds(
    spaces(s).find((r) => r.roomId === id),
    s.floorplan.positions[id],
  );

test('벽의 + 손잡이로 붙인 공간은 그 벽에 틈 없이 맞닿고 시작 끝을 맞추며 문이 생긴다', () => {
  for (const side of Object.keys(SIDES)) {
    const s = freshState(),
      studio = s.roomId,
      id = addSpace(s, 'bedroom', side),
      a = bounds(s, studio),
      b = bounds(s, id);
    assert.equal(s.roomId, id, '새 공간이 고른 공간이 된다');
    if (side === 'right') assert.ok(Math.abs(b.left - a.right) < 1e-9);
    if (side === 'left') assert.ok(Math.abs(b.right - a.left) < 1e-9);
    if (side === 'front') assert.ok(Math.abs(b.top - a.bottom) < 1e-9);
    if (side === 'back') assert.ok(Math.abs(b.bottom - a.top) < 1e-9);
    // 세로 벽에는 위쪽 끝을, 가로 벽에는 왼쪽 끝을 맞춘다.
    if (side === 'right' || side === 'left') assert.ok(Math.abs(b.top - a.top) < 1e-9);
    else assert.ok(Math.abs(b.left - a.left) < 1e-9);
    assert.equal(rectanglesOverlap(a, b), false);
    const [link] = connections(spaces(s), s.floorplan);
    assert.ok(link?.opening, `${side}에 문이 난다`);
  }
});

test('막힌 자리는 벽을 따라 밀어 놓고, 문을 낼 만큼 맞닿을 자리가 없으면 이유를 알린다', () => {
  const s = freshState(),
    studio = s.roomId;
  // 원룸 오른쪽 위에 화장실을 붙인 뒤, 같은 벽에 침실을 붙이면 화장실 아래로 밀려 놓인다.
  const bath = addSpace(s, 'bathroom', 'right');
  switchSpace(s, studio);
  const size = makeRoom('office'),
    slot = sideSlot(s, 'right', size);
  assert.ok(slot, '화장실 아래에 자리가 있다');
  const office = addSpace(s, 'office', 'right');
  assert.equal(rectanglesOverlap(bounds(s, office), bounds(s, bath)), false);
  assert.ok(Math.abs(bounds(s, office).left - bounds(s, studio).right) < 1e-9);
  // 문을 낼 수 있게 원룸 벽과 90cm 넘게 맞닿는다.
  const shared =
    Math.min(bounds(s, office).bottom, bounds(s, studio).bottom) -
    Math.max(bounds(s, office).top, bounds(s, studio).top);
  assert.ok(shared >= 0.9 - 1e-9);
  // 이제 오른쪽 벽은 가득 찼다.
  switchSpace(s, studio);
  assert.equal(sideSlot(s, 'right', makeRoom('bathroom')), null);
  const before = structuredClone(s);
  assert.throws(() => addSpace(s, 'living', 'right'), /오른쪽에는 거실을 붙일 자리가 없어요/);
  assert.deepEqual(s, before, '실패하면 아무것도 바꾸지 않는다');
  assert.equal(sideSlot(s, 'nowhere', size), null);
});

test('공간을 옮겨 벽을 비우면 그 벽에 다시 붙일 수 있고, 벽을 고르지 않으면 가까운 빈자리에 놓는다', () => {
  const s = freshState(),
    studio = s.roomId,
    bed = addSpace(s, 'bedroom', 'right');
  switchSpace(s, studio);
  assert.equal(sideSlot(s, 'right', makeRoom('living')), null);
  moveSpace(s, bed, 30, 30, { snap: false });
  assert.ok(sideSlot(s, 'right', makeRoom('living')));
  const auto = addSpace(s, 'kitchen');
  assert.equal(
    spaces(s).some(
      (r) => r.roomId !== auto && rectanglesOverlap(bounds(s, auto), bounds(s, r.roomId)),
    ),
    false,
  );
});
