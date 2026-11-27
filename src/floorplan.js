import { windowOpenings } from './windows.js';
// 각 방의 가구는 로컬 좌표를 유지하고, 집 평면도는 방 중심의 전역 위치만 저장한다.
export function roomBounds(space, position) {
  return {
    left: position.x - space.room.w / 2,
    right: position.x + space.room.w / 2,
    top: position.z - space.room.d / 2,
    bottom: position.z + space.room.d / 2,
  };
}
export function rectanglesOverlap(a, b) {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.005 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.005
  );
}
// 문 설정. 폭은 직접 정하지 않으면 80cm 가정이고, offset은 맞닿은 벽 구간의 가운데에서 떨어진 거리(m)다.
export const DOOR = { width: 0.8, min: 0.6, max: 1.2, margin: 0.05 };
const samePair = (door, a, b) =>
  (door.rooms[0] === a && door.rooms[1] === b) || (door.rooms[0] === b && door.rooms[1] === a);
export const findDoor = (floorplan, a, b) => floorplan?.doors?.find((d) => samePair(d, a, b));
function normalizeDoors(value, list) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw Error('집 평면도의 문 설정이 올바르지 않아요.');
  const ids = new Set(list.map((r) => r.roomId)),
    doors = [];
  for (const d of value) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.rooms) || d.rooms.length !== 2)
      throw Error('집 평면도의 문 설정이 올바르지 않아요.');
    const [a, b] = d.rooms;
    // 지운 공간의 문 설정은 버린다.
    if (a === b || !ids.has(a) || !ids.has(b) || doors.some((x) => samePair(x, a, b))) continue;
    const door = { rooms: [a, b] };
    if (d.offset !== undefined) {
      if (typeof d.offset !== 'number' || !Number.isFinite(d.offset) || Math.abs(d.offset) > 30)
        throw Error('문 위치는 벽 가운데에서 30m 안으로 입력해주세요.');
      if (d.offset) door.offset = d.offset;
    }
    if (d.width !== undefined) {
      if (typeof d.width !== 'number' || !(d.width >= DOOR.min && d.width <= DOOR.max))
        throw Error('문 폭은 60~120cm로 입력해주세요.');
      door.width = d.width;
    }
    if (d.closed === true) door.closed = true;
    if (d.flip === true) door.flip = true;
    if (Object.keys(door).length > 1) doors.push(door);
  }
  return doors;
}
export function normalizeFloorplan(value, list) {
  if (
    value !== undefined &&
    (!value || typeof value !== 'object' || !value.positions || typeof value.positions !== 'object')
  )
    throw Error('집 평면도 위치가 올바르지 않아요.');
  const positions = {};
  let right = -Infinity;
  for (const r of list) {
    const p =
      value?.positions && Object.hasOwn(value.positions, r.roomId)
        ? value.positions[r.roomId]
        : undefined;
    if (
      p &&
      ![p.x, p.z].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 200)
    )
      throw Error('공간 위치는 -200~200m로 입력해주세요.');
    Object.defineProperty(positions, r.roomId, {
      value: p
        ? { x: p.x, z: p.z }
        : { x: Number.isFinite(right) ? right + r.room.w / 2 : 0, z: 0 },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    right = Math.max(right, positions[r.roomId].x + r.room.w / 2);
  }
  const doors = normalizeDoors(value?.doors, list);
  return doors.length ? { positions, doors } : { positions };
}
export function floorplanWarnings(list, floorplan) {
  const conflicts = new Set();
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      if (
        rectanglesOverlap(
          roomBounds(list[i], floorplan.positions[list[i].roomId]),
          roomBounds(list[j], floorplan.positions[list[j].roomId]),
        )
      ) {
        conflicts.add(list[i].roomId);
        conflicts.add(list[j].roomId);
      }
    }
  return conflicts;
}
// 두 공간이 맞닿은 벽 구간. start~end는 벽을 따라 잰 전역 좌표다.
export function sharedWall(a, ap, b, bp) {
  const A = roomBounds(a, ap),
    B = roomBounds(b, bp);
  const z0 = Math.max(A.top, B.top),
    z1 = Math.min(A.bottom, B.bottom);
  if (Math.min(Math.abs(A.right - B.left), Math.abs(A.left - B.right)) < 0.02 && z1 - z0 > 0.02) {
    const aFirst = Math.abs(A.right - B.left) < 0.02;
    return { vertical: true, at: aFirst ? A.right : A.left, start: z0, end: z1, aFirst };
  }
  const x0 = Math.max(A.left, B.left),
    x1 = Math.min(A.right, B.right);
  if (Math.min(Math.abs(A.bottom - B.top), Math.abs(A.top - B.bottom)) < 0.02 && x1 - x0 > 0.02) {
    const aFirst = Math.abs(A.bottom - B.top) < 0.02;
    return { vertical: false, at: aFirst ? A.bottom : A.top, start: x0, end: x1, aFirst };
  }
  return null;
}
// 벽 구간 안에서 문이 놓일 자리. 문을 낼 길이가 안 되면 null이다.
// 직접 정한 위치가 구간을 벗어나면 구간 안으로 당겨 그리되 저장한 값은 바꾸지 않는다.
export function doorPlacement(wall, door = {}) {
  const length = wall.end - wall.start,
    want = door.width ?? DOOR.width;
  if (length + 1e-9 < Math.min(want, DOOR.width) + 0.1) return null;
  const width = Math.min(want, Math.round((length - 0.1) * 100) / 100),
    half = width / 2 + DOOR.margin,
    mid = (wall.start + wall.end) / 2,
    reach = Math.max(0, length / 2 - half);
  return {
    width,
    center: mid + Math.max(-reach, Math.min(reach, door.offset || 0)),
    reach,
    length,
  };
}

