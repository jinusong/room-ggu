import { sizeFields } from './dimensions.js';
import { UI_SURFACES } from './ui-schema.js';
import { detectType } from './estimator.js';
import { ROOM_TYPES, makeRoom, retypeRoom } from './catalog.js';
import { josa } from './app/text.js';
const roomAliases = {
  studio: /원룸|스튜디오/,
  bathroom: /화장실|욕실/,
  living: /거실(?!장)|리빙룸/,
  bedroom: /침실|안방/,
  office: /서재|작업실|홈\s*오피스/,
  dining: /다이닝룸|식사\s*공간/,
  kitchen: /주방|부엌/,
  kids: /아이\s*방|어린이\s*방/,
};
// 이름 없이 용도로만 말했을 때 그 유형으로 읽을 근거. 모델이 고른 유형은 이 말이 문장에 있을 때만 쓴다.
const ROOM_EVIDENCE = {
  studio: /혼자\s*(?:살|사는|지낼)|자취/,
  bathroom: /씻|샤워|목욕|욕조|변기|세면/,
  living: /쉬|휴식|모여|티비|TV|소파/i,
  bedroom: /잠|수면|자는|잘\s*(?:방|곳|공간)|침대|손님|옷/,
  office: /책|공부|업무|작업|일하|재택|컴퓨터/,
  dining: /식사|밥\s*먹|먹는|식탁/,
  kitchen: /요리|조리|음식\s*(?:하|만들)/,
  kids: /아이|어린이|아기|애기|유아/,
};
export const roomEvidence = (type, text) => !!ROOM_EVIDENCE[type]?.test(text);
// 문장에 나온 공간 이름은 같은 낱말이어도 하는 일이 다르다.
// - ref: "화장실 옆에"처럼 자리를 가리킨다. 새로 만들거나 바꿀 유형이 아니다.
// - neg: "화장실 말고", "왜 화장실로 만들어"처럼 아니라고 한 유형이다.
// - new: 그 밖의 경우. 만들거나 바꾸려는 유형이다. strong은 "거실이라니까", "거실로 바꿔"처럼 못 박은 말이다.
const REF_AFTER =
  /^\s*(?:바로\s*)?(?:옆|앞|뒤|근처|맞은\s*편|건너편|왼쪽|오른쪽|위쪽|아래쪽|위에|아래에|쪽에|(?:이랑|랑|과|와|하고)\s*(?:붙|연결|이어|맞닿|나란)|에\s*(?:붙|이어|맞닿|연결))/;
const NEG_AFTER =
  /^\s*(?:이|가|은|는|으로|로)?\s*(?:말고|아니|아닌|아냐|아님|빼고|대신|(?:하지|만들지|바꾸지|넣지)\s*(?:말|마))/;
const BLAME_BEFORE = /왜|어째서|자꾸|계속|또\s/;
const BLAME_AFTER =
  /^\s*(?:(?:으로|로)\s*(?:자꾸\s*|계속\s*)?(?:생성|고정|만들|만든|바꾸|바꿔|바꿨|해\s*놨|했|하냐|하는|되|돼|됐|나오|나와|잡|설정|인식|읽)|(?:이|가)\s*(?:됐|돼|된|되))/;
const STRONG_AFTER =
  /^\s*(?:이라니까|라니까|이라고|라고|이라구|라구|임(?![가-힣])|이야|야(?![가-힣])|이에요|예요|입니다|이다(?![가-힣])|인데|이지|(?:으로|로)\s*(?:바꿔|바꾸|해\s*줘|해줘|하자|할래|만들|변경|수정))/;
