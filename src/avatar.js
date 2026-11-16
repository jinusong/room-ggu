// 키는 cm, 장면 좌표는 m. 신체 비율과 가구의 착석 높이는 비교용 단순 모형이다.
// 몸 좌표는 가구와 같다: x 좌우, y 위, z 앞. 앉거나 누우면 가구의 위치·회전을 그대로 따른다.
import { SEATS, seatSurface, lyingSurface } from './seating.js';
export { SEATS };
export const POSES = { standing: '서 있기', sitting: '앉기', lying: '눕기' };
export const poseAccepts = (pose, item) =>
  !!item && (pose === 'lying' ? item.type === 'bed' : pose === 'sitting' && SEATS.has(item.type));
export const poseFor = (item) => (item?.type === 'bed' ? 'lying' : 'sitting');
export const defaultAvatar = () => ({
  enabled: false,
  height: 170,
  source: '비교용 기본값',
  pose: 'standing',
  itemId: null,
  roomId: null,
  x: 0.7,
  z: 0.6,
  angle: 0,
});
// 아바타가 설 수 있는 범위. 방 안은 물론 벽 바깥 OUT(m)까지 세울 수 있고, 벽 두께 안에는 서지 않는다.
export const AVATAR_OUT = 0.9;
const WALL = 0.1;
// 서 있는 몸이 벽에서 떨어져야 하는 거리(어깨 방향 x, 앞뒤 z).
const standMargin = (h) => ({ x: h * 0.18, z: h * 0.1 });
// 끌어 놓은 자리를 설 수 있는 가장 가까운 자리로 옮긴다. 벽에 걸치면 방 안쪽과 바깥쪽 중 가까운 쪽으로 보낸다.
export function standAt(room, heightCm, x, z) {
  const m = standMargin(heightCm / 100),
    hw = room.w / 2,
    hd = room.d / 2,
    clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  x = clamp(x, -hw - AVATAR_OUT, hw + AVATAR_OUT);
  z = clamp(z, -hd - AVATAR_OUT, hd + AVATAR_OUT);
  const inX = Math.max(0, hw - m.x),
    inZ = Math.max(0, hd - m.z),
    outX = hw + WALL + m.x,
    outZ = hd + WALL + m.z;
  if (Math.abs(x) <= inX && Math.abs(z) <= inZ) return { x, z, outside: false };
  if (Math.abs(x) >= outX || Math.abs(z) >= outZ) return { x, z, outside: true };
  const side = (v) => (v < 0 ? -1 : 1),
    options = [
      { x: clamp(x, -inX, inX), z: clamp(z, -inZ, inZ), outside: false },
      { x: side(x) * outX, z, outside: true },
      { x, z: side(z) * outZ, outside: true },
    ];
  return options.reduce((best, o) =>
    Math.hypot(o.x - x, o.z - z) < Math.hypot(best.x - x, best.z - z) ? o : best,
  );
}
// 3D 기본 시점에서 카메라가 있는 방향(방 가운데 기준). 오른쪽 앞 위에서 내려다본다.
export const HOME_VIEW = [0.66, 0.62, 0.8];
// 아바타를 처음 세우는 자리: 방 바깥 앞쪽 왼 모서리 옆이다. 기본 3D 시점에서 방 안을 가리지 않고 벽 끝 옆에 서서
// 벽 높이와 바로 견줄 수 있다. 그 자리가 다른 공간과 겹치거나 높은 벽 뒤에 숨으면 다음 후보로, 모두 막혔으면
// 방 안에 세운다. blocked는 이 방 가운데를 원점으로 한 다른 공간들의 범위다.
export function standSpot(room, heightCm, blocked = []) {
  const m = standMargin(heightCm / 100),
    hw = room.w / 2,
    hd = room.d / 2,
    sx = hw + WALL + m.x + 0.04,
    sz = hd + WALL + m.z + 0.18,
    nearX = Math.max(0, hw - 0.45),
    nearZ = Math.max(0, hd - 0.45);
  // 방 안을 가리지 않는 모서리 옆, 앞쪽 벽 앞, 오른쪽 벽 옆, 기본 시점에서 벽 뒤가 되는 자리 순서다.
  const spots = [
    [-sx, sz],
    [sx, -sz],
    [-nearX, sz],
    [0, sz],
    [nearX, sz],
    [sx, nearZ],
    [sx, 0],
    [sx, -nearZ],
    [sx, sz],
    [-sx, nearZ],
    [-sx, 0],
    [-sx, -sz],
    [0, -sz],
  ];
  const within = (x, z, b, pad) =>
      x > b.left - pad && x < b.right + pad && z > b.top - pad && z < b.bottom + pad,
    free = ([x, z]) =>
      !blocked.some(
        (b) =>
          x + m.x > b.left - WALL &&
          x - m.x < b.right + WALL &&
          z + m.z > b.top - WALL &&
          z - m.z < b.bottom + WALL,
      );
  // 카메라 쪽으로 3m 안에 공간이 있으면 그 공간의 높은 벽(왼쪽·뒤쪽)이 아바타를 가린다.
  const own = { left: -hw, right: hw, top: -hd, bottom: hd },
    step = Math.hypot(HOME_VIEW[0], HOME_VIEW[2]),
    seen = ([x, z]) => {
      for (let t = 0.2; t <= 3; t += 0.2) {
        const px = x + (HOME_VIEW[0] / step) * t,
          pz = z + (HOME_VIEW[2] / step) * t;
        if ([own, ...blocked].some((b) => within(px, pz, b, WALL))) return false;
      }
      return true;
    };
  const spot = spots.find((s) => free(s) && seen(s)) || spots.find(free);
  if (spot) return { x: spot[0], z: spot[1], outside: true };
  return {
    x: Math.min(0.7, Math.max(0, hw - m.x)),
    z: Math.min(0.6, Math.max(0, hd - m.z)),
    outside: false,
  };
}
export function validateAvatar(value, rooms) {
  if (value === undefined) return defaultAvatar();
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    !Number.isFinite(value.height) ||
    value.height < 80 ||
    value.height > 230 ||
    !Object.hasOwn(POSES, value.pose) ||
    ![value.x, value.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 15) ||
    !Number.isFinite(value.angle)
  )
    throw Error('아바타 키는 80~230cm, 위치는 -15~15m로 입력해주세요.');
  const room = rooms.find((r) => r.roomId === value.roomId);
  const item = room?.items.find((i) => i.id === value.itemId);
  const pose =
    value.pose !== 'standing' && !poseAccepts(value.pose, item) ? 'standing' : value.pose;
  return {
    enabled: value.enabled,
    height: value.height,
    source: value.source === '사용자 설정' ? '사용자 설정' : '비교용 기본값',
    pose,
    roomId: room?.roomId || null,
    itemId: pose === 'standing' ? null : item.id,
    x: value.x,
    z: value.z,
    angle: ((value.angle % 360) + 360) % 360,
  };
}

