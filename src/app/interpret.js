// 상담 모델이 기본 해석기다. 모델이 고른 의도·동작·가구·공간 유형·크기 느낌·색·도구·답을
// 앱의 계획(planner.js와 같은 모양)으로 옮긴다. 앱은 다음만 검증하고, 바로잡으면 fixes에 남긴다.
// - 숫자 치수는 모델이 아니라 문장에서 직접 읽는다(사용자 값은 그대로 둔다).
// - 문장에 적힌 가구·공간 이름과 모델 선택이 어긋나면 문장을 따른다. 다만 "화장실 옆에"처럼 자리를
//   가리키거나 "화장실 말고"처럼 아니라고 한 이름은 고를 유형으로 치지 않는다(room-consult.js의 roomMentions).
// - 사용자가 말하지 않은 속성(벽·바닥·가구 색·공간 유형 등)과 문장에 없는 동작은 실행하지 않는다.
// - 모델이 쓴 답 문장은 앱이 바로잡은 것이 없고, 하지 않은 일을 했다고 말하지 않을 때만 보여 준다.
// - 한 문장에 방 이야기와 가구 이야기가 함께 있거나 가구가 여럿이면 마디로 나눠 각각 처리한다.
// 모델 답을 쓸 수 없으면 store가 규칙 기반 planTurn으로 대신 처리한다.
import {
  TYPES,
  ROOM_TYPES,
  WALL_COLORS,
  FLOOR_COLORS,
  FURNITURE_COLORS,
  makeRoom,
  retypeRoom,
} from '../catalog.js';
import { makeItem, layoutWarnings, clampItem, spaces } from '../data.js';
import { consult, applyModelResult, furnitureSubjects } from '../estimator.js';
import {
  mentionsRoom,
  roomMentions,
  assertedType,
  parseRoomDimensions,
  roomEvidence,
  roomLabel,
} from '../room-consult.js';
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
  splitRequest,
  mergePlans,
  refSpace,
  ROOM_REFERENCE,
  ROOM_TALK,
  COMPLAINT,
  noteUnlisted,
  actionSubject,
  editSubject,
} from './planner.js';
import { purposeRequest } from './purpose.js';
import { sizeFields } from '../dimensions.js';
import { roomNameSpan } from './consult-context.js';
import { usableReply } from './model-turn.js';
import { dimsText, josa } from './text.js';

const WALL_WORDS = /벽|도배|벽지/;
const FLOOR_WORDS = /바닥|마루|장판|타일/;
const COLOR_TALK = /색|컬러|톤|[가-힣]+색|(?:으로|로)\s*(?:바꿔|바꾸|해)/;
const MOOD_TALK = /느낌|분위기|톤/;
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
  clear: /비워|비우|빈\s*방|(?:다|모두|전부)\s*(?:치워|빼)|초기화|리셋/,
  example: /예시/,
  new_space: /추가|새\s*(?:방|공간)|새로|하나\s*더|만들|붙여|붙이/,
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
  'rotate-space': '방 돌리기',
  'place-all': '모두 놓기',
  catalog: '가구 고르기',
  spaces: '공간 목록',
  items: '가구 목록',
  files: '저장과 불러오기',
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

// 모델 답이 "했어요"라고 끝맺는 문장인지. 앱이 아무것도 바꾸지 않았는데 이런 답을 보여 주면 거짓말이 된다.
const CLAIMS_DONE =
  /(?:했|었|았|였|겼|꿨|웠|놨|렸|췄|뒀|됐)(?:어요|습니다|어|다)(?![가-힣])|(?:추가|변경|삭제|배치|적용|반영|완료|이동)(?:했|됐|되었)/;

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
function literalScope(t, named, target, intent) {
  const surfaceWords = WALL_WORDS.test(t) || FLOOR_WORDS.test(t) || /천장/.test(t);
  if (named.length && !surfaceWords) return 'furniture';
  if (!named.length && (mentionsRoom(t) || ROOM_REFERENCE.test(t) || ROOM_TALK.test(t)))
    return 'room';
  if (intent !== 'chat' && Object.keys(sizeFields(t).values).length) return resolveScope(t, target);
  return null;
}

function hasChanges(plan) {
  const c = plan.changes || {};
  return !!(plan.action || c.room || c.item || c.draft || c.addSpace);
}

