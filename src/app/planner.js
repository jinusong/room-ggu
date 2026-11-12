// 규칙 기반 대화 계획기. 사용자 문장 하나를 읽고 "무엇을 바꿀지, 어떤 도구를 보여줄지"를 정한다.
// 상태를 직접 바꾸지 않는다. 적용과 실행 취소 기록은 store가 맡는다.
import { TYPES, ROOM_TYPES } from '../catalog.js';
import { makeItem, layoutWarnings, clampItem, spaces } from '../data.js';
import { consult, detectType, extractDimensions } from '../estimator.js';
import { consultRoom, consultationScope, detectRoomType } from '../room-consult.js';
import { chooseSurface, surfaceKind } from '../ui-schema.js';

// 규칙이 기본값으로 물러난 경우(방: 유형, 가구: 규격)가 아니면 요청 단어로 도구를 확신한 것이다.
const confidentPick = (scope, pick) => pick !== (scope === 'room' ? 'types' : 'sizes');

const ROOM_REFERENCE =
  /(?:방|공간)(?:을|를|은|는|이|가|의)?\s*(?:가로|세로|크기|치수|넓이|면적)|천장|\d\s*평|평수|m²|제곱미터|벽|바닥/;

const COLOR_WORDS = [
  [/오크|원목|나무색|우드/, '#b29a80'],
  [/크림|아이보리|베이지/, '#e5ddcc'],
  [/올리브|초록|그린|세이지|녹색/, '#83917d'],
  [/테라코타|주황|오렌지|벽돌/, '#bc8065'],
  [/블루|파란|하늘색|파랑/, '#8495a5'],
  [/차콜|검정|블랙|검은|어두운\s*회색/, '#575c58'],
  [/월넛|브라운|갈색|진한\s*나무/, '#7a5c43'],
  [/화이트|흰색|하얀/, '#efede7'],
  [/네이비|남색/, '#3f4d63'],
  [/머스터드|노랑|노란|겨자/, '#c99a3c'],
];

export function parseFurnitureColor(text) {
  for (const [re, hex] of COLOR_WORDS) if (re.test(text)) return hex;
  return null;
}

// 선택한 가구가 있으면 방 단어가 분명할 때만 방 상담으로 본다.
const ROOM_TALK =
  /(?:방|공간|룸)(?:으로|을|를|은|는|이|가)?\s*(?:꾸미|꾸며|바꿔|만들|정리|채우)|(?:아담한|작은|좁은|넓은|큰|밝은)\s*(?:방|공간)/;

export function resolveScope(text, target = { type: 'room' }) {
  if (target.type === 'item' || target.type === 'draft') {
    if (!detectType(text) && ROOM_TALK.test(text)) return 'room';
    if (detectRoomType(text) || ROOM_REFERENCE.test(text)) {
      const scope = consultationScope(text, 'auto');
      return detectType(text) && !/벽|바닥|천장/.test(text) ? 'furniture' : scope;
    }
    return 'furniture';
  }
  return consultationScope(text, 'auto');
}

const roomTarget = { type: 'room' };
const surface = (kind, target = roomTarget) => ({ kind, target });
const say = (label, text) => ({ label, text });
const act = (label, action, extra = {}) => ({ label, action, ...extra });

function metaPlan(action, reply, extra = {}) {
  return { intent: 'meta', scope: null, action, reply, surfaces: [], suggestions: [], ...extra };
}
function surfacePlan(kind, reply, suggestions = []) {
  return { intent: 'meta', scope: null, reply, surfaces: [surface(kind)], suggestions };
}

function matchSpace(text, state) {
  if (!/(?:이동|전환|열어|보여|가자|넘어가|바꿔)/.test(text)) return null;
  return (
    spaces(state)
      .filter((r) => r.roomId !== state.roomId)
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => r.name.length >= 2 && text.includes(r.name)) || null
  );
}