// 벽 끝의 여백과 창을 뺀 뒤 문 폭이 들어가는 구간을 돌려준다.
export function doorGaps(wall, windows, width = DOOR.width) {
  const blocked = windows
    .filter(
      (o) =>
        o.vertical === wall.vertical &&
        o.sill < 2.05 &&
        Math.abs((o.vertical ? o.x : o.z) - wall.at) < 0.02,
    )
    .map((o) => [(o.vertical ? o.z : o.x) - o.width / 2, (o.vertical ? o.z : o.x) + o.width / 2])
    .sort((a, b) => a[0] - b[0]);
  const slots = [];
  const limit = wall.end - DOOR.margin;
  let at = wall.start + DOOR.margin;
  for (const [start, end] of blocked) {
    if (start >= limit) break;
    if (start - at >= width - 1e-6) slots.push([at, start]);
    at = Math.max(at, end);
  }
  if (limit - at >= width - 1e-6) slots.push([at, limit]);
  return slots;
}

// 맞닿은 벽의 문. 폭을 정하지 않았으면 80cm 가정이고 위치를 정하지 않았으면 구간 가운데다.
// side는 문짝이 열리는 쪽(+1: +x 또는 +z, -1: 반대)이며 기본은 더 넓은 공간 쪽이다.
export function sharedOpening(a, ap, b, bp, door = {}) {
  const wall = sharedWall(a, ap, b, bp),
    place = wall && !door.closed ? doorPlacement(wall, door) : null;
  if (!place) return null;
  // 자동 문은 창문을 피한 빈 구간으로 옮긴다. 직접 정한 문은 ops에서 충돌을 거절한다.
  if (door.offset === undefined && (a.room.windows?.length || b.room.windows?.length)) {
    const windows = [...windowOpenings(a.room, ap), ...windowOpenings(b.room, bp)];
    const slots = doorGaps(wall, windows, place.width);
    if (!slots.length) return null;
    place.center = slots
      .map(([lo, hi]) =>
        Math.max(lo + place.width / 2, Math.min(hi - place.width / 2, place.center)),
      )
      .sort((x, y) => Math.abs(x - place.center) - Math.abs(y - place.center))[0];
  }
  // 넓이가 같으면 왼쪽·위쪽 공간으로 연다. 두 공간의 순서를 바꿔 불러도 결과가 같다.
  const areaA = a.room.w * a.room.d,
    areaB = b.room.w * b.room.d,
    side = (areaA > areaB || (areaA === areaB && wall.aFirst)) === wall.aFirst ? -1 : 1;
  return {
    x: wall.vertical ? wall.at : place.center,
    z: wall.vertical ? place.center : wall.at,
    vertical: wall.vertical,
    width: place.width,
    side: door.flip ? -side : side,
    // 위치나 폭을 직접 정한 문인지. 화면에서 가정값과 구별해 그린다.
    custom: door.offset !== undefined || door.width !== undefined,
    measured: door.width !== undefined,
  };
}
// 문을 낼 수 있는 맞닿은 벽 전부. 막아 둔 벽도 다시 열 수 있게 함께 돌려준다.
export function connections(list, floorplan) {
  const found = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i],
        b = list[j],
        ap = floorplan.positions[a.roomId],
        bp = floorplan.positions[b.roomId];
      if (!ap || !bp) continue;
      const wall = sharedWall(a, ap, b, bp),
        door = findDoor(floorplan, a.roomId, b.roomId) || {},
        place = wall && doorPlacement(wall, door);
      if (!place) continue;
      const opening = sharedOpening(a, ap, b, bp, door);
      found.push({
        ids: [a.roomId, b.roomId],
        names: [a.name, b.name],
        wall,
        door,
        ...place,
        center: opening ? (opening.vertical ? opening.z : opening.x) : place.center,
        closed: !!door.closed || !opening,
        opening,
      });
    }
  return found;
}
// 한 공간의 벽에 난 연결 문을 그 공간의 로컬 좌표로 옮긴다. inward는 문짝이 이 공간 안으로 열리는지다.
export function roomOpenings(list, floorplan, roomId) {
  const self = list.find((r) => r.roomId === roomId),
    p = self && floorplan.positions[roomId];
  if (!p) return [];
  const found = [];
  for (const other of list) {
    if (other.roomId === roomId || !floorplan.positions[other.roomId]) continue;
    const o = sharedOpening(
      self,
      p,
      other,
      floorplan.positions[other.roomId],
      findDoor(floorplan, roomId, other.roomId),
    );
    if (!o) continue;
    const x = o.x - p.x,
      z = o.z - p.z,
      positive = o.vertical ? x > 0 : z > 0;
    found.push({
      x,
      z,
      vertical: o.vertical,
      width: o.width,
      wall: o.vertical ? (positive ? 'right' : 'left') : positive ? 'front' : 'back',
      side: o.side,
      inward: o.side > 0 !== positive,
      custom: o.custom,
      measured: o.measured,
      roomId: other.roomId,
      name: other.name,
      type: other.room.type,
    });
  }
  return found;
}
// 문짝 기호의 기준점. 경첩에서 along 방향이 닫힌 문, leaf 방향이 열린 문이다(2D·3D 공용).
export function doorSwing(o) {
  return o.vertical
    ? { hinge: [o.x, o.z + o.width / 2], along: [0, -1], leaf: [o.side, 0] }
    : { hinge: [o.x - o.width / 2, o.z], along: [1, 0], leaf: [0, o.side] };
}
