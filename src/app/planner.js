// 규칙 기반 대화 계획기. 상담 모델을 쓸 수 없을 때(준비 중·꺼짐·미지원·실패) 쓰는 대체 경로다.
// 사용자 문장 하나를 읽고 "무엇을 바꿀지, 어떤 도구를 보여줄지"를 정한다.
// 상태를 직접 바꾸지 않는다. 적용과 실행 취소 기록은 store가 맡는다.
import { TYPES, ROOM_TYPES, FURNITURE_COLORS, WALL_COLORS, FLOOR_COLORS } from '../catalog.js';
import { josa } from './text.js';
import { makeItem, layoutWarnings, clampItem, spaces } from '../data.js';
import { consult, detectType, extractDimensions, unlistedInfo } from '../estimator.js';
import { consultRoom, consultationScope, detectRoomType } from '../room-consult.js';
import { chooseSurface, surfaceKind } from '../ui-schema.js';

// 규칙이 기본값으로 물러난 경우(방: 유형, 가구: 규격)가 아니면 요청 단어로 도구를 확신한 것이다.
const confidentPick = (scope, pick) => pick !== (scope === 'room' ? 'types' : 'sizes');

export const ROOM_REFERENCE =
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
export const ROOM_TALK =
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

export function metaPlan(action, reply, extra = {}) {
  return { intent: 'meta', scope: null, action, reply, surfaces: [], suggestions: [], ...extra };
}
export function surfacePlan(kind, reply, suggestions = []) {
  return { intent: 'meta', scope: null, reply, surfaces: [surface(kind)], suggestions };
}

export function matchSpace(text, state) {
  if (!/(?:이동|전환|열어|보여|가자|넘어가|바꿔)/.test(text)) return null;
  return (
    spaces(state)
      .filter((r) => r.roomId !== state.roomId)
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => r.name.length >= 2 && text.includes(r.name)) || null
  );
}

// “침대 빼줘”처럼 동작할 가구를 문장에 적었으면 그 가구에 한다. 이름이 없거나 고른 가구와 같으면 고른 가구다.
// 말한 가구가 방에 없거나 여럿이면 실행하지 않고 알려 준다. 같은 종류의 초안이 떠 있으면 초안 이야기로 넘긴다.
export function actionSubject(t, state, item, verb, draft = null) {
  const type = detectType(t);
  if (!type || type === item?.type) return item ? { item } : null;
  const found = state.items.filter((a) => a.type === type);
  if (found.length === 1) return { item: found[0] };
  if (!found.length && draft?.type === type) return null;
  const name = TYPES[type].name;
  return {
    plan: {
      intent: 'meta',
      scope: null,
      reply: found.length
        ? `${josa(name, '이/가')} ${found.length}개 있어요. ${verb} ${josa(name, '을/를')} 도면에서 눌러 고른 뒤 다시 말해 주세요.`
        : `이 방에는 ${josa(name, '이/가')} 없어요.`,
      surfaces: found.length ? [surface('items')] : [],
      suggestions: [],
    },
  };
}

