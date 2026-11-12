// 앱 상태와 동작. 대화 한 줄기(thread)가 모든 공간에 이어지고,
// 각 턴은 상태 변경 내역(receipt)과 그 순간에 필요한 컴포넌트(surfaces)를 가진다.
import { TYPES, ROOM_TYPES } from '../catalog.js';
import {
  exampleState,
  validateState,
  makeItem,
  layoutWarnings,
  spaces,
  clampItem,
  DEFAULT_SOURCE,
} from '../data.js';
import { detectType } from '../estimator.js';
import { validateSurfaceSpec, SURFACE_KINDS } from '../ui-schema.js';
import { runAI, stopAI, onAIStatus, imageData } from '../ai.js';
import * as ops from './ops.js';
import { planTurn } from './planner.js';
import { mergeFurnitureModel, mergeRoomModel, usableCaption } from './model-turn.js';
import { josa, dimsText } from './text.js';

export const KEY = 'room-ggu-v2';
export const THREAD_KEY = 'room-ggu-thread-v1';
const VISION_KEY = 'room-ggu-vision-device';
const ACTIONS = new Set(['place', 'catalog', 'photo', 'tool', 'relocate', 'clear-target']);
const MAX_TURNS = 80;

let readError = false;
let initial = exampleState();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) initial = validateState(JSON.parse(raw));
} catch {
  readError = true;
}

export const app = {
  state: initial,
  thread: [],
  draft: null,
  selected: null,
  target: { type: 'room' },
  photo: null,
  ai: {
    text: 'off',
    model: null,
    vision: 'off',
    device: 'webgpu',
    progress: 0,
    label: '',
    error: '',
  },
  busy: null,
  modelSeq: 0,
  view: {
    sheet: 'half',
    collapsed: false,
    preview: null,
    toast: null,
    menu: null,
    webglError: false,
    saveStatus: '이 기기에 저장됨',
  },
  history: [],
  future: [],
  scenes: { three: null, plan: null },
  rev: 0,
  readError,
};
try {
  app.ai.device = localStorage.getItem(VISION_KEY) === 'wasm' ? 'wasm' : 'webgpu';
} catch {}

const subs = new Set();
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function emit() {
  app.rev++;
  for (const fn of subs) fn();
}

let toastTimer;
export function toast(text) {
  app.view.toast = { text, at: Date.now() };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    app.view.toast = null;
    emit();
  }, 4200);
  emit();
}

// ---------- 저장 ----------
export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(app.state));
    app.view.saveStatus = '이 기기에 저장됨';
  } catch {
    app.view.saveStatus = '자동 저장 불가 · 파일로 저장해주세요';
  }
  saveThread();
}
function cleanText(v, n) {
  return typeof v === 'string' ? v.slice(0, n) : '';
}
function sanitizeTurn(t) {
  if (!t || !['user', 'assistant', 'event'].includes(t.role)) return null;
  const turn = {
    id: cleanText(t.id, 40) || turnId(),
    role: t.role,
    text: cleanText(t.text, 2000),
    roomId: cleanText(t.roomId, 100),
  };
  if (t.role === 'user') {
    if (t.action) turn.action = true;
    if (t.photo || t.hadPhoto) turn.hadPhoto = true;
  }
  if (t.role === 'assistant') {
    turn.engine = ['rule', 'gemma', 'qwen'].includes(t.engine) ? t.engine : 'rule';
    turn.uiBy = ['rule', 'model', 'user', 'rule-kept'].includes(t.uiBy) ? t.uiBy : 'rule';
    turn.modelReply = cleanText(t.modelReply, 400) || undefined;
    turn.note = cleanText(t.note, 300) || undefined;
    turn.tone = t.tone === 'error' ? 'error' : undefined;
    turn.visionCaption = cleanText(t.visionCaption, 300) || undefined;
    turn.surfaces = (Array.isArray(t.surfaces) ? t.surfaces : [])
      .slice(0, 4)
      .map(validateSurfaceSpec)
      .filter(Boolean)
      .map((s) => ({ ...s, id: s.id || turnId() }));
    turn.receipt = (Array.isArray(t.receipt) ? t.receipt : []).slice(0, 12).map((r) => ({
      label: cleanText(r?.label, 30),
      from: cleanText(r?.from, 40) || undefined,
      to: cleanText(r?.to, 60),
      swatch: /^#[0-9a-f]{6}$/i.test(r?.swatch || '') ? r.swatch : undefined,
      tag: cleanText(r?.tag, 30) || undefined,
    }));
    turn.suggestions = (Array.isArray(t.suggestions) ? t.suggestions : [])
      .slice(0, 5)
      .map((s) => ({
        label: cleanText(s?.label, 30),
        text: cleanText(s?.text, 200) || undefined,
        action: ACTIONS.has(s?.action) ? s.action : undefined,
        arg: typeof s?.arg === 'string' ? s.arg.slice(0, 40) : undefined,
        primary: !!s?.primary,
      }))
      .filter((s) => s.label && (s.text || s.action));
    turn.status = 'done';
  }
  return turn;
}
function saveThread() {
  try {
    const turns = app.thread.slice(-MAX_TURNS).map((t) => {
      const { photo, status, ...rest } = t;
      return photo ? { ...rest, hadPhoto: true } : rest;
    });
    localStorage.setItem(THREAD_KEY, JSON.stringify({ turns, draft: app.draft }));
  } catch {}
}
try {
  const raw = JSON.parse(localStorage.getItem(THREAD_KEY) || 'null');
  if (raw && Array.isArray(raw.turns))
    app.thread = raw.turns.slice(-MAX_TURNS).map(sanitizeTurn).filter(Boolean);
  if (raw?.draft) app.draft = ops.sanitizeItem(raw.draft);
} catch {
  app.thread = [];
}

