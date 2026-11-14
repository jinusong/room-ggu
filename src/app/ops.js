// 상태 변경 연산. 모든 함수는 앱 상태(v4)를 직접 바꾸고, 대화에 보여줄 변경 내역을 돌려준다.
// 숫자 범위·경계·충돌 검사는 여기서 끝낸다. AI와 UI는 이 함수만 호출한다.
import {
  TYPES,
  ROOM_TYPES,
  WALL_COLORS,
  FLOOR_COLORS,
  FURNITURE_COLORS,
  makeRoom,
} from '../catalog.js';
import {
  clampItem,
  overlaps,
  footprint,
  layoutWarnings,
  newId,
  addRoom,
  switchRoom,
  spaces,
  exampleState,
  DEFAULT_SOURCE,
} from '../data.js';
import { defaultAvatar, POSES, SEATS } from '../avatar.js';
import { normalizeFloorplan, roomBounds, rectanglesOverlap } from '../floorplan.js';

export const round2 = (n) => Math.round(n * 100) / 100;
export const fmtM = (n) => `${round2(n)}m`;
export const fmtCm = (n) => `${Math.round(n * 10) / 10}cm`;
export const pyeong = (w, d) => (w * d) / 3.3058;
export const isUserSource = (s) => typeof s === 'string' && s.startsWith('사용자');
export const MAX_ITEMS = 100;

const named = (hex, list) =>
  list.find(([, c]) => c.toLowerCase() === String(hex).toLowerCase())?.[0] || hex;
export const wallName = (hex) => named(hex, WALL_COLORS);
export const floorName = (hex) => named(hex, FLOOR_COLORS);
export const furnitureColorName = (hex) => named(hex, FURNITURE_COLORS);

export function diffRoom(before, after) {
  const rows = [];
  if (before.type !== after.type)
    rows.push({
      label: '공간 유형',
      from: ROOM_TYPES[before.type].name,
      to: ROOM_TYPES[after.type].name,
    });
  for (const [k, label] of [
    ['w', '가로'],
    ['d', '세로'],
    ['h', '천장'],
  ])
    if (before[k] !== after[k]) rows.push({ label, from: fmtM(before[k]), to: fmtM(after[k]) });
  if (before.wallColor !== after.wallColor)
    rows.push({
      label: '벽',
      from: wallName(before.wallColor),
      to: wallName(after.wallColor),
      swatch: after.wallColor,
    });
  if (before.floorColor !== after.floorColor)
    rows.push({
      label: '바닥',
      from: floorName(before.floorColor),
      to: floorName(after.floorColor),
      swatch: after.floorColor,
    });
  return rows;
}

export function diffItem(before, after) {
  const rows = [];
  if (before.type !== after.type)
    rows.push({ label: '종류', from: TYPES[before.type].name, to: TYPES[after.type].name });
  for (const [i, label] of [
    [0, '가로'],
    [2, '깊이'],
    [1, '높이'],
  ])
    if (before.dims[i] !== after.dims[i])
      rows.push({ label, from: fmtCm(before.dims[i]), to: fmtCm(after.dims[i]) });
  if (before.color !== after.color)
    rows.push({
      label: '색상',
      from: furnitureColorName(before.color),
      to: furnitureColorName(after.color),
      swatch: after.color,
    });
  if (before.angle !== after.angle)
    rows.push({
      label: '회전',
      from: `${Math.round(before.angle)}°`,
      to: `${Math.round(after.angle)}°`,
    });
  if (before.name !== after.name) rows.push({ label: '이름', from: before.name, to: after.name });
  return rows;
}

const validRoomNumber = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 15;
const validDim = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 1500;
const validColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

// 방 전체를 검증한 뒤 교체한다. 가구는 새 경계 안으로 옮긴다.
export function setRoom(state, room) {
  for (const k of ['w', 'd', 'h'])
    if (!validRoomNumber(room[k])) throw Error('방 치수는 1~15m 범위로 알려주세요.');
  if (!Object.hasOwn(ROOM_TYPES, room.type)) throw Error('알 수 없는 공간 유형이에요.');
  if (!validColor(room.wallColor) || !validColor(room.floorColor))
    throw Error('마감 색상이 올바르지 않아요.');
  const before = state.room;
  state.room = room;
  for (const a of state.items) clampItem(a, room);
  return diffRoom(before, room);
}

