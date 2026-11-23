import { wallLength } from './windows.js';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, snap) => Math.round(v * (snap ? 20 : 100)) / (snap ? 20 : 100);

// 포인터를 누른 곳과의 차이로 계산해 손잡이의 터치 여백에서도 창이 튀지 않는다.
export function dragWindowPatch(room, base, start, point, mode = 'move', snap = true) {
  const dx = round(point.u - start.u, snap),
    dy = point.v === null || start.v === null ? 0 : round(point.v - start.v, snap),
    right = base.offset + base.width,
    top = base.sill + base.height,
    end = wallLength(room, base.wall) - 0.05;
  let { offset, width, sill, height } = base;
  if (mode === 'move') {
    offset = clamp(base.offset + dx, 0.05, end - width);
    sill = clamp(base.sill + dy, 0.1, room.h - 0.05 - height);
  } else {
    if (mode.includes('l')) {
      offset = clamp(base.offset + dx, 0.05, right - 0.3);
      width = right - offset;
    }
    if (mode.includes('r')) width = clamp(base.width + dx, 0.3, end - offset);
    if (point.v !== null) {
      if (mode.includes('t')) height = clamp(base.height + dy, 0.3, room.h - 0.05 - sill);
      if (mode.includes('b')) {
        sill = clamp(base.sill + dy, 0.1, top - 0.3);
        height = top - sill;
      }
    }
  }
  return Object.fromEntries(
    Object.entries({ offset, width, sill, height }).map(([k, v]) => [
      k,
      Math.round(v * 1000) / 1000,
    ]),
  );
}