// ---------- 기록 ----------
let seq = 0;
export function turnId() {
  return `t${Date.now().toString(36)}${(seq++).toString(36)}`;
}
export function snapshot() {
  const json = JSON.stringify(app.state);
  if (app.history.at(-1) !== json) app.history.push(json);
  if (app.history.length > 40) app.history.shift();
  app.future = [];
  return app.history.length;
}
function restore(json) {
  const roomBefore = app.state.roomId;
  Object.assign(app.state, validateState(JSON.parse(json)));
  if (!app.state.items.some((a) => a.id === app.selected)) {
    app.selected = null;
    if (app.target.type === 'item') app.target = app.draft ? { type: 'draft' } : { type: 'room' };
  }
  if (roomBefore !== app.state.roomId) spaceEvent();
}
export function undo() {
  if (!app.history.length) return false;
  app.future.push(JSON.stringify(app.state));
  restore(app.history.pop());
  persist();
  emit();
  return true;
}
export function redo() {
  if (!app.future.length) return false;
  app.history.push(JSON.stringify(app.state));
  restore(app.future.pop());
  persist();
  emit();
  return true;
}

// ---------- 대화 ----------
function push(turn) {
  const t = { id: turnId(), roomId: app.state.roomId, ...turn };
  if (t.role === 'assistant') {
    t.surfaces = (t.surfaces || []).map((s) => ({
      id: turnId(),
      ...s,
      target: s.target?.type === 'room' ? { type: 'room', roomId: app.state.roomId } : s.target,
    }));
    t.receipt ||= [];
    t.suggestions ||= [];
    t.engine ||= 'rule';
    t.uiBy ||= 'rule';
    t.status ||= 'done';
  }
  app.thread.push(t);
  if (app.thread.length > MAX_TURNS) app.thread = app.thread.slice(-MAX_TURNS);
  return t;
}
function event(text) {
  return push({ role: 'event', text });
}
function spaceEvent() {
  const r = app.state.room;
  event(`${app.state.name} · ${ROOM_TYPES[r.type].name} ${r.w} × ${r.d}m`);
}
export function clearThread() {
  app.thread = [];
  app.draft = null;
  app.photo = null;
  app.target = app.selected ? { type: 'item', id: app.selected } : { type: 'room' };
  persist();
  emit();
}
export const roomTarget = () => ({ type: 'room', roomId: app.state.roomId });
export function subject(target = app.target) {
  if (target?.type === 'item') return app.state.items.find((a) => a.id === target.id) || null;
  if (target?.type === 'draft')
    return app.draft && (!target.id || target.id === app.draft.id) ? app.draft : null;
  return null;
}

// ---------- 선택과 초안 ----------
export function select(id) {
  if (app.selected === id) return;
  app.selected = id;
  app.target = id ? { type: 'item', id } : app.draft ? { type: 'draft' } : { type: 'room' };
  app.view.preview = null;
  emit();
}
export function setTarget(target) {
  app.target = target;
  if (target.type !== 'item') app.selected = null;
  emit();
}
export function setPreview(preview) {
  app.view.preview = preview;
  emit();
}
function nameOf(item) {
  return item?.name || '가구';
}

// ---------- 계획 적용 ----------
function placeDraftInto(turn) {
  const d = app.draft;
  if (!d) {
    turn.text = '놓을 초안이 없어요. 먼저 가구를 말하거나 골라 주세요.';
    turn.surfaces.push({ kind: 'catalog', target: roomTarget() });
    return;
  }
  snapshot();
  const { item, free } = ops.placeItem(app.state, d);
  app.draft = null;
  // 초안을 다루던 도구는 놓인 가구를 계속 다루도록 대상을 옮긴다.
  for (const t of app.thread)
    for (const s of t.surfaces || [])
      if (s.target?.type === 'draft' && (!s.target.id || s.target.id === d.id))
        s.target = { type: 'item', id: item.id };
  app.selected = item.id;
  app.target = { type: 'item', id: item.id };
  turn.receipt.push({
    label: '배치',
    to: `${item.name} · ${dimsText(item.dims)}cm`,
  });
  turn.text = free
    ? `${josa(item.name, '을/를')} 방에 놓았어요. 도면에서 끌어 옮기거나 회전할 수 있어요.`
    : `${josa(item.name, '을/를')} 놓았지만 빈자리가 없어 다른 가구와 겹쳐요. 크기를 줄이거나 위치를 옮겨 주세요.`;
  if (!free) turn.surfaces.push({ kind: 'impact', target: roomTarget() });
  turn.suggestions = [
    { label: '90° 돌리기', text: '90도 돌려줘' },
    { label: '색 바꾸기', text: `${TYPES[item.type].name} 색을 바꾸고 싶어` },
    { label: '다른 가구', action: 'catalog' },
  ];
}