export function roomWithDims(room, patch, source = '사용자 설정') {
  const next = structuredClone(room);
  for (const [k, v] of Object.entries(patch)) {
    if (!['w', 'd', 'h'].includes(k)) continue;
    if (!validRoomNumber(v)) throw Error('방 치수는 1~15m 범위로 알려주세요.');
    next[k] = round2(v);
    next.sources[k] = source;
  }
  return next;
}

// 공간 유형만 바꾸고, 사용자가 정한 치수는 남긴다.
export function roomWithType(room, type) {
  if (!Object.hasOwn(ROOM_TYPES, type)) throw Error('알 수 없는 공간 유형이에요.');
  const next = structuredClone(room),
    base = makeRoom(type);
  next.type = type;
  for (const k of ['w', 'd', 'h'])
    if (!isUserSource(room.sources[k])) {
      next[k] = base[k];
      next.sources[k] = '공간 유형 기본값';
    }
  return next;
}

export function roomWithPreset(room, index) {
  const size = ROOM_TYPES[room.type].sizes[index];
  if (!size) throw Error('크기 초안을 찾지 못했어요.');
  const next = structuredClone(room);
  for (const [i, k] of ['w', 'd', 'h'].entries()) {
    next[k] = size[i];
    next.sources[k] = '사용자 선택 · 크기 초안';
  }
  return next;
}

export function roomWithFinish(room, key, color) {
  if (!['wallColor', 'floorColor'].includes(key) || !validColor(color))
    throw Error('마감 색상이 올바르지 않아요.');
  return { ...structuredClone(room), [key]: color.toLowerCase() };
}

function oversizedAt(item, room) {
  const f = footprint(item);
  return f.w > room.w + 0.001 || f.d > room.d + 0.001 || item.dims[1] / 100 > room.h;
}

// 빈자리를 찾는다. 먼저 벽에 붙여 방 안쪽을 보게 두고(여유 30cm), 없으면 방 안쪽,
// 그래도 없으면 여유 없이 찾는다. 러그는 겹침 검사에서 빠지므로 바닥 가운데부터 둔다.
const MARGIN = 0.3;
function freeAt(c, others, margin) {
  const probe = margin
    ? { ...c, dims: [c.dims[0] + margin * 200, c.dims[1], c.dims[2] + margin * 200] }
    : c;
  return !others.some((o) => overlaps(probe, o));
}
function wallSpots(item, room) {
  const spots = [],
    w = item.dims[0] / 100,
    d = item.dims[2] / 100;
  const step = 0.25;
  // [각도, 벽에 붙는 좌표 계산] — 0° 뒤 벽, 90° 왼쪽 벽, 270° 오른쪽 벽, 180° 앞 벽
  for (let x = -room.w / 2 + w / 2; x <= room.w / 2 - w / 2 + 0.001; x += step)
    spots.push({ x, z: -room.d / 2 + d / 2, angle: 0 });
  for (let z = -room.d / 2 + w / 2; z <= room.d / 2 - w / 2 + 0.001; z += step)
    spots.push({ x: -room.w / 2 + d / 2, z, angle: 90 });
  for (let z = -room.d / 2 + w / 2; z <= room.d / 2 - w / 2 + 0.001; z += step)
    spots.push({ x: room.w / 2 - d / 2, z, angle: 270 });
  for (let x = -room.w / 2 + w / 2; x <= room.w / 2 - w / 2 + 0.001; x += step)
    spots.push({ x, z: room.d / 2 - d / 2, angle: 180 });
  return spots;
}
function gridSpots(room, angle) {
  const spots = [];
  for (let z = -room.d / 2 + 0.3; z < room.d / 2; z += 0.25)
    for (let x = -room.w / 2 + 0.3; x < room.w / 2; x += 0.25) spots.push({ x, z, angle });
  return spots;
}
export function findFreeSpot(state, item) {
  const room = state.room,
    others = state.items.filter((o) => o.id !== item.id);
  const fallback = { ...item, x: 0, z: 0 };
  clampItem(fallback, room);
  const result = (c, free) => ({ x: c.x, z: c.z, angle: c.angle, free });
  if (oversizedAt(item, room)) return result(fallback, false);
  if (item.type === 'rug') {
    const c = { ...item, x: 0, z: 0, angle: item.angle || 0 };
    clampItem(c, room);
    return result(c, true);
  }
  const passes = [
    [wallSpots(item, room), MARGIN],
    [gridSpots(room, item.angle || 0), MARGIN],
    [gridSpots(room, item.angle || 0), 0],
  ];
  for (const [spots, margin] of passes)
    for (const spot of spots) {
      const c = { ...item, ...spot };
      clampItem(c, room);
      if (!oversizedAt(c, room) && freeAt(c, others, margin)) return result(c, true);
    }
  return result(fallback, false);
}

