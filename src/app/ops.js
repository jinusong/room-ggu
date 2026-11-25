import {
  validateWindows,
  windowOpenings,
  assertWindowDoors,
  wallLength,
  rotateWindows,
  MAX_WINDOWS,
} from '../windows.js';
// 상태 변경 연산. 모든 함수는 앱 상태(v5)를 직접 바꾸고, 대화에 보여줄 변경 내역을 돌려준다.
// 숫자 범위·경계·충돌 검사는 여기서 끝낸다. AI와 UI는 이 함수만 호출한다.
import {
  TYPES,
  ROOM_TYPES,
  WALL_COLORS,
  FLOOR_COLORS,
  FURNITURE_COLORS,
  FIXTURE_TYPES,
  FLAT_TYPES,
  makeRoom,
  retypeRoom,
} from '../catalog.js';
import {
  clampItem,
  overlaps,
  tucked,
  footprint,
  layoutWarnings,
  newId,
  addRoom,
  switchRoom,
  spaces,
  exampleState,
  freshState,
  makeItem,
  validateState,
  doorZones,
  windowZones,
  DEFAULT_SOURCE,
} from '../data.js';
import { defaultAvatar, POSES, poseAccepts, standAt, standSpot } from '../avatar.js';
import {
  normalizeFloorplan,
  roomBounds,
  rectanglesOverlap,
  sharedWall,
  sharedOpening,
  doorPlacement,
  findDoor,
  roomOpenings,
  connections,
  floorplanWarnings,
  DOOR,
} from '../floorplan.js';
import { bathroomFixtures } from '../house-geometry.js';
import { josa } from './text.js';
import { roomEssentials, THEMES } from './design.js';
import { layoutHouse } from './house-layout.js';

// 일괄 상담도 이 경계에서만 실제 상태로 바꾼다. 완성한 별도 상태를 검증한 뒤 store가 한 번에 적용한다.
export function buildDesign(state, spec) {
  if (!Object.hasOwn(THEMES, spec.theme)) throw Error('테마를 다시 골라 주세요.');
  const theme = THEMES[spec.theme];
  if (spec.mode === 'theme') {
    const next = structuredClone(state);
    for (const r of [next, ...next.otherRooms]) {
      r.room.wallColor = theme.wall;
      r.room.floorColor = r.room.type === 'bathroom' ? '#dce1dc' : theme.floor;
      r.items.forEach((i, n) => {
        i.color = theme.colors[n % theme.colors.length];
      });
    }
    return { state: validateState(next), omitted: [], skipped: [] };
  }
  if (spec.rooms.length < 2 || spec.rooms.length > 12)
    throw Error('공간 구성을 다시 요청해 주세요.');
  let rooms = [...spec.rooms].sort((a, b) => b.weight - a.weight);
  let best = null;
  const skipped = [];
  // 필수 가구가 빠졌거나 선택 공간이 비면 면적을 다시 나눠 본다.
  for (;;) {
    let layout;
    try {
      layout = layoutHouse(rooms, spec.areaM2);
    } catch (e) {
      if (!best && !rooms.some((r) => r.optional)) throw e;
    }
    let empty = [];
    if (layout) {
      const result = furnishHouse(state, theme, rooms, layout);
      empty = result.empty;
      if (
        !best ||
        result.missing < best.missing ||
        (result.missing === best.missing && empty.length < best.empty.length)
      ) {
        best = { ...result, skipped: [...skipped] };
      }
      if (!result.missing && !empty.length) break;
    }
    const drop = empty.at(-1) || rooms.findLast((r) => r.optional);
    if (!drop) break;
    rooms = rooms.filter((r) => r !== drop);
    skipped.unshift(drop.name);
  }
  return { state: best.state, omitted: best.omitted, skipped: best.skipped };
}