// 키에 비례한 몸 치수. 머리 꼭대기가 정확히 키 높이에 온다.
export const BODY = {
  hip: 0.52,
  shoulder: 0.8,
  head: 0.935,
  headRadius: 0.065,
  hipHalf: 0.075,
  shoulderHalf: 0.13,
  thigh: 0.24,
  shin: 0.245,
  foot: 0.035,
  torsoDepth: 0.075,
};
const side = (joints, name, fn) => {
  for (const [key, sign] of [
    ['left', -1],
    ['right', 1],
  ])
    joints[key + name] = fn(sign);
};

function standing(h) {
  const B = BODY,
    j = {
      hip: [0, h * B.hip, 0],
      shoulder: [0, h * B.shoulder, 0],
      head: [0, h * B.head, 0],
    };
  side(j, 'Hip', (s) => [s * h * B.hipHalf, h * B.hip, 0]);
  side(j, 'Knee', (s) => [s * h * B.hipHalf, h * 0.28, h * 0.01]);
  side(j, 'Foot', (s) => [s * h * B.hipHalf, h * B.foot, 0]);
  side(j, 'Toe', (s) => [s * h * B.hipHalf, h * 0.02, h * 0.085]);
  side(j, 'Shoulder', (s) => [s * h * B.shoulderHalf, h * 0.79, 0]);
  side(j, 'Elbow', (s) => [s * h * 0.15, h * 0.62, 0]);
  side(j, 'Hand', (s) => [s * h * 0.145, h * 0.46, h * 0.02]);
  return j;
}