function runAction(action, arg, turn) {
  const s = app.state;
  const item = subject();
  switch (action) {
    case 'undo':
      if (!undo()) turn.text = '되돌릴 내용이 없어요.';
      break;
    case 'redo':
      if (!redo()) turn.text = '다시 적용할 내용이 없어요.';
      break;
    case 'switch':
      snapshot();
      ops.switchSpace(s, arg.id);
      app.selected = null;
      app.target = app.draft ? { type: 'draft' } : { type: 'room' };
      turn.text = `${josa(s.name, '으로/로')} 옮겼어요. ${ROOM_TYPES[s.room.type].name} ${s.room.w} × ${s.room.d}m, 가구 ${s.items.length}개가 있어요.`;
      turn.surfaces.push({ kind: 'room-size', target: roomTarget() });
      break;
    case 'relocate': {
      snapshot();
      const r = ops.relocateConflicts(s);
      turn.text = r.moved
        ? `가구 ${r.moved}개를 빈자리로 옮겼어요.${r.remaining ? ` ${r.remaining}개는 방보다 크거나 자리가 없어 그대로 두었어요.` : ''}`
        : r.remaining
          ? '옮길 빈자리가 없어요. 가구 크기를 줄이거나 방을 넓혀 주세요.'
          : '겹치거나 벽을 넘은 가구가 없어요.';
      if (r.moved) turn.receipt.push({ label: '자리 정리', to: `${r.moved}개 이동` });
      turn.surfaces.push({ kind: 'impact', target: roomTarget() });
      break;
    }
    case 'clear': {
      snapshot();
      const n = ops.clearItems(s);
      app.selected = null;
      app.target = app.draft ? { type: 'draft' } : { type: 'room' };
      turn.text = n
        ? `가구 ${n}개를 비웠어요. 되돌리기로 다시 꺼낼 수 있어요.`
        : '이미 빈 방이에요.';
      if (n) turn.receipt.push({ label: '가구 비우기', to: `${n}개` });
      turn.suggestions = [{ label: '가구 고르기', action: 'catalog' }];
      break;
    }
    case 'example':
      snapshot();
      ops.loadExample(s);
      app.selected = null;
      turn.text = '예시 방을 불러왔어요. 침대·책상·의자·책장이 놓여 있어요.';
      turn.surfaces.push({ kind: 'items', target: roomTarget() });
      break;
    case 'rotate':
      snapshot();
      turn.receipt.push(...ops.rotateItem(s, item.id, arg?.deg ?? 90));
      turn.text = `${josa(nameOf(item), '을/를')} 돌렸어요.`;
      break;
    case 'duplicate': {
      snapshot();
      const { item: copy, free } = ops.duplicateItem(s, item.id);
      app.selected = copy.id;
      app.target = { type: 'item', id: copy.id };
      turn.text = free
        ? `${josa(nameOf(item), '을/를')} 하나 더 놓았어요.`
        : `${josa(nameOf(item), '을/를')} 복제했지만 빈자리가 없어 겹쳐요.`;
      turn.receipt.push({ label: '복제', to: copy.name });
      break;
    }
    case 'delete':
      snapshot();
      ops.removeItem(s, item.id);
      app.selected = null;
      app.target = app.draft ? { type: 'draft' } : { type: 'room' };
      turn.text = `${josa(nameOf(item), '을/를')} 뺐어요. 되돌리기로 다시 놓을 수 있어요.`;
      turn.receipt.push({ label: '삭제', to: nameOf(item) });
      break;
    case 'place':
      placeDraftInto(turn);
      break;
  }
}

function applyPlan(plan, turn) {
  if (plan.action) return runAction(plan.action, plan.arg, turn);
  const c = plan.changes || {};
  const s = app.state;
  if (c.addSpace) {
    snapshot();
    ops.addSpace(s, c.addSpace);
    s.name = `나의 ${ROOM_TYPES[c.addSpace].name}`;
    app.selected = null;
    app.target = app.draft ? { type: 'draft' } : { type: 'room' };
    turn.receipt.push({ label: '새 공간', to: s.name });
    const rows = ops.setRoom(s, c.room);
    turn.receipt.push(...rows.filter((r) => r.label !== '공간 유형'));
  } else if (c.room) {
    snapshot();
    if (c.room.wallColor !== s.room.wallColor || c.room.floorColor !== s.room.floorColor)
      rememberFinish(s.room);
    turn.receipt.push(...ops.setRoom(s, c.room));
  }
  if (c.item) {
    snapshot();
    turn.receipt.push(...ops.updateItem(s, c.item.id, c.item.next));
  }
  if (c.draft) {
    const before = app.draft;
    app.draft = ops.sanitizeItem(c.draft);
    app.target = { type: 'draft' };
    app.selected = null;
    if (plan.mode === 'new' || !before)
      turn.receipt.push({
        label: '새 초안',
        to: `${TYPES[app.draft.type].name} · ${dimsText(app.draft.dims)}cm`,
      });
    else turn.receipt.push(...ops.diffItem(before, app.draft).map((r) => ({ ...r, tag: '초안' })));
  }
}

