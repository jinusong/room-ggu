// 규칙 기반 대화 계획기. 상담 모델을 쓸 수 없을 때(준비 중·꺼짐·미지원·실패) 쓰는 대체 경로다.
// 사용자 문장 하나를 읽고 "무엇을 바꿀지, 어떤 도구를 보여줄지"를 정한다.
// 상태를 직접 바꾸지 않는다. 적용과 실행 취소 기록은 store가 맡는다.
import {
  TYPES,
  ROOM_TYPES,
  FURNITURE_COLORS,
  WALL_COLORS,
  FLOOR_COLORS,
  retypeRoom,
} from '../catalog.js';
import { josa, dimsText } from './text.js';
import { makeItem, layoutWarnings, clampItem, spaces } from '../data.js';
import {
  consult,
  detectType,
  extractDimensions,
  furnitureMentions,
  furnitureSubjects,
  unlistedInfo,
} from '../estimator.js';
import {
  consultRoom,
  consultationScope,
  mentionsRoom,
  roomMentions,
  assertedType,
  wantsNewSpace,
  roomLabel,
  unsupportedSpace,
  deniesNewSpace,
} from '../room-consult.js';
import { sizeFields } from '../dimensions.js';
import { roomNameSpan } from './consult-context.js';
import { chooseSurface, surfaceKind } from '../ui-schema.js';

// 규칙이 기본값으로 물러난 경우(방: 유형, 가구: 규격)가 아니면 요청 단어로 도구를 확신한 것이다.
const confidentPick = (scope, pick) => pick !== (scope === 'room' ? 'types' : 'sizes');

