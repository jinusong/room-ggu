// 상담 모델이 기본 해석기다. 모델이 고른 의도·동작·가구·공간 유형·크기 느낌·색·도구·답을
// 앱의 계획(planner.js와 같은 모양)으로 옮긴다. 앱은 다음만 검증하고, 바로잡으면 fixes에 남긴다.
// - 숫자 치수는 모델이 아니라 문장에서 직접 읽는다(사용자 값은 그대로 둔다).
// - 문장에 적힌 가구·공간 이름과 모델 선택이 어긋나면 문장을 따른다.
// - 사용자가 말하지 않은 속성(벽·바닥·가구 색·공간 유형 등)과 문장에 없는 동작은 실행하지 않는다.
// 모델 답을 쓸 수 없으면 store가 규칙 기반 planTurn으로 대신 처리한다.
import {
  TYPES,
  ROOM_TYPES,
  WALL_COLORS,
  FLOOR_COLORS,
  FURNITURE_COLORS,
  makeRoom,
} from '../catalog.js';
import { makeItem, layoutWarnings, clampItem, spaces } from '../data.js';
import { consult, applyModelResult, mentionedTypes } from '../estimator.js';
import { detectRoomType, parseRoomDimensions } from '../room-consult.js';
import {
  chooseSurface,
  surfaceKind,
  SURFACE_KINDS,
  MODEL_ACTIONS,
  MODEL_UI,
} from '../ui-schema.js';
import {
  metaPlan,
  surfacePlan,
  furnitureChips,
  planRoom,
  planTurn,
  resolveScope,
  parseFurnitureColor,
  ROOM_REFERENCE,
  ROOM_TALK,
} from './planner.js';
import { usableReply } from './model-turn.js';
import { dimsText, josa } from './text.js';

const WALL_WORDS = /벽|도배|벽지/;
const FLOOR_WORDS = /바닥|마루|장판|타일/;
const COLOR_TALK = /색|컬러|톤|[가-힣]+색|으로\s*(?:바꿔|해)/;
const MOOD_TALK = /느낌|분위기|톤/;
const PURPOSE =
  /책|공부|업무|작업|일하|잠|수면|자는|쉬|휴식|아이|어린이|아기|요리|조리|식사|밥|손님|가족|모여|영화|게임|운동|취미|음악|홈\s*카페|드레스룸|옷|(?:하는|할|위한|용)\s*(?:방|공간)|(?:방|공간)으로\s*(?:꾸미|꾸며|쓰|만들)/;
const ROOM_SIZE_TALK = /아담|작|좁|컴팩트|넓|넉넉|크|큰|여유|널찍|답답|혼자|가족/;
const LITERAL_ROOM_SIZE = /아담|작은|작게|좁은|컴팩트|넓은|넓게|넉넉|큰\s*방|크게/;
const NEW_ITEM = /하나\s*(?:더|놓|두|사|들|있)|추가|새로|또\s|도\s*(?:하나|놓|필요|두|사)/;

// 모델이 고른 동작은 문장에 그 동작을 뜻하는 말이 있을 때만 실행한다.
const ACTION_EVIDENCE = {
  place: /놓아|놓을|놓자|놓기|놔\s*줘|놔줘|배치해|배치하자|넣어\s*줘|둘게|두자|둬\s*줘/,
  undo: /되돌|취소|원래대로|undo/i,
  redo: /다시\s*(?:실행|적용|해)|redo/i,
  rotate: /회전|돌려|돌리|방향/,
  duplicate: /복제|하나\s*더|똑같|같은\s*(?:거|것)|복사/,
  delete: /삭제|지워|빼|없애|치워/,
  relocate: /겹치|겹친|빈\s*(?:곳|자리)|정리|자동\s*배치|옮겨/,
  clear: /비워|비우|빈\s*방|(?:다|모두|전부)\s*(?:치워|빼)/,
  example: /예시/,
  new_space: /추가|새\s*(?:방|공간)|새로|하나\s*더|만들/,
  switch_space: /이동|전환|열어|가자|넘어가|바꿔|보여/,
};
const ACTION_NAMES = {
  place: '놓기',
  undo: '되돌리기',
  redo: '다시 실행',
  rotate: '회전',
  duplicate: '복제',
  delete: '삭제',
  relocate: '자리 정리',
  clear: '가구 비우기',
  example: '예시 방',
  new_space: '새 공간',
  switch_space: '공간 이동',
};
const COMMAND_NAMES = {
  ...ACTION_NAMES,
  switch: '공간 이동',
  catalog: '가구 고르기',
  spaces: '공간 목록',
  items: '가구 목록',
  files: '저장·불러오기',
  help: '사용법',
  ai: '모델 설정',
};
const OPEN_TEXT = {
  catalog: '놓고 싶은 가구를 골라 주세요. 고르면 크기 초안부터 보여드릴게요.',
  spaces: '공간마다 크기와 가구를 따로 저장해요.',
  items: '이 방에 놓인 가구예요. 누르면 도면에서 선택돼요.',
  files: '배치는 파일로 저장하거나 불러올 수 있어요. 지금 보이는 화면은 이미지로 저장돼요.',
  help: '이렇게 쓰면 돼요.',
  ai: '이 기기에서 실행하는 모델이에요. 끄면 규칙으로 답해요.',
};