const SIDE_AFTER = [
  ['right', /^\s*(?:의\s*)?(?:바로\s*)?오른쪽/],
  ['left', /^\s*(?:의\s*)?(?:바로\s*)?왼쪽/],
  ['back', /^\s*(?:의\s*)?(?:바로\s*)?(?:위쪽|위에|뒤쪽|뒤에|뒤)/],
  ['front', /^\s*(?:의\s*)?(?:바로\s*)?(?:아래쪽|아래에|앞쪽|앞에|앞)/],
];
export function roomMentions(text) {
  const t = String(text),
    found = [];
  for (const [type, re] of Object.entries(roomAliases))
    for (const m of t.matchAll(new RegExp(re.source, 'g'))) {
      const end = m.index + m[0].length,
        after = t.slice(end, end + 24),
        // 같은 문장 안에서만 "왜 … 로 만들어" 같은 따지는 말을 찾는다.
        before = t
          .slice(0, m.index)
          .split(/[.!?\n]/)
          .pop();
      let role = 'new';
      if (REF_AFTER.test(after)) role = 'ref';
      else if (NEG_AFTER.test(after) || (BLAME_BEFORE.test(before) && BLAME_AFTER.test(after)))
        role = 'neg';
      found.push({
        type,
        index: m.index,
        role,
        strong: role === 'new' && STRONG_AFTER.test(after),
        side: role === 'ref' ? SIDE_AFTER.find(([, r]) => r.test(after))?.[0] || null : null,
      });
    }
  return found.sort((a, b) => a.index - b.index);
}
// 만들거나 바꾸려는 유형. 못 박은 말이 있으면 그중 마지막을, 없으면 처음 나온 유형을 고른다.
export function assertedType(mentions) {
  const wanted = mentions.filter((m) => m.role === 'new');
  return (wanted.filter((m) => m.strong).at(-1) || wanted[0])?.type || null;
}
export const detectRoomType = (text) => assertedType(roomMentions(text));
// 어떤 뜻으로든 공간 이름이 나왔는지. 방 이야기인지 가를 때 쓴다.
export const mentionsRoom = (text) => roomMentions(text).length > 0;
// 새 공간을 만들자는 말인지. "옆에"로 자리를 짚었으면 "만들어", "붙여", "하나"만 있어도 그렇게 읽는다.
const ADD_WORDS = /추가|하나\s*더|새로\s*만들|새\s*(?:방|공간)/;
const ADD_NEAR = /붙여|붙이|만들|놓|두자|둬|하나|있었으면|필요|생성|달아|이어/;
export function wantsNewSpace(text, mentions = roomMentions(text)) {
  return ADD_WORDS.test(text) || (mentions.some((m) => m.role === 'ref') && ADD_NEAR.test(text));
}
export function isRoomIntent(text) {
  return (
    /(?:방|공간|거실|침실|서재|주방|원룸|다이닝룸).*(?:가로|세로|천장|평|제곱|넓|좁|크기|추가|만들|바꿔|변경|꾸미)|(?:벽|바닥).*(?:색|흰|화이트|오크|월넛|그레이|세이지)|(?:가로|세로|천장).*\d+\s*(?:m|미터)|\d+\s*(?:평|m²|제곱미터)/i.test(
      text,
    ) || mentionsRoom(text)
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
  const { values, issue } = sizeFields(text, true);
  if (issue?.kind === 'range') throw Error('방 치수는 1~15m 범위로 알려주세요.');
  if (issue?.kind === 'conflict')
    throw Error('같은 치수에 숫자가 두 개 있어요. 어느 값으로 맞출까요?');
  return Object.fromEntries(Object.entries(values).map(([k, x]) => [k, x.value]));
}
export function consultRoom(text, previous) {
  const mentions = roomMentions(text),
    type = assertedType(mentions),
    wantsAdd = wantsNewSpace(text, mentions),
    add = wantsAdd && !!type;
  let room = add ? makeRoom(type) : structuredClone(previous);
  const explicit = parseRoomDimensions(text);
  let changed = false,
    areaSaid = null;
  const set = (key, value, source) => {
    room[key] = round(value);
    room.sources[key] = source;
    changed = true;
  };
  if (type && type !== room.type) {
    room = retypeRoom(room, type);
    changed = true;
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
  if (area && explicit.w && explicit.d) {
    const square = +area[1] * (area[2] === '평' ? 3.3058 : 1);
    if (Math.abs(explicit.w * explicit.d - square) / square > 0.02)
      throw Error('가로·세로로 계산한 면적과 요청한 면적이 달라요. 어느 쪽을 기준으로 할까요?');
  }
  if (area && !(explicit.w && explicit.d)) {
    const square = +area[1] * (area[2] === '평' ? 3.3058 : 1);
    if (square < 1 || square > 225) throw Error('면적은 1~225m² 범위로 알려주세요.');
    // 면적만으로는 가로·세로가 정해지지 않는다. 한쪽 길이를 말했으면 나머지를 면적으로 구하고,
    // 아니면 지금 방의 비율("정사각형"이라고 했으면 1:1)로 나눈다. "6평 정도"에 4.92m 같은 값을 내놓지 않게
    // 5cm 단위로 다듬되, 다듬은 넓이가 말한 면적에서 2% 넘게 벗어나면 다듬지 않는다.
    const nice = (n) => Math.round(n * 20) / 20,
      fits = (a, b) => Math.abs(a * b - square) / square <= 0.02,
      square1 = /정사각|정방형/.test(text);
    let w = explicit.w ?? (room.sources.w.startsWith('사용자') ? room.w : null),
      d = explicit.d ?? (room.sources.d.startsWith('사용자') ? room.d : null);
    if (w && d && !fits(w, d))
      throw Error('정한 가로·세로와 요청한 면적이 달라요. 어느 쪽 치수를 바꿀까요?');
    if (w && !d) d = fits(w, nice(square / w)) ? nice(square / w) : square / w;
    else if (d && !w) w = fits(nice(square / d), d) ? nice(square / d) : square / d;
    else if (!w && !d) {
      const ratio = square1 ? 1 : room.w / room.d,
        exact = Math.sqrt(square * ratio);
      w = nice(exact);
      d = nice(square / w);
      if (!fits(w, d)) [w, d] = [exact, square / exact];
    }
    if (w < 1 || w > 15 || d < 1 || d > 15)
      throw Error('그 면적과 치수를 조합하면 방 치수가 범위를 벗어나요.');
    if (!room.sources.w.startsWith('사용자') || explicit.w)
      set('w', w, '대화 추정 · 면적에서 가정');
    if (!room.sources.d.startsWith('사용자') || explicit.d)
      set('d', d, '대화 추정 · 면적에서 가정');
    // 답에서 사용자가 말한 면적을 그대로 받아 준다: "6평(약 19.8m²)".
    const pyeong = area[2] === '평';
    areaSaid = {
      text: `${area[1]}${pyeong ? '평' : 'm²'}`,
      about: pyeong
        ? `약 ${Math.round(square * 10) / 10}m²`
        : `약 ${(square / 3.3058).toFixed(1)}평`,
      // 가로·세로를 앱이 가정했는지. 그렇다면 한쪽 길이를 물어본다.
      assumed: !explicit.w && !explicit.d,
      square: square1,
    };
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
  const name = ROOM_TYPES[room.type].name;
  let reply =
    changed || add
      ? `${josa(name, '을/를')} 가로 ${room.w}m, 세로 ${room.d}m, 천장 ${room.h}m로 ${add ? '새로 만들었어요' : '반영했어요'}.`
      : '방 유형과 가로·세로를 알려주세요. “거실 가로 5m 세로 4m”처럼 말하면 도면에 바로 반영해요.';
  if (areaSaid)
    reply =
      `${areaSaid.text}(${areaSaid.about})에 맞춰 ${josa(name, '을/를')} 가로 ${room.w}m, 세로 ${room.d}m로 ${add ? '새로 만들었어요' : '잡았어요'}.` +
      (areaSaid.assumed
        ? areaSaid.square
          ? ' 정사각형에 가깝게 나눴어요.'
          : ' 한쪽 벽 길이를 알려주면 그 길이에 맞춰 다시 나눌게요.'
        : '');
  return {
    room,
    reply,
    add,
    changed,
    // 면적으로 크기를 잡았으면 말한 면적과 가정 여부.
    area: areaSaid,
    // 새 공간을 만들자고 했지만 어떤 공간인지는 말하지 않았다.
    askType: wantsAdd && !type && /방|공간|룸/.test(text),
    // 지금 방이 이미 그 유형이다.
    same: !add && !changed && !!type && type === previous.type ? type : null,
  };
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
