import { spaces } from './data.js';
import { normalizeFloorplan, roomBounds, sharedOpening } from './floorplan.js';

// 2D와 같은 공간 중심 좌표를 사용한다. 벽은 맞닿는 구간마다 한 번만 만든다.
export function houseLayout(state) {
  const list = spaces(state),
    plan = normalizeFloorplan(state.floorplan, list);
  const rooms = list.map((r) => ({
    ...r,
    position: plan.positions[r.roomId],
    bounds: roomBounds(r, plan.positions[r.roomId]),
  }));
  const minX = Math.min(...rooms.map((r) => r.bounds.left)),
    maxX = Math.max(...rooms.map((r) => r.bounds.right));
  const minZ = Math.min(...rooms.map((r) => r.bounds.top)),
    maxZ = Math.max(...rooms.map((r) => r.bounds.bottom));
  const openings = [];
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const o = sharedOpening(rooms[i], rooms[i].position, rooms[j], rooms[j].position);
      if (o) openings.push({ ...o, roomIds: [rooms[i].roomId, rooms[j].roomId] });
    }
  const lines = new Map();
  for (const r of rooms) {
    const b = r.bounds;
    for (const [axis, at, start, end, side] of [
      ['x', b.left, b.top, b.bottom, 'back'],
      ['x', b.right, b.top, b.bottom, 'front'],
      ['z', b.top, b.left, b.right, 'back'],
      ['z', b.bottom, b.left, b.right, 'front'],
    ]) {
      // 1cm 위치 저장 시 생기는 미세한 오차도 2D의 연결 판정과 맞춘다.
      const key =
        [...lines.keys()].find(
          (key) => lines.get(key).axis === axis && Math.abs(lines.get(key).at - at) < 0.02,
        ) || `${axis}:${Math.round(at * 1e5)}`;
      if (!lines.has(key)) lines.set(key, { axis, at, edges: [] });
      lines.get(key).edges.push({ start, end, side, roomId: r.roomId, h: r.room.h });
    }
  }
  const walls = [];
  for (const { axis, at, edges } of lines.values()) {
    const doors = openings.filter(
      (o) => (o.vertical ? 'x' : 'z') === axis && Math.abs((o.vertical ? o.x : o.z) - at) < 0.02,
    );
    const endpoints = [
      ...new Set([
        ...edges.flatMap((e) => [e.start, e.end]),
        ...doors.flatMap((o) => [
          (o.vertical ? o.z : o.x) - o.width / 2,
          (o.vertical ? o.z : o.x) + o.width / 2,
        ]),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 1; i < endpoints.length; i++) {
      const start = endpoints[i - 1],
        end = endpoints[i],
        mid = (start + end) / 2;
      const owners = edges.filter((e) => mid > e.start - 0.001 && mid < e.end + 0.001);
      if (
        !owners.length ||
        end - start < 0.001 ||
        doors.some((o) => Math.abs(mid - (o.vertical ? o.z : o.x)) < o.width / 2 - 0.001)
      )
        continue;
      // 전체 모형은 내부 벽을 낮춰 가구와 화장실을 들여다보는 단면으로 보여준다.
      const h = owners.length > 1 ? 0.85 : owners[0].side === 'front' ? 0.12 : owners[0].h;
      walls.push({ axis, at, start, end, h, roomId: owners[0].roomId, shared: owners.length > 1 });
    }
  }
  return {
    rooms,
    walls,
    openings,
    w: maxX - minX,
    d: maxZ - minZ,
    h: Math.max(...rooms.map((r) => r.room.h)),
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
  };
}

// 설비는 시각적 배치 초안이다. 2D 기호와 3D 모형이 같은 위치를 쓴다.
export function bathroomFixtures(room) {
  return [
    {
      type: 'toilet',
      x: -room.w * 0.27,
      z: -room.d * 0.15,
      w: Math.min(0.42, room.w * 0.3),
      d: Math.min(0.68, room.d * 0.4),
      h: 0.75,
    },
    {
      type: 'basin',
      x: room.w * 0.25,
      z: -room.d * 0.29,
      w: Math.min(0.5, room.w * 0.32),
      d: Math.min(0.4, room.d * 0.25),
      h: 0.82,
    },
    {
      type: 'shower',
      x: room.w * 0.22,
      z: room.d * 0.25,
      w: Math.min(0.8, room.w * 0.44),
      d: Math.min(0.8, room.d * 0.36),
      h: 1.7,
    },
  ];
}