const colorOf = (list, name) => list.find(([n]) => n === name)?.[1] || null;
const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);

// 모델 JSON을 허용된 값만 남겨 읽는다. 형식이 틀리면 예외를 던져 규칙 경로로 넘긴다.
export function readModel(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) throw Error('모델 답에서 JSON을 찾지 못했어요.');
  const v = JSON.parse(m[0]);
  if (!v || typeof v !== 'object') throw Error('모델 답 형식이 맞지 않아요.');
  return {
    intent: pick(v.intent, ['furniture', 'room', 'action', 'chat'], 'chat'),
    action: pick(v.action, MODEL_ACTIONS, 'none'),
    furniture: Object.hasOwn(TYPES, v.furniture) ? v.furniture : null,
    roomType: Object.hasOwn(ROOM_TYPES, v.room_type) ? v.room_type : null,
    space: typeof v.space === 'string' && v.space !== 'none' ? v.space.slice(0, 40) : null,
    seats: [1, 2, 3, 4].includes(v.seats) ? v.seats : null,
    size: pick(v.size, ['compact', 'standard', 'large'], 'unknown'),
    depth: pick(v.depth, ['shallow', 'deep'], 'unknown'),
    height: pick(v.height, ['low', 'tall'], 'unknown'),
    color: colorOf(FURNITURE_COLORS, v.color),
    wall: colorOf(WALL_COLORS, v.wall),
    floor: colorOf(FLOOR_COLORS, v.floor),
    ui: Object.hasOwn(MODEL_UI, v.ui) ? MODEL_UI[v.ui] : null,
    reply: typeof v.reply === 'string' ? v.reply : '',
  };
}

// 문장 자체에 적힌 이름으로 방 이야기인지 가구 이야기인지 분명하면 그 값을, 아니면 null.
function literalScope(t, named) {
  const surfaceWords = WALL_WORDS.test(t) || FLOOR_WORDS.test(t) || /천장/.test(t);
  if (named.length && !surfaceWords) return 'furniture';
  if (!named.length && (detectRoomType(t) || ROOM_REFERENCE.test(t) || ROOM_TALK.test(t)))
    return 'room';
  return null;
}

function hasChanges(plan) {
  const c = plan.changes || {};
  return !!(plan.action || c.room || c.item || c.draft || c.addSpace);
}

export function planFromModel(raw, text, ctx) {
  const v = readModel(raw);
  const t = String(text).trim().slice(0, 1500);
  const fixes = [];
  const target = ctx.target || { type: 'room' };
  const item =
    target.type === 'item' ? ctx.state.items.find((a) => a.id === target.id) || null : null;
  const named = mentionedTypes(t);
  const literal = literalScope(t, named);
  const done = (plan) => ({ ...plan, decidedBy: 'model', fixes });

  // "되돌려줘", "공간 목록", "파일로 저장"처럼 문장에 명령이 분명한데 모델이 다른 일을 고르면 명령을 따른다.
  const rule = planTurn(t, ctx);
  if (rule.intent === 'meta') {
    const command = rule.action || rule.surfaces[0]?.kind;
    const modelCommand = v.action === 'switch_space' ? 'switch' : v.action;
    if (command && command !== modelCommand) {
      fixes.push(`문장의 명령(${COMMAND_NAMES[command] || command})을 따름`);
      return done(rule);
    }
  }

  if (v.action !== 'none') {
    const plan = actionPlan(v, t, ctx, item, named, fixes);
    if (plan) return done(plan);
  }
  // 동작을 실행하지 않았으면 문장이나 지금 대상(선택한 가구·초안)으로 이어서 해석한다.
  const subj = item || (target.type === 'draft' ? ctx.draft : null);
  let intent =
    v.intent === 'action' ? literal || resolveScope(t, subj ? target : { type: 'room' }) : v.intent;
  if (literal && intent && intent !== 'chat' && intent !== literal) {
    fixes.push(literal === 'room' ? '방 이야기로 처리' : '가구 이야기로 처리');
    intent = literal;
  }
  if (!intent || intent === 'chat') {
    if (literal) intent = literal;
    else {
      // 모델이 바꿀 것이 없다고 봤지만 규칙이 바꿀 내용을 찾으면 규칙으로 처리한다.
      if (hasChanges(planTurn(t, ctx))) return { fallback: 'model-chat' };
      return done({
        intent: 'chat',
        scope: null,
        reply:
          usableReply(v.reply, t) ||
          '방 크기나 놓고 싶은 가구를 말해 주세요. “거실 가로 5m 세로 4m”처럼 말하면 바로 반영해요.',
        surfaces: [],
        suggestions: [
          { label: '방 크기 정하기', action: 'tool', arg: 'room-size' },
          { label: '가구 고르기', action: 'catalog' },
        ],
      });
    }
  }
  return done(
    intent === 'room' ? roomPlan(v, t, ctx, fixes) : furniturePlan(v, t, ctx, item, named, fixes),
  );
}

