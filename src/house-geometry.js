import { windowOpenings, wallPieces } from './windows.js';
import { spaces } from './data.js';
import {
  normalizeFloorplan,
  roomBounds,
  sharedOpening,
  roomOpenings,
  findDoor,
} from './floorplan.js';

// 2D와 같은 공간 중심 좌표를 사용한다. 벽은 맞닿는 구간마다 한 번만 만든다.
export function houseLayout(state) {
  const list = spaces(state),
    plan = normalizeFloorplan(state.floorplan, list);
  const rooms = list.map((r) => ({
    ...r,
    position: plan.positions[r.roomId],
    bounds: roomBounds(r, plan.positions[r.roomId]),
    openings: roomOpenings(list, plan, r.roomId),
  }));
  const minX = Math.min(...rooms.map((r) => r.bounds.left)),
    maxX = Math.max(...rooms.map((r) => r.bounds.right));
  const minZ = Math.min(...rooms.map((r) => r.bounds.top)),
    maxZ = Math.max(...rooms.map((r) => r.bounds.bottom));
  const openings = [];
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const o = sharedOpening(
        rooms[i],
        rooms[i].position,
        rooms[j],
        rooms[j].position,
        findDoor(plan, rooms[i].roomId, rooms[j].roomId),
      );
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
  const windows = rooms.flatMap((r) =>
    windowOpenings(r.room, r.position).map((o) => ({ ...o, roomId: r.roomId })),
  );
  const windowWalls = walls.flatMap((w) => {
    const cuts = windows
      .filter(
        (o) =>
          (o.vertical ? 'x' : 'z') === w.axis && Math.abs((o.vertical ? o.x : o.z) - w.at) < 0.02,
      )
      .map((o) => ({
        start: (o.vertical ? o.z : o.x) - o.width / 2,
        end: (o.vertical ? o.z : o.x) + o.width / 2,
        bottom: o.sill,
        top: o.sill + o.height,
      }));
    return wallPieces(w.start, w.end, w.h, cuts).map((p) => ({
      ...w,
      start: p.start,
      end: p.end,
      h: p.top - p.bottom,
      bottom: p.bottom,
    }));
  });
  return {
    rooms,
    windows,
    walls: windowWalls,
    openings,
    w: maxX - minX,
    d: maxZ - minZ,
    h: Math.max(...rooms.map((r) => r.room.h)),
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
  };
}

// 설비는 시각적 배치 초안이다. 2D 기호와 3D 모형이 같은 위치·방향을 쓴다.
// 문이 난 벽의 맞은편에 샤워·변기를 두고 세면대는 옆벽에 붙인다. w는 벽을 따른 폭, d는 벽에서 나온 깊이다.
const TURN = { front: 0, right: 90, back: 180, left: 270 };
export function fixtureFootprint(f) {
  const swap = Math.round(f.angle / 90) % 2 !== 0;
  return { w: swap ? f.d : f.w, d: swap ? f.w : f.d };
}
// 문 앞에 비워 둘 자리. pad는 문 폭 양옆과 깊이에 더하는 여유다.
function doorZone(o, room, pad = 0.05) {
  const depth = o.inward ? o.width + pad : 0.5,
    half = o.width / 2 + pad;
  if (o.vertical) {
    const edge = o.x > 0 ? room.w / 2 : -room.w / 2;
    return {
      left: o.x > 0 ? edge - depth : edge,
      right: o.x > 0 ? edge : edge + depth,
      top: o.z - half,
      bottom: o.z + half,
    };
  }
  const edge = o.z > 0 ? room.d / 2 : -room.d / 2;
  return {
    left: o.x - half,
    right: o.x + half,
    top: o.z > 0 ? edge - depth : edge,
    bottom: o.z > 0 ? edge : edge + depth,
  };
}
export function bathroomFixtures(room, openings = []) {
  // 문 폭 그대로의 통로를 막는 것을 여유 5cm를 침범하는 것보다 훨씬 크게 친다.
  const ways = openings.map((o) => doorZone(o, room, 0)),
    zones = openings.map((o) => doorZone(o, room));
  const build = (turn, mirror) => {
    const quarter = turn % 180 !== 0,
      W = quarter ? room.d : room.w,
      D = quarter ? room.w : room.d;
    const shower = { w: Math.min(0.8, W * 0.44), d: Math.min(0.8, D * 0.36), h: 1.7 },
      toilet = { w: Math.min(0.42, W * 0.3), d: Math.min(0.68, D * 0.4), h: 0.75 },
      basin = { w: Math.min(0.5, D * 0.32), d: Math.min(0.4, W * 0.25), h: 0.82 };
    const rad = (turn * Math.PI) / 180,
      cos = Math.round(Math.cos(rad)),
      sin = Math.round(Math.sin(rad)),
      m = mirror ? -1 : 1;
    const local = [
      { type: 'toilet', ...toilet, x: (m * -shower.w) / 2, z: -D / 2 + toilet.d / 2, angle: 0 },
      {
        type: 'basin',
        ...basin,
        x: m * (W / 2 - basin.d / 2),
        z: Math.min(D / 2 - basin.w / 2, -D / 2 + shower.d + 0.08 + basin.w / 2),
        angle: mirror ? 90 : 270,
      },
      {
        type: 'shower',
        ...shower,
        x: m * (W / 2 - shower.w / 2),
        z: -D / 2 + shower.d / 2,
        angle: 0,
        flip: mirror,
      },
    ];
    return local.map((f) => ({
      ...f,
      x: f.x * cos + f.z * sin,
      z: -f.x * sin + f.z * cos,
      angle: (f.angle + turn) % 360,
    }));
  };
  const overlap = (list, rects) =>
    list.reduce((sum, f) => {
      const p = fixtureFootprint(f);
      return (
        sum +
        rects.reduce(
          (n, r) =>
            n +
            Math.max(0, Math.min(r.right, f.x + p.w / 2) - Math.max(r.left, f.x - p.w / 2)) *
              Math.max(0, Math.min(r.bottom, f.z + p.d / 2) - Math.max(r.top, f.z - p.d / 2)),
          0,
        )
      );
    }, 0);
  const blocked = (list) => overlap(list, ways) * 1000 + overlap(list, zones);
  // 첫 문의 맞은편 벽을 먼저 보고, 문 앞을 막으면 옆벽과 좌우를 뒤집은 안까지 견줘 가장 덜 막는 안을 고른다.
  const first = TURN[openings[0]?.wall] ?? 0;
  let best = null,
    least = Infinity;
  for (const turn of [first, (first + 90) % 360, (first + 270) % 360, (first + 180) % 360])
    for (const mirror of [false, true]) {
      const list = build(turn, mirror),
        area = blocked(list);
      if (area < least - 1e-9) {
        best = list;
        least = area;
      }
    }
  return best;
}
