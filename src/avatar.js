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
  if (pose === 'standing') {
    const mx = Math.max(0, state.room.w / 2 - h * 0.18),
      mz = Math.max(0, state.room.d / 2 - h * 0.1);
    x = Math.max(-mx, Math.min(mx, x));
    z = Math.max(-mz, Math.min(mz, z));
  }
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
  if (top > state.room.h) warnings.push('아바타가 천장 높이를 넘어요');
  return {
    ...a,
    x,
    z,
    angle,
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