function actionPlan(v, t, ctx, item, named, fixes) {
  const a = v.action;
  if (Object.hasOwn(OPEN_TEXT, a)) {
    // 가구 이름을 말했으면 목록보다 그 가구 초안이 먼저다.
    if (a === 'catalog' && named.length) return null;
    return surfacePlan(a, usableReply(v.reply, t) || OPEN_TEXT[a]);
  }
  if (a === 'switch_space') {
    const hit = spaces(ctx.state).find((r) => r.roomId !== ctx.state.roomId && r.name === v.space);
    if (!hit || !(t.includes(hit.name) || ACTION_EVIDENCE.switch_space.test(t))) {
      fixes.push('공간 이동은 문장에 공간 이름이 있을 때만 실행');
      return null;
    }
    return metaPlan('switch', '', { arg: { id: hit.roomId } });
  }
  if (!ACTION_EVIDENCE[a]?.test(t)) {
    fixes.push(`문장에 없는 동작(${ACTION_NAMES[a] || a})은 실행하지 않음`);
    return null;
  }
  if (['rotate', 'duplicate', 'delete'].includes(a)) {
    if (!item)
      return {
        intent: 'meta',
        scope: null,
        reply: '먼저 방에서 가구를 눌러 선택해 주세요. 선택한 가구에 바로 적용할게요.',
        surfaces: [{ kind: 'items', target: { type: 'room' } }],
        suggestions: [],
      };
    if (a === 'rotate') {
      const m = t.match(/(-?\d{1,3})\s*도/);
      return metaPlan('rotate', '', { arg: { deg: m ? +m[1] : 90 } });
    }
    return metaPlan(a, '');
  }
  if (a === 'new_space') {
    const literal = detectRoomType(t);
    if (literal && v.roomType && v.roomType !== literal)
      fixes.push(`공간 유형은 문장에 적힌 ${ROOM_TYPES[literal].name}`);
    const type = literal || v.roomType;
    if (!type) return null;
    return newSpacePlan(type, t, v);
  }
  return metaPlan(
    a,
    a === 'undo'
      ? '방금 바꾼 내용을 되돌렸어요.'
      : a === 'redo'
        ? '되돌린 내용을 다시 적용했어요.'
        : '',
  );
}

function newSpacePlan(type, t, v) {
  const room = makeRoom(type);
  for (const [k, n] of Object.entries(parseRoomDimensions(t))) {
    room[k] = n;
    room.sources[k] = '사용자 설정 · 대화';
  }
  return {
    intent: 'room',
    scope: 'room',
    reply:
      usableReply(v.reply, t) ||
      `${ROOM_TYPES[type].name}을 새 공간으로 만들었어요. 가로·세로를 알려주면 바로 맞출게요.`,
    changes: { addSpace: type, room },
    surfaces: [{ kind: 'room-size', target: { type: 'room' } }],
    suggestions: [
      { label: '크기 알려주기', text: '가로 4m 세로 3m' },
      { label: '가구 고르기', action: 'catalog' },
    ],
  };
}

const keep = (source) => /^(사용자|대화 추정)/.test(String(source));

