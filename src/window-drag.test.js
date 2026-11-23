import test from 'node:test';
import assert from 'node:assert/strict';
import { dragWindowPatch } from './window-drag.js';
import { makeRoom } from './catalog.js';
const room = makeRoom(),
  base = { id: 'w', wall: 'back', offset: 1, width: 1.2, sill: 0.9, height: 1 };
test('창문 이동은 폭·높이를 지키며 벽 안에 제한되고 5cm 스냅한다', () => {
  const p = dragWindowPatch(room, base, { u: 0, v: 0 }, { u: 0.22, v: 0.12 });
  assert.deepEqual(p, { offset: 1.2, width: 1.2, sill: 1, height: 1 });
  const edge = dragWindowPatch(room, base, { u: 0, v: 0 }, { u: -10, v: 10 });
  assert.equal(edge.offset, 0.05);
  assert.equal(edge.sill, 1.35);
});
test('네 모서리는 반대 모서리를 지키고 최소 30cm와 벽 경계를 넘지 않는다', () => {
  for (const mode of ['bl', 'br', 'tr', 'tl'])
    for (const u of [-10, 10])
      for (const v of [-10, 10]) {
        const p = dragWindowPatch(room, base, { u: 0, v: 0 }, { u, v }, mode);
        assert.ok(p.width >= 0.3 && p.height >= 0.3);
        assert.ok(p.offset >= 0.05 && p.sill >= 0.1);
        assert.ok(p.offset + p.width <= room.w - 0.05 + 1e-6);
        assert.ok(p.sill + p.height <= room.h - 0.05 + 1e-6);
        if (mode.includes('l'))
          assert.ok(Math.abs(p.offset + p.width - base.offset - base.width) < 1e-6);
        if (mode.includes('b'))
          assert.ok(Math.abs(p.sill + p.height - base.sill - base.height) < 1e-6);
      }
});
test('2D에서는 폭과 벽을 따른 위치만 바꾸며 창 높이는 보존한다', () => {
  const p = dragWindowPatch(room, base, { u: 0, v: null }, { u: 0.3, v: null }, 'tr');
  assert.equal(p.width, 1.5);
  assert.equal(p.height, base.height);
  assert.equal(p.sill, base.sill);
});