function furnishHouse(state, theme, rooms, layout) {
  const next = freshState(),
    omitted = [],
    list = [];
  for (const [i, r] of rooms.entries()) {
    const { w, d, x, z } = layout.rooms[i],
      room = makeRoom(r.type),
      roomId = newId();
    Object.assign(room, {
      w,
      d,
      h: 2.5,
      wallColor: theme.wall,
      floorColor: r.type === 'bathroom' ? '#dce1dc' : theme.floor,
      sources: {
        w: '대화 추정(집 전체 면적 배분)',
        d: '대화 추정(집 전체 면적 배분)',
        h: '상담 초안',
      },
    });
    list.push({ roomId, name: r.name, room, items: [], requested: r.items });
    next.floorplan.positions[roomId] = { x, z };
  }
  const first = list[0];
  Object.assign(next, {
    roomId: first.roomId,
    name: first.name,
    room: first.room,
    items: first.items,
    otherRooms: list.slice(1).map(({ requested, ...r }) => r),
    roomOrder: list.map((r) => r.roomId),
    scope: 'house',
    view: state.view,
  });
  // 맞닿은 벽마다 문을 만들지 않고, 배치에서 고른 문만 연다.
  const open = new Set(
    layout.doors.map((ids) =>
      ids
        .map((i) => list[i].roomId)
        .sort()
        .join(),
    ),
  );
  for (const link of connections(list, next.floorplan))
    if (!open.has([...link.ids].sort().join())) setDoor(next, ...link.ids, { closed: true });
  for (const r of list) {
    const local = { ...r };
    // 문 앞의 통로를 가구처럼 빈자리 계산에만 넣고 저장하기 전에 거둔다.
    const keepouts = roomOpenings(list, next.floorplan, r.roomId).map((o) => ({
      ...makeItem('cabinet'),
      dims: o.vertical ? [90, 100, (o.width + 0.4) * 100] : [(o.width + 0.4) * 100, 100, 90],
      x: o.x + (o.vertical ? (o.x > 0 ? -0.45 : 0.45) : 0),
      z: o.z + (!o.vertical ? (o.z > 0 ? -0.45 : 0.45) : 0),
    }));
    local.items = [...keepouts];
    for (const [index, type] of r.requested.entries()) {
      const item = makeItem(type);
      item.name = TYPES[type].name;
      item.color = theme.colors[index % theme.colors.length];
      item.sources = item.sources.map(() => '상담 배치 초안');
      // 좌석은 책상·식탁 앞으로, 협탁은 침대 머리맡으로 묶어 쓰임새를 유지한다.
      const candidates = [];
      const anchor = (type) =>
        local.items.find((i) => i.type === type && !keepouts.some((k) => k.id === i.id));
      const table = anchor('dining'),
        desk = anchor('desk'),
        bed = anchor('bed'),
        sofa = anchor('sofa');
      if (type === 'dining') candidates.push({ x: 0, z: 0, angle: 0 });
      if (type === 'coffee' && sofa)
        candidates.push({
          x: sofa.x,
          z: sofa.z + (sofa.dims[2] + item.dims[2]) / 200 + 0.4,
          angle: 0,
        });
      if (type === 'chair' && (table || desk)) {
        const a = table || desk,
          count = local.items.filter((i) => i.type === 'chair').length;
        const spots = table
          ? [
              { x: a.x, z: a.z + (a.dims[2] + item.dims[2]) / 200 + 0.15, angle: 0 },
              { x: a.x, z: a.z - (a.dims[2] + item.dims[2]) / 200 - 0.15, angle: 180 },
              { x: a.x - (a.dims[0] + item.dims[2]) / 200 - 0.15, z: a.z, angle: 90 },
              { x: a.x + (a.dims[0] + item.dims[2]) / 200 + 0.15, z: a.z, angle: 270 },
            ]
          : [{ x: a.x, z: a.z + (a.dims[2] + item.dims[2]) / 200 + 0.15, angle: 0 }];
        candidates.push(...spots.slice(count), ...spots.slice(0, count));
      }
      if (type === 'side' && bed)
        for (const sign of [-1, 1])
          candidates.push({
            x: bed.x + sign * ((bed.dims[0] + item.dims[0]) / 200 + 0.1),
            z: bed.z - bed.dims[2] / 200 + item.dims[2] / 200,
            angle: 0,
          });
      const preferred = candidates.find((p) => {
        const c = { ...item, ...p },
          bounded = { ...c };
        clampItem(bounded, local.room);
        return (
          Math.abs(c.x - bounded.x) < 0.001 &&
          Math.abs(c.z - bounded.z) < 0.001 &&
          freeAt(c, local.items, MARGIN)
        );
      });
      let spot = preferred ? { ...preferred, free: true } : findFreeSpot(local, item);
      if (!spot.free) {
        item.dims = [...TYPES[type].presets[0].dims];
        spot = findFreeSpot(local, item);
      }
      if (!spot.free) {
        omitted.push(`${r.name}의 ${TYPES[type].name}`);
        continue;
      }
      local.items.push({ ...item, x: spot.x, z: spot.z, angle: spot.angle });
    }
    r.items.push(...local.items.slice(keepouts.length));
  }
  const empty = rooms.filter((r, i) => r.optional && !list[i].items.length);
  const missing = rooms.reduce((count, r, i) => {
    if (r.optional) return count;
    return (
      count +
      roomEssentials(r.type, r.name).filter(
        (type) => !list[i].items.some((item) => item.type === type),
      ).length
    );
  }, 0);
  return { state: validateState(next), omitted, missing, empty };
}

export const round2 = (n) => Math.round(n * 100) / 100;
// 공간 위치는 mm까지 둔다. 벽을 맞붙일 때 폭의 절반(5mm 단위)이 그대로 맞아야 겹침으로 잡히지 않는다.
const round3 = (n) => Math.round(n * 1000) / 1000;
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
  const original = state;
  state = structuredClone(state);
  for (const k of ['w', 'd', 'h'])
    if (!validRoomNumber(room[k])) throw Error('방 치수는 1~15m 범위로 알려주세요.');
  if (!Object.hasOwn(ROOM_TYPES, room.type)) throw Error('알 수 없는 공간 유형이에요.');
  if (!validColor(room.wallColor) || !validColor(room.floorColor))
    throw Error('마감 색상이 올바르지 않아요.');
  room = { ...room, windows: validateWindows(room.windows ?? state.room.windows, room) };
  assertWindowDoors(room, roomOpenings(spaces({ ...state, room }), state.floorplan, state.roomId));
  const before = state.room;
  state.room = room;
  const rows = diffRoom(before, room);
  // 화장실로 바꾸면 설비를 채우고, 화장실이 아니게 되면 손대지 않은 설비 초안은 치운다.
  if (before.type !== room.type) {
    if (before.type === 'bathroom') {
      const kept = state.items.filter((a) => !isDraftFixture(a));
      if (kept.length !== state.items.length) {
        rows.push({ label: '설비', to: `${state.items.length - kept.length}개 치움` });
        state.items = kept;
        syncAvatar(state);
      }
    }
    const renamed = syncSpaceName(state);
    if (renamed) rows.push(renamed);
  }
  for (const a of state.items) clampItem(a, room);
  // 크기가 바뀌면 이웃 공간과 맞닿은 벽은 그대로 두고, 겹치는 공간은 밀어낸다.
  const moved = reseatSpace(state, state.roomId, before);
  if (moved.length)
    rows.push({ label: '집 배치', to: `${moved.length}개 공간을 겹치지 않게 옮김` });
  if (before.type !== room.type && room.type === 'bathroom') {
    const n = fillBathroom(state);
    if (n) rows.push({ label: '설비', to: `변기, 세면대, 샤워부스 ${n}개` });
  }
  for (const r of spaces(state))
    assertWindowDoors(r.room, roomOpenings(spaces(state), state.floorplan, r.roomId));
  Object.assign(original, state);
  return rows;
}