// 등받이에 등을 대고 앉는다. 좌석이 허벅지보다 깊으면 무릎이 좌석 끝에 오도록 앞으로 나와 기대앉는다.
function sitting(h, seat) {
  const B = BODY,
    T = h * B.thigh,
    S = h * B.shin,
    footY = h * B.foot,
    hipY = seat.y + h * 0.045;
  const forward = seat.front + 0.02 - T;
  const zH = seat.back === null ? Math.max(0, forward) : Math.max(seat.back + h * 0.075, forward);
  const gap = seat.back === null ? 0 : zH - h * B.torsoDepth - seat.back;
  const torso = h * (B.shoulder - B.hip);
  const lean = gap > 0.01 ? Math.min(0.42, Math.asin(Math.min(1, gap / torso))) : 0;
  const up = Math.cos(lean),
    back = Math.sin(lean);
  const shoulder = [0, hipY + up * torso, zH - back * torso];
  const j = {
    hip: [0, hipY, zH],
    shoulder,
    head: [0, shoulder[1] + up * h * 0.135, shoulder[2] - back * h * 0.07],
  };
  const drop = hipY - S - footY;
  let knee, foot;
  if (drop >= -h * 0.005) {
    // 좌석이 종아리보다 높다. 허벅지는 수평이고 발은 바닥에 닿거나 뜬다.
    knee = [hipY, zH + T];
    foot = [drop < h * 0.03 ? footY : hipY - S, zH + T + h * 0.01];
  } else {
    // 좌석이 낮다. 발을 바닥에 두고 무릎을 세운다.
    foot = [footY, Math.max(zH + T * 0.9, seat.front + h * 0.04)];
    const dz = foot[1] - zH,
      dy = footY - hipY,
      dist = Math.hypot(dz, dy);
    const a = (T * T - S * S + dist * dist) / (2 * dist),
      k = Math.sqrt(Math.max(0, T * T - a * a));
    knee = [hipY + (a * dy) / dist + (k * dz) / dist, zH + (a * dz) / dist - (k * dy) / dist];
  }
  side(j, 'Hip', (s) => [s * h * B.hipHalf, hipY, zH]);
  side(j, 'Knee', (s) => [s * h * B.hipHalf, knee[0], knee[1]]);
  side(j, 'Foot', (s) => [s * h * B.hipHalf, foot[0], foot[1]]);
  side(j, 'Toe', (s) => [s * h * B.hipHalf, foot[0] - h * 0.015, foot[1] + h * 0.085]);
  side(j, 'Shoulder', (s) => [s * h * B.shoulderHalf, shoulder[1] - h * 0.01, shoulder[2]]);
  side(j, 'Hand', (s) => [s * h * 0.085, hipY + h * 0.05, zH + T * 0.55]);
  side(j, 'Elbow', (s) => [
    s * h * 0.155,
    (shoulder[1] + hipY) / 2 + h * 0.01,
    (shoulder[2] + zH + T * 0.55) / 2 - h * 0.05,
  ]);
  return { joints: j, dangling: drop >= h * 0.03 ? drop : 0 };
}

// 머리를 헤드보드 쪽에 두고 이불 위에 눕는다. 서 있는 자세를 발끝 기준으로 눕힌 좌표다.
function lying(h, bed) {
  const B = BODY,
    along = (ratio) => bed.head + h * (1 - ratio),
    y = (lift) => bed.y + h * lift;
  const headZ = along(B.head),
    onPillow = headZ > bed.pillow[0] - h * 0.03 && headZ < bed.pillow[1] + h * 0.03;
  const j = {
    hip: [0, y(B.torsoDepth), along(B.hip)],
    shoulder: [0, y(B.torsoDepth), along(B.shoulder)],
    head: [0, Math.max(y(B.headRadius), onPillow ? bed.pillowY + h * B.headRadius : 0), headZ],
  };
  side(j, 'Hip', (s) => [s * h * B.hipHalf, y(0.06), along(B.hip)]);
  side(j, 'Knee', (s) => [s * h * B.hipHalf, y(0.045), along(0.28)]);
  side(j, 'Foot', (s) => [s * h * B.hipHalf, y(0.04), along(B.foot)]);
  side(j, 'Toe', (s) => [s * h * B.hipHalf, y(0.12), along(0.02)]);
  side(j, 'Shoulder', (s) => [s * h * B.shoulderHalf, y(0.07), along(0.79)]);
  side(j, 'Elbow', (s) => [s * h * 0.165, y(0.035), along(0.62)]);
  side(j, 'Hand', (s) => [s * h * 0.165, y(0.03), along(0.46)]);
  return j;
}

