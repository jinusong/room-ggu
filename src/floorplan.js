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
  return { positions };
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
// 맞닿은 벽의 80cm 개구부를 연결 초안으로 그린다. 실제 문 위치는 측정값이 아니다.
// side는 문짝이 열리는 쪽(+1: +x 또는 +z, -1: 반대)이며 더 넓은 공간 쪽으로 연다.
export function sharedOpening(a, ap, b, bp) {
  const A = roomBounds(a, ap),
    B = roomBounds(b, bp);
  // 넓이가 같으면 왼쪽·위쪽 공간으로 연다. 두 공간의 순서를 바꿔 불러도 결과가 같다.
  const areaA = a.room.w * a.room.d,
    areaB = b.room.w * b.room.d,
    side = (aFirst) => ((areaA > areaB || (areaA === areaB && aFirst)) === aFirst ? -1 : 1);
  const z0 = Math.max(A.top, B.top),
    z1 = Math.min(A.bottom, B.bottom);
  if (Math.min(Math.abs(A.right - B.left), Math.abs(A.left - B.right)) < 0.02 && z1 - z0 >= 0.9) {
    const aFirst = Math.abs(A.right - B.left) < 0.02;
    return {
      x: aFirst ? A.right : A.left,
      z: (z0 + z1) / 2,
      vertical: true,
      width: 0.8,
      side: side(aFirst),
    };
  }
  const x0 = Math.max(A.left, B.left),
    x1 = Math.min(A.right, B.right);
  if (Math.min(Math.abs(A.bottom - B.top), Math.abs(A.top - B.bottom)) < 0.02 && x1 - x0 >= 0.9) {
    const aFirst = Math.abs(A.bottom - B.top) < 0.02;
    return {
      x: (x0 + x1) / 2,
      z: aFirst ? A.bottom : A.top,
      vertical: false,
      width: 0.8,
      side: side(aFirst),
    };
  }
  return null;
}
// 한 공간의 벽에 난 연결 문을 그 공간의 로컬 좌표로 옮긴다. inward는 문짝이 이 공간 안으로 열리는지다.
export function roomOpenings(list, floorplan, roomId) {
  const self = list.find((r) => r.roomId === roomId),
    p = self && floorplan.positions[roomId];
  if (!p) return [];
  const found = [];
  for (const other of list) {
    if (other.roomId === roomId || !floorplan.positions[other.roomId]) continue;
    const o = sharedOpening(self, p, other, floorplan.positions[other.roomId]);
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
      roomId: other.roomId,
      name: other.name,
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