export function planFromModel(raw, text, ctx) {
  const t = String(text).trim().slice(0, 1500);
  if (purposeRequest(t)) {
    const ranked = JSON.parse(raw);
    if (
      !ranked ||
      !['first', 'second', 'third'].every(
        (k) => ranked[k] === 'none' || Object.hasOwn(TYPES, ranked[k]),
      )
    )
      throw Error('가구 후보를 다시 확인해 주세요.');
    const plan = planTurn(t, ctx, undefined, ranked);
    const actual =
      plan.recommendation?.types ??
      plan.confirmation?.types ??
      (plan.changes?.draft ? [plan.changes.draft.type] : []);
    const proposed = [ranked.first, ranked.second, ranked.third].filter((k) => k !== 'none');
    return {
      ...plan,
      decidedBy: 'model',
      fixes: actual.join() !== proposed.join() ? ['카탈로그 용도와 대조해 선택지를 정리'] : [],
    };
  }
  const v = readModel(raw);
  const fixes = [];
  const target = ctx.target || { type: 'room' };
  let item =
    target.type === 'item' ? ctx.state.items.find((a) => a.id === target.id) || null : null;
  const named = furnitureSubjects(t);
  const literal = literalScope(t, named, target, v.intent);
  // 모델이 쓴 답(modelReply)은 바로잡은 것이 없고, 바꾼 것 없이 "했어요"라고 하지 않을 때만 쓴다.
  const done = ({ modelReply, ...plan }) => {
    const out = { ...plan, decidedBy: 'model', fixes };
    if (
      modelReply &&
      !fixes.length &&
      !plan.ask &&
      !plan.changes?.item &&
      !plan.changes?.room &&
      (hasChanges(out) || !CLAIMS_DONE.test(modelReply))
    ) {
      out.reply = modelReply;
      out.replyBy = 'model';
    }
    return noteUnlisted(out, t);
  };

  // "되돌려줘", "공간 목록", "파일로 저장"처럼 문장에 명령이 분명한데 모델이 다른 일을 고르면 명령을 따른다.
  const request = splitRequest(t);
  const rule = planTurn(t, ctx, request);
  if (rule.batchLimit || ['constraint', 'item', 'mood', 'delete-space'].includes(rule.ask)) {
    fixes.push(
      rule.ask === 'constraint'
        ? '모호하거나 충돌하는 치수와 배치는 확인 후 반영'
        : '선택이 필요한 부분을 되물음',
    );
    return done(rule);
  }
  const edit = editSubject(t, ctx);
  if (edit?.item) item = edit.item;
  if (rule.intent === 'meta') {
    const command = rule.action || rule.surfaces[0]?.kind;
    const modelCommand = v.action === 'switch_space' ? 'switch' : v.action;
    if (command === 'switch') {
      const room = spaces(ctx.state).find((r) => r.roomId === rule.arg?.id);
      if (command !== modelCommand || v.space !== room?.name) fixes.push('문장에 나온 방으로 이동');
      return done(rule);
    }
    if (command && command !== modelCommand) {
      fixes.push(`문장의 명령(${COMMAND_NAMES[command] || command})을 따름`);
      return done(rule);
    }
  }
  // "왜 화장실로 만들어?"처럼 아니라고만 한 문장은 앞 대화에서 바라던 유형을 찾아 바로잡거나 되묻는다.
  if (rule.repaired) {
    fixes.push('아니라고 한 유형은 고르지 않고 앞 대화를 따름');
    return done(rule);
  }
  // 무엇을 가리키는지 없는 불만("아니 그게 아니라")은 지금 대상인 가구나 초안 이야기로 받지 않고 되묻는다.
  // 모델도 되묻는 답을 썼으면 그 답을 쓴다.
  if (rule.vague)
    return done({
      ...rule,
      modelReply: v.intent === 'chat' && v.action === 'none' ? usableReply(v.reply, t) : null,
    });
  // 어떤 공간인지 말하지 않고 방을 추가하자고 했으면 만들지 않고 묻는다. 모델이 용도에서 유형을
  // 읽어 냈고 문장에 그 용도가 있으면("잠잘 방 하나 추가해줘") 모델을 따른다.
  if (rule.ask === 'space-type' && !(v.action === 'new_space' && roomEvidence(v.roomType, t))) {
    if (v.roomType) fixes.push('문장에 근거가 없는 공간 유형은 고르지 않고 되물음');
    return done(rule);
  }
  // 방 이야기와 가구 이야기가 섞였거나 가구가 여럿이면 나눠서 처리한다.
  if (request && !request.limit) {
    const plan = compoundPlan(v, request, ctx, item, fixes);
    if (plan) return done(plan);
  }

  // 목록에 없는 물건을 말했으면 모델이 비슷한 가구나 지금 대상을 골랐어도 만들거나 바꾸지 않는다.
  if (rule.unlisted) {
    if (v.furniture || v.action !== 'none')
      fixes.push(`목록에 없는 물건(${rule.unlisted.join(', ')})이라 가구를 만들지 않음`);
    return done(rule);
  }

  if (
    (Object.hasOwn(OPEN_TEXT, v.action) && rule.intent !== 'meta' && hasChanges(rule)) ||
    (v.action === 'new_space' && literal === 'furniture')
  ) {
    fixes.push('문장의 편집 요청을 기타 동작보다 우선');
    v.action = 'none';
  }
  if (
    v.action === 'place' &&
    named.length &&
    (!ctx.draft || !named.includes(ctx.draft.type) || rule.changes?.draft)
  ) {
    fixes.push('새 가구나 치수 요청은 초안을 먼저 준비');
    v.action = 'none';
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
      if (hasChanges(rule)) return { fallback: 'model-chat' };
      const upset = COMPLAINT.test(t);
      return done({
        intent: 'chat',
        scope: null,
        modelReply: usableReply(v.reply, t),
        reply: upset
          ? '어디가 다르게 됐는지 알려 주세요. 방금 바꾼 내용은 되돌릴 수 있어요.'
          : '방 크기나 놓고 싶은 가구를 말해 주세요. “거실 가로 5m 세로 4m”처럼 말하면 바로 반영해요.',
        surfaces: [],
        suggestions: upset
          ? [{ label: '되돌리기', text: '되돌려줘' }]
          : [
              { label: '방 크기 정하기', action: 'tool', arg: 'room-size' },
              { label: '가구 고르기', action: 'catalog' },
            ],
      });
    }
  }
  if (intent === 'room') {
    const plan = roomPlan(v, t, ctx, fixes);
    // 선택한 가구나 초안을 가리키는 중에 모델이 방 이야기로 읽었는데 방에서 바뀐 것이 없고
    // 문장에도 방을 가리키는 말이 없으면, 지금 대상인 가구 이야기로 다시 읽는다.
    // (작은 모델이 “네이비로 바꿔줘”를 방 이야기로 분류해 아무것도 바꾸지 않던 경우)
    if (
      subj &&
      !plan.changes?.room &&
      !literal &&
      !/방|공간|룸|집|벽|바닥|천장/.test(t) &&
      resolveScope(t, target) === 'furniture'
    ) {
      fixes.push(`지금 대상인 ${TYPES[subj.type].name} 이야기로 처리`);
      return done(furniturePlan(v, t, ctx, item, named, fixes));
    }
    return done(plan);
  }
  return done(furniturePlan(v, t, ctx, item, named, fixes));
}