// ---------- 공간 이름 ----------
const AUTO_NAME = new RegExp(
  `^나의 (${Object.values(ROOM_TYPES)
    .map((t) => t.name)
    .join('|')})(?: \\d+)?$`,
);
// 유형 이름을 딴 기본 이름. 같은 이름이 있으면 뒤에 번호를 붙인다.
export function autoSpaceName(state, type, exceptId = null, label = null) {
  const base = `나의 ${label || ROOM_TYPES[type].name}`,
    taken = new Set(
      spaces(state)
        .filter((r) => r.roomId !== exceptId)
        .map((r) => r.name),
    );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  return base;
}
// 기본 이름이 지금 유형과 어긋나면 유형에 맞춘다. 직접 지은 이름은 건드리지 않는다.
export function syncSpaceName(state) {
  const m = AUTO_NAME.exec(state.name);
  if (!m || m[1] === ROOM_TYPES[state.room.type].name) return null;
  const from = state.name;
  state.name = autoSpaceName(state, state.room.type, state.roomId);
  return { label: '이름', from, to: state.name };
}

// ---------- 화장실 설비 ----------
export const FIXTURE_SOURCE = '설비 초안';
const isDraftFixture = (a) =>
  FIXTURE_TYPES.includes(a.type) && a.sources.every((x) => x === FIXTURE_SOURCE);
// 화장실에 변기·세면대·샤워부스를 가구로 놓는다. 문 맞은편 벽부터 채우는 배치 초안이며,
// 놓인 뒤에는 다른 가구처럼 옮기고 돌리고 뺄 수 있다. 이미 설비가 있으면 두지 않는다.
export function fillBathroom(state, id = state.roomId) {
  const list = spaces(state),
    space = list.find((r) => r.roomId === id);
  if (
    !space ||
    space.room.type !== 'bathroom' ||
    space.items.some((a) => FIXTURE_TYPES.includes(a.type))
  )
    return 0;
  const plan = normalizeFloorplan(state.floorplan, list),
    made = bathroomFixtures(space.room, roomOpenings(list, plan, id)).map((f) => {
      // 좌우를 뒤집은 샤워부스는 90° 돌려 유리가 방 안쪽을 보게 한다. 차지하는 자리는 같다.
      const dims = f.flip ? [f.d, f.h, f.w] : [f.w, f.h, f.d];
      const item = sanitizeItem({
        type: f.type,
        name: TYPES[f.type].name,
        dims: dims.map((n) => Math.round(n * 1000) / 10),
        sources: [FIXTURE_SOURCE, FIXTURE_SOURCE, FIXTURE_SOURCE],
        color: '#efede7',
        x: round3(f.x),
        z: round3(f.z),
        angle: f.angle + (f.flip ? 90 : 0),
      });
      clampItem(item, space.room);
      return item;
    });
  space.items.push(...made);
  return made.length;
}
// 예전 저장본(v4 이하)을 불러올 때 한 번 손본다. 그때의 화장실은 설비를 그림으로만 그렸으므로
// 가구로 옮기고, 그림과 같던 타일 바닥도 바닥 색으로 옮긴다.
export function migrateLegacy(state) {
  // 유형을 바꿔도 이름이 따라오지 않던 때의 기본 이름("나의 화장실"인 거실)을 유형에 맞춘다.
  for (const r of spaces(state)) {
    const m = AUTO_NAME.exec(r.name);
    if (!m || m[1] === ROOM_TYPES[r.room.type].name) continue;
    const name = autoSpaceName(state, r.room.type, r.roomId);
    if (r.roomId === state.roomId) state.name = name;
    else state.otherRooms.find((o) => o.roomId === r.roomId).name = name;
  }
  // 크기를 바꾸다 겹친 채 저장된 공간을 떼어 놓는다.
  separateSpaces(state);
  for (const r of spaces(state)) {
    if (r.room.type !== 'bathroom') continue;
    if (r.room.floorColor === FLOOR_COLORS[0][1])
      r.room.floorColor = makeRoom('bathroom').floorColor;
    fillBathroom(state, r.roomId);
  }
  return state;
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
  return retypeRoom(room, type, isUserSource);
}