function messagesForModel() {
  return app.thread
    .filter((t) => t.role !== 'event' && t.text)
    .slice(-6)
    .map((t) => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.text.slice(0, 400),
    }));
}

export async function send(raw) {
  const text = String(raw || '')
    .trim()
    .slice(0, 1500);
  const pendingPhoto = app.photo && !app.photo.sent ? app.photo : null;
  if ((!text && !pendingPhoto) || app.busy?.kind === 'model') return;
  push({ role: 'user', text, ...(pendingPhoto ? { photo: pendingPhoto.data } : {}) });
  if (pendingPhoto) pendingPhoto.sent = true;
  let plan;
  if (text) {
    plan = planTurn(text, {
      state: app.state,
      target: app.target,
      draft: app.draft,
      caption: app.photo?.caption || '',
    });
  } else
    plan = {
      intent: 'photo',
      scope: null,
      reply: '사진을 받았어요. 사진 AI로 가구 종류를 확인하거나, 아래에서 직접 골라 주세요.',
      surfaces: [],
      suggestions: [],
    };
  const turn = push({
    role: 'assistant',
    text: plan.reply,
    surfaces: plan.surfaces,
    suggestions: plan.suggestions,
  });
  if (pendingPhoto) {
    pendingPhoto.surfaceId = turnId();
    turn.surfaces.unshift({ id: pendingPhoto.surfaceId, kind: 'photo', target: { type: 'room' } });
  }
  try {
    if (!plan.error) applyPlan(plan, turn);
    else turn.tone = 'error';
  } catch (e) {
    turn.text = e.message;
    turn.tone = 'error';
  }
  fixRoomTargets(turn);
  persist();
  emit();
  if (plan.scope && !plan.error && turn.tone !== 'error' && app.ai.text === 'ready')
    await refine(plan, turn, text);
}

function fixRoomTargets(turn) {
  for (const s of turn.surfaces || []) {
    if (s.target?.type === 'room') s.target = { type: 'room', roomId: app.state.roomId };
    if (s.target?.type === 'draft' && !s.target.id && app.draft)
      s.target = { type: 'draft', id: app.draft.id };
  }
}

async function refine(plan, turn, text) {
  const version = ++app.modelSeq,
    roomId = app.state.roomId;
  const target = plan.scope === 'furniture' ? plan.target : null;
  const base = plan.scope === 'furniture' ? subject(target) : null;
  if (plan.scope === 'furniture' && !base) return;
  turn.status = 'thinking';
  app.busy = { kind: 'model', turnId: turn.id };
  emit();
  try {
    const raw = await runAI(
      'chat',
      plan.scope === 'room'
        ? { scope: 'room', room: app.state.room, messages: messagesForModel() }
        : { item: base, caption: app.photo?.caption || '', messages: messagesForModel() },
    );
    if (version !== app.modelSeq || roomId !== app.state.roomId) return;
    const engine = String(app.ai.model || '').startsWith('gemma') ? 'gemma' : 'qwen';
    let merged;
    if (plan.scope === 'room') {
      merged = mergeRoomModel(raw, app.state.room, text);
      const rows = ops.diffRoom(app.state.room, merged.room);
      if (rows.length) {
        ops.setRoom(app.state, merged.room);
        turn.receipt.push(...rows.map((r) => ({ ...r, tag: '모델 단서' })));
      }
    } else {
      const current = subject(target);
      if (!current) return;
      merged = mergeFurnitureModel(raw, current, text);
      const rows = ops.diffItem(current, merged.item);
      if (rows.length) {
        if (target.type === 'item') ops.updateItem(app.state, current.id, merged.item);
        else app.draft = ops.sanitizeItem(merged.item);
        turn.receipt.push(...rows.map((r) => ({ ...r, tag: '모델 단서' })));
      }
    }
    if (merged.kind) {
      const i = turn.surfaces.findIndex((s) => SURFACE_KINDS[s.kind].scope === plan.scope);
      const current = i >= 0 ? turn.surfaces[i].kind : null;
      // 요청 문장에 분명한 단어(벽·가로·색 등)가 있어 규칙이 고른 도구는 모델이 바꾸지 않는다.
      // 그때 모델이 다른 도구를 고르면 칩으로만 제안한다.
      if (current === merged.kind) turn.uiBy = 'model';
      else if (i >= 0 && !plan.confident) {
        turn.surfaces[i] = { ...turn.surfaces[i], kind: merged.kind };
        turn.uiBy = 'model';
      } else if (i >= 0) {
        turn.uiBy = 'rule-kept';
        turn.suggestions = [
          ...turn.suggestions.slice(0, 3),
          {
            label: `모델 제안 · ${SURFACE_KINDS[merged.kind].title}`,
            action: 'tool',
            arg: merged.kind,
          },
        ];
      }
    }
    turn.engine = engine;
    if (merged.reply) turn.modelReply = merged.reply;
  } catch (e) {
    if (version === app.modelSeq)
      turn.note = `모델 답변을 쓰지 못해 규칙 기반 결과를 유지했어요. ${e.message}`;
  } finally {
    if (version === app.modelSeq) app.busy = null;
    turn.status = 'done';
    persist();
    emit();
  }
}