export function avatarLayout(state) {
  const a = state.avatar;
  if (!a?.enabled || (a.roomId && a.roomId !== state.roomId)) return null;
  const h = a.height / 100;
  const item = state.items.find((i) => i.id === a.itemId);
  const seat = a.pose === 'sitting' ? seatSurface(item) : null,
    bed = a.pose === 'lying' ? lyingSurface(item) : null;
  const pose = seat ? 'sitting' : bed ? 'lying' : 'standing';
  const seated = seat ? sitting(h, seat) : null;
  const joints = seated ? seated.joints : bed ? lying(h, bed) : standing(h);
  let { x, z, angle } = pose === 'standing' ? a : item;
  // 서 있을 때는 방 안이나 벽 바깥에 선다. 방 크기가 바뀌어 벽에 걸치게 되면 가까운 쪽으로 옮긴다.
  let outside = false;
  if (pose === 'standing') ({ x, z, outside } = standAt(state.room, a.height, x, z));
  const top = Math.max(...Object.values(joints).map((p) => p[1])) + h * BODY.headRadius;
  const cm = (m) => Math.round(m * 100);
  // 안내는 이 모형을 기준으로 한 어림값이다. 실측처럼 단정하지 않는다.
  const warnings = [];
  if (bed && h > bed.length + 0.005)
    warnings.push(`모형 기준으로 발끝이 침대 끝을 약 ${cm(h - bed.length)}cm 넘어요`);
  if (seat && h * BODY.shoulderHalf * 2 > seat.width + 0.005)
    warnings.push(
      `모형 어깨 너비 약 ${cm(h * BODY.shoulderHalf * 2)}cm가 좌석 안쪽 가로 ${cm(seat.width)}cm보다 넓어요`,
    );
  if (seated?.dangling)
    warnings.push(`좌석이 높아 모형 기준으로 발이 바닥에서 약 ${cm(seated.dangling)}cm 떠요`);
  if (top > state.room.h && !outside) warnings.push('아바타가 천장 높이를 넘어요');
  return {
    ...a,
    x,
    z,
    angle,
    outside,
    pose,
    joints,
    h,
    top,
    warnings,
    item: pose === 'standing' ? null : item,
  };
}

// 아바타가 놓인 공간. 방을 바꿔도 아바타는 원래 공간에 남는다.
export function avatarSpace(state, list) {
  if (!state.avatar?.enabled) return null;
  return list.find((r) => r.roomId === (state.avatar.roomId || state.roomId)) || null;
}

// 방 밖에 선 아바타가 바닥에서 차지하는 범위(m, 방 가운데가 원점). 방 안에 있거나 앉아 있으면 null이다.
export function avatarRect(layout) {
  if (!layout?.outside) return null;
  const m = standMargin(layout.h),
    pad = 0.12;
  return {
    left: layout.x - m.x - pad,
    right: layout.x + m.x + pad,
    top: layout.z - m.z - pad,
    bottom: layout.z + m.z + pad,
  };
}
// 그 범위가 방을 얼마나 벗어나는지(m). 도면과 3D가 이만큼 자리를 더 잡아 아바타가 잘리지 않게 한다.
export function avatarApron(layout, room) {
  const r = avatarRect(layout);
  if (!r) return { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    left: Math.max(0, -room.w / 2 - r.left),
    right: Math.max(0, r.right - room.w / 2),
    top: Math.max(0, -room.d / 2 - r.top),
    bottom: Math.max(0, r.bottom - room.d / 2),
  };
}