export function sanitizeItem(a) {
  if (!a || !Object.hasOwn(TYPES, a.type)) throw Error('가구 종류가 올바르지 않아요.');
  if (!Array.isArray(a.dims) || a.dims.length !== 3 || !a.dims.every(validDim))
    throw Error('가구 치수는 1~1500cm로 입력해주세요.');
  if (!validColor(a.color)) throw Error('가구 색상이 올바르지 않아요.');
  return {
    id: typeof a.id === 'string' && a.id ? a.id.slice(0, 100) : newId(),
    type: a.type,
    name: String(a.name || TYPES[a.type].name).slice(0, 100),
    dims: a.dims.map((n) => Math.round(n * 10) / 10),
    sources:
      Array.isArray(a.sources) && a.sources.length === 3
        ? a.sources.map((x) => (typeof x === 'string' ? x.slice(0, 120) : DEFAULT_SOURCE))
        : [DEFAULT_SOURCE, DEFAULT_SOURCE, DEFAULT_SOURCE],
    color: a.color.toLowerCase(),
    x: Number.isFinite(a.x) ? a.x : 0,
    z: Number.isFinite(a.z) ? a.z : 0,
    angle: Number.isFinite(a.angle) ? ((a.angle % 360) + 360) % 360 : 0,
  };
}

export function placeItem(state, draft) {
  if (state.items.length >= MAX_ITEMS) throw Error('가구는 한 방에 100개까지 놓을 수 있어요.');
  const item = sanitizeItem({ ...draft, id: newId(), angle: draft.angle || 0 });
  const spot = findFreeSpot(state, item);
  item.x = spot.x;
  item.z = spot.z;
  item.angle = spot.angle;
  clampItem(item, state.room);
  state.items.push(item);
  return { item, free: spot.free };
}

export function updateItem(state, id, next) {
  const i = state.items.findIndex((a) => a.id === id);
  if (i < 0) throw Error('가구를 찾지 못했어요.');
  const before = state.items[i],
    after = sanitizeItem({ ...next, id });
  clampItem(after, state.room);
  state.items[i] = after;
  return diffItem(before, after);
}

export function removeItem(state, id) {
  const item = state.items.find((a) => a.id === id);
  if (!item) throw Error('가구를 찾지 못했어요.');
  state.items = state.items.filter((a) => a.id !== id);
  return item;
}

export function rotateItem(state, id, deg = 90) {
  const a = state.items.find((x) => x.id === id);
  if (!a) throw Error('가구를 찾지 못했어요.');
  const before = a.angle;
  a.angle = (((a.angle + deg) % 360) + 360) % 360;
  clampItem(a, state.room);
  return [{ label: '회전', from: `${Math.round(before)}°`, to: `${Math.round(a.angle)}°` }];
}

export function duplicateItem(state, id) {
  const a = state.items.find((x) => x.id === id);
  if (!a) throw Error('가구를 찾지 못했어요.');
  return placeItem(state, { ...structuredClone(a), name: `${a.name} 복사`.slice(0, 100) });
}