export function cancelModel() {
  app.modelSeq++;
  stopAI('모델 작업을 취소했어요.');
  app.busy = null;
  app.ai.text = 'off';
  app.ai.vision = 'off';
  app.ai.model = null;
  for (const t of app.thread) if (t.status === 'thinking') t.status = 'done';
  toast('모델 작업을 취소했어요. 다시 쓰려면 모델을 준비해 주세요.');
}

// ---------- 직접 연 도구와 버튼 동작 ----------
const TOOL_TEXT = {
  'room-size': '방 크기를 정해 볼까요? 숫자를 바로 고치거나 “가로 4m 세로 3m”처럼 말해도 돼요.',
  'room-type': '어떤 공간인가요? 유형을 바꾸면 직접 정한 치수는 그대로 두고 나머지만 바꿔요.',
  finishes: '벽과 바닥을 골라 보세요. 바꾸기 전과 후를 나란히 보여드려요.',
  catalog: '놓고 싶은 가구를 골라 주세요. 고르면 크기 초안이 방 안에 먼저 나타나요.',
  spaces: '공간마다 크기와 가구를 따로 저장해요. 최대 12개까지 만들 수 있어요.',
  items: '이 방에 놓인 가구예요. 누르면 도면에서 선택돼요.',
  files: '배치는 파일로 저장하거나 불러올 수 있어요. 사진과 대화는 파일에 넣지 않아요.',
  ai: '이 기기에서 실행하는 모델이에요. 준비하지 않아도 기본 상담과 배치는 그대로 쓸 수 있어요.',
  help: '이렇게 쓰면 돼요.',
  impact: '지금 배치에서 겹치거나 벽을 넘은 가구를 확인해요.',
  'furniture-size': '같은 종류의 다른 규격과 비교해 보세요.',
  'furniture-dims': '아는 치수만 고치면 돼요. 직접 입력한 값은 상담이나 모델이 바꾸지 않아요.',
  'furniture-color': '가구 색을 골라 보세요.',
  photo: '가구 사진을 올려 주세요.',
};
const TOOL_LABEL = {
  'room-size': '방 크기 열기',
  'room-type': '공간 유형 열기',
  finishes: '벽·바닥 열기',
  catalog: '가구 고르기',
  spaces: '내 공간 열기',
  items: '가구 목록 열기',
  files: '저장·불러오기',
  ai: 'AI 설정 열기',
  help: '사용 방법',
  impact: '배치 확인',
  'furniture-size': '규격 비교 열기',
  'furniture-dims': '치수 입력 열기',
  'furniture-color': '색상 열기',
};
export function openTool(kind, { echo = true, target } = {}) {
  if (!Object.hasOwn(SURFACE_KINDS, kind)) return;
  const scope = SURFACE_KINDS[kind].scope;
  let t = target || (scope === 'furniture' ? app.target : roomTarget());
  if (scope === 'furniture' && !subject(t)) {
    kind = 'catalog';
    t = roomTarget();
  }
  if (echo)
    push({ role: 'user', text: TOOL_LABEL[kind] || SURFACE_KINDS[kind].title, action: true });
  const s = subject(t);
  if (t.type === 'draft' && s) t = { type: 'draft', id: s.id };
  push({
    role: 'assistant',
    text: scope === 'furniture' && s ? `${s.name} · ${TOOL_TEXT[kind]}` : TOOL_TEXT[kind],
    surfaces: [{ kind, target: t }],
    uiBy: 'user',
  });
  saveThread();
  emit();
}

export function runSuggestion(sug) {
  if (sug.text) return send(sug.text);
  if (sug.action === 'place') return placeDraft(sug.label);
  if (sug.action === 'catalog') return openTool('catalog');
  if (sug.action === 'tool' && sug.arg) return openTool(sug.arg);
  if (sug.action === 'photo') return pickPhoto();
  if (sug.action === 'relocate') return relocate();
}

export function placeDraft(label = '방에 놓기') {
  push({ role: 'user', text: label, action: true });
  const turn = push({ role: 'assistant', text: '' });
  try {
    placeDraftInto(turn);
  } catch (e) {
    turn.text = e.message;
    turn.tone = 'error';
  }
  fixRoomTargets(turn);
  persist();
  emit();
}