function planMeta(t, ctx, item) {
  const { state, draft } = ctx;
  const numbers = Object.keys(extractDimensions(t)).length > 0;
  const type = detectType(t);
  if (/^(?:방금\s*(?:거|것|건)?\s*)?(?:되돌려|되돌리기|실행\s*취소|취소해)/.test(t))
    return metaPlan('undo', '방금 바꾼 내용을 되돌렸어요.');
  if (/^다시\s*실행/.test(t)) return metaPlan('redo', '되돌린 내용을 다시 적용했어요.');
  if (/(?:저장|내보내|불러오|이미지로|png|json|배치\s*파일)/i.test(t) && !numbers)
    return surfacePlan(
      'files',
      '배치는 파일로 저장하거나 불러올 수 있어요. 지금 보이는 화면은 이미지로 저장돼요.',
    );
  if (/(?:\bai\b|에이아이|젬마|gemma|인공지능|언어\s*모델|사진\s*모델)/i.test(t))
    return surfacePlan(
      'ai',
      '이 기기에서 실행하는 모델을 준비하거나 끌 수 있어요. 준비하지 않아도 기본 상담은 계속 돼요.',
    );
  if (/(?:사용법|도움말|어떻게\s*(?:써|사용|하면\s*돼))/.test(t))
    return surfacePlan('help', '이렇게 쓰면 돼요.');
  if (/(?:가구\s*목록|배치된\s*가구|어떤\s*가구가\s*있|뭐가\s*(?:있|놓여))/.test(t))
    return surfacePlan('items', `이 방에 놓인 가구는 ${state.items.length}개예요.`);
  const space = matchSpace(t, state);
  if (space)
    return metaPlan('switch', `${space.name}(으)로 옮겼어요.`, { arg: { id: space.roomId } });
  if (
    /(?:공간|방)\s*(?:목록|전환|이동|관리)|다른\s*(?:방|공간)(?!\s*(?:추가|만들))/.test(t) &&
    !detectRoomType(t)
  )
    return surfacePlan('spaces', `저장된 공간은 ${spaces(state).length}개예요.`);
  if (
    !type &&
    /(?:가구|뭘|무엇을|어떤\s*(?:걸|것을?))\s*(?:고르|골라|보여|놓을|추천|종류|둘러)|가구\s*(?:추가|고르기|라이브러리)/.test(
      t,
    )
  )
    return surfacePlan(
      'catalog',
      '놓고 싶은 가구를 골라 주세요. 고르면 크기 초안부터 보여드릴게요.',
    );
  if (/겹치지\s*않게|겹친\s*(?:거|것|가구)|빈\s*(?:곳|자리)으로|자동\s*(?:정리|배치)/.test(t))
    return metaPlan('relocate', '');
  if (/빈\s*방(?:으로|에서)|가구\s*(?:를\s*)?(?:다|모두|전부)\s*(?:치워|비워|빼)/.test(t))
    return metaPlan('clear', '');
  if (/예시\s*(?:방|공간)/.test(t)) return metaPlan('example', '');
  if (item) {
    if (/회전|돌려/.test(t)) {
      const m = t.match(/(-?\d{1,3})\s*도/);
      return metaPlan('rotate', '', { arg: { deg: m ? +m[1] : 90 } });
    }
    if (!type && /복제|하나\s*더|똑같은\s*(?:거|것)/.test(t)) return metaPlan('duplicate', '');
    if (/삭제|지워|빼\s*줘|없애|치워\s*줘/.test(t)) return metaPlan('delete', '');
  }
  if (
    draft &&
    (!type || type === draft.type) &&
    !numbers &&
    t.length <= 24 &&
    /(?:놓아\s*줘|놔\s*줘|배치해\s*줘?|놓을게|놓자|놓기|넣어\s*줘)\s*[.!]?$/.test(t)
  )
    return metaPlan('place', '');
  return null;
}

function furnitureChips(item, mode) {
  const chips = [];
  if (mode !== 'item') chips.push(act('방에 놓기', 'place', { primary: true }));
  if (item.type === 'sofa' && !item.sources[0].startsWith('사용자'))
    chips.push(say('2인', '두 명이 앉아요'), say('3인', '세 명이 앉아요'));
  else if (item.type === 'bed' && !item.sources[0].startsWith('사용자'))
    chips.push(say('싱글', '싱글 침대야'), say('퀸', '퀸 침대야'));
  else chips.push(say('조금 더 작게', '조금 더 작게'));
  chips.push(say('색 바꾸기', `${TYPES[item.type].name} 색을 바꾸고 싶어`));
  return chips;
}

