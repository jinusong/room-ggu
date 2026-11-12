import { UI_SURFACES } from './ui-schema.js';
import { detectType } from './estimator.js';
import { ROOM_TYPES, makeRoom } from './catalog.js';
const roomAliases = {
  studio: /원룸|스튜디오/,
  living: /거실|리빙룸/,
  bedroom: /침실|안방/,
  office: /서재|작업실|홈\s*오피스/,
  dining: /다이닝룸|식사\s*공간/,
  kitchen: /주방|부엌/,
  kids: /아이\s*방|어린이\s*방/,
};
export const detectRoomType = (text) =>
  Object.entries(roomAliases).find(([, re]) => re.test(text))?.[0] || null;
export function isRoomIntent(text) {
  return (
    /(?:방|공간|거실|침실|서재|주방|원룸|다이닝룸).*(?:가로|세로|천장|평|제곱|넓|좁|크기|추가|만들|바꿔|변경|꾸미)|(?:벽|바닥).*(?:색|흰|화이트|오크|월넛|그레이|세이지)|(?:가로|세로|천장).*\d+\s*(?:m|미터)|\d+\s*(?:평|m²|제곱미터)/i.test(
      text,
    ) || !!detectRoomType(text)
  );
}
export function consultationScope(text, requested = 'auto') {
  if (requested !== 'auto') return requested;
  const firstSentence = text.split(/[.!?](?:\s|$)/)[0];
  const explicitRoom =
    /(?:원룸|거실|침실|서재|주방|아이\s*방|방|공간)(?:을|를|은|는)?\s*(?:가로|세로|천장|크기|치수)/.test(
      text,
    );
  if (explicitRoom || (isRoomIntent(firstSentence) && !detectType(firstSentence))) return 'room';
  return isRoomIntent(text) && !detectType(text) ? 'room' : 'furniture';
}
const round = (n) => Math.round(n * 100) / 100;
export function parseRoomDimensions(text) {
  const dims = {},
    axes = { w: '(?:가로|너비|폭)', d: '(?:세로|깊이)', h: '(?:천장\\s*높이|천장|높이)' };
  const meters = (value, unit) =>
    /^(cm|센티미터|센티|센치)$/.test(unit || '')
      ? value / 100
      : /^(mm|밀리미터)$/.test(unit || '')
        ? value / 1000
        : unit
          ? value
          : value > 15
            ? value / 100
            : value;
  const put = (k, n) => {
    if (n < 1 || n > 15) throw Error('방 치수는 1~15m 범위로 알려주세요.');
    dims[k] = round(n);
  };
  for (const [k, axis] of Object.entries(axes)) {
    const regex = new RegExp(
      axis +
        '(?:는|은|가|이|:|\\s)*([0-9]+(?:\\.[0-9]+)?)\\s*(mm|cm|m(?![²2])|밀리미터|센티미터|센티|센치|미터)?',
      'ig',
    );
    for (const m of text.matchAll(regex)) put(k, meters(+m[1], m[2]?.toLowerCase()));
  }
  const tuple = text.match(
    /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(cm|m|미터)?/i,
  );
  if (tuple) {
    for (const [k, value] of [
      ['w', tuple[1]],
      ['d', tuple[2]],
      ['h', tuple[3]],
    ])
      if (value !== undefined && dims[k] === undefined)
        put(k, meters(+value, tuple[4]?.toLowerCase()));
  }
  return dims;
}
export function consultRoom(text, previous) {
  const type = detectRoomType(text),
    add = /(?:추가|하나\s*더|새로\s*만들|새\s*(?:방|공간))/.test(text) && !!type;
  const room = add ? makeRoom(type) : structuredClone(previous),
    explicit = parseRoomDimensions(text);
  let changed = false,
    areaBased = false;
  const set = (key, value, source) => {
    room[key] = round(value);
    room.sources[key] = source;
    changed = true;
  };
  if (type && type !== room.type) {
    room.type = type;
    changed = true;
    const base = makeRoom(type);
    for (const k of ['w', 'd', 'h'])
      if (!room.sources[k].startsWith('사용자')) set(k, base[k], '공간 유형 기본값');
  }
  const size = /아담|작은|작게|좁은|컴팩트/.test(text)
    ? 0
    : /넓은|넓게|넉넉|큰\s*방|크게/.test(text)
      ? 2
      : null;
  if (size !== null) {
    const base = ROOM_TYPES[room.type].sizes[size];
    for (const [i, k] of ['w', 'd', 'h'].entries())
      if (!room.sources[k].startsWith('사용자')) set(k, base[i], '대화 추정 · 공간 크기');
  }
  const area = text.match(/(\d+(?:\.\d+)?)\s*(평|m²|m2|제곱미터)/i);
  if (area && !(explicit.w && explicit.d)) {
    const square = +area[1] * (area[2] === '평' ? 3.3058 : 1);
    if (square < 1 || square > 225) throw Error('면적은 1~225m² 범위로 알려주세요.');
    let w = explicit.w,
      d = explicit.d;
    if (w) d = square / w;
    else if (d) w = square / d;
    else {
      const ratio = room.w / room.d;
      w = Math.sqrt(square * ratio);
      d = square / w;
    }
    if (w < 1 || w > 15 || d < 1 || d > 15)
      throw Error('그 면적과 치수를 조합하면 방 치수가 범위를 벗어나요.');
    set('w', w, '대화 추정 · 면적에서 가정');
    set('d', d, '대화 추정 · 면적에서 가정');
    areaBased = true;
  }
  for (const [k, n] of Object.entries(explicit)) set(k, n, '사용자 설정 · 대화');
  for (const [key, pattern] of [
    ['w', /가로[^.!?]{0,8}(?:늘려|넓혀|더\s*넓게)/],
    ['d', /세로[^.!?]{0,8}(?:늘려|넓혀|더\s*길게)/],
    ['h', /천장[^.!?]{0,8}(?:높여|더\s*높게)/],
  ])
    if (pattern.test(text) && explicit[key] === undefined)
      set(key, Math.min(15, room[key] + 0.5), '사용자 요청 · 0.5m 증가');
  const colors = [
    [/세이지|연두|그린/, '#c0cbbb'],
    [/블루|파란/, '#bfcbd1'],
    [/그레이|회색/, '#d5d2cb'],
    [/샌드|베이지/, '#e0cfb9'],
    [/화이트|흰색|아이보리/, '#faf9f5'],
  ];
  if (/벽/.test(text))
    for (const [re, c] of colors)
      if (re.test(text)) {
        room.wallColor = c;
        changed = true;
        break;
      }
  if (/바닥/.test(text)) {
    const c = /월넛|짙은|어두운/.test(text)
      ? '#93785c'
      : /밝은|라이트/.test(text)
        ? '#eee4ce'
        : /그레이|회색/.test(text)
          ? '#babbb6'
          : /오크|나무|우드|내추럴/.test(text)
            ? '#e0d4bf'
            : null;
    if (c) {
      room.floorColor = c;
      changed = true;
    }
  }
  let reply =
    changed || add
      ? `${ROOM_TYPES[room.type].name}을 가로 ${room.w}m, 세로 ${room.d}m, 천장 ${room.h}m로 ${add ? '새로 만들었어요' : '반영했어요'}.`
      : '방 유형과 가로·세로를 알려주세요. “거실 가로 5m 세로 4m”처럼 말하면 도면에 바로 반영해요.';
  if (areaBased)
    reply +=
      ' 면적만으로 가로·세로는 알 수 없어 현재 비율로 나눈 초안이에요. 벽 하나의 길이를 알면 더 조절할 수 있어요.';
  return { room, reply, add, changed };
}
export function applyRoomModel(raw, previous, options = {}) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw Error('방 상담 응답을 읽지 못했어요.');
  const v = JSON.parse(match[0]),
    room = structuredClone(previous);
  if (typeof v.reply !== 'string' || !v.reply.trim()) throw Error('방 상담 응답이 비어 있어요.');
  const text = options.text;
  const allowedTypes = [];
  if (typeof text === 'string') {
    for (const [pattern, types] of [
      [/책|공부|업무|작업/, ['office']],
      [/잠|수면/, ['bedroom']],
      [/아이|어린이/, ['kids']],
      [/요리|조리/, ['kitchen']],
      [/식사/, ['dining']],
      [/손님|가족.*모여/, ['living']],
    ])
      if (pattern.test(text)) allowedTypes.push(...types);
  }
  const allowType =
    text === undefined || (!detectRoomType(text) && allowedTypes.includes(v.room_type));
  if (allowType && Object.hasOwn(ROOM_TYPES, v.room_type)) room.type = v.room_type;
  const allowSize =
    text === undefined ||
    /아담|작은|작게|좁은|컴팩트|넓은|넓게|넉넉|큰\s*(?:방|공간)|크게|보통|표준/.test(text);
  if (allowSize && ['compact', 'standard', 'large'].includes(v.size)) {
    const values = ROOM_TYPES[room.type].sizes[['compact', 'standard', 'large'].indexOf(v.size)];
    for (const [i, k] of ['w', 'd', 'h'].entries())
      if (!/^(사용자|대화 추정)/.test(room.sources[k])) {
        room[k] = values[i];
        room.sources[k] = 'AI 단서 · 공간 유형 추정';
      }
  }
  return { room, reply: v.reply.slice(0, 700), ui: UI_SURFACES.room.includes(v.ui) ? v.ui : null };
}