export function createDraft(type, { via = 'catalog' } = {}) {
  if (!Object.hasOwn(TYPES, type)) return;
  const item = makeItem(type);
  item.name = TYPES[type].name;
  app.draft = item;
  app.selected = null;
  app.target = { type: 'draft' };
  push({ role: 'user', text: `${TYPES[type].name} 고르기`, action: true });
  push({
    role: 'assistant',
    text: `${TYPES[type].name} 초안을 방 안에 먼저 띄웠어요. 규격을 고르거나 아는 치수를 말해 주세요.`,
    surfaces: [{ kind: 'furniture-size', target: { type: 'draft', id: item.id } }],
    suggestions: [
      { label: '방에 놓기', action: 'place', primary: true },
      { label: '치수 말하기', text: `${TYPES[type].name} 가로 ` },
      { label: '색 바꾸기', text: `${TYPES[type].name} 색을 바꾸고 싶어` },
    ].filter((x) => via === 'catalog' || x.action),
    receipt: [{ label: '새 초안', to: `${TYPES[type].name} · ${dimsText(item.dims)}cm` }],
  });
  persist();
  emit();
}

export function relocate() {
  push({ role: 'user', text: '겹친 가구 정리', action: true });
  const turn = push({ role: 'assistant', text: '' });
  runAction('relocate', null, turn);
  fixRoomTargets(turn);
  persist();
  emit();
}

// 도구 안에서 직접 바꾸는 값. 입력 도중에는 기록을 한 번만 남긴다.
let liveEdit = null;
export function beginEdit(key) {
  if (liveEdit === key) return;
  liveEdit = key;
  snapshot();
}
export function endEdit() {
  liveEdit = null;
}
function commit({ silent = false } = {}) {
  persist();
  if (!silent) emit();
}

export function setRoomDim(key, value, { live = false } = {}) {
  if (!live) snapshot();
  ops.setRoom(app.state, ops.roomWithDims(app.state.room, { [key]: value }));
  commit();
}
export function setRoomPreset(index) {
  snapshot();
  ops.setRoom(app.state, ops.roomWithPreset(app.state.room, index));
  commit();
}
export function setRoomType(type) {
  snapshot();
  ops.setRoom(app.state, ops.roomWithType(app.state.room, type));
  commit();
}
export function setFinish(key, color) {
  const before = app.state.room[key];
  if (before === color) return;
  snapshot();
  rememberFinish(app.state.room);
  ops.setRoom(app.state, ops.roomWithFinish(app.state.room, key, color));
  commit();
}
function rememberFinish(room) {
  app.view.lastFinish = {
    roomId: app.state.roomId,
    before: { wallColor: room.wallColor, floorColor: room.floorColor },
  };
}
export function renameRoom(name) {
  ops.renameSpace(app.state, name);
  commit();
}

function editSubject(target, change, { live = false } = {}) {
  const s = subject(target);
  if (!s) return;
  const next = structuredClone(s);
  change(next);
  if (target.type === 'item') {
    if (!live) snapshot();
    ops.updateItem(app.state, s.id, next);
  } else app.draft = ops.sanitizeItem(next);
  commit();
}
export function setItemDim(target, i, value, opts) {
  if (!(value >= 1 && value <= 1500)) throw Error('치수는 1~1500cm로 입력해주세요.');
  editSubject(
    target,
    (a) => {
      a.dims[i] = Math.round(value * 10) / 10;
      a.sources[i] = '사용자 설정';
    },
    opts,
  );
}
export function setItemPreset(target, index) {
  editSubject(target, (a) => {
    const p = TYPES[a.type].presets[index];
    a.dims = [...p.dims];
    a.sources = a.dims.map(() => `사용자 선택 · ${p.label}`);
  });
}
export function setItemColor(target, color) {
  editSubject(target, (a) => {
    a.color = color;
  });
}
export function setItemType(target, type) {
  editSubject(target, (a) => {
    const fresh = makeItem(type);
    a.type = type;
    a.name = TYPES[type].name;
    a.dims = fresh.dims;
    a.sources = [DEFAULT_SOURCE, DEFAULT_SOURCE, DEFAULT_SOURCE];
  });
}
export function setItemName(target, name) {
  editSubject(target, (a) => {
    a.name = String(name).trim().slice(0, 100) || TYPES[a.type].name;
  });
}
export function setItemAngle(id, angle) {
  snapshot();
  const a = app.state.items.find((x) => x.id === id);
  if (!a) return;
  ops.updateItem(app.state, id, { ...a, angle });
  commit();
}

// 도면 위 도구 막대에서 한 동작은 대화에 짧은 기록으로 남긴다.
export function itemAction(action, id = app.selected) {
  const item = app.state.items.find((a) => a.id === id);
  if (!item) return;
  const prevTarget = app.target;
  app.target = { type: 'item', id };
  const turn = { receipt: [], surfaces: [], suggestions: [], text: '' };
  try {
    runAction(action, action === 'rotate' ? { deg: 90 } : null, turn);
  } catch (e) {
    app.target = prevTarget;
    return toast(e.message);
  }
  event(turn.text);
  persist();
  emit();
}

export function removeById(id) {
  itemAction('delete', id);
}