// 바닥에 투영한 몸의 범위(m, 몸 좌표). 2D에서 누르는 영역과 이름표 위치에 쓴다.
export function avatarReach(layout) {
  const pts = Object.values(layout.joints),
    pad = layout.h * 0.07;
  return {
    minX: Math.min(...pts.map((p) => p[0])) - pad,
    maxX: Math.max(...pts.map((p) => p[0])) + pad,
    minZ: Math.min(...pts.map((p) => p[2])) - pad,
    maxZ: Math.max(...pts.map((p) => p[2])) + pad,
  };
}
export function avatarHit(layout, x, z) {
  const r = (layout.angle * Math.PI) / 180,
    dx = x - layout.x,
    dz = z - layout.z;
  const lx = dx * Math.cos(r) - dz * Math.sin(r),
    lz = dx * Math.sin(r) + dz * Math.cos(r),
    b = avatarReach(layout);
  return lx >= b.minX && lx <= b.maxX && lz >= b.minZ && lz <= b.maxZ;
}

export const LIMBS = [
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftFoot'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightFoot'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftHand'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightHand'],
];

const FURNITURE_WORDS = [
  [/침대/, 'bed'],
  [/소파/, 'sofa'],
  [/라운지|안락/, 'armchair'],
  [/벤치/, 'bench'],
  [/의자/, 'chair'],
];
// 명시적인 아바타 명령. 가구 높이·방 높이를 사용자의 키로 해석하지 않는다.
// 아바타가 방에 보이는 동안에는 “의자에 앉혀줘”, “일으켜줘”처럼 아바타라는 말이 없어도 자세 명령으로 읽는다.
export function parseComparisonCommand(text, { avatarOn = false } = {}) {
  const height = text.match(
    /(?:내\s*키|제\s*키|아바타\s*키)(?:는|가|를|은)?\s*(\d+(?:\.\d+)?)\s*(cm|센티(?:미터)?|m(?![a-z])|미터)?/i,
  );
  const avatarWord = /아바타|내\s*키|제\s*키/.test(text);
  const pose = /누워|눕기|눕혀|누운/.test(text)
    ? 'lying'
    : /앉아|앉기|앉혀|앉은/.test(text)
      ? 'sitting'
      : /서\s*있|세워|일으켜/.test(text)
        ? 'standing'
        : null;
  const posing = avatarOn && /앉혀|눕혀|일으켜/.test(text);
  if (height || posing || (avatarWord && (pose || /보여|띄워|비교|숨겨|꺼/.test(text)))) {
    const patch = { enabled: !/숨겨|꺼/.test(text) };
    if (height) patch.height = Number(height[1]) * (/^(m|미터)$/i.test(height[2] || '') ? 100 : 1);
    if (pose) patch.pose = pose;
    return {
      kind: 'avatar',
      patch,
      furniture: FURNITURE_WORDS.find(([word]) => word.test(text))?.[1] || null,
    };
  }
  // 연결 문 명령. “문 옆에 소파”처럼 문을 기준으로 가구를 말하는 문장은 읽지 않는다.
  const door = text.match(
    /(?:^|[\s,.·])(?:화장실|욕실|방|침실|거실|연결)?\s*문(?:을|이|은|의|도)?\s*(위치|폭|너비|옮|이동|막|없애|닫아|다시\s*내|내\s*줘|내줘|방향|여는|열리는)/,
  );
  if (door) {
    const word = door[1].replace(/\s/g, ''),
      size = text.match(/(\d+(?:\.\d+)?)\s*(cm|센티(?:미터)?|m(?![a-z])|미터)?/i);
    const action = /폭|너비/.test(word)
      ? 'width'
      : /막|없애|닫아/.test(word)
        ? 'close'
        : /다시내|내줘/.test(word)
          ? 'open'
          : /방향|여는|열리는/.test(word)
            ? 'flip'
            : 'show';
    return {
      kind: 'door',
      action,
      ...(action === 'width' && size
        ? { width: Number(size[1]) * (/^(m|미터)$/i.test(size[2] || '') ? 100 : 1) }
        : {}),
    };
  }
  if (/(집\s*전체|전체\s*평면도|집\s*평면도)/.test(text))
    return {
      kind: 'floorplan',
      ...(/3d|입체/i.test(text) ? { view: '3d' } : /2d/i.test(text) ? { view: '2d' } : {}),
    };
  return null;
}