import { purposeRequest, recommendedTypes, requestsRoomFurniture } from './purpose.js';
import { roomEssentials } from './design.js';

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
    if (mentionsRoom(text) || ROOM_REFERENCE.test(text)) {
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

// 이름으로 고치라고 한 가구가 하나뿐이면 도면에서 먼저 고르지 않아도 그 가구를 다룬다.
export function editSubject(text, ctx) {
  if (ctx.target?.type === 'draft' || /새로|추가|하나\s*더|놓고|놓아|배치|만들/.test(text))
    return null;
  if (!/바꿔|바꾸|줄여|늘려|넓혀|좁혀|가로|세로|높이|너비|폭|깊이|색/.test(text)) return null;
  const names = furnitureMentions(text).filter((m) => !m.ref);
  if (names.length !== 1 || /벽|바닥|천장/.test(text)) return null;
  const hits = ctx.state.items.filter((i) => i.type === names[0].type);
  if (ctx.target?.type === 'item' && hits.some((i) => i.id === ctx.target.id)) return null;
  if (hits.length === 1) return { item: hits[0] };
  if (hits.length > 1)
    return {
      plan: {
        intent: 'furniture',
        ask: 'item',
        scope: null,
        reply: `${josa(TYPES[names[0].type].name, '이/가')} ${hits.length}개 있어요. 고칠 가구를 도면이나 목록에서 먼저 골라 주세요.`,
        changes: {},
        surfaces: [surface('items')],
        suggestions: [],
      },
    };
  return null;
}

export function matchSpace(text, state) {
  if (!/(?:이동|전환|열어|보여|가자|넘어가|바꿔)/.test(text)) return null;
  if (furnitureMentions(text).some((m) => !m.ref) || /가로|세로|높이|깊이|너비|벽|바닥/.test(text))
    return null;
  return (
    spaces(state)
      .filter((r) => r.roomId !== state.roomId)
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => roomNameSpan(text, r.name)) || null
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

// 방 이름은 가구를 놓을 장소다. 이미 있는 가구는 다시 놓지 않는다.
function furnishRoomPlan(t, { state, draft }) {
  if (!requestsRoomFurniture(t) || (draft && !mentionsRoom(t) && !/기본|세트|세팅|채워/.test(t)))
    return null;
  const rooms = spaces(state);
  const mentions = roomMentions(t);
  if (mentions.some((m) => m.role !== 'new'))
    return surfacePlan('spaces', '가구를 놓을 방의 이름을 알려 주세요.');
  const types = [...new Set(mentions.map((m) => m.type))];
  const named = rooms.filter((r) => roomNameSpan(t, r.name));
  if (types.length > 1 || named.length > 1)
    return surfacePlan('spaces', '어느 방에 먼저 가구를 놓을까요? 방 이름을 하나 알려 주세요.');
  let room = named[0] || state;
  if (!named.length && types.length && types[0] !== state.room.type) {
    const hits = rooms.filter((r) => r.room.type === types[0]);
    if (hits.length !== 1)
      return surfacePlan(
        'spaces',
        hits.length
          ? '같은 유형의 방이 여럿이에요. 가구를 놓을 방 이름을 알려 주세요.'
          : `${josa(ROOM_TYPES[types[0]].name, '이/가')} 아직 없어요. 공간을 먼저 추가해 주세요.`,
      );
    room = hits[0];
  }
  const essentials = roomEssentials(room.room.type, room.name);
  const typesToAdd = (essentials.length ? essentials : ['bed', 'desk', 'chair']).filter(
    (type) => !room.items.some((i) => i.type === type),
  );
  if (!typesToAdd.length) return metaPlan(null, `${room.name}에는 기본 가구가 모두 있어요.`);
  return metaPlan('furnish-room', '', { arg: { roomId: room.roomId, types: typesToAdd } });
}

function planMeta(t, ctx, item) {
  const { state, draft } = ctx;
  const numbers = Object.keys(extractDimensions(t)).length > 0;
  const type = detectType(t);
  if (/^(?:방금\s*(?:거|것|건)?\s*)?(?:되돌려|되돌리기|실행\s*취소|취소해)/.test(t))
    return metaPlan('undo', '방금 바꾼 내용을 되돌렸어요.');
  if (/^다시\s*실행/.test(t)) return metaPlan('redo', '되돌린 내용을 다시 적용했어요.');
  if (/창문|창호/.test(t))
    return surfacePlan('windows', '벽을 고른 뒤 창 크기와 위치를 입력해 주세요.');
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
    !mentionsRoom(t)
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
  // 방을 통째로 돌리기: "방을 돌려줘", "화장실 돌려줘". 가구 이름을 말했거나, 가구를 골라 둔 채
  // "돌려줘"라고만 하면 가구를 돌린다.
  if (
    /돌려|돌리|회전/.test(t) &&
    !type &&
    (/(?:방(?!향)|공간|룸)[^.!?]{0,14}(?:돌려|돌리|회전)/.test(t) || mentionsRoom(t))
  ) {
    const named = spaces(state).find((r) => r.name.length >= 2 && t.includes(r.name)),
      kind = roomMentions(t)[0]?.type,
      hit =
        named ||
        (kind && state.room.type !== kind && spaces(state).find((r) => r.room.type === kind));
    return metaPlan('rotate-space', '', { arg: { id: hit ? hit.roomId : state.roomId } });
  }
  if (
    /겹치지\s*않게|겹친\s*(?:거|것|가구|방|공간)|겹치잖|겹쳐\s*(?:있|요|서|버|[.!?~]|$)|겹쳤|겹침|빈\s*(?:곳|자리)으로|자동\s*(?:정리|배치)/.test(
      t,
    )
  )
    return metaPlan('relocate', '');
  if (
    /빈\s*방(?:으로|에서)|가구\s*(?:를\s*)?(?:다|모두|전부)\s*(?:치워|비워|빼)|(?:방|가구|배치)[^.!?]{0,6}(?:초기화|리셋)|^(?:초기화|리셋)/.test(
      t,
    )
  )
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
  // 초안이 여럿 기다릴 때 "둘 다 놓아줘", "모두 놓자"는 한꺼번에 놓는다.
  if (
    draft &&
    ctx.queue?.length &&
    !type &&
    /(?:모두|전부|둘\s*다|셋\s*다|다)\s*(?:놓|놔|배치|넣)/.test(t)
  )
    return metaPlan('place-all', '');
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
  const typeChips = (skip, phrase) =>
    ['living', 'bedroom', 'office', 'kitchen', 'bathroom', 'studio']
      .filter((k) => !skip.includes(k))
      .slice(0, 4)
      .map((k) => say(ROOM_TYPES[k].name, phrase(ROOM_TYPES[k].name)));
  if (r.askType) {
    const near = refSpace(t, state),
      where = near?.name ? `${near.name} 옆에 ` : '';
    return {
      intent: 'room',
      scope: 'room',
      ask: 'space-type',
      spaceRequest: t,
      reply: `${where}어떤 공간을 추가할까요? “거실”처럼 방 종류를 알려 주세요.`,
      changes: {},
      surfaces: [],
      suggestions: typeChips([], (name) => name),
    };
  }
  if (r.same)
    return {
      intent: 'room',
      scope: 'room',
      settled: true,
      reply: `이 공간은 이미 ${josa(ROOM_TYPES[r.same].name, '이에요/예요')}. 크기나 가구를 정해 볼까요?`,
      changes: {},
      surfaces: [surface('room-size')],
      suggestions: [say('크기 알려주기', '가로 4m 세로 3m'), act('가구 고르기', 'catalog')],
    };
  if (r.changed && !r.add && COMPLAINT.test(t)) r.reply = `제가 잘못 읽었어요. ${r.reply}`;
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
  // 면적만 말했으면 다음에 정할 것(한쪽 벽 길이, 정사각형)을 한 번에 고르게 한다.
  if (r.area?.assumed && !r.area.square) {
    // 지금 잡은 가로와 가까운 50cm 단위. 이미 그 값이면 한 칸 더 넓은 쪽을 권한다.
    let side = Math.round(r.room.w * 2) / 2;
    if (Math.abs(side - r.room.w) < 0.01) side += 0.5;
    side = Math.max(1, Math.min(15, side));
    suggestions.push(
      say(`가로 ${side}m로`, `${r.area.text}, 가로 ${side}m`),
      say('정사각형에 가깝게', `${r.area.text} 정사각형`),
    );
  }
  const userSet = ['w', 'd'].every((k) => r.room.sources[k].startsWith('사용자'));
  if (!userSet && kind !== 'room-size') suggestions.push(say('크기 알려주기', '가로 4m 세로 3m'));
  if (kind !== 'finishes') suggestions.push(say('벽과 바닥 색', '벽과 바닥 색을 바꾸고 싶어'));
  suggestions.push(act('가구 고르기', 'catalog'));
  return {
    intent: 'room',
    scope: 'room',
    confident: confidentPick('room', picked),
    reply: r.reply,
    area: r.area,
    changed: r.changed || r.add,
    changes: r.add
      ? {
          addSpace: r.room.type,
          room: r.room,
          near: refSpace(t, state),
          label: roomLabel(t, r.room.type),
        }
      : r.changed
        ? { room: r.room }
        : {},
    surfaces,
    suggestions,
  };
}

// 따지거나 고쳐 달라는 말투. 이런 문장은 명령으로 읽기 전에 무엇이 틀렸다는 뜻인지부터 본다.
export const COMPLAINT = /왜|아니\s|아니[,.]|라니까|잖아|했잖|냐고|하냐|!!|ㅡㅡ|;;|틀렸|잘못/;

// "화장실 옆에", "이 방 오른쪽에"처럼 새 공간을 붙일 기준 공간과 벽. 말하지 않았으면 null.
export function refSpace(text, state) {
  const list = spaces(state),
    ref = roomMentions(text).find((m) => m.role === 'ref');
  if (!ref) {
    const here = text.match(
      /(?:이\s*방|여기|지금\s*방)\s*(?:바로\s*)?(오른쪽|왼쪽|위쪽|뒤쪽|아래쪽|앞쪽|옆|뒤|앞)/,
    );
    if (!here) return null;
    const side = { 오른쪽: 'right', 왼쪽: 'left', 위쪽: 'back', 뒤쪽: 'back', 뒤: 'back' }[here[1]];
    return {
      roomId: state.roomId,
      name: state.name,
      side: side || (/아래쪽|앞쪽|앞/.test(here[1]) ? 'front' : null),
    };
  }
  const same = list.filter((r) => r.room.type === ref.type),
    hit =
      same.find((r) => r.name.length >= 2 && text.includes(r.name)) ||
      same.find((r) => r.roomId === state.roomId) ||
      same[0];
  // 그런 공간이 없으면 지금 방에 붙이고, 없었다는 것을 답에서 알린다.
  return hit
    ? { roomId: hit.roomId, name: hit.name, side: ref.side }
    : {
        roomId: state.roomId,
        name: state.name,
        side: ref.side,
        missing: ROOM_TYPES[ref.type].name,
      };
}

// 아니라고 한 유형만 있고 바라는 유형은 말하지 않은 문장("왜 화장실로 만들어?", "화장실 아니야").
// 앞에서 말한 유형이 있으면 그 유형으로 바로잡고, 없으면 어떤 공간인지 묻는다.
export function repairPlan(t, ctx) {
  const mentions = roomMentions(t),
    denied = mentions.filter((m) => m.role === 'neg').map((m) => m.type);
  if (!denied.length || assertedType(mentions)) return null;
  const { state } = ctx,
    now = state.room.type;
  let want = null;
  for (const said of [...(ctx.said || [])].reverse()) {
    want = assertedType(roomMentions(said).filter((m) => !denied.includes(m.type)));
    if (want) break;
  }
  if (want && want !== now && denied.includes(now)) {
    const room = retypeRoom(state.room, want);
    return {
      intent: 'room',
      scope: 'room',
      repaired: true,
      reply: `제가 잘못 읽었어요. 앞에서 말한 대로 이 공간을 ${josa(ROOM_TYPES[want].name, '으로/로')} 바꿨어요. 가로 ${room.w}m, 세로 ${room.d}m 기본 크기예요.`,
      changes: { room },
      surfaces: [surface('room-size')],
      suggestions: [
        say('크기 알려주기', '가로 4m 세로 3m'),
        act('가구 고르기', 'catalog'),
        say('되돌리기', '되돌려줘'),
      ],
    };
  }
  const name = ROOM_TYPES[denied[0]].name;
  return {
    intent: 'room',
    scope: 'room',
    repaired: true,
    // 지금 방이 그 유형이 아니면(이미 바로잡혔으면) 지금 무엇인지부터 알린다.
    reply: denied.includes(now)
      ? `${josa(name, '이/가')} 아니라면 어떤 공간으로 바꿀까요? 아래에서 고르거나 “거실로 바꿔줘”처럼 말해 주세요.`
      : `이 공간은 지금 ${josa(name, '이/가')} 아니라 ${josa(ROOM_TYPES[now].name, '이에요/예요')}. 다른 공간으로 바꾸려면 아래에서 골라 주세요.`,
    changes: {},
    surfaces: [surface('room-type')],
    suggestions: ['living', 'bedroom', 'office', 'kitchen', 'bathroom', 'studio']
      .filter((k) => !denied.includes(k) && k !== now)
      .slice(0, 4)
      .map((k) => say(ROOM_TYPES[k].name, `${josa(ROOM_TYPES[k].name, '으로/로')} 바꿔줘`)),
  };
}

// ---------- 한 문장의 여러 요청 ----------
const ROOM_FACT = /\d\s*평|평수|m²|제곱미터/;
const COUNT =
  /([0-9]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?:개|점)(?=만|를|가|씩|[^가-힣]|$)/;
const KO_COUNTS = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
const COORDINATOR = /^\s*(?:이랑|랑|하고|과|와|및|그리고|\+|&|\/)\s*/;
// 문장을 방 이야기와 가구 이야기로 나누고, 가구가 여럿이면 하나씩 떼어 낸다.
// 방과 가구가 서로 다른 마디에 있거나 가구가 둘 이상일 때만 값을 돌려준다. 아니면 null(보통 경로).
export function splitRequest(text) {
  const clauses = String(text)
    .replace(/((?:바꾸|바꿔\s?주|만들|추가하|넓히|줄이|늘리|정하|잡|해\s?주)고)\s+/g, '$1\n')
    .split(/\.(?!\d)|[!?\n]+|,\s*|\s+그리고(?:\s+|$)/)
    .map((c) => c.trim())
    .filter(Boolean);
  const kinds = clauses.map((c) =>
    furnitureMentions(c).some((m) => !m.ref)
      ? 'F'
      : mentionsRoom(c) || ROOM_FACT.test(c) || ROOM_REFERENCE.test(c)
        ? 'R'
        : 'U',
  );
  // 어느 쪽인지 알 수 없는 마디는 앞 마디(첫 마디면 뒤 마디)를 따른다.
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === 'U' && i > 0) kinds[i] = kinds[i - 1];
  for (let i = kinds.length - 2; i >= 0; i--) if (kinds[i] === 'U') kinds[i] = kinds[i + 1];
  const pick = (k) => clauses.filter((_, i) => kinds[i] === k),
    roomText = pick('R').join('. '),
    parts = pick('F'),
    pieces = [];
  for (const part of parts) {
    const names = furnitureMentions(part).filter((m) => !m.ref);
    let from = 0;
    names.forEach((m, i) => {
      const next = names[i + 1],
        joined = next && COORDINATOR.exec(part.slice(m.end));
      // 이름 사이를 "랑", "하고"로 이었을 때만 따로 놓을 가구로 본다("책상 의자"는 하나로 둔다).
      if (next && !joined) return;
      pieces.push({ type: m.type, text: part.slice(from, next ? m.end : part.length).trim() });
      if (joined) from = m.end + joined[0].length;
    });
  }
  if (!pieces.length) return null;
  const counted = pieces.map((piece) => {
    const count = piece.text.match(COUNT);
    const n = count ? KO_COUNTS.indexOf(count[1]) + 1 || +count[1] : 1;
    return { ...piece, count: n };
  });
  const total = counted.reduce((n, piece) => n + piece.count, 0);
  if (total > 24 || counted.some((p) => p.count < 1)) return { limit: true };
  if (!roomText && total < 2) return null;
  return {
    roomText,
    pieces: counted.flatMap(({ count, ...piece }) => Array.from({ length: count }, () => piece)),
  };
}
const roomChanged = (plan) => !!(plan?.changes?.room || plan?.changes?.addSpace);
// 방 계획과 가구 초안들을 한 턴으로 합친다. drafts[0]이 방에 먼저 뜨고 나머지는 차례를 기다린다.
export function mergePlans(roomPlan, drafts, ctx) {
  const room = roomChanged(roomPlan) ? roomPlan : null,
    [first, ...queue] = drafts,
    names = drafts.map((d) => TYPES[d.type].name),
    lines = [];
  if (room?.changes.addSpace) {
    const r = room.changes.room;
    lines.push(
      `${josa(ROOM_TYPES[r.type].name, '을/를')} 가로 ${r.w}m, 세로 ${r.d}m로 새로 만들었어요.`,
    );
  } else if (room) {
    const r = room.changes.room,
      was = ctx.state.room,
      typed = r.type !== was.type,
      sized = r.w !== was.w || r.d !== was.d || r.h !== was.h;
    const how = room.area ? `${room.area.text}(${room.area.about})에 맞춰 ` : '';
    lines.push(
      typed || sized
        ? `${typed ? `${josa(ROOM_TYPES[r.type].name, '으로/로')} 바꾸고 ` : how ? '' : '방을 '}${how}가로 ${r.w}m, 세로 ${r.d}m로 잡았어요.`
        : '벽과 바닥을 바꿨어요.',
    );
  }
  lines.push(
    queue.length
      ? `${names.map((n, i) => (i < names.length - 1 ? josa(n, '과/와') : n)).join(' ')} 초안을 준비했어요. ${names[0]}부터 규격을 골라 보세요. 놓으면 다음 초안이 이어져요.`
      : `${names[0]} 초안은 ${dimsText(first.dims)}cm예요. 방에 놓기 전에 아래에서 규격을 비교해 보세요.`,
  );
  return {
    intent: 'compound',
    scope: room ? 'room' : 'furniture',
    mode: 'new',
    target: { type: 'draft' },
    confident: true,
    reply: lines.join(' '),
    changes: { ...(room ? room.changes : {}), draft: first, queue },
    surfaces: [
      surface('furniture-size', { type: 'draft' }),
      ...(room ? [surface('room-size')] : []),
    ],
    suggestions: queue.length
      ? [act('모두 놓기', 'place-all', { primary: true }), act(`${names[0]}만 놓기`, 'place')]
      : furnitureChips(first, 'new'),
  };
}
function draftFrom(piece) {
  const base = makeItem(piece.type),
    next = consult(piece.text, structuredClone(base), '', { keepType: true }).item,
    color = parseFurnitureColor(piece.text);
  if (color) next.color = color;
  return next;
}
function planCompound(req, ctx, item) {
  if (!req) return null;
  if (req.limit)
    return {
      intent: 'compound',
      batchLimit: true,
      error: true,
      reply: '한 번에 가구 24개까지 준비해요. 요청을 나눠 말해 주세요.',
      surfaces: [],
      suggestions: [],
    };
  const room = req.roomText ? planRoom(req.roomText, ctx) : null;
  if (room?.error) return room;
  // 가구가 하나뿐이고 방에서 바뀔 것도 없으면 보통 경로가 더 잘 처리한다(선택한 가구 고치기 등).
  if (!roomChanged(room) && req.pieces.length < 2) return null;
  if (req.pieces.length === 1 && item) return null;
  return mergePlans(room, req.pieces.map(draftFrom), ctx);
}

function planFurniture(t, ctx, item) {
  const { state, draft, caption = '' } = ctx;
  const type = furnitureSubjects(t)[0] || detectType(t);
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
  const res = consult(t, structuredClone(base), '', { keepType: true });
  const next = res.item,
    color = parseFurnitureColor(t);
  // “네이비”, “네이비로”처럼 색 이름만 말해도 색 이야기다.
  const bareColor = color && t.split(/\s+/).length <= 2;
  if (color && (bareColor || /색|컬러|톤|(?:으로|로)\s*(?:바꿔|바꾸|해)|[가-힣]+색/.test(t)))
    next.color = color;
  else if (color && mode === 'new') next.color = color;
  // 색만 바꿨으면 치수 이야기를 되풀이하지 않고 바뀐 색을 말한다.
  const colorName = FURNITURE_COLORS.find(([, hex]) => hex === next.color)?.[0],
    colorOnly =
      mode !== 'new' &&
      colorName &&
      next.color !== base.color &&
      next.dims.every((d, i) => d === base.dims[i]);
  // 고른 가구나 초안에서 바뀐 것이 없으면 바꾼 것처럼 말하지 않고 무엇을 바꿀지 묻는다.
  const same = mode !== 'new' && JSON.stringify(next) === JSON.stringify(base);
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
    reply: same
      ? `${josa(next.name || TYPES[next.type].name, '은/는')} 그대로예요. “가로 140cm”, “초록색으로”, “조금 더 작게”처럼 바꿀 치수나 색을 알려주세요.`
      : colorOnly
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
const nameList = (names) => names.slice(0, 3).join(', ');

// 놓기·빼기 같은 동사 바로 앞의 낱말을 목적어로 읽는다. 목록의 가구면 known, 아니면 무엇이든 unlisted다.
// "컴퓨터랑 책상"처럼 이어진 말은 함께 보고, "책상에"·"책상 위에"는 놓을 곳(place)으로 본다.
const OBJECT_VERB =
  /^(?:놓|놔|두고|둘|둬|두자|두면|두려|추가|넣|배치|만들|만들어|올려|올리|올릴|설치|깔아|깔고|붙여|생성|사고|살래|사자|사줘|사려|들이|들여|필요|있으면|있어|있나|있니|갖다|가져|걸어|걸고|달아|빼|지워|지우|삭제|없애|치워|돌려|돌리|회전|옮겨|옮기|복제)/;
// 목적어와 동사 사이에 오는 수량·꾸밈·자리 말은 건너뛴다.
const SKIP_WORD =
  /^(?:하나|하나만|한|두|세|네|몇|개|대|점|더|좀|또|새로|같이|다시|그냥|바로|꼭|\d+(?:\.\d+)?\s*(?:개|대|도|cm|mm|m|센치|미터)?)$|(?:게|히|으로|로|쪽|에|에서|에다|에다가)$/;
const PARTICLE = /(?:이랑|랑|하고|와|과|을|를|은|는|이|가|도|만)$/;
const AND_TAIL = /(?:이랑|랑|하고|와|과|,)$/;
const PLACE_TAIL = /에(?:다가?)?$/;
const PLACE_WORD = /^(?:위|옆|앞|아래|밑|안)/;
// 물건 이름이 아닌 말: 지시어, 방·집의 부분, "방하나"처럼 붙여 쓴 수량, 방향·크기 같은 속성, 따지거나 꾸미는 부사.
const NOT_THING =
  /^(?:(?:이|그|저)?(?:거|것|걸|건|게)|여기|거기|저기|이쪽|그쪽|가구|물건|초안|아바타|사람|(?:공간|방)(?:하나|한개|두개)?|집|벽|바닥|천장|문|창문|크기|색|자리|방향|위치|각도|반대|이름|높이|가로|세로|깊이|너비|폭|색깔|색상|사이즈|치수|배치|순서|간격|왜|자꾸|계속|또|진짜|정말|제발|이렇게|그렇게|저렇게|어떻게|빨리|일단|먼저|혹시|근데|그럼|이제|아니|다|모두|전부|나|내가|너|네가|니가|우리|뭐|뭘|무엇|어디|언제|누가|한번|아무것도)$/;

export function objectsOf(t) {
  const sentence = String(t).replace(/[.!?~…]/g, ' ');
  const tokens = [...sentence.matchAll(/\S+/g)];
  const words = tokens.map((token) => token[0]);
  // “컴퓨터 놓을 책상”에서 놓을은 뒤의 책상을 꾸민다. 이 동사로 컴퓨터 추가를 해석하지 않는다.
  const v = words.findIndex(
    (w, i) =>
      OBJECT_VERB.test(w) &&
      !(
        /(?:놓을|놓는|둘|두는|넣을|넣는|올릴|올리는|달|다는|설치할|설치하는)$/.test(w) &&
        words[i + 1] &&
        detectType(words[i + 1])
      ),
  );
  let i = v - 1;
  // “책상 위에”처럼 띄어 쓴 놓을 곳도 건너뛴다.
  while (
    i >= 0 &&
    (SKIP_WORD.test(words[i].replace(/만$/, '')) ||
      KO_COUNTS.includes(words[i]) ||
      COUNT.test(words[i]) ||
      PLACE_WORD.test(words[i + 1] || ''))
  )
    i--;
  if (i < 0) return null;
  const picked = [i];
  while (picked[0] > 0 && AND_TAIL.test(words[picked[0] - 1])) picked.unshift(picked[0] - 1);
  const known = [],
    unlisted = [];
  let mentions;
  for (const j of picked) {
    const raw = words[j].replace(/,$/, '');
    const w =
      NOT_THING.test(raw) || (!unlistedInfo(raw) && detectType(raw))
        ? raw
        : raw.replace(PARTICLE, '') || raw;
    const odd = unlistedInfo(w);
    let type = !odd && detectType(w);
    // “캣 타워”처럼 앞 단어와 합쳐 가구 이름이 된 경우 마지막 단어만으로 판단하지 않는다.
    if (!odd && !type && j > 0) {
      mentions ||= furnitureMentions(sentence);
      const start = tokens[j].index;
      type = mentions.find((m) => !m.ref && m.index < start && m.end > start)?.type;
    }
    if (odd) unlisted.push(odd);
    else if (type) known.push(type);
    else if (!NOT_THING.test(w) && !mentionsRoom(w) && /[가-힣a-z]/i.test(w))
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

// "이 방 지워줘", "침실 삭제해줘"처럼 공간을 지우자는 말. 바로 지우지 않고 확인 단추를 보여 준다.
const DELETE_VERB = /지워|지우|지울|삭제|없애|없앨|날려/;
export function deleteSpacePlan(t, state) {
  // "이 방 가구 다 지워줘"는 가구 비우기다.
  if (!DELETE_VERB.test(t) || /가구|물건/.test(t) || furnitureMentions(t).some((m) => !m.ref))
    return null;
  const list = spaces(state),
    named = list
      .filter((r) => roomNameSpan(t, r.name))
      .sort((a, b) => b.name.length - a.name.length)[0],
    current = /(?:이|지금|현재)\s*(?:방|공간)/.test(t)
      ? list.find((r) => r.roomId === state.roomId)
      : null,
    type = assertedType(roomMentions(t)),
    sameType = type ? list.filter((r) => r.room.type === type) : [];
  const say = (reply, suggestions = []) => ({
    intent: 'chat',
    ask: 'delete-space',
    reply,
    surfaces: [],
    suggestions,
  });
  if (!named && !current && !type)
    return /(?:방|공간)\s*(?:을|를|하나)?\s*(?:지워|지우|지울|삭제|없애|없앨|날려)/.test(t)
      ? say('어느 공간을 지울까요? 공간 목록에서 고르거나 “침실 지워줘”처럼 말해 주세요.', [
          act('공간 목록', 'tool', { arg: 'spaces' }),
        ])
      : null;
  if (list.length < 2)
    return say('마지막 공간은 지울 수 없어요. 새 공간을 먼저 만든 뒤에 지워 주세요.');
  const target = named || current || (sameType.length === 1 ? sameType[0] : null);
  if (!target)
    return say(
      sameType.length
        ? `${josa(ROOM_TYPES[type].name, '이/가')} ${sameType.length}개 있어요. 어느 공간을 지울지 공간 목록에서 골라 주세요.`
        : `${josa(ROOM_TYPES[type].name, '은/는')} 아직 없어요.`,
      [act('공간 목록', 'tool', { arg: 'spaces' })],
    );
  return say(
    `${josa(target.name, '을/를')} 지울까요?${target.items.length ? ` 가구 ${target.items.length}개도 함께 지워져요.` : ''} 지운 뒤에도 되돌리기로 살릴 수 있어요.`,
    [act(`${target.name} 지우기`, 'delete-space', { arg: target.roomId })],
  );
}

// 현관, 베란다처럼 아직 없는 공간 종류를 만들어 달라고 하면 가구가 아니라 공간 종류에 없다고 답한다.
function unsupportedSpacePlan(name) {
  const kinds = Object.values(ROOM_TYPES).map((r) => r.name);
  return {
    intent: 'chat',
    scope: null,
    unlisted: [name],
    reply: `${josa(name, '은/는')} 아직 만들 수 있는 공간 종류에 없어요. 지금은 ${josa(kinds.join(', '), '을/를')} 만들 수 있어요.`,
    surfaces: [],
    suggestions: ['living', 'bedroom', 'office', 'kitchen'].map((k) =>
      say(`${ROOM_TYPES[k].name} 추가`, `${ROOM_TYPES[k].name} 추가해줘`),
    ),
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
  const w =
    NOT_THING.test(raw) || (!unlistedInfo(raw) && detectType(raw))
      ? raw
      : raw.replace(PARTICLE, '') || raw;
  const odd = unlistedInfo(w);
  if (odd) return { ...odd, sure: true };
  if (
    detectType(w) ||
    CHAT_WORD.test(w) ||
    STYLE_WORD.test(w) ||
    SIZE_WORD.test(w) ||
    PREDICATE.test(raw) ||
    NOT_THING.test(w) ||
    mentionsRoom(w) ||
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

function consultationGuard(text, ctx, request, furniturePurpose) {
  if (ctx.guard) return ctx.guard;
  if (!request?.limit) {
    const scopes = request
      ? [[request.roomText, true], ...request.pieces.map((p) => [p.text, false])]
      : [[text, !furniturePurpose && resolveScope(text, ctx.target) === 'room']];
    for (const [clause, room] of scopes) {
      const { issue } = sizeFields(clause, room);
      if (issue)
        return {
          intent: 'chat',
          ask: 'constraint',
          surfaces: [],
          suggestions: [],
          reply:
            issue.kind === 'conflict'
              ? '같은 치수에 숫자가 두 개 있어요. 어느 값으로 맞출까요?'
              : issue.kind === 'unit'
                ? '가로와 깊이에 cm나 m 단위를 붙여 주세요.'
                : room
                  ? '방 치수는 1~15m 범위로 알려 주세요.'
                  : '가구 치수는 1~1500cm 범위로 알려 주세요.',
        };
    }
  }
  if (
    /옆|앞|뒤|맞은\s*편|근처/.test(text) &&
    /넓게|널찍|여유|비워|공간을\s*확보/.test(text) &&
    furnitureMentions(text).some((m) => m.ref) &&
    !furnitureMentions(text).some((m) => !m.ref)
  ) {
    return {
      intent: 'chat',
      ask: 'constraint',
      surfaces: [],
      suggestions: [],
      reply: '어느 쪽 통로를 넓힐까요? 옮길 가구와 방향을 알려 주세요.',
    };
  }
  return null;
}

export function moodQuestion(text) {
  if (!/아늑|포근|따뜻|차분|쾌적|분위기/.test(text)) return null;
  if (
    /벽|바닥|가구\s*색/.test(text) &&
    !/(?:하고|두고|[,.;])[^,.]*(?:아늑|포근|차분|쾌적)/.test(text)
  )
    return null;
  return '아늑한 느낌을 내려면 어디부터 바꿀까요? 벽 색, 조명, 가구 배치 중에 골라 주세요.';
}

export function purposeDraft(text, type) {
  const item = draftFrom({ text, type });
  return {
    intent: 'furniture',
    scope: 'furniture',
    mode: 'new',
    reply: `${josa(TYPES[type].name, '을/를')} 초안으로 준비했어요. 방에 놓기 전에 크기를 바꿀 수 있어요.`,
    changes: { draft: item },
    surfaces: [surface('furniture-size', { type: 'draft' })],
    suggestions: furnitureChips(item, 'new'),
  };
}

export function offerFurniture(text, types) {
  if (types.length === 1) return purposeDraft(text, types[0]);
  return {
    intent: 'furniture',
    ask: 'purpose',
    reply: '어느 쪽이 더 어울릴까요? 하나 고르면 방에서 크기를 볼 수 있어요.',
    recommendation: { types, text },
    surfaces: [surface('recommendations')],
    suggestions: [],
  };
}

export function planTurn(text, ctx, request = splitRequest(text), ranked = null) {
  const t = String(text).trim().slice(0, 1500);
  if (!ctx.guard && (mentionsRoom(t) || /방|공간/.test(t)) && deniesNewSpace(t))
    return {
      intent: 'chat',
      ask: 'no-add',
      reply: '새 공간을 추가하지 않았어요.',
      surfaces: [],
      suggestions: [],
    };
  const furnishing = !ctx.guard && furnishRoomPlan(t, ctx);
  if (furnishing) return furnishing;
  const purpose = purposeRequest(t);
  const guard = consultationGuard(t, ctx, request, !!purpose);
  if (guard) return guard;
  if (purpose) {
    const types = recommendedTypes(purpose, ranked);
    if (types.length && !purpose.matched.length && !purpose.evidence.length)
      return {
        intent: 'chat',
        ask: 'purpose',
        reply:
          '어디에 쓰고 싶으세요? 아래 용도가 맞으면 눌러 주세요. 다른 쓰임이라면 한마디 더 알려 주세요.',
        confirmation: { types, text: t, activity: ranked.activity },
        suggestions: [{ action: 'confirm-use', label: ranked.activity + ' 용도예요' }],
        surfaces: [],
      };
    if (types.length) return offerFurniture(t, types);
    return {
      intent: 'chat',
      ask: 'purpose',
      reply: '어디에 쓰고 싶으세요? “혼자 기대서 책을 읽고 싶어”처럼 말해 주세요.',
      surfaces: [surface('catalog')],
      suggestions: [],
    };
  }
  const target = ctx.target || roomTarget;
  let item = target.type === 'item' ? ctx.state.items.find((a) => a.id === target.id) : null;
  const mood = moodQuestion(t);
  if (mood && !detectType(t)) {
    const clear = /벽|바닥|천장|가로|세로|\d\s*평/.test(t) ? planRoom(t, ctx) : null;
    if (clear?.error) return clear;
    return clear?.changes?.room
      ? { ...clear, ask: 'mood', reply: `마감을 바꿨어요. ${mood}` }
      : { intent: 'chat', ask: 'mood', reply: mood, surfaces: [], suggestions: [] };
  }
  const removal = deleteSpacePlan(t, ctx.state);
  if (removal) return removal;
  const space = unsupportedSpace(t);
  if (space) return unsupportedSpacePlan(space);
  const meta = planMeta(t, ctx, item);
  // 목록에 없는 물건 찾기는 동사 앞 낱말을 물건으로 읽는다. 방을 만들거나 고쳐 달라는 말("방하나 추가하자",
  // "왜 화장실로 만들어")을 물건 이름으로 읽지 않도록, 방 이야기가 분명하면 건너뛴다.
  const roomTalk = wantsNewSpace(t) && (mentionsRoom(t) || /방|공간/.test(t));
  const unlisted = roomTalk ? null : unlistedPlan(t);
  if (meta && !(unlisted && SUBJECT_ACTIONS.includes(meta.action))) return meta;
  const repair = repairPlan(t, ctx);
  if (repair) return repair;
  if (unlisted) return unlisted;
  const compound = planCompound(request, ctx, item);
  if (compound) return compound;
  const edit = editSubject(t, ctx);
  if (edit?.plan) return edit.plan;
  if (edit?.item) item = edit.item;
  // 무엇을 가리키는지 없는 불만은 가구 이야기로 넘기지 않고 되묻는다.
  if (
    COMPLAINT.test(t) &&
    !mentionsRoom(t) &&
    !detectType(t) &&
    !ROOM_REFERENCE.test(t) &&
    !Object.keys(extractDimensions(t)).length
  )
    return {
      intent: 'chat',
      scope: null,
      vague: true,
      reply: '어디가 다르게 됐는지 알려 주세요. 방금 바꾼 내용은 되돌릴 수 있어요.',
      changes: {},
      surfaces: [],
      suggestions: [say('되돌리기', '되돌려줘')],
    };
  // 방을 추가하자는 말은 가구를 고르거나 초안을 띄워 둔 중에도 방 이야기다.
  const scope =
    roomTalk && !detectType(t)
      ? 'room'
      : resolveScope(t, item || target.type === 'draft' ? target : roomTarget);
  const plan = noteUnlisted(scope === 'room' ? planRoom(t, ctx) : planFurniture(t, ctx, item), t);
  // 이름 하나만 말했는데 아무것도 바뀌지 않으면 목록에 없는 물건이다(“퀸”, “네이비”는 바뀌므로 그대로).
  const lone = loneName(t);
  return lone && (lone.sure || !changesSomething(plan, ctx, item))
    ? unlistedReply({ unlisted: [lone], place: null })
    : plan;
}

// 첫 화면과 빈 대화에서 보여줄 시작점.
export const STARTERS = [
  { label: '방 크기부터', detail: '가로, 세로, 천장 높이', action: 'tool', arg: 'room-size' },
  {
    label: '가구 고르기',
    detail: `${Object.keys(TYPES).length}종, ${Object.values(TYPES).reduce((n, t) => n + t.presets.length, 0)}가지 크기`,
    action: 'tool',
    arg: 'catalog',
  },
  { label: '사진으로 시작', detail: '가구 사진에서 종류부터 잡기', action: 'photo' },
  { label: '벽과 바닥', detail: '마감 색 비교하기', action: 'tool', arg: 'finishes' },
  { label: '내 키로 가늠하기', detail: '같은 축척의 아바타 세우기', action: 'tool', arg: 'avatar' },
  { label: '집 전체로 잇기', detail: '화장실까지 2D와 3D로', action: 'tool', arg: 'floorplan' },
];
export const EXAMPLE_PROMPTS = [
  '100평 집 전체를 재팬디로 꾸며줘',
  '6평 원룸, 천장 2.4m',
  '혼자 기대서 책을 읽고 싶어',
  '벽은 세이지, 바닥은 월넛',
  '내 키 175cm',
];
export const ROOM_TYPE_NAMES = Object.fromEntries(
  Object.entries(ROOM_TYPES).map(([k, v]) => [k, v.name]),
);