function roomPlan(v, t, ctx, fixes) {
  // 숫자·면적·문장에 적힌 유형과 마감은 먼저 문장에서 읽는다.
  const base = planRoom(t, ctx);
  if (base.error || base.changes?.addSpace) return base;
  const before = ctx.state.room;
  const room = structuredClone(base.changes?.room || before);
  const literalType = detectRoomType(t);
  if (v.roomType && v.roomType !== room.type) {
    if (literalType) fixes.push(`공간 유형은 문장에 적힌 ${ROOM_TYPES[literalType].name} 유지`);
    else if (!PURPOSE.test(t)) fixes.push('말하지 않은 공간 유형 변경은 막음');
    else {
      room.type = v.roomType;
      const d = makeRoom(v.roomType);
      for (const k of ['w', 'd', 'h'])
        if (!keep(room.sources[k])) {
          room[k] = d[k];
          room.sources[k] = '공간 유형 기본값';
        }
    }
  }
  if (v.size !== 'unknown' && !LITERAL_ROOM_SIZE.test(t) && ROOM_SIZE_TALK.test(t)) {
    const sizes = ROOM_TYPES[room.type].sizes[['compact', 'standard', 'large'].indexOf(v.size)];
    for (const [i, k] of ['w', 'd', 'h'].entries())
      if (!keep(room.sources[k])) {
        room[k] = sizes[i];
        room.sources[k] = 'AI 단서 · 공간 크기';
      }
  }
  const literalWall = !!base.changes?.room && base.changes.room.wallColor !== before.wallColor;
  if (v.wall && v.wall !== room.wallColor) {
    if (!WALL_WORDS.test(t)) fixes.push('말하지 않은 벽 색 변경은 막음');
    else if (literalWall) fixes.push('벽 색은 문장에 적힌 색 유지');
    else room.wallColor = v.wall;
  }
  const literalFloor = !!base.changes?.room && base.changes.room.floorColor !== before.floorColor;
  if (v.floor && v.floor !== room.floorColor) {
    if (!FLOOR_WORDS.test(t)) fixes.push('말하지 않은 바닥 색 변경은 막음');
    else if (literalFloor) fixes.push('바닥 색은 문장에 적힌 색 유지');
    else room.floorColor = v.floor;
  }
  const changed = JSON.stringify(room) !== JSON.stringify(before);

  const ruleKind = surfaceKind('room', chooseSurface(t, 'room'));
  let kind = v.ui && SURFACE_KINDS[v.ui].scope === 'room' ? v.ui : null;
  if (!kind) kind = base.surfaces[0]?.kind || ruleKind;
  else if (ruleKind !== 'room-type' && kind !== ruleKind) {
    fixes.push(`도구는 요청 단어에 맞춰 ${SURFACE_KINDS[ruleKind].title}`);
    kind = ruleKind;
  }
  const surfaces = [{ kind, target: { type: 'room' } }];
  const items = ctx.state.items.map((a) => {
    const c = { ...a };
    clampItem(c, room);
    return c;
  });
  if (layoutWarnings({ ...ctx.state, room, items }).all.size > layoutWarnings(ctx.state).all.size)
    surfaces.push({ kind: 'impact', target: { type: 'room' } });

  // 모델 답을 쓸 수 없으면 실제로 바뀐 것만 말한다.
  const sizeChanged = ['type', 'w', 'd', 'h'].some((k) => room[k] !== before[k]);
  const name = (list, hex) => list.find(([, h]) => h === hex)?.[0] || '고른 색';
  const finish = [
    room.wallColor !== before.wallColor && `벽은 ${name(WALL_COLORS, room.wallColor)}`,
    room.floorColor !== before.floorColor && `바닥은 ${name(FLOOR_COLORS, room.floorColor)}`,
  ].filter(Boolean);
  const fallbackReply = !changed
    ? base.reply
    : [
        sizeChanged &&
          `${ROOM_TYPES[room.type].name}을 가로 ${room.w}m, 세로 ${room.d}m, 천장 ${room.h}m로 반영했어요.`,
        finish.length && `${josa(finish.join(', '), '으로/로')} 바꿨어요.`,
      ]
        .filter(Boolean)
        .join(' ');
  const areaNote = /면적만으로[^.]*\./.exec(base.reply)?.[0];
  return {
    intent: 'room',
    scope: 'room',
    reply: (!fixes.length && usableReply(v.reply, t)) || fallbackReply,
    note: areaNote && !fixes.length ? areaNote : undefined,
    changes: changed ? { room } : {},
    surfaces,
    suggestions: base.suggestions,
  };
}