// 겹치거나 벽을 넘은 가구를 빈자리로 옮긴다. 방보다 큰 가구는 옮겨도 해결되지 않는다.
export function relocateConflicts(state) {
  let moved = 0;
  for (const id of [...layoutWarnings(state).all]) {
    if (!layoutWarnings(state).all.has(id)) continue;
    const a = state.items.find((x) => x.id === id);
    const spot = findFreeSpot({ ...state, items: state.items.filter((x) => x.id !== id) }, a);
    if (spot.free) {
      a.x = spot.x;
      a.z = spot.z;
      a.angle = spot.angle;
      moved++;
    }
  }
  return { moved, remaining: layoutWarnings(state).all.size };
}

export function addSpace(state, type = 'studio') {
  if (!Object.hasOwn(ROOM_TYPES, type)) throw Error('알 수 없는 공간 유형이에요.');
  return addRoom(state, type);
}

export function switchSpace(state, id) {
  if (id === state.roomId) return true;
  if (!switchRoom(state, id)) throw Error('공간을 찾지 못했어요.');
  return true;
}

export function deleteSpace(state, id = state.roomId) {
  if (!state.otherRooms.length) throw Error('마지막 공간은 삭제할 수 없어요.');
  const order = spaces(state).map((r) => r.roomId),
    index = order.indexOf(id);
  if (index < 0) throw Error('공간을 찾지 못했어요.');
  const name = spaces(state)[index].name;
  if (id === state.roomId) switchRoom(state, order[index - 1] || order[index + 1]);
  state.otherRooms = state.otherRooms.filter((r) => r.roomId !== id);
  state.roomOrder = state.roomOrder.filter((x) => x !== id);
  state.floorplan = normalizeFloorplan(state.floorplan, spaces(state));
  if (state.avatar?.roomId === id)
    state.avatar = { ...state.avatar, roomId: state.roomId, pose: 'standing', itemId: null };
  return name;
}

export function setAvatar(state, patch = {}, selectedId = null) {
  const next = { ...defaultAvatar(), ...state.avatar, ...patch, roomId: state.roomId };
  if (!Number.isFinite(next.height) || next.height < 80 || next.height > 230)
    throw Error('키는 80~230cm로 입력해주세요.');
  if (!Object.hasOwn(POSES, next.pose)) throw Error('아바타 자세를 골라 주세요.');
  if (
    ![next.x, next.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 15) ||
    !Number.isFinite(next.angle)
  )
    throw Error('아바타 위치는 -15~15m로 입력해주세요.');
  next.height = Math.round(next.height * 10) / 10;
  if (patch.height !== undefined) next.source = '사용자 설정';
  if (patch.pose && patch.pose !== 'standing') {
    const id = selectedId || next.itemId;
    const item = state.items.find((a) => a.id === id);
    if (!item || (patch.pose === 'lying' ? item.type !== 'bed' : !SEATS.has(item.type)))
      throw Error(
        patch.pose === 'lying'
          ? '먼저 이 방의 침대를 골라 주세요.'
          : '먼저 이 방의 의자·소파·라운지체어·벤치를 골라 주세요.',
      );
    next.itemId = item.id;
  }
  if (next.pose !== 'standing' && !state.items.some((a) => a.id === next.itemId))
    next.pose = 'standing';
  if (next.pose === 'standing') next.itemId = null;
  next.angle = ((next.angle % 360) + 360) % 360;
  state.avatar = next;
  return next;
}