function planMeta(t, ctx, item) {
  const { state, draft } = ctx;
  const numbers = Object.keys(extractDimensions(t)).length > 0;
  const type = detectType(t);
  if (/^(?:방금\s*(?:거|것|건)?\s*)?(?:되돌려|되돌리기|실행\s*취소|취소해)/.test(t))
    return metaPlan('undo', '방금 바꾼 내용을 되돌렸어요.');
  if (/^다시\s*실행/.test(t)) return metaPlan('redo', '되돌린 내용을 다시 적용했어요.');
  if (/예시\s*(?:방|공간)/.test(t)) return metaPlan('example', '');
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
  if (
    /(?:사용법|도움말|어떻게\s*(?:써|사용|하면\s*돼)|(?:뭘|뭐|무엇을)\s*할\s*수|할\s*수\s*있는\s*(?:게|것|일))/.test(
      t,
    )
  )
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
  const rotate = /회전|돌려/.test(t);
  if (rotate || /삭제|지워|빼\s*줘|없애|치워\s*줘/.test(t)) {
    const who = actionSubject(t, state, item, rotate ? '돌릴' : '뺄', ctx.draft);
    if (who?.plan) return who.plan;
    if (who && rotate) {
      const m = t.match(/(-?\d{1,3})\s*도/);
      return metaPlan('rotate', '', { arg: { deg: m ? +m[1] : 90, id: who.item.id } });
    }
    if (who) return metaPlan('delete', '', { arg: { id: who.item.id } });
  }
  if (item && !type && /복제|하나\s*더|똑같은\s*(?:거|것)/.test(t))
    return metaPlan('duplicate', '');
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

export function furnitureChips(item, mode) {
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

export function planRoom(t, ctx) {
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
  if (color && /색|컬러|톤|(?:으로|로)\s*(?:바꿔|바꾸|해)|[가-힣]+색/.test(t)) next.color = color;
  else if (color && mode === 'new') next.color = color;
  // 색만 바꿨으면 치수 이야기를 되풀이하지 않고 바뀐 색을 말한다.
  const colorName = FURNITURE_COLORS.find(([, hex]) => hex === next.color)?.[0],
    colorOnly =
      mode !== 'new' &&
      colorName &&
      next.color !== base.color &&
      next.dims.every((d, i) => d === base.dims[i]);
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
    reply: colorOnly
      ? `${next.name || TYPES[next.type].name} 색을 ${josa(colorName, '으로/로')} 바꿨어요.`
      : mode === 'new'
        ? res.reply.replace('치수 초안을 바꿨어요.', '치수 초안을 잡았어요.')
        : res.reply,
    changes: mode === 'item' ? { item: { id: item.id, next } } : { draft: next },
    surfaces,
    suggestions: furnitureChips(next, mode),
  };
}

// 선택한 가구·초안에 하는 동작. 목록에 없는 물건을 말했으면 지금 대상에 하지 않는다.
const SUBJECT_ACTIONS = ['rotate', 'duplicate', 'delete', 'place'];
const nameList = (names) => names.slice(0, 3).join('·');

// 놓기·빼기 같은 동사 바로 앞의 낱말을 목적어로 읽는다. 목록의 가구면 known, 아니면 무엇이든 unlisted다.
// "컴퓨터랑 책상"처럼 이어진 말은 함께 보고, "책상에"·"책상 위에"는 놓을 곳(place)으로 본다.
const OBJECT_VERB =
  /^(?:놓|놔|두고|둘|둬|두자|두면|두려|추가|넣|배치|만들|만들어|올려|올리|올릴|설치|깔아|깔고|붙여|생성|사고|살래|사자|사줘|사려|들이|들여|필요|있으면|있어|있나|있니|갖다|가져|걸어|걸고|달아|빼|지워|지우|삭제|없애|치워|돌려|돌리|회전|옮겨|옮기|복제)/;
// 목적어와 동사 사이에 오는 수량·꾸밈·자리 말은 건너뛴다.
const SKIP_WORD =
  /^(?:하나|하나만|한|두|세|네|몇|개|대|더|좀|또|새로|같이|다시|그냥|바로|꼭|\d+(?:\.\d+)?\s*(?:개|대|도|cm|mm|m|센치|미터)?)$|(?:게|히|으로|로|쪽|에|에서|에다|에다가)$/;
const PARTICLE = /(?:이랑|랑|하고|와|과|을|를|은|는|이|가|도|만)$/;
const AND_TAIL = /(?:이랑|랑|하고|와|과|,)$/;
const PLACE_TAIL = /에(?:다가?)?$/;
const PLACE_WORD = /^(?:위|옆|앞|아래|밑|안)/;
const NOT_THING =
  /^(?:(?:이|그|저)(?:거|것|걸|건|게)|여기|거기|저기|이쪽|그쪽|가구|물건|초안|아바타|사람|공간|방|집|벽|바닥|천장|문|창문|크기|색|자리)$/;

export function objectsOf(t) {
  const words = String(t)
    .replace(/[.!?~…]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const v = words.findIndex((w) => OBJECT_VERB.test(w));
  let i = v - 1;
  // “책상 위에”처럼 띄어 쓴 놓을 곳도 건너뛴다.
  while (i >= 0 && (SKIP_WORD.test(words[i]) || PLACE_WORD.test(words[i + 1] || ''))) i--;
  if (i < 0) return null;
  const picked = [i];
  while (picked[0] > 0 && AND_TAIL.test(words[picked[0] - 1])) picked.unshift(picked[0] - 1);
  const known = [],
    unlisted = [];
  for (const j of picked) {
    const raw = words[j].replace(/,$/, '');
    const w = raw.replace(PARTICLE, '') || raw;
    const odd = unlistedInfo(w);
    const type = !odd && detectType(w);
    if (odd) unlisted.push(odd);
    else if (type) known.push(type);
    else if (!NOT_THING.test(w) && !detectRoomType(w) && /[가-힣a-z]/i.test(w))
      unlisted.push({ name: w, on: false, alt: [] });
  }
  // 놓을 곳은 목적어 앞(“책상에 컴퓨터”)에도 뒤(“컴퓨터를 책상 위에”)에도 온다.
  let place = null;
  for (let j = 0; j < v; j++) {
    if (picked.includes(j)) continue;
    const type = detectType(words[j]);
    if (type && (PLACE_TAIL.test(words[j]) || PLACE_WORD.test(words[j + 1] || ''))) place = type;
  }
  return { known, unlisted, place };
}

// 목록에 없는 물건만 말했으면 가구를 만들거나 바꾸지 않고 없다고 답한다.
// 목록의 가구도 함께 말했으면(“컴퓨터랑 책상”) null을 돌려 그 가구로 이어서 처리한다.
export function unlistedPlan(t) {
  const o = objectsOf(t);
  if (!o?.unlisted.length || o.known.length) return null;
  return unlistedReply(o);
}

function unlistedReply(o) {
  const first = o.unlisted[0];
  const names = nameList(o.unlisted.map((x) => x.name));
  const count = Object.keys(TYPES).length;
  const reply = o.place
    ? `${josa(names, '은/는')} 아직 가구 목록에 없어서 ${TYPES[o.place].name} 위에 올릴 수 없어요. 지금은 바닥에 놓는 가구 ${count}종만 다뤄요.`
    : first.on
      ? `${josa(names, '은/는')} 아직 가구 목록에 없어요. 다른 가구 위에 올리는 물건은 아직 놓을 수 없어요.`
      : `${josa(names, '은/는')} 아직 가구 목록에 없어요. 지금은 가구 ${count}종만 놓을 수 있어요. 비슷한 크기의 가구로 자리를 가늠해 보세요.`;
  const alt = first.alt.filter((k) => k !== o.place).slice(0, 2);
  return {
    intent: 'chat',
    scope: null,
    unlisted: o.unlisted.map((x) => x.name),
    reply,
    surfaces: [],
    suggestions: [
      ...alt.map((k) => say(TYPES[k].name, `${TYPES[k].name} 하나 놓고 싶어`)),
      act('가구 고르기', 'catalog'),
    ],
  };
}

// 목록의 가구와 함께 말한 목록에 없는 물건은 빼고 처리했다고 덧붙인다.
export function noteUnlisted(plan, t) {
  const o = objectsOf(t);
  if (!o?.unlisted.length || !o.known.length || plan.intent !== 'furniture' || !plan.reply)
    return plan;
  const names = nameList(o.unlisted.map((x) => x.name));
  return { ...plan, reply: `${plan.reply} ${josa(names, '은/는')} 가구 목록에 없어서 뺐어요.` };
}

// 동사 없이 이름 하나만 말한 문장(“트램펄린”, “큰 트램펄린”)의 그 이름.
// 인사·대답·지시어·방 이름·색·분위기 말, “도와줘”처럼 서술어로 끝나는 말이면 null.
const CHAT_WORD =
  /^(?:안녕|고마|감사|응|네|예|아니|좋아|싫어|그래|됐어|오케이|ok|okay|hi|hello|thanks|ㅎ|ㅋ|ㅠ|음|흠|뭐|왜|와|오|굿)/i;
const STYLE_WORD =
  /모던|미니멀|북유럽|빈티지|내추럴|심플|클래식|인더스트리얼|코지|아늑|깔끔|따뜻|밝|어둡|스타일|느낌|분위기/;
const PREDICATE = /(?:줘|요|다|해|어|아|지|까|니|래|게|고|며|면|서|던)$/;
const SIZE_WORD = /^(?:크|큰|작|넓|좁|높|낮|길|짧|넉넉|아담|여유|얕|깊)/;
const COLOR_NAMES = [...FURNITURE_COLORS, ...WALL_COLORS, ...FLOOR_COLORS].map(([n]) => n);
// 받침이 ㄴ인 꾸밈말(“큰”, “작은”, “예쁜”)
const MODIFIER = (w) => {
  const code = w.slice(-1).charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 4;
};
function loneName(t) {
  if (objectsOf(t) || /\d/.test(t)) return null;
  const words = t
    .replace(/[.!?~…,]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SKIP_WORD.test(w));
  if (!words.length || words.length > 2 || (words.length === 2 && !MODIFIER(words[0]))) return null;
  const raw = words.at(-1);
  const w = raw.replace(PARTICLE, '') || raw;
  const odd = unlistedInfo(w);
  if (odd) return { ...odd, sure: true };
  if (
    detectType(w) ||
    CHAT_WORD.test(w) ||
    STYLE_WORD.test(w) ||
    SIZE_WORD.test(w) ||
    PREDICATE.test(raw) ||
    NOT_THING.test(w) ||
    detectRoomType(w) ||
    parseFurnitureColor(w) ||
    COLOR_NAMES.some((n) => w.includes(n)) ||
    !/[가-힣a-z]/i.test(w)
  )
    return null;
  return { name: w, on: false, alt: [] };
}

// 계획이 방·가구·초안 중 무엇이든 실제로 바꾸는지. 그대로인 초안이나 가구는 바꾸지 않은 것이다.
function changesSomething(plan, ctx, item) {
  const c = plan.changes || {};
  if (plan.action || c.room || c.addSpace) return true;
  if (c.item) return JSON.stringify(c.item.next) !== JSON.stringify(item);
  if (c.draft) return !ctx.draft || JSON.stringify(c.draft) !== JSON.stringify(ctx.draft);
  return false;
}

export function planTurn(text, ctx) {
  const t = String(text).trim().slice(0, 1500);
  const target = ctx.target || roomTarget;
  const item = target.type === 'item' ? ctx.state.items.find((a) => a.id === target.id) : null;
  const meta = planMeta(t, ctx, item);
  const unlisted = unlistedPlan(t);
  if (meta && !(unlisted && SUBJECT_ACTIONS.includes(meta.action))) return meta;
  if (unlisted) return unlisted;
  const scope = resolveScope(t, item || target.type === 'draft' ? target : roomTarget);
  const plan = noteUnlisted(scope === 'room' ? planRoom(t, ctx) : planFurniture(t, ctx, item), t);
  // 이름 하나만 말했는데 아무것도 바뀌지 않으면 목록에 없는 물건이다(“퀸”, “네이비”는 바뀌므로 그대로).
  const lone = loneName(t);
  return lone && (lone.sure || !changesSomething(plan, ctx, item))
    ? unlistedReply({ unlisted: [lone], place: null })
    : plan;
}

// 첫 화면과 빈 대화에서 보여줄 시작점.
export const STARTERS = [
  { label: '방 크기부터', detail: '가로·세로·천장 높이', action: 'tool', arg: 'room-size' },
  { label: '가구 고르기', detail: '20종 · 63가지 크기', action: 'tool', arg: 'catalog' },
  { label: '사진으로 시작', detail: '가구 사진에서 종류부터 잡기', action: 'photo' },
  { label: '벽과 바닥', detail: '마감 색 비교하기', action: 'tool', arg: 'finishes' },
  { label: '내 키로 가늠하기', detail: '같은 축척의 아바타 세우기', action: 'tool', arg: 'avatar' },
  { label: '집 전체로 잇기', detail: '화장실까지 2D·3D로', action: 'tool', arg: 'floorplan' },
];
export const EXAMPLE_PROMPTS = [
  '6평 원룸, 천장 2.4m',
  '두 명이 앉는 소파',
  '벽은 세이지, 바닥은 월넛',
  '내 키 175cm',
];
export const ROOM_TYPE_NAMES = Object.fromEntries(
  Object.entries(ROOM_TYPES).map(([k, v]) => [k, v.name]),
);