function actionPlan(v, t, ctx, item, named, fixes) {
  const a = v.action;
  if (Object.hasOwn(OPEN_TEXT, a)) {
    // 가구 이름을 말했으면 목록보다 그 가구 초안이 먼저다.
    if (a === 'catalog' && named.length) return null;
    return { ...surfacePlan(a, OPEN_TEXT[a]), modelReply: usableReply(v.reply, t) };
  }
  if (a === 'switch_space') {
    const hit = spaces(ctx.state).find((r) => r.roomId !== ctx.state.roomId && r.name === v.space);
    // 이름을 그대로 말했거나, 옮기자는 말과 함께 그 공간의 유형을 말했을 때만 옮긴다.
    // "거실 말고 침실로 바꿔줘"의 "바꿔"만 보고 모델이 고른 엉뚱한 공간으로 가지 않는다.
    const typed = hit && roomMentions(t).some((m) => m.type === hit.room.type && m.role !== 'neg');
    if (!hit || !(roomNameSpan(t, hit.name) || (typed && ACTION_EVIDENCE.switch_space.test(t)))) {
      fixes.push('공간 이동은 문장에 그 공간의 이름이나 유형이 있을 때만 실행');
      return null;
    }
    return metaPlan('switch', '', { arg: { id: hit.roomId } });
  }
  if (!ACTION_EVIDENCE[a]?.test(t)) {
    fixes.push(`문장에 없는 동작(${ACTION_NAMES[a] || a})은 실행하지 않음`);
    return null;
  }
  if (['rotate', 'duplicate', 'delete'].includes(a)) {
    const who =
      a === 'duplicate'
        ? item && { item }
        : actionSubject(t, ctx.state, item, a === 'rotate' ? '돌릴' : '뺄', ctx.draft);
    if (who?.plan) return who.plan;
    if (!who)
      return {
        intent: 'meta',
        scope: null,
        reply: '먼저 방에서 가구를 눌러 선택해 주세요. 선택한 가구에 바로 적용할게요.',
        surfaces: [{ kind: 'items', target: { type: 'room' } }],
        suggestions: [],
      };
    if (a === 'rotate') {
      const m = t.match(/(-?\d{1,3})\s*도/);
      return metaPlan('rotate', '', { arg: { deg: m ? +m[1] : 90, id: who.item.id } });
    }
    return metaPlan(a, '', { arg: { id: who.item.id } });
  }
  if (a === 'new_space') {
    const type = pickRoomType(v.roomType, t, fixes);
    // 어떤 공간인지 알 수 없으면 방 이야기로 넘겨 되묻는다.
    if (!type) return null;
    return newSpacePlan(type, t, v, ctx);
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

// 새로 만들거나 바꿀 공간 유형을 정한다. 문장에 유형이 적혀 있으면 그 안에서만 고른다.
// - 못 박은 말("거실이라니까", "거실로 바꿔")이 있으면 그 유형이다.
// - 유형을 여럿 말했으면 모델이 그중에서 고른 것을 따른다.
// - 자리("화장실 옆에")나 부정("화장실 말고")으로만 나온 이름은 모델이 골라도 쓰지 않는다.
function pickRoomType(modelType, t, fixes) {
  const mentions = roomMentions(t),
    wanted = mentions.filter((m) => m.role === 'new'),
    literal = assertedType(mentions);
  if (!wanted.length) {
    if (modelType && mentions.some((m) => m.type === modelType)) {
      fixes.push('자리를 가리키거나 아니라고 한 이름은 공간 유형으로 쓰지 않음');
      return null;
    }
    // 작은 모델은 모르면 목록 첫 값(화장실)을 고르기 쉽다. 문장에 그 용도가 없으면 쓰지 않는다.
    if (modelType && !roomEvidence(modelType, t)) {
      fixes.push('문장에 근거가 없는 공간 유형은 고르지 않고 되물음');
      return null;
    }
    return modelType;
  }
  if (modelType === literal) return literal;
  if (modelType && !wanted.some((m) => m.strong) && wanted.some((m) => m.type === modelType))
    return modelType;
  if (modelType) fixes.push(`공간 유형은 문장에 적힌 ${ROOM_TYPES[literal].name}`);
  return literal;
}

function newSpacePlan(type, t, v, ctx) {
  const room = makeRoom(type),
    label = roomLabel(t, type);
  for (const [k, n] of Object.entries(parseRoomDimensions(t))) {
    room[k] = n;
    room.sources[k] = '사용자 설정(대화)';
  }
  return {
    intent: 'room',
    scope: 'room',
    // 답은 실제로 붙은 공간과 벽, 크기를 넣어 store가 쓴다(applyPlan). 모델 답은 어디에 붙었는지 모른다.
    reply: `${josa(label || ROOM_TYPES[type].name, '을/를')} 새 공간으로 만들었어요. 가로와 세로를 알려주면 바로 맞출게요.`,
    changes: { addSpace: type, room, near: refSpace(t, ctx.state), label },
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
  // 새 공간 만들기, 되묻기, "이미 그 유형"은 문장에서 읽은 그대로 쓴다.
  if (base.error || base.changes?.addSpace || !base.surfaces.length || base.settled) return base;
  const before = ctx.state.room;
  let room = structuredClone(base.changes?.room || before);
  if (v.roomType && v.roomType !== room.type) {
    const mentions = roomMentions(t),
      literal = assertedType(mentions),
      picked = pickRoomType(v.roomType, t, []);
    if (literal && picked === v.roomType) room = retypeRoom(room, v.roomType, keep);
    else if (literal) fixes.push(`공간 유형은 문장에 적힌 ${ROOM_TYPES[literal].name} 유지`);
    else if (mentions.length)
      fixes.push('자리를 가리키거나 아니라고 한 이름은 공간 유형으로 쓰지 않음');
    else if (!roomEvidence(v.roomType, t)) fixes.push('말하지 않은 공간 유형 변경은 막음');
    else room = retypeRoom(room, v.roomType, keep);
  }
  if (v.size !== 'unknown' && !LITERAL_ROOM_SIZE.test(t) && ROOM_SIZE_TALK.test(t)) {
    const sizes = ROOM_TYPES[room.type].sizes[['compact', 'standard', 'large'].indexOf(v.size)];
    for (const [i, k] of ['w', 'd', 'h'].entries())
      if (!keep(room.sources[k])) {
        room[k] = sizes[i];
        room.sources[k] = 'AI 단서(공간 크기)';
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
  // 면적으로 크기를 잡은 턴은 "6평(약 19.8m²)에 맞춰…"처럼 말한 면적을 받아 주는 앱의 답을 쓴다.
  // 모델 답은 숫자를 말할 수 없어서, 그 답을 쓰면 면적을 알아들었는지 화면에서 알 수 없다.
  const byArea =
    base.area && room.w === base.changes?.room?.w && room.d === base.changes?.room?.d
      ? base.reply
      : null;
  const fallbackReply = !changed
    ? base.reply
    : [
        byArea ||
          (sizeChanged &&
            `${josa(ROOM_TYPES[room.type].name, '을/를')} 가로 ${room.w}m, 세로 ${room.d}m, 천장 ${room.h}m로 반영했어요.`),
        finish.length && `${josa(finish.join(', '), '으로/로')} 바꿨어요.`,
      ]
        .filter(Boolean)
        .join(' ');
  return {
    intent: 'room',
    scope: 'room',
    modelReply: byArea ? null : usableReply(v.reply, t),
    reply: fallbackReply,
    area: byArea ? base.area : undefined,
    changes: changed ? { room } : {},
    surfaces,
    suggestions: base.suggestions,
  };
}

// 한 문장을 방 마디와 가구 마디로 나눈 요청. 모델이 고른 가구에는 모델의 단서(인원·크기 느낌·색)를 쓰고,
// 나머지 가구는 그 마디에 적힌 말로 초안을 잡는다. 방 마디의 숫자·면적·유형은 문장에서 읽는다.
function compoundPlan(v, request, ctx, item, fixes) {
  const { roomText, pieces } = request;
  let room = null;
  if (roomText) {
    room = v.intent === 'room' ? roomPlan(v, roomText, ctx, fixes) : planRoom(roomText, ctx);
    if (room.error) return room;
    if (!room.changes?.room && !room.changes?.addSpace) room = null;
  }
  if (!room && pieces.length < 2) return null;
  if (pieces.length === 1 && item) return null;
  // 새 초안으로만 잡는다. 지금 고른 가구를 고치는 말은 보통 경로가 맡는다.
  const fresh = { ...ctx, target: { type: 'room' }, draft: null };
  const drafts = pieces.map((piece) => {
    const mine = piece.type === v.furniture || (pieces.length === 1 && !v.furniture);
    const plan = furniturePlan(
      mine
        ? v
        : {
            ...v,
            furniture: piece.type,
            seats: null,
            size: 'unknown',
            depth: 'unknown',
            height: 'unknown',
            color: null,
            ui: null,
          },
      piece.text,
      fresh,
      null,
      [piece.type],
      fixes,
    );
    return plan.changes.draft;
  });
  fixes.push(
    room && pieces.length > 1
      ? '방 이야기와 가구 여럿을 나눠 처리'
      : room
        ? '방 이야기와 가구 이야기를 나눠 처리'
        : '가구 여럿을 나눠 처리',
  );
  return mergePlans(room, drafts, ctx);
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
      modelReply: usableReply(v.reply, t),
      reply: '어떤 가구인지 알려주세요. 이름을 말하거나 아래에서 고르면 크기 초안부터 잡아드려요.',
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
  // 색만 바뀌었으면 치수를 되풀이하지 않고 바뀐 색을 말한다. 아무것도 안 바뀌었으면 그대로라고 한다.
  const colorName = FURNITURE_COLORS.find(([, hex]) => hex === next.color)?.[0],
    sameDims = next.dims.every((d, i) => d === base.dims[i]),
    label = next.name || TYPES[type].name;
  const fallbackReply =
    mode !== 'new' && sameDims && next.color !== base.color && colorName
      ? `${label} 색을 ${josa(colorName, '으로/로')} 바꿨어요.`
      : mode !== 'new' && sameDims && next.color === base.color
        ? `${josa(label, '은/는')} 그대로예요. “가로 140cm”, “초록색으로”, “조금 더 작게”처럼 바꿀 치수나 색을 알려주세요.`
        : `${what} ${dimsText(next.dims)}cm예요. ${mode === 'new' ? '방에 놓기 전에 아래에서 규격을 비교해 보세요.' : '아래 도구에서 더 조절할 수 있어요.'}`;
  return {
    intent: 'furniture',
    scope: 'furniture',
    mode,
    target,
    modelReply: usableReply(v.reply, t),
    reply: fallbackReply,
    changes: mode === 'item' ? { item: { id: item.id, next } } : { draft: next },
    surfaces,
    suggestions: furnitureChips(next, mode),
  };
}