export function roomWithPreset(room, index) {
  const size = ROOM_TYPES[room.type].sizes[index];
  if (!size) throw Error('크기 초안을 찾지 못했어요.');
  const next = structuredClone(room);
  for (const [i, k] of ['w', 'd', 'h'].entries()) {
    next[k] = size[i];
    next.sources[k] = '사용자 선택(크기 초안)';
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
    others = [
      ...state.items.filter((o) => o.id !== item.id),
      ...doorZones(state),
      ...windowZones(state, item),
    ];
  const fallback = { ...item, x: 0, z: 0 };
  clampItem(fallback, room);
  const result = (c, free) => ({ x: c.x, z: c.z, angle: c.angle, free });
  if (oversizedAt(item, room)) return result(fallback, false);
  if (FLAT_TYPES.has(item.type)) {
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
  syncAvatar(state, before);
  return diffItem(before, after);
}

// 앉거나 누운 가구가 없어지거나 종류가 바뀌면 그 자리에 세운다. 다른 공간의 아바타는 건드리지 않는다.
export function syncAvatar(state, last) {
  const a = state.avatar;
  if (!a || a.pose === 'standing' || (a.roomId && a.roomId !== state.roomId)) return;
  const item = state.items.find((i) => i.id === a.itemId);
  if (poseAccepts(a.pose, item)) return;
  const at = item || (last?.id === a.itemId ? last : null);
  state.avatar = {
    ...a,
    pose: 'standing',
    itemId: null,
    ...(at ? { x: at.x, z: at.z, angle: at.angle } : {}),
  };
}

export function removeItem(state, id) {
  const item = state.items.find((a) => a.id === id);
  if (!item) throw Error('가구를 찾지 못했어요.');
  state.items = state.items.filter((a) => a.id !== id);
  syncAvatar(state, item);
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
    if (spot.free && (spot.x !== a.x || spot.z !== a.z || spot.angle !== a.angle)) {
      a.x = spot.x;
      a.z = spot.z;
      a.angle = spot.angle;
      moved++;
    }
  }
  return { moved, remaining: layoutWarnings(state).all.size };
}

// 지금 공간의 벽에 맞닿는 빈자리. 집 전체에서 바로 이어져 보이도록 새 공간을 여기에 둔다.
function adjacentSlot(state, size, align = 'start', anchorId = state.roomId) {
  const list = spaces(state),
    plan = normalizeFloorplan(state.floorplan, list),
    anchor = list.find((r) => r.roomId === anchorId) || list.find((r) => r.roomId === state.roomId),
    origin = plan.positions[anchor.roomId],
    { w, d } = anchor.room;
  const dz = ((d - size.d) / 2) * (align === 'end' ? 1 : -1),
    dx = -(w - size.w) / 2;
  return [
    { x: origin.x + (w + size.w) / 2, z: origin.z + dz },
    { x: origin.x - (w + size.w) / 2, z: origin.z + dz },
    { x: origin.x + dx, z: origin.z + (d + size.d) / 2 },
    { x: origin.x + dx, z: origin.z - (d + size.d) / 2 },
  ]
    .map((p) => ({ x: round2(p.x), z: round2(p.z) }))
    .find(
      (p) =>
        Math.abs(p.x) <= 200 &&
        Math.abs(p.z) <= 200 &&
        list.every(
          (r) =>
            !rectanglesOverlap(
              roomBounds({ room: size }, p),
              roomBounds(r, plan.positions[r.roomId]),
            ),
        ),
    );
}

// 지금 공간의 한쪽 벽(right·left·front·back)에 맞닿는 빈자리. 벽의 시작 끝에 맞춘 자리부터 보고,
// 다른 공간에 막히면 벽을 따라 25cm씩 밀어 본다. 문을 낼 수 있게 90cm 넘게 맞닿는 자리만 고른다.
export const SIDES = { right: '오른쪽', left: '왼쪽', back: '위쪽', front: '아래쪽' };
export function sideSlot(state, side, size, anchorId = state.roomId) {
  if (!Object.hasOwn(SIDES, side)) return null;
  const list = spaces(state),
    plan = normalizeFloorplan(state.floorplan, list),
    anchor = list.find((r) => r.roomId === anchorId) || list.find((r) => r.roomId === state.roomId),
    origin = plan.positions[anchor.roomId],
    { w, d } = anchor.room,
    vertical = side === 'right' || side === 'left',
    sign = side === 'right' || side === 'front' ? 1 : -1,
    span = vertical ? d : w,
    length = vertical ? size.d : size.w,
    reach = (span + length) / 2 - 0.9,
    start = -(span - length) / 2;
  if (reach < 0) return null;
  const offsets = [start, 0, -start];
  for (let t = 0.25; t <= reach + 1e-9; t += 0.25) offsets.push(start + t, start - t);
  for (const t of offsets) {
    if (Math.abs(t) > reach + 1e-9) continue;
    const p = vertical
      ? { x: round2(origin.x + (sign * (w + size.w)) / 2), z: round2(origin.z + t) }
      : { x: round2(origin.x + t), z: round2(origin.z + (sign * (d + size.d)) / 2) };
    if (
      Math.abs(p.x) <= 200 &&
      Math.abs(p.z) <= 200 &&
      list.every(
        (r) =>
          !rectanglesOverlap(
            roomBounds({ room: size }, p),
            roomBounds(r, plan.positions[r.roomId]),
          ),
      )
    )
      return p;
  }
  return null;
}

// 새 공간을 만들어 그 공간으로 옮겨 간다. room을 주면 그 크기로 자리를 잡고, anchor를 주면 그 공간의 벽에 붙인다.
// 고른 벽에 자리가 없을 때: strict(벽의 + 손잡이)면 거절하고, 아니면 다른 벽을 찾는다.
export function addSpace(
  state,
  type = 'studio',
  side = null,
  { room = null, anchor = null, strict = true, label = null } = {},
) {
  const original = state;
  state = structuredClone(state);
  if (!Object.hasOwn(ROOM_TYPES, type)) throw Error('알 수 없는 공간 유형이에요.');
  if (state.otherRooms.length >= 11) throw Error('공간은 최대 12개까지 저장할 수 있어요.');
  const size = room || makeRoom(type),
    from = spaces(state).find((r) => r.roomId === anchor) || null,
    anchorId = from?.roomId || state.roomId;
  for (const k of ['w', 'd', 'h'])
    if (!validRoomNumber(size[k])) throw Error('방 치수는 1~15m 범위로 알려주세요.');
  let slot = side ? sideSlot(state, side, size, anchorId) : null;
  if (side && !slot && strict)
    throw Error(
      `${SIDES[side] || '그쪽'}에는 ${josa(ROOM_TYPES[type].name, '을/를')} 붙일 자리가 없어요. 다른 벽을 고르거나 공간을 먼저 옮겨 주세요.`,
    );
  slot ||= adjacentSlot(state, size, 'start', anchorId);
  const id = addRoom(state, type);
  if (room) state.room = { ...structuredClone(room), type };
  // 공부방, 드레스룸처럼 따로 유형이 없는 공간은 가까운 유형으로 만들고 말한 이름을 쓴다.
  state.name = autoSpaceName(state, type, id, label);
  if (slot) state.floorplan.positions[id] = slot;
  // 붙일 벽이 모두 막혔으면 맨 오른쪽 기본 자리에 놓인다. 크기가 달라 겹치면 밀어낸다.
  else separateSpaces(state);
  fillBathroom(state, id);
  const list = spaces(state),
    parent = list.find((r) => r.roomId === anchorId),
    added = list.find((r) => r.roomId === id);
  if (
    (parent?.room.windows?.length || added?.room.windows?.length) &&
    sharedWall(parent, state.floorplan.positions[anchorId], added, state.floorplan.positions[id]) &&
    !sharedOpening(
      parent,
      state.floorplan.positions[anchorId],
      added,
      state.floorplan.positions[id],
    )
  )
    throw Error(
      '창문 때문에 연결 문을 낼 자리가 없어요. 창문을 옮기거나 다른 벽에 공간을 붙여 주세요.',
    );
  Object.assign(original, state);
  return id;
}
// 새 공간이 어느 공간의 어느 쪽에 붙었는지. 대화에서 알려 줄 때 쓴다.
export function attachedTo(state, id = state.roomId, preferId = null) {
  const list = spaces(state),
    plan = normalizeFloorplan(state.floorplan, list),
    self = list.find((r) => r.roomId === id);
  if (!self) return null;
  const mine = roomBounds(self, plan.positions[id]),
    order = [...list].sort((a, b) => (b.roomId === preferId) - (a.roomId === preferId));
  for (const r of order) {
    if (r.roomId === id) continue;
    const side = touching(roomBounds(r, plan.positions[r.roomId]), mine);
    if (side) return { roomId: r.roomId, name: r.name, side };
  }
  return null;
}

// ---------- 집 배치 맞추기 ----------
const EPS = 0.02;
// b가 a의 어느 벽에 맞닿아 있는지(left·right·back·front). 맞닿지 않으면 null.
function touching(a, b) {
  const zs = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EPS,
    xs = Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS;
  if (zs && Math.abs(b.right - a.left) < EPS) return 'left';
  if (zs && Math.abs(b.left - a.right) < EPS) return 'right';
  if (xs && Math.abs(b.bottom - a.top) < EPS) return 'back';
  if (xs && Math.abs(b.top - a.bottom) < EPS) return 'front';
  return null;
}
// 겹친 공간을 가장 적게 움직여 떼어 놓는다. first에 든 공간은 제자리에 두고 나머지를 차례로 민다.
// 한 번 자리를 잡은 공간은 다시 밀지 않으므로 반드시 끝난다. 옮긴 공간의 id를 돌려준다.
function pushApart(list, pos, first) {
  const rect = (r) => roomBounds(r, pos[r.roomId]),
    settled = new Set(),
    moved = new Set(),
    queue = list.filter((r) => first.includes(r.roomId));
  const next = () => {
    if (queue.length) return queue.shift();
    // 아직 보지 않은 공간끼리 겹친 곳이 남았으면 그중 하나를 기준으로 삼는다.
    for (const a of list)
      if (!settled.has(a.roomId))
        for (const b of list)
          if (a !== b && !settled.has(b.roomId) && rectanglesOverlap(rect(a), rect(b))) return a;
    return null;
  };
  for (let a = next(); a; a = next()) {
    if (settled.has(a.roomId)) continue;
    settled.add(a.roomId);
    const A = rect(a);
    for (const b of list) {
      if (settled.has(b.roomId)) continue;
      const B = rect(b);
      if (!rectanglesOverlap(A, B)) continue;
      const moves = [
        ['x', -(B.right - A.left)],
        ['x', A.right - B.left],
        ['z', -(B.bottom - A.top)],
        ['z', A.bottom - B.top],
      ].sort((m, n) => Math.abs(m[1]) - Math.abs(n[1]));
      const [axis, by] = moves[0];
      pos[b.roomId][axis] = round3(pos[b.roomId][axis] + by);
      moved.add(b.roomId);
      queue.push(b);
    }
  }
  return [...moved];
}
// 공간 크기가 바뀐 뒤 집 배치를 다시 맞춘다. before는 바뀌기 전의 { w, d }다.
// 이웃이 맞닿아 있던 벽은 그 자리에 두고 반대쪽으로 늘이거나 줄인다. 양쪽에 이웃이 있으면
// 먼 쪽 이웃과 거기에 이어진 공간을 달라진 길이만큼 함께 옮긴다. 그래도 겹치면 밀어낸다.
export function reseatSpace(state, id, before) {
  const list = spaces(state),
    self = list.find((r) => r.roomId === id);
  if (list.length < 2 || !self || (self.room.w === before.w && self.room.d === before.d)) return [];
  const plan = normalizeFloorplan(state.floorplan, list),
    pos = plan.positions,
    start = structuredClone(pos),
    others = list.filter((r) => r.roomId !== id),
    rect = (r) => roomBounds(r, pos[r.roomId]),
    old = roomBounds({ room: before }, pos[id]),
    sides = { left: [], right: [], back: [], front: [] };
  for (const r of others) {
    const side = touching(old, rect(r));
    if (side) sides[side].push(r);
  }
  // start에 든 공간에서 벽을 타고 이어진 공간들. stop에 닿으면(집을 한 바퀴 돌아 이어지면) 함께 옮길 수 없다.
  const chain = (from, stop) => {
    const seen = new Set(from.map((r) => r.roomId)),
      queue = [...from];
    while (queue.length) {
      const r = queue.shift();
      for (const o of others)
        if (!seen.has(o.roomId) && touching(rect(r), rect(o))) {
          seen.add(o.roomId);
          queue.push(o);
        }
    }
    return stop.some((r) => seen.has(r.roomId)) ? [] : others.filter((r) => seen.has(r.roomId));
  };
  const shifts = [];
  for (const axis of ['x', 'z']) {
    const [lo, hi, size, was, near, far, across] =
      axis === 'x'
        ? [old.left, old.right, self.room.w, before.w, sides.left, sides.right, 'back front']
        : [old.top, old.bottom, self.room.d, before.d, sides.back, sides.front, 'left right'];
    if (size === was) continue;
    const beside = across.split(' ').flatMap((k) => sides[k]),
      edge = (r, end) => {
        const b = rect(r);
        return axis === 'x' ? (end ? b.right : b.left) : end ? b.bottom : b.top;
      };
    let keep = 'center';
    if (near.length) keep = 'lo';
    else if (far.length) keep = 'hi';
    else if (beside.some((r) => Math.abs(edge(r, false) - lo) < EPS)) keep = 'lo';
    else if (beside.some((r) => Math.abs(edge(r, true) - hi) < EPS)) keep = 'hi';
    pos[id][axis] = round3(
      keep === 'lo' ? lo + size / 2 : keep === 'hi' ? hi - size / 2 : (lo + hi) / 2,
    );
    if (keep === 'lo' && far.length) shifts.push([axis, size - was, chain(far, near)]);
  }
  for (const [axis, by, group] of shifts)
    for (const r of group) pos[r.roomId][axis] = round3(pos[r.roomId][axis] + by);
  pushApart(list, pos, [id]);
  // 줄어든 쪽 이웃을 당겨 오다 다른 공간과 겹치게 됐으면 이웃은 제자리에 둔다.
  if (floorplanWarnings(list, plan).size) {
    for (const r of others) pos[r.roomId] = { ...start[r.roomId] };
    pushApart(list, pos, [id]);
  }
  state.floorplan = plan;
  return others
    .filter((r) => pos[r.roomId].x !== start[r.roomId].x || pos[r.roomId].z !== start[r.roomId].z)
    .map((r) => r.roomId);
}
// 이미 겹쳐 있는 공간을 떼어 놓는다. 지금 방은 제자리에 둔다. 겹친 쌍과 옮긴 공간을 돌려준다.
export function separateSpaces(state) {
  const list = spaces(state),
    plan = normalizeFloorplan(state.floorplan, list),
    names = (ids) => list.filter((r) => ids.includes(r.roomId)).map((r) => r.name),
    overlapped = [...floorplanWarnings(list, plan)];
  if (!overlapped.length) return { overlapped: [], moved: [], remaining: 0 };
  const moved = pushApart(list, plan.positions, [state.roomId]);
  state.floorplan = plan;
  return {
    overlapped: names(overlapped),
    moved: names(moved),
    remaining: floorplanWarnings(list, plan).size,
  };
}
// 공간을 통째로 오른쪽으로 90° 돌린다. 가로·세로가 바뀌고 가구와 아바타도 함께 돈다.
// 벽이 달라지므로 이 공간에 직접 정해 둔 문은 자동 문으로 돌아간다.
export function rotateSpace(state, id = state.roomId) {
  const space = spaces(state).find((r) => r.roomId === id);
  if (!space) throw Error('공간을 찾지 못했어요.');
  const { room } = space,
    before = { w: room.w, d: room.d };
  rotateWindows(room, before);
  [room.w, room.d] = [before.d, before.w];
  [room.sources.w, room.sources.d] = [room.sources.d, room.sources.w];
  const turn = (a) => {
    [a.x, a.z] = [-a.z, a.x];
    a.angle = (((a.angle - 90) % 360) + 360) % 360;
  };
  for (const a of space.items) {
    turn(a);
    clampItem(a, room);
  }
  const av = state.avatar;
  if (av && (av.roomId ? av.roomId === id : id === state.roomId)) turn(av);
  if (state.floorplan?.doors)
    state.floorplan = {
      ...state.floorplan,
      doors: state.floorplan.doors.filter((d) => !d.rooms.includes(id)),
    };
  const moved = reseatSpace(state, id, before);
  return { name: space.name, w: room.w, d: room.d, moved };
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

// 이 방 가운데를 원점으로 본 다른 공간들의 범위. 아바타를 방 밖에 세울 때 옆 공간과 겹치지 않는 자리를 고른다.
function neighbourRects(state) {
  const at = state.floorplan?.positions?.[state.roomId];
  if (!at) return [];
  return spaces(state)
    .filter((r) => r.roomId !== state.roomId && state.floorplan.positions[r.roomId])
    .map((r) => {
      const p = state.floorplan.positions[r.roomId],
        x = p.x - at.x,
        z = p.z - at.z;
      return {
        left: x - r.room.w / 2,
        right: x + r.room.w / 2,
        top: z - r.room.d / 2,
        bottom: z + r.room.d / 2,
      };
    });
}
export function setAvatar(state, patch = {}, selectedId = null) {
  const was = state.avatar,
    next = { ...defaultAvatar(), ...was, ...patch, roomId: state.roomId };
  // 새로 세우거나 다른 공간에서 데려올 때는 이 방 바깥의 기본 자리에 세운다. 그 뒤로는 끌어 둔 자리를 지킨다.
  const fresh = !was?.enabled || (was.roomId && was.roomId !== state.roomId);
  if (next.enabled && fresh && patch.x === undefined && patch.z === undefined) {
    const spot = standSpot(state.room, next.height, neighbourRects(state));
    next.x = Math.round(spot.x * 100) / 100;
    next.z = Math.round(spot.z * 100) / 100;
    next.angle = 0;
  }
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
    if (!poseAccepts(patch.pose, item))
      throw Error(
        patch.pose === 'lying'
          ? '먼저 이 방의 침대를 골라 주세요.'
          : '먼저 이 방에서 의자나 소파, 라운지체어, 벤치를 골라 주세요.',
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
  for (const r of list) assertWindowDoors(r.room, roomOpenings(list, plan, r.roomId));
  state.floorplan = plan;
  return p;
}

// 두 공간 사이 문을 옮기거나 폭·여는 방향을 바꾸거나 막는다. 기본값으로 돌아가면 설정을 지운다.
// center는 벽을 따라 잰 전역 좌표, edge는 맞닿은 벽 구간의 시작(왼쪽·위쪽 끝)에서 문까지의 거리다.
export function setDoor(state, a, b, patch = {}) {
  const list = spaces(state),
    plan = normalizeFloorplan(state.floorplan, list),
    A = list.find((r) => r.roomId === a),
    B = list.find((r) => r.roomId === b),
    wall = A && B && a !== b ? sharedWall(A, plan.positions[a], B, plan.positions[b]) : null;
  if (!wall || !doorPlacement(wall, { width: DOOR.min }))
    throw Error('벽이 60cm 넘게 맞닿은 두 공간 사이에만 문을 낼 수 있어요.');
  const next = patch.reset ? { rooms: [a, b] } : { rooms: [a, b], ...findDoor(plan, a, b) },
    length = wall.end - wall.start,
    mid = (wall.start + wall.end) / 2,
    before = doorPlacement(wall, next);
  if (patch.closed !== undefined) {
    if (patch.closed) next.closed = true;
    else delete next.closed;
  }
  if (patch.flip !== undefined) {
    if (patch.flip) next.flip = true;
    else delete next.flip;
  }
  if (patch.width !== undefined) {
    const fits = Math.min(DOOR.max, Math.floor((length - 0.1) * 100 + 1e-6) / 100);
    if (!Number.isFinite(patch.width) || patch.width < DOOR.min || patch.width > DOOR.max)
      throw Error('문 폭은 60~120cm로 입력해주세요.');
    if (patch.width > fits + 1e-9)
      throw Error(
        `맞닿은 벽이 ${Math.round(length * 100)}cm라 문 폭은 ${Math.round(fits * 100)}cm까지 낼 수 있어요.`,
      );
    next.width = round2(patch.width);
  }
  const place = doorPlacement(wall, next);
  if (!place) throw Error('맞닿은 벽이 짧아 문을 낼 수 없어요.');
  let center = patch.center,
    exact = patch.exact;
  if (patch.edge !== undefined) center = wall.start + patch.edge + place.width / 2;
  // 직접 옮겨 둔 문은 폭을 바꿔도 벽 끝에서의 거리를 지킨다(경첩 쪽이 그대로다).
  if (center === undefined && patch.width !== undefined && next.offset !== undefined && before) {
    center = before.center - before.width / 2 + place.width / 2;
    exact = true;
  }
  if (center !== undefined) {
    if (!Number.isFinite(center)) throw Error('문 위치를 숫자로 입력해주세요.');
    // 벽 끝에서 문까지의 거리를 5cm 단위로 맞추고 구간 안에 둔다.
    const snapped = exact
      ? center
      : wall.start +
        Math.round((center - place.width / 2 - wall.start) * 20) / 20 +
        place.width / 2;
    const offset = round2(Math.max(-place.reach, Math.min(place.reach, snapped - mid)));
    if (offset) next.offset = offset;
    else delete next.offset;
  } else if (next.offset !== undefined) {
    // 폭이 바뀌어 문이 구간을 벗어나면 저장한 위치도 구간 안으로 당긴다.
    const offset = round2(Math.max(-place.reach, Math.min(place.reach, next.offset)));
    if (offset) next.offset = offset;
    else delete next.offset;
  }
  const doors = (plan.doors || []).filter((d) => !(d.rooms.includes(a) && d.rooms.includes(b)));
  const nextPlan = normalizeFloorplan({ positions: plan.positions, doors: [...doors, next] }, list);
  for (const r of list) assertWindowDoors(r.room, roomOpenings(list, nextPlan, r.roomId));
  if (
    !next.closed &&
    !sharedOpening(A, plan.positions[a], B, plan.positions[b], findDoor(nextPlan, a, b))
  )
    throw Error('창문을 피해서 문을 낼 자리가 없어요. 창문을 옮기거나 줄여 주세요.');
  state.floorplan = nextPlan;
  return sharedOpening(A, plan.positions[a], B, plan.positions[b], findDoor(state.floorplan, a, b));
}

export function attachBathroom(state) {
  if (spaces(state).length >= 12) throw Error('공간은 최대 12개까지 저장할 수 있어요.');
  const original = state.roomId;
  const position = adjacentSlot(state, makeRoom('bathroom'), 'end');
  if (!position)
    throw Error('방 옆에 화장실을 붙일 자리가 없어요. 집 전체에서 공간 위치를 먼저 조정해 주세요.');
  const id = addRoom(state, 'bathroom');
  state.name = autoSpaceName(state, 'bathroom', id);
  state.floorplan.positions[id] = position;
  fillBathroom(state, id);
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
  syncAvatar(state);
  return n;
}

export function loadExample(state) {
  const ex = exampleState();
  state.name = ex.name;
  state.room = ex.room;
  state.items = ex.items;
  syncAvatar(state);
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
  if (doorZones(state).some((o) => overlaps(c, o))) return 'door';
  if (windowZones(state, c).some((o) => overlaps(c, o))) return 'window';
  return state.items.some((o) => o.id !== item.id && overlaps(c, o) && !tucked(c, o))
    ? 'overlap'
    : 'fits';
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

// ---------- 창문 ----------
function checkWindowRoom(state, room) {
  room.windows = validateWindows(room.windows, room);
  const next = spaces({ ...state, room });
  const doors = roomOpenings(next, state.floorplan, state.roomId);
  assertWindowDoors(room, doors);
  const before = roomOpenings(spaces(state), state.floorplan, state.roomId);
  if (before.some((o) => !doors.some((d) => d.roomId === o.roomId)))
    throw Error(
      '창문 때문에 기존 연결 문을 낼 자리가 없어져요. 창 크기를 줄이거나 다른 벽을 골라 주세요.',
    );
  return room;
}
export function setWindow(state, id, patch) {
  const list = state.room.windows || [];
  const before = list.find((w) => w.id === id);
  if (!before) throw Error('창문을 찾지 못했어요.');
  const room = {
    ...state.room,
    windows: list.map((w) => (w.id === id ? { ...w, ...patch, id } : w)),
  };
  state.room = checkWindowRoom(state, room);
}
export function addWindow(state, wall = 'back') {
  if ((state.room.windows || []).length >= MAX_WINDOWS)
    throw Error('창문은 방마다 최대 8개까지 설정해요.');
  const room = state.room,
    length = wallLength(room, wall),
    id = newId();
  const width = Math.min(1.2, length - 0.1),
    height = Math.min(1.1, room.h - 0.2),
    sill = Math.max(0.1, Math.min(0.9, room.h - height - 0.05));
  for (let offset = 0.05; offset + width <= length - 0.05 + 1e-6; offset += 0.05) {
    const next = {
      ...room,
      windows: [
        ...(room.windows || []),
        { id, wall, width, height, sill, offset: Math.round(offset * 100) / 100 },
      ],
    };
    try {
      state.room = checkWindowRoom(state, next);
      return id;
    } catch {
      /* 다음 빈 구간을 찾는다. */
    }
  }
  throw Error(
    '이 벽에는 기본 창이 들어갈 빈자리가 없어요. 다른 벽을 고르거나 기존 창을 줄여 주세요.',
  );
}
export function removeWindow(state, id) {
  if (!(state.room.windows || []).some((w) => w.id === id)) throw Error('창문을 찾지 못했어요.');
  state.room = { ...state.room, windows: state.room.windows.filter((w) => w.id !== id) };
}