export function moveSpace(state, id, x, z, { snap = true } = {}) {
  if (![x, z].every((n) => Number.isFinite(n) && Math.abs(n) <= 200))
    throw Error('공간 위치는 -200~200m로 입력해주세요.');
  const list = spaces(state),
    current = list.find((r) => r.roomId === id);
  if (!current) throw Error('공간을 찾지 못했어요.');
  const plan = normalizeFloorplan(state.floorplan, list);
  if (snap) {
    x = Math.round(x * 20) / 20;
    z = Math.round(z * 20) / 20;
    // 인접 공간의 벽에 15cm 이내로 접근하면 맞붙인다.
    for (const r of list.filter((r) => r.roomId !== id)) {
      const b = roomBounds(r, plan.positions[r.roomId]);
      const dx = [b.left - current.room.w / 2, b.right + current.room.w / 2];
      const dz = [b.top - current.room.d / 2, b.bottom + current.room.d / 2];
      for (const n of dx) if (Math.abs(x - n) < 0.15) x = n;
      for (const n of dz) if (Math.abs(z - n) < 0.15) z = n;
    }
  }
  const p = { x: round2(x), z: round2(z) };
  if (Math.abs(p.x) > 200 || Math.abs(p.z) > 200)
    throw Error('공간 위치는 -200~200m로 입력해주세요.');
  if (
    list.some(
      (r) =>
        r.roomId !== id &&
        rectanglesOverlap(roomBounds(current, p), roomBounds(r, plan.positions[r.roomId])),
    )
  )
    throw Error('공간이 겹쳐요. 빈 곳으로 옮겨 주세요.');
  plan.positions[id] = p;
  state.floorplan = plan;
  return p;
}

export function attachBathroom(state) {
  if (spaces(state).length >= 12) throw Error('공간은 최대 12개까지 저장할 수 있어요.');
  const original = state.roomId,
    list = spaces(state);
  const origin = normalizeFloorplan(state.floorplan, list).positions[original];
  const bath = makeRoom('bathroom');
  const candidates = [
    { x: origin.x + (state.room.w + bath.w) / 2, z: origin.z + (state.room.d - bath.d) / 2 },
    { x: origin.x - (state.room.w + bath.w) / 2, z: origin.z + (state.room.d - bath.d) / 2 },
    { x: origin.x, z: origin.z + (state.room.d + bath.d) / 2 },
    { x: origin.x, z: origin.z - (state.room.d + bath.d) / 2 },
  ];
  const position = candidates.find(
    (p) =>
      Math.abs(p.x) <= 200 &&
      Math.abs(p.z) <= 200 &&
      list.every(
        (r) =>
          !rectanglesOverlap(
            roomBounds({ room: bath }, p),
            roomBounds(r, state.floorplan.positions[r.roomId]),
          ),
      ),
  );
  if (!position)
    throw Error('방 옆에 화장실을 붙일 자리가 없어요. 집 전체에서 공간 위치를 먼저 조정해 주세요.');
  const id = addSpace(state, 'bathroom');
  state.floorplan.positions[id] = position;
  switchSpace(state, original);
  state.scope = 'house';
  return id;
}

export function renameSpace(state, name) {
  state.name = String(name).trim().slice(0, 100) || '나의 방';
  return state.name;
}

export function clearItems(state) {
  const n = state.items.length;
  state.items = [];
  return n;
}

export function loadExample(state) {
  const ex = exampleState();
  state.name = ex.name;
  state.room = ex.room;
  state.items = ex.items;
}

export function isExampleLike(state) {
  const ex = exampleState();
  return (
    state.name === ex.name &&
    state.items.length === ex.items.length &&
    state.items.every((a, i) => a.type === ex.items[i].type)
  );
}

// 가구 하나가 들어갈 수 있는지 미리 계산한다. 규격 비교 UI가 사용한다.
export function fitStatus(state, item) {
  const room = state.room;
  if (oversizedAt(item, room)) return 'oversize';
  const c = { ...item };
  clampItem(c, room);
  return state.items.some((o) => o.id !== item.id && overlaps(c, o)) ? 'overlap' : 'fits';
}

export function clearance(state, item) {
  const f = footprint(item),
    { w, d } = state.room;
  return {
    left: Math.max(0, Math.round((w / 2 + item.x - f.w / 2) * 100)),
    right: Math.max(0, Math.round((w / 2 - item.x - f.w / 2) * 100)),
    back: Math.max(0, Math.round((d / 2 + item.z - f.d / 2) * 100)),
    front: Math.max(0, Math.round((d / 2 - item.z - f.d / 2) * 100)),
  };
}