function planRoom(t, ctx) {
  const { state } = ctx;
  let r;
  try {
    r = consultRoom(t, state.room);
  } catch (e) {
    return {
      intent: 'room',
      scope: 'room',
      error: e.message,
      reply: e.message,
      surfaces: [surface('room-size')],
      suggestions: [],
    };
  }
  const picked = chooseSurface(t, 'room');
  // 새 공간을 만들었으면 다음 할 일은 크기 정하기다.
  const kind = surfaceKind('room', r.add && picked === 'types' ? 'dimensions' : picked);
  const surfaces = [surface(kind)];
  if (!r.add) {
    const items = state.items.map((a) => {
      const c = { ...a };
      clampItem(c, r.room);
      return c;
    });
    if (layoutWarnings({ ...state, room: r.room, items }).all.size > layoutWarnings(state).all.size)
      surfaces.push(surface('impact'));
  }
  const suggestions = [];
  const userSet = ['w', 'd'].every((k) => r.room.sources[k].startsWith('사용자'));
  if (!userSet && kind !== 'room-size') suggestions.push(say('크기 알려주기', '가로 4m 세로 3m'));
  if (kind !== 'finishes') suggestions.push(say('벽·바닥 색', '벽과 바닥 색을 바꾸고 싶어'));
  suggestions.push(act('가구 고르기', 'catalog'));
  return {
    intent: 'room',
    scope: 'room',
    confident: confidentPick('room', picked),
    reply: r.reply,
    changed: r.changed || r.add,
    changes: r.add ? { addSpace: r.room.type, room: r.room } : r.changed ? { room: r.room } : {},
    surfaces,
    suggestions,
  };
}

function planFurniture(t, ctx, item) {
  const { state, draft, caption = '' } = ctx;
  const type = detectType(t);
  let base, mode;
  if (item && (!type || type === item.type)) [base, mode] = [item, 'item'];
  else if (draft && (!type || type === draft.type)) [base, mode] = [draft, 'draft'];
  else if (type) [base, mode] = [makeItem(type), 'new'];
  else if (detectType(caption)) [base, mode] = [makeItem(detectType(caption)), 'new'];
  else
    return {
      intent: 'furniture',
      scope: null,
      reply: '어떤 가구인지 알려주세요. 이름을 말하거나 아래에서 고르면 크기 초안부터 잡아드려요.',
      surfaces: [surface('catalog')],
      suggestions: [say('2인 소파', '두 명이 앉는 소파'), say('책상', '기본 책상 하나')],
    };
  const res = consult(t, structuredClone(base));
  const next = res.item,
    color = parseFurnitureColor(t);
  if (color && /색|컬러|톤|으로\s*(?:바꿔|해)|[가-힣]+색/.test(t)) next.color = color;
  else if (color && mode === 'new') next.color = color;
  const target = mode === 'item' ? { type: 'item', id: item.id } : { type: 'draft' };
  const pick = chooseSurface(t, 'furniture');
  const kind = surfaceKind('furniture', color && pick === 'sizes' ? 'colors' : pick);
  const surfaces = [surface(kind, target)];
  if (mode === 'item') {
    const items = state.items.map((a) => (a.id === item.id ? { ...next } : a));
    if (layoutWarnings({ ...state, items }).all.size > layoutWarnings(state).all.size)
      surfaces.push(surface('impact'));
  }
  return {
    intent: 'furniture',
    scope: 'furniture',
    mode,
    target,
    confident: confidentPick('furniture', pick) || !!color,
    reply:
      mode === 'new'
        ? res.reply.replace('치수 초안을 바꿨어요.', '치수 초안을 잡았어요.')
        : res.reply,
    changes: mode === 'item' ? { item: { id: item.id, next } } : { draft: next },
    surfaces,
    suggestions: furnitureChips(next, mode),
  };
}

export function planTurn(text, ctx) {
  const t = String(text).trim().slice(0, 1500);
  const target = ctx.target || roomTarget;
  const item = target.type === 'item' ? ctx.state.items.find((a) => a.id === target.id) : null;
  const meta = planMeta(t, ctx, item);
  if (meta) return meta;
  const scope = resolveScope(t, item || target.type === 'draft' ? target : roomTarget);
  return scope === 'room' ? planRoom(t, ctx) : planFurniture(t, ctx, item);
}

// 첫 화면과 빈 대화에서 보여줄 시작점.
export const STARTERS = [
  { label: '방 크기부터', detail: '가로·세로·천장 높이', action: 'tool', arg: 'room-size' },
  { label: '가구 고르기', detail: '20종 · 63가지 크기 초안', action: 'tool', arg: 'catalog' },
  { label: '사진으로 시작', detail: '가구 사진에서 종류부터 잡기', action: 'photo' },
  { label: '벽과 바닥', detail: '마감 색 비교하기', action: 'tool', arg: 'finishes' },
];
export const EXAMPLE_PROMPTS = [
  '6평 원룸, 천장 2.4m',
  '두 명이 앉는 소파',
  '벽은 세이지, 바닥은 월넛',
];
export const ROOM_TYPE_NAMES = Object.fromEntries(
  Object.entries(ROOM_TYPES).map(([k, v]) => [k, v.name]),
);
