// 키는 cm, 장면 좌표는 m. 신체 비율과 가구의 착석 높이는 비교용 단순 모형이다.
export const POSES = { standing: '서 있기', sitting: '앉기', lying: '눕기' };
export const SEATS = new Set(['chair', 'sofa', 'armchair', 'bench']);
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
    value.pose !== 'standing' &&
    (!item || (value.pose === 'lying' ? item.type !== 'bed' : !SEATS.has(item.type)))
      ? 'standing'
      : value.pose;
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
export function avatarLayout(state) {
  const a = state.avatar;
  if (!a?.enabled || (a.roomId && a.roomId !== state.roomId)) return null;
  const h = a.height / 100;
  const item = state.items.find((i) => i.id === a.itemId);
  const pose =
    item && (a.pose === 'lying' ? item.type === 'bed' : SEATS.has(item.type)) ? a.pose : 'standing';
  const seated = pose === 'sitting',
    lying = pose === 'lying';
  const seat = item
    ? item.type === 'bench'
      ? item.dims[1] / 100
      : Math.min(0.48, (item.dims[1] / 100) * 0.54)
    : 0;
  const base = lying ? item.dims[1] / 100 + h * 0.085 : 0;
  const hipY = seated ? seat + h * 0.045 : h * 0.52;
  const joints = {
    hip: [0, hipY, 0],
    shoulder: [0, hipY + h * 0.28, 0],
    head: [0, hipY + h * 0.42, 0],
    leftHip: [-h * 0.075, hipY, 0],
    rightHip: [h * 0.075, hipY, 0],
    leftKnee: [-h * 0.075, seated ? hipY : h * 0.28, seated ? h * 0.235 : 0.01 * h],
    rightKnee: [h * 0.075, seated ? hipY : h * 0.28, seated ? h * 0.235 : 0.01 * h],
    leftFoot: [
      -h * 0.075,
      seated ? Math.max(h * 0.035, hipY - h * 0.235) : h * 0.035,
      seated ? h * 0.25 : h * 0.035,
    ],
    rightFoot: [
      h * 0.075,
      seated ? Math.max(h * 0.035, hipY - h * 0.235) : h * 0.035,
      seated ? h * 0.25 : h * 0.035,
    ],
    leftShoulder: [-h * 0.13, hipY + h * 0.27, 0],
    rightShoulder: [h * 0.13, hipY + h * 0.27, 0],
    leftElbow: [-h * 0.15, hipY + h * 0.1, seated ? h * 0.06 : 0],
    rightElbow: [h * 0.15, hipY + h * 0.1, seated ? h * 0.06 : 0],
    leftHand: [-h * 0.14, hipY - h * 0.04, seated ? h * 0.19 : 0],
    rightHand: [h * 0.14, hipY - h * 0.04, seated ? h * 0.19 : 0],
  };
  if (lying)
    for (const [key, [x, y, z]] of Object.entries(joints)) joints[key] = [x, base + z, h * 0.5 - y];
  let x = item && pose !== 'standing' ? item.x : a.x;
  let z = item && pose !== 'standing' ? item.z : a.z;
  const angle = item && pose !== 'standing' ? item.angle : a.angle;
  if (pose === 'standing') {
    x = Math.max(
      -Math.max(0, state.room.w / 2 - h * 0.18),
      Math.min(Math.max(0, state.room.w / 2 - h * 0.18), x),
    );
    z = Math.max(
      -Math.max(0, state.room.d / 2 - h * 0.1),
      Math.min(Math.max(0, state.room.d / 2 - h * 0.1), z),
    );
  }
  const warnings = [];
  if (lying && h > item.dims[2] / 100)
    warnings.push(`키가 침대 깊이보다 ${Math.round(a.height - item.dims[2])}cm 길어요`);
  if (seated && h * 0.34 > item.dims[0] / 100) warnings.push('아바타 어깨가 좌석 너비를 넘어요');
  if (Math.max(...Object.values(joints).map((p) => p[1])) + h * 0.06 > state.room.h)
    warnings.push('아바타가 천장 높이를 넘어요');
  return { ...a, x, z, angle, pose, joints, h, warnings, item };
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

// 명시적인 아바타 명령. 가구 높이·방 높이를 사용자의 키로 해석하지 않는다.
export function parseComparisonCommand(text) {
  const height = text.match(
    /(?:내\s*키|제\s*키|아바타\s*키)(?:는|가|를|은)?\s*(\d+(?:\.\d+)?)\s*(cm|센티(?:미터)?|m(?![a-z])|미터)?/i,
  );
  const avatarWord = /아바타|내\s*키|제\s*키/.test(text);
  const pose = /누워|눕기|눕혀/.test(text)
    ? 'lying'
    : /앉아|앉기|앉혀/.test(text)
      ? 'sitting'
      : /서\s*있|세워/.test(text)
        ? 'standing'
        : null;
  if (height || (avatarWord && (pose || /보여|띄워|비교|숨겨|꺼/.test(text)))) {
    const patch = { enabled: !/숨겨|꺼/.test(text) };
    if (height) patch.height = Number(height[1]) * (/^(m|미터)$/i.test(height[2] || '') ? 100 : 1);
    if (pose) patch.pose = pose;
    return {
      kind: 'avatar',
      patch,
      furniture: /침대/.test(text)
        ? 'bed'
        : /소파/.test(text)
          ? 'sofa'
          : /의자/.test(text)
            ? 'chair'
            : null,
    };
  }
  if (/(집\s*전체|전체\s*평면도|집\s*평면도)/.test(text)) return { kind: 'floorplan' };
  return null;
}
