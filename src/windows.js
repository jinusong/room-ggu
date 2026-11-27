// 창문 치수와 위치는 m. offset은 벽의 왼쪽(옆벽은 위쪽) 끝에서 창 시작까지다.
export const WINDOW_WALLS = {
  back: '뒤쪽 벽',
  left: '왼쪽 벽',
  right: '오른쪽 벽',
  front: '앞쪽 벽',
};
export const MAX_WINDOWS = 8;
export const wallLength = (room, wall) => (['left', 'right'].includes(wall) ? room.d : room.w);
const overlap = (a, b, c, d) => Math.min(b, d) - Math.max(a, c) > 0.001;

export function validateWindows(value, room) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_WINDOWS)
    throw Error('창문은 방마다 최대 8개까지 설정해요.');
  const ids = new Set();
  const list = value.map((w) => {
    if (
      !w ||
      typeof w.id !== 'string' ||
      !w.id ||
      w.id.length > 100 ||
      ids.has(w.id) ||
      !Object.hasOwn(WINDOW_WALLS, w.wall)
    )
      throw Error('창문 정보가 올바르지 않아요.');
    ids.add(w.id);
    for (const k of ['offset', 'width', 'height', 'sill'])
      if (!Number.isFinite(w[k])) throw Error('창문 치수와 위치를 숫자로 입력해 주세요.');
    if (w.width < 0.3 || w.height < 0.3 || w.offset < 0.05 || w.sill < 0.1)
      throw Error(
        '창 폭과 높이는 30cm 이상, 벽 끝 여백은 5cm 이상, 바닥 높이는 10cm 이상으로 입력해 주세요.',
      );
    if (
      w.offset + w.width > wallLength(room, w.wall) - 0.05 + 1e-6 ||
      w.sill + w.height > room.h - 0.05 + 1e-6
    )
      throw Error(
        '창문이 벽을 벗어나요. 창 크기를 줄이거나 위치를 옮기거나 방 크기를 늘려 주세요.',
      );
    return {
      id: w.id,
      wall: w.wall,
      offset: w.offset,
      width: w.width,
      height: w.height,
      sill: w.sill,
    };
  });
  for (let i = 0; i < list.length; i++)
    for (const b of list.slice(i + 1)) {
      const a = list[i];
      if (
        a.wall === b.wall &&
        overlap(a.offset, a.offset + a.width, b.offset, b.offset + b.width) &&
        overlap(a.sill, a.sill + a.height, b.sill, b.sill + b.height)
      )
        throw Error('창문끼리 겹쳐요. 벽이나 위치, 크기를 바꿔 주세요.');
    }
  return list;
}

export function windowOpenings(room, position = { x: 0, z: 0 }) {
  return (room.windows || []).map((w) => {
    const vertical = ['left', 'right'].includes(w.wall);
    const center = -wallLength(room, w.wall) / 2 + w.offset + w.width / 2;
    return {
      ...w,
      vertical,
      x: position.x + (vertical ? (w.wall === 'left' ? -room.w / 2 : room.w / 2) : center),
      z: position.z + (vertical ? center : w.wall === 'back' ? -room.d / 2 : room.d / 2),
    };
  });
}

export function assertWindowDoors(room, doors) {
  for (const w of windowOpenings(room))
    for (const d of doors)
      if (
        w.wall === d.wall &&
        w.sill < 2.05 &&
        overlap(
          (w.vertical ? w.z : w.x) - w.width / 2,
          (w.vertical ? w.z : w.x) + w.width / 2,
          (d.vertical ? d.z : d.x) - d.width / 2,
          (d.vertical ? d.z : d.x) + d.width / 2,
        )
      )
        throw Error('창문과 연결 문이 겹쳐요. 창문이나 문 위치를 옮겨 주세요.');
}

// 사각 구멍(문·창) 바깥의 벽 조각. 모든 조각은 같은 좌표계와 높이를 쓴다.
export function wallPieces(from, to, height, cuts = [], bottom = 0) {
  const xs = [
    ...new Set([
      from,
      to,
      ...cuts.flatMap((c) => [
        Math.max(from, Math.min(to, c.start)),
        Math.max(from, Math.min(to, c.end)),
      ]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      bottom,
      height,
      ...cuts.flatMap((c) => [
        Math.max(bottom, Math.min(height, c.bottom)),
        Math.max(bottom, Math.min(height, c.top)),
      ]),
    ]),
  ].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 1; i < xs.length; i++)
    for (let j = 1; j < ys.length; j++) {
      const start = xs[i - 1],
        end = xs[i],
        low = ys[j - 1],
        high = ys[j],
        x = (start + end) / 2,
        y = (low + high) / 2;
      if (
        end - start > 0.001 &&
        high - low > 0.001 &&
        !cuts.some((c) => x > c.start && x < c.end && y > c.bottom && y < c.top)
      )
        pieces.push({ start, end, bottom: low, top: high });
    }
  return pieces;
}

export function rotateWindows(room, before) {
  const turn = { back: 'right', right: 'front', front: 'left', left: 'back' };
  room.windows = (room.windows || []).map((w) => ({
    ...w,
    wall: turn[w.wall],
    offset: ['left', 'right'].includes(w.wall)
      ? Math.max(0.05, Number((wallLength(before, w.wall) - w.offset - w.width).toFixed(12)))
      : w.offset,
  }));
}