// ---------- 공간 ----------
export function switchSpace(id) {
  if (id === app.state.roomId) return;
  snapshot();
  ops.switchSpace(app.state, id);
  app.selected = null;
  app.target = app.draft ? { type: 'draft' } : { type: 'room' };
  spaceEvent();
  persist();
  emit();
}
export function addSpace(type) {
  try {
    snapshot();
    ops.addSpace(app.state, type);
    app.state.name = `나의 ${ROOM_TYPES[type].name}`;
    app.selected = null;
    app.target = app.draft ? { type: 'draft' } : { type: 'room' };
    push({ role: 'user', text: `${ROOM_TYPES[type].name} 추가`, action: true });
    push({
      role: 'assistant',
      text: `${josa(app.state.name, '을/를')} 새로 만들었어요. 크기를 알려주면 바로 맞출게요.`,
      surfaces: [{ kind: 'room-size', target: roomTarget() }],
      receipt: [{ label: '새 공간', to: app.state.name }],
      suggestions: [{ label: '가구 고르기', action: 'catalog' }],
    });
    persist();
    emit();
  } catch (e) {
    app.history.pop();
    toast(e.message);
  }
}
export function deleteSpace(id) {
  try {
    snapshot();
    const name = ops.deleteSpace(app.state, id);
    app.selected = null;
    app.target = app.draft ? { type: 'draft' } : { type: 'room' };
    event(`${josa(name, '을/를')} 삭제했어요 · 되돌리기로 복구할 수 있어요`);
    persist();
    emit();
  } catch (e) {
    app.history.pop();
    toast(e.message);
  }
}
export function clearItemsAction() {
  push({ role: 'user', text: '가구 비우기', action: true });
  const turn = push({ role: 'assistant', text: '' });
  runAction('clear', null, turn);
  persist();
  emit();
}
export function loadExampleAction() {
  push({ role: 'user', text: '예시 방 불러오기', action: true });
  const turn = push({ role: 'assistant', text: '' });
  runAction('example', null, turn);
  fixRoomTargets(turn);
  persist();
  emit();
}

// ---------- 보기 설정 ----------
export function setView(view) {
  if (view === '3d' && app.view.webglError)
    return toast('이 기기에서 3D를 시작하지 못했어요. 2D 평면을 이용해주세요.');
  app.state.view = view;
  commit();
}
export function toggle(key) {
  app.state[key] = !app.state[key];
  commit();
}
export function setSheet(sheet) {
  app.view.sheet = sheet;
  emit();
}
export function setCollapsed(v) {
  app.view.collapsed = v;
  emit();
}
export function setMenu(menu) {
  app.view.menu = app.view.menu === menu ? null : menu;
  emit();
}