function furniturePlan(v, t, ctx, item, named, fixes) {
  const draft = ctx.draft;
  const subj = item || (ctx.target?.type === 'draft' ? draft : null);
  let type = v.furniture;
  if (named.length) {
    if (type && !named.includes(type)) {
      fixes.push(`가구 종류는 문장에 적힌 ${TYPES[named[0]].name}`);
      type = named[0];
    } else if (!type) type = named[0];
  } else if (subj && type && type !== subj.type && !NEW_ITEM.test(t)) {
    fixes.push(`가구 종류는 지금 대상인 ${TYPES[subj.type].name} 유지`);
    type = subj.type;
  }
  type ||= subj?.type || null;
  if (!type)
    return {
      intent: 'furniture',
      scope: null,
      reply:
        usableReply(v.reply, t) ||
        '어떤 가구인지 알려주세요. 이름을 말하거나 아래에서 고르면 크기 초안부터 잡아드려요.',
      surfaces: [{ kind: 'catalog', target: { type: 'room' } }],
      suggestions: [
        { label: '2인 소파', text: '두 명이 앉는 소파' },
        { label: '책상', text: '기본 책상 하나' },
      ],
    };
  let base, mode;
  const fresh = NEW_ITEM.test(t) && !!item && type === item.type;
  if (item && type === item.type && !fresh) [base, mode] = [item, 'item'];
  else if (draft && type === draft.type) [base, mode] = [draft, 'draft'];
  else [base, mode] = [makeItem(type), 'new'];

  // 숫자와 "10cm 늘려" 같은 직접 요청은 문장에서 읽고, 크기 느낌은 모델 단서를 먼저 쓴다.
  const rule = consult(t, structuredClone(base), '', { keepType: true });
  let hinted = null;
  try {
    hinted = applyModelResult(
      JSON.stringify({
        seats: v.seats,
        size: v.size,
        depth_profile: v.depth,
        height_profile: v.height,
        reply: '-',
      }),
      structuredClone(base),
      { text: t },
    ).item;
  } catch {
    hinted = null;
  }
  const next = structuredClone(rule.item);
  for (let i = 0; i < 3; i++) {
    if (String(rule.item.sources[i]).startsWith('사용자')) continue;
    if (hinted && (hinted.dims[i] !== base.dims[i] || hinted.sources[i] !== base.sources[i])) {
      next.dims[i] = hinted.dims[i];
      next.sources[i] = hinted.sources[i];
    }
  }

  const literalColor = parseFurnitureColor(t);
  const colorTalk = COLOR_TALK.test(t) || (mode === 'new' && MOOD_TALK.test(t));
  if (v.color && v.color !== base.color) {
    if (!literalColor && !colorTalk) fixes.push('말하지 않은 가구 색 변경은 막음');
    else if (literalColor && literalColor !== v.color) {
      fixes.push('가구 색은 문장에 적힌 색');
      next.color = literalColor;
    } else next.color = v.color;
  } else if (literalColor && (COLOR_TALK.test(t) || mode === 'new')) next.color = literalColor;

  const ruleKind = surfaceKind('furniture', chooseSurface(t, 'furniture'));
  let kind = v.ui && SURFACE_KINDS[v.ui].scope === 'furniture' ? v.ui : null;
  if (!kind) kind = next.color !== base.color ? 'furniture-color' : ruleKind;
  else if (ruleKind !== 'furniture-size' && kind !== ruleKind) {
    fixes.push(`도구는 요청 단어에 맞춰 ${SURFACE_KINDS[ruleKind].title}`);
    kind = ruleKind;
  }
  const target = mode === 'item' ? { type: 'item', id: item.id } : { type: 'draft' };
  const surfaces = [{ kind, target }];
  if (mode === 'item') {
    const items = ctx.state.items.map((a) => (a.id === item.id ? { ...next } : a));
    if (layoutWarnings({ ...ctx.state, items }).all.size > layoutWarnings(ctx.state).all.size)
      surfaces.push({ kind: 'impact', target: { type: 'room' } });
  }
  const what = mode === 'item' ? `${TYPES[type].name} 크기는` : `${TYPES[type].name} 초안은`;
  const fallbackReply = `${what} ${dimsText(next.dims)}cm예요. ${mode === 'new' ? '방에 놓기 전에 아래에서 규격을 비교해 보세요.' : '아래 도구에서 더 조절할 수 있어요.'}`;
  return {
    intent: 'furniture',
    scope: 'furniture',
    mode,
    target,
    reply: (!fixes.length && usableReply(v.reply, t)) || fallbackReply,
    changes: mode === 'item' ? { item: { id: item.id, next } } : { draft: next },
    surfaces,
    suggestions: furnitureChips(next, mode),
  };
}