// ---------- 파일 ----------
function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}
export function exportJSON() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(app.state, null, 2)], { type: 'application/json' }),
  );
  download(url, `${app.state.name || '룸꾸'}-배치.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('배치 파일을 저장했어요. 다른 기기에서 불러올 수 있어요.');
}
export async function importJSON(file) {
  try {
    if (!file) return;
    if (file.size > 5e6) throw Error('배치 파일은 5MB 이하로 선택해주세요.');
    const next = validateState(JSON.parse(await file.text()));
    snapshot();
    Object.assign(app.state, next);
    for (const a of app.state.items) clampItem(a, app.state.room);
    app.selected = null;
    app.target = app.draft ? { type: 'draft' } : { type: 'room' };
    event(`배치 파일을 불러왔어요 · 공간 ${spaces(app.state).length}개`);
    persist();
    emit();
    toast('배치를 불러왔어요.');
  } catch (e) {
    toast(`불러오기 실패: ${e.message}`);
  }
}
export function exportPNG() {
  try {
    const sc = app.state.view === '2d' ? app.scenes.plan : app.scenes.three;
    const url = sc?.png();
    if (!url) throw Error('현재 화면을 저장하지 못했어요.');
    download(url, `${app.state.name}-배치.png`);
    toast('지금 보이는 배치 화면을 저장했어요.');
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 사진 ----------
let photoInput = null;
export function registerPhotoInput(el) {
  photoInput = el;
}
export function pickPhoto() {
  photoInput?.click();
}
export async function attachPhoto(file) {
  if (!file) return;
  try {
    const data = await imageData(file);
    app.photo = { data, caption: '', analyzed: false, sent: false, type: null };
    emit();
  } catch (e) {
    toast(e.message);
  }
}
export function removePhoto() {
  if (app.photo && !app.photo.sent) app.photo = null;
  emit();
}
export function setVisionDevice(device) {
  app.ai.device = device === 'wasm' ? 'wasm' : 'webgpu';
  try {
    localStorage.setItem(VISION_KEY, app.ai.device);
  } catch {}
  emit();
}
export async function analyzePhoto() {
  const photo = app.photo;
  if (!photo || app.busy) return;
  app.busy = { kind: 'vision' };
  app.ai.vision = 'loading';
  app.ai.label = '사진 모델 준비 중';
  app.ai.progress = 0;
  emit();
  try {
    const raw = await runAI('caption', { image: photo.data, device: app.ai.device });
    if (app.photo !== photo) return;
    const caption = usableCaption(raw);
    photo.caption = caption;
    photo.analyzed = true;
    app.ai.vision = 'ready';
    const type = detectType(caption);
    photo.type = type;
    if (type) {
      const base = app.draft && app.draft.type === type ? app.draft : makeItem(type);
      const next = structuredClone(base);
      next.name = TYPES[type].name;
      for (let i = 0; i < 3; i++)
        if (!String(next.sources[i]).startsWith('사용자')) next.sources[i] = '사진 유형 · 기본값';
      app.draft = ops.sanitizeItem(next);
      app.target = { type: 'draft' };
      app.selected = null;
    }
    push({
      role: 'assistant',
      engine: 'rule',
      text: type
        ? `사진은 ${josa(TYPES[type].name, '으로/로')} 보여요. 그 유형의 기본 크기로 초안을 띄웠어요. 사진만으로는 실제 cm를 알 수 없으니 아는 치수를 알려주세요.`
        : caption
          ? '사진에서 가구 종류를 확실히 찾지 못했어요. 아래에서 종류를 골라 주세요.'
          : '사진 모델이 읽을 수 있는 설명을 내지 못했어요. 가구가 크게 보이는 사진으로 다시 해보거나 아래에서 종류를 골라 주세요.',
      surfaces: type
        ? [{ kind: 'furniture-size', target: { type: 'draft', id: app.draft.id } }]
        : [{ kind: 'catalog', target: roomTarget() }],
      receipt: type ? [{ label: '사진 단서', to: TYPES[type].name, tag: 'SmolVLM' }] : [],
      suggestions: type
        ? [
            { label: '방에 놓기', action: 'place', primary: true },
            { label: '가로 알려주기', text: `${TYPES[type].name} 가로 ` },
          ]
        : [],
      visionCaption: caption || undefined,
    });
  } catch (e) {
    app.ai.vision = 'error';
    app.ai.error = e.message;
    toast(`사진 분석: ${e.message}`);
  } finally {
    app.busy = null;
    persist();
    emit();
  }
}

// ---------- 텍스트 모델 ----------
export async function loadText() {
  if (app.busy) return;
  app.busy = { kind: 'load' };
  app.ai.text = 'loading';
  app.ai.label = '상담 모델 준비 중';
  app.ai.progress = 0;
  app.ai.error = '';
  emit();
  try {
    const model = await runAI('load-text');
    app.ai.text = 'ready';
    app.ai.model = model;
    toast(`${model.startsWith('gemma') ? 'Gemma 3 1B' : 'Qwen3 0.6B'} 상담 모델을 준비했어요.`);
  } catch (e) {
    app.ai.text = 'error';
    app.ai.error = e.message;
  } finally {
    app.busy = null;
    emit();
  }
}
export function unloadAI() {
  app.modelSeq++;
  stopAI('모델 메모리를 해제했어요.');
  app.busy = null;
  app.ai = { ...app.ai, text: 'off', vision: 'off', model: null, progress: 0, label: '' };
  toast('모델 메모리를 해제했어요. 기본 상담은 계속 쓸 수 있어요.');
}
let lastProgressEmit = 0;
onAIStatus((data) => {
  if (data.event === 'unloaded' && data.task === 'text') {
    app.ai.text = 'off';
    app.ai.model = null;
  }
  if (data.event === 'unloaded' && data.task === 'vision') app.ai.vision = 'off';
  if (data.event === 'reset') {
    app.ai.text = 'off';
    app.ai.vision = 'off';
  }
  if (data.event === 'progress') {
    let label = data.text || '모델 준비 중';
    if (data.task === 'text') {
      const percent = label.match(/(\d+)%/);
      label = /Fetching|Loading model|Start to fetch/i.test(label)
        ? `상담 모델 내려받는 중${percent ? ` · ${percent[1]}%` : ''}`
        : '이 기기에 맞게 상담 모델을 준비하는 중';
    } else label = data.status === 'progress' ? '사진 모델 내려받는 중' : '사진 모델 준비 중';
    app.ai.label = label;
    if (Number.isFinite(data.progress)) app.ai.progress = Math.min(1, Math.max(0, data.progress));
  }
  const now = performance.now();
  if (data.event !== 'progress' || now - lastProgressEmit > 120) {
    lastProgressEmit = now;
    emit();
  }
});

// ---------- 도면 콜백 ----------
export const sceneCallbacks = {
  select: (id) => select(id),
  start: () => snapshot(),
  move: (id, x, z) => {
    const a = app.state.items.find((i) => i.id === id);
    if (!a) return;
    if (app.state.snap) {
      x = Math.round(x * 20) / 20;
      z = Math.round(z * 20) / 20;
    }
    a.x = x;
    a.z = z;
    ops.updateItem(app.state, id, a);
    const moved = app.state.items.find((i) => i.id === id);
    app.scenes.three?.moveObject(id, moved.x, moved.z);
    app.scenes.plan?.draw();
    app.rev++;
    for (const fn of subs) fn('move');
  },
  commit: () => {
    persist();
    emit();
  },
};

export function warnings() {
  return layoutWarnings(app.state);
}
