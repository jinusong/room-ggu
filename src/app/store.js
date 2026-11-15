// 앱 상태와 동작. 대화 한 줄기(thread)가 모든 공간에 이어지고,
// 각 턴은 상태 변경 내역(receipt)과 그 순간에 필요한 컴포넌트(surfaces)를 가진다.
import { TYPES, ROOM_TYPES, makeRoom } from '../catalog.js';
import {
  exampleState,
  validateState,
  makeItem,
  layoutWarnings,
  spaces,
  clampItem,
  DEFAULT_SOURCE,
} from '../data.js';
import { validateSurfaceSpec, SURFACE_KINDS } from '../ui-schema.js';
import { runAI, stopAI, interruptAI, onAIStatus, imageData } from '../ai.js';
import * as ops from './ops.js';
import { planTurn } from './planner.js';
import { planFromModel } from './interpret.js';
import { photoCandidates, PHOTO_CONFIDENT } from './photo.js';
import { josa, dimsText } from './text.js';
import { parseComparisonCommand, avatarLayout, poseAccepts } from '../avatar.js';
import { connections } from '../floorplan.js';
import {
  TEXT_MODELS,
  DEFAULT_TEXT_MODEL,
  textModel,
  modelName,
  downloadSize,
  parseProgress,
  explainLoadError,
} from './models.js';
export { modelName, TEXT_MODELS };

export const KEY = 'room-ggu-v2';
export const THREAD_KEY = 'room-ggu-thread-v1';
const VISION_KEY = 'room-ggu-vision-device';
const ACTIONS = new Set(['place', 'catalog', 'photo', 'tool', 'relocate', 'clear-target', 'draft']);
const FALLBACKS = [
  'loading',
  'off',
  'unsupported',
  'error',
  'timeout',
  'invalid',
  'cancelled',
  'model-chat',
];
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
    // text: off | loading | ready | error | unsupported. 기본은 켜짐이며 bootModel()이 자동으로 준비한다.
    text: 'off',
    why: '',
    model: null,
    choice: DEFAULT_TEXT_MODEL,
    vision: 'off',
    device: 'webgpu',
    progress: 0,
    label: '',
    error: '',
    // 내려받기 안내: task는 text|vision, phase는 fetch(내려받는 중)|init(준비)|done|error.
    download: null,
  },
  busy: null,
  modelSeq: 0,
  view: {
    sheet: 'half',
    collapsed: false,
    preview: null,
    avatarBar: false,
    door: null,
    doorList: false,
    addSide: null,
    ghostRoom: null,
    // 위쪽 모델 아일랜드를 펼쳐 둘지. 처음 내려받을 때와 실패했을 때만 저절로 펼친다.
    downloadOpen: false,
    downloadAuto: false,
    toast: null,
    menu: null,
    webglError: false,
    saveStatus: '이 기기에 저장됨',
  },
  history: [],
  future: [],
  scenes: { three: null, plan: null, house: null, tags: null },
  rev: 0,
  readError,
};
try {
  app.ai.device = localStorage.getItem(VISION_KEY) === 'wasm' ? 'wasm' : 'webgpu';
  app.ai.choice = textModel(localStorage.getItem('room-ggu-model-choice')).key;
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
const hideToast = () => {
  clearTimeout(toastTimer);
  app.view.toast = null;
  emit();
};
export function toast(text) {
  app.view.toast = { text, at: Date.now() };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4200);
  emit();
}
// 알림 위에 포인터를 올리거나 누르고 있는 동안에는 사라지지 않게 멈추고, 떼면 조금 뒤에 닫는다.
export function holdToast() {
  clearTimeout(toastTimer);
}
export function releaseToast() {
  if (!app.view.toast) return;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2000);
}
export function dismissToast() {
  if (app.view.toast) hideToast();
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
    turn.engine = ['rule', 'gemma', 'qwen', 'siglip', 'app'].includes(t.engine) ? t.engine : 'rule';
    turn.uiBy = t.uiBy === 'user' ? 'user' : undefined;
    turn.fallback = FALLBACKS.includes(t.fallback) ? t.fallback : undefined;
    turn.fixes = (Array.isArray(t.fixes) ? t.fixes : [])
      .slice(0, 6)
      .map((f) => cleanText(f, 80))
      .filter(Boolean);
    turn.note = cleanText(t.note, 300) || undefined;
    turn.tone = t.tone === 'error' ? 'error' : undefined;
    turn.photoScores = cleanText(t.photoScores, 120) || undefined;
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
  if (app.selected === id && !(id === null && app.view.avatarBar)) return;
  app.selected = id;
  app.target = id ? { type: 'item', id } : app.draft ? { type: 'draft' } : { type: 'room' };
  app.view.preview = null;
  app.view.avatarBar = false;
  app.view.door = null;
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

function historyForModel() {
  return app.thread
    .filter((t) => t.role !== 'event' && t.text)
    .slice(-4)
    .map((t) => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.text.slice(0, 300),
    }));
}
function context() {
  return { state: app.state, target: app.target, draft: app.draft };
}
function modelContext() {
  const s = subject();
  const r = app.state.room;
  const target =
    app.target.type === 'item' && s
      ? `선택한 가구 ${s.name}(${s.type})`
      : app.target.type === 'draft' && s
        ? `방에 놓기 전 초안 ${s.name}(${s.type})`
        : '방';
  return {
    target,
    room: `${app.state.name} · ${ROOM_TYPES[r.type].name} 가로 ${r.w}m 세로 ${r.d}m 천장 ${r.h}m · 놓인 가구 ${app.state.items.length}개${app.draft ? ` · 초안 ${app.draft.name}` : ''}`,
    spaces: spaces(app.state)
      .filter((x) => x.roomId !== app.state.roomId)
      .map((x) => x.name),
  };
}
const engineName = () => (String(app.ai.model || '').startsWith('gemma') ? 'gemma' : 'qwen');
function fallbackReason() {
  if (['loading', 'unsupported', 'error'].includes(app.ai.text)) return app.ai.text;
  return 'off';
}
const withPhoto = (plan, extra) =>
  extra.length ? { ...plan, surfaces: [...extra, ...(plan.surfaces || [])] } : plan;

function finishTurn(turn, plan, meta) {
  Object.assign(turn, {
    text: plan.reply || '',
    surfaces: (plan.surfaces || []).map((s) => ({ id: turnId(), ...s })),
    suggestions: plan.suggestions || [],
    status: 'done',
    ...meta,
  });
  if (plan.note) turn.note = plan.note;
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
}

// 상담 모델이 준비돼 있으면 모델이 문장을 먼저 해석한다(interpret.js가 검증).
// 모델이 준비 중·꺼짐·미지원이거나 답이 늦거나 틀리면 규칙(planner.js)으로 처리하고 그 이유를 턴에 남긴다.
const MODEL_TIMEOUT = 25000;
let pending = null;
export async function send(raw) {
  const text = String(raw || '')
    .trim()
    .slice(0, 1500);
  const pendingPhoto = app.photo && !app.photo.sent ? app.photo : null;
  if ((!text && !pendingPhoto) || app.busy?.kind === 'model') return;
  const history = historyForModel();
  push({ role: 'user', text, ...(pendingPhoto ? { photo: pendingPhoto.data } : {}) });
  const turn = push({ role: 'assistant', text: '' });
  let extra = [];
  if (pendingPhoto) {
    pendingPhoto.sent = true;
    pendingPhoto.surfaceId = turnId();
    extra = [{ id: pendingPhoto.surfaceId, kind: 'photo', target: { type: 'room' } }];
  }
  if (!text) {
    const auto = app.ai.why !== 'user' && app.ai.why !== 'url';
    finishTurn(
      turn,
      {
        reply: auto
          ? '사진을 받았어요. 이 기기의 사진 모델로 가구 종류를 확인할게요.'
          : '사진을 받았어요. 사진 모델로 가구 종류를 확인하거나, 아래에서 직접 골라 주세요.',
        surfaces: extra,
      },
      { engine: 'app' },
    );
    if (auto) analyzePhoto();
    return;
  }
  const comparison = parseComparisonCommand(text, { avatarOn: !!avatarLayout(app.state) });
  if (comparison) {
    let reply;
    try {
      if (comparison.kind === 'floorplan') {
        setScope('house');
        if (comparison.view) setView(comparison.view);
        reply =
          '집 전체를 열었어요. 2D에서 공간을 끌어 배치하고, 3D에서 화장실과 가구를 함께 둘러보세요.';
      } else if (comparison.kind === 'door') {
        // 문 명령의 답에는 집 전체 도구(문 목록)를 붙인다.
        comparison.kind = 'floorplan';
        reply = doorCommand(comparison);
      } else {
        const { patch, furniture } = comparison;
        const prefer = furniture
          ? app.state.items.find((i) => i.type === furniture)?.id
          : app.selected;
        // 가구를 말했는데 자세를 말하지 않았으면 그 가구에 맞는 자세로 읽는다.
        if (furniture && !patch.pose && patch.enabled)
          patch.pose = furniture === 'bed' ? 'lying' : 'sitting';
        const id =
          patch.pose && patch.pose !== 'standing' ? poseTarget(patch.pose, prefer)?.id : null;
        const error = updateAvatar(patch, id);
        if (error) throw Error(error);
        reply = avatarSentence();
        app.view.avatarBar = app.state.avatar.enabled;
      }
    } catch (e) {
      reply = e.message;
    }
    finishTurn(
      turn,
      { reply, surfaces: [{ kind: comparison.kind, target: { type: 'room' } }] },
      { engine: 'app' },
    );
    return;
  }
  if (app.ai.text !== 'ready') {
    finishTurn(turn, withPhoto(planTurn(text, context()), extra), {
      engine: 'rule',
      fallback: fallbackReason(),
    });
    return;
  }
  const version = ++app.modelSeq;
  turn.status = 'thinking';
  turn.engine = engineName();
  app.busy = { kind: 'model', turnId: turn.id };
  pending = { version, turn, text, extra };
  emit();
  let plan, meta;
  try {
    const raw = await Promise.race([
      runAI('interpret', { text, history, context: modelContext() }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Object.assign(Error('모델 답이 늦어요.'), { timeout: true })),
          MODEL_TIMEOUT,
        ),
      ),
    ]);
    if (version !== app.modelSeq) return;
    plan = planFromModel(raw, text, context());
    if (plan.fallback) {
      meta = { engine: 'rule', fallback: plan.fallback };
      plan = planTurn(text, context());
    } else meta = { engine: engineName(), fixes: plan.fixes };
  } catch (e) {
    if (version !== app.modelSeq) return;
    if (e.timeout) interruptAI();
    meta = {
      engine: 'rule',
      fallback: e.timeout ? 'timeout' : 'invalid',
      note: e.timeout ? undefined : `모델 답을 쓰지 못했어요: ${e.message}`,
    };
    plan = planTurn(text, context());
  }
  pending = null;
  app.busy = null;
  finishTurn(turn, withPhoto(plan, extra), meta);
}

function fixRoomTargets(turn) {
  for (const s of turn.surfaces || []) {
    if (s.target?.type === 'room') s.target = { type: 'room', roomId: app.state.roomId };
    if (s.target?.type === 'draft' && !s.target.id && app.draft)
      s.target = { type: 'draft', id: app.draft.id };
  }
}

// 해석 중인 답을 멈추고 그 문장은 규칙으로 처리한다. 모델은 메모리에 그대로 둔다.
export function interruptModel() {
  if (!pending) return;
  const { turn, text, extra } = pending;
  pending = null;
  app.modelSeq++;
  interruptAI();
  app.busy = null;
  finishTurn(turn, withPhoto(planTurn(text, context()), extra), {
    engine: 'rule',
    fallback: 'cancelled',
  });
}

// 진행 중인 모델 작업 취소: 해석 중이면 그 답만 멈추고, 사진 판별이면 Worker를 멈춘다.
export function cancelModel() {
  if (pending) return interruptModel();
  if (app.busy?.kind !== 'vision') return;
  app.modelSeq++;
  stopAI('사진 판별을 취소했어요.');
  app.busy = null;
  app.ai.vision = 'off';
  app.ai.model = null;
  if (app.ai.download?.task === 'vision') app.ai.download = null;
  toast('사진 판별을 취소했어요.');
  // Worker를 다시 만들었으니 기본 설정이면 상담 모델을 다시 준비한다.
  if (!app.ai.why) loadText({ auto: true });
}

// ---------- 직접 연 도구와 버튼 동작 ----------
const TOOL_TEXT = {
  avatar:
    '키를 알려주면 가구와 같은 축척의 아바타를 세워요. 의자·소파·침대에는 앉히거나 눕혀 볼 수 있어요.',
  floorplan: '방과 화장실을 2D·3D로 함께 보세요. 공간 위치는 2D에서 끌어 맞출 수 있어요.',
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
  avatar: '내 키로 크기 비교',
  floorplan: '집 전체 보기',
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
  if (kind === 'floorplan') app.state.scope = 'house';
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
  persist();
  emit();
}

function comparisonEdit(change, { live = false } = {}) {
  const next = structuredClone(app.state);
  change(next);
  if (!live) snapshot();
  Object.assign(app.state, next);
  commit();
}
export function updateAvatar(patch, id = app.selected, opts = {}) {
  try {
    comparisonEdit((s) => ops.setAvatar(s, patch, id), opts);
    if (patch.enabled === false) app.view.avatarBar = false;
  } catch (e) {
    toast(e.message);
    return e.message;
  }
}
// 앉히거나 눕힐 가구: 지금 고른 가구, 이미 쓰던 가구, 방에 있는 첫 가구 순으로 찾는다.
export function poseTarget(pose, prefer = app.selected) {
  const items = app.state.items.filter((i) => poseAccepts(pose, i));
  return (
    items.find((i) => i.id === prefer) ||
    items.find((i) => i.id === app.state.avatar.itemId) ||
    items[0] ||
    null
  );
}
export function setPose(pose, id) {
  const target = pose === 'standing' ? null : id || poseTarget(pose)?.id;
  const error = updateAvatar({ pose, enabled: true }, target);
  if (!error) {
    app.view.avatarBar = true;
    emit();
  }
  return error;
}
export function avatarHere() {
  return avatarLayout(app.state);
}
function avatarSentence() {
  const a = app.state.avatar,
    layout = avatarLayout(app.state);
  if (!a.enabled || !layout) return `키 ${a.height}cm 아바타를 숨겼어요.`;
  const where =
    layout.pose === 'standing'
      ? '방에 세웠어요'
      : `${layout.item.name}에 ${layout.pose === 'lying' ? '눕혔어요' : '앉혔어요'}`;
  return `키 ${a.height}cm 아바타를 ${where}.${layout.warnings[0] ? ` ${layout.warnings[0]}.` : ''}`;
}
// 방 위의 사람 버튼: 이 방에 아바타를 세우거나 숨긴다. 처음 세울 때는 대화에 키 도구를 함께 연다.
export function toggleAvatar() {
  if (avatarLayout(app.state)) return updateAvatar({ enabled: false });
  if (updateAvatar({ enabled: true, pose: 'standing' }, null)) return;
  app.selected = null;
  app.target = app.draft ? { type: 'draft' } : { type: 'room' };
  app.view.avatarBar = true;
  const last = [...app.thread].reverse().find((t) => t.surfaces?.length);
  if (last?.surfaces.some((x) => x.kind === 'avatar')) emit();
  else openTool('avatar');
}
export function pickAvatar() {
  app.selected = null;
  app.target = app.draft ? { type: 'draft' } : { type: 'room' };
  app.view.avatarBar = true;
  emit();
}
export function closeAvatarBar() {
  app.view.avatarBar = false;
  emit();
}
export function setScope(scope) {
  app.state.scope = scope === 'house' ? 'house' : 'room';
  app.selected = null;
  app.target = { type: 'room' };
  app.view.avatarBar = false;
  app.view.door = null;
  app.view.addSide = null;
  app.view.ghostRoom = null;
  commit();
}
export function editSpace(id) {
  if (id && id !== app.state.roomId) switchSpace(id);
  setScope('room');
}
export function moveSpace(id, x, z, opts = {}) {
  try {
    comparisonEdit((s) => ops.moveSpace(s, id, x, z, { snap: !opts.exact }), opts);
  } catch (e) {
    if (!opts.live) toast(e.message);
  }
}
// 대화로 받은 문 명령. 대상 문이 하나로 정해질 때만 바로 바꾸고, 아니면 집 전체 2D와 문 목록을 열어 고르게 한다.
function doorCommand({ action, width }) {
  app.view.doorList = true;
  const all = connections(spaces(app.state), app.state.floorplan),
    wanted = all.filter((l) => (action === 'open' ? l.closed : !l.closed)),
    here = wanted.filter((l) => l.ids.includes(app.state.roomId)),
    target = here.length === 1 ? here[0] : wanted.length === 1 ? wanted[0] : null;
  if (!all.length)
    return '아직 벽이 맞닿은 공간이 없어 문이 없어요. 집 전체에서 공간을 붙이면 그 사이에 문이 생겨요.';
  const show = () => {
    setScope('house');
    setView('2d');
  };
  if (!target || action === 'show' || (action === 'width' && !width)) {
    show();
    if (action === 'open' && !wanted.length) return '막아 둔 문이 없어요. 문은 모두 열려 있어요.';
    return target || action === 'show'
      ? '집 전체 2D를 열었어요. 문을 끌어 옮기고, 눌러서 폭과 여는 방향을 바꿀 수 있어요. 아래 문 목록에서 숫자로도 맞출 수 있어요.'
      : '문이 여러 개라 어느 문인지 알 수 없었어요. 집 전체 2D에서 문을 누르거나 아래 문 목록에서 골라 주세요.';
  }
  const [a, b] = target.ids,
    name = `${josa(target.names[0], '과/와')} ${target.names[1]} 사이 문`,
    patch =
      action === 'width'
        ? { width: width / 100 }
        : action === 'flip'
          ? { flip: !target.door.flip }
          : { closed: action === 'close' };
  comparisonEdit((s) => ops.setDoor(s, a, b, patch));
  app.view.door = null;
  show();
  if (action === 'width') return `${name}의 폭을 ${width}cm로 바꿨어요.`;
  if (action === 'flip') return `${name}이 반대쪽으로 열리게 바꿨어요.`;
  if (action === 'close')
    return `${josa(name, '을/를')} 막았어요. 아래 문 목록에서 다시 낼 수 있어요.`;
  return `${josa(name, '을/를')} 다시 냈어요.`;
}
// 문: 두 공간 사이 문의 위치·폭·여는 방향을 바꾸거나 막는다. 끄는 동안(live)은 기록을 남기지 않는다.
export function setDoor(a, b, patch, opts = {}) {
  try {
    comparisonEdit((s) => ops.setDoor(s, a, b, patch), opts);
    if (patch.closed) app.view.door = null;
  } catch (e) {
    if (!opts.live) toast(e.message);
    return e.message;
  }
}
export function closeDoor(a, b) {
  const names = [a, b].map((id) => spaces(app.state).find((r) => r.roomId === id)?.name);
  if (setDoor(a, b, { closed: true })) return;
  app.view.doorList = true;
  event(
    `${josa(names[0], '과/와')} ${names[1]} 사이 문을 막았어요 · 집 전체 도구의 문 목록에서 다시 낼 수 있어요`,
  );
  persist();
  emit();
}
// 집 전체 도구의 문 목록을 펼쳐 둘지. 문을 막거나 대화로 문을 말하면 펼친다.
export function setDoorList(open) {
  if (app.view.doorList === !!open) return;
  app.view.doorList = !!open;
  emit();
}
// 집 전체 2D에서 고른 문. 고르면 문 위에 폭·방향·막기 막대가 뜬다.
export function pickDoor(ids) {
  const next = ids ? [...ids] : null;
  if (!next && !app.view.door && !app.view.addSide) return;
  app.view.door = next;
  app.view.avatarBar = false;
  app.view.addSide = null;
  app.view.ghostRoom = null;
  emit();
}

export function attachBathroom() {
  try {
    comparisonEdit((s) => ops.attachBathroom(s));
    event('화장실을 방 옆에 붙였어요 · 연결 문과 설비는 위치를 가늠하기 위한 초안이에요');
    persist();
    emit();
  } catch (e) {
    toast(e.message);
  }
}

export function runSuggestion(sug) {
  if (sug.text) return send(sug.text);
  if (sug.action === 'place') return placeDraft(sug.label);
  if (sug.action === 'catalog') return openTool('catalog');
  if (sug.action === 'tool' && sug.arg) return openTool(sug.arg);
  if (sug.action === 'photo') return pickPhoto();
  if (sug.action === 'relocate') return relocate();
  if (sug.action === 'draft' && sug.arg) return createDraft(sug.arg, { via: 'photo' });
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
  push({
    role: 'user',
    text:
      via === 'photo' ? `${josa(TYPES[type].name, '으로/로')} 잡기` : `${TYPES[type].name} 고르기`,
    action: true,
  });
  if (via === 'photo') for (let i = 0; i < 3; i++) item.sources[i] = '사진 유형 · 기본값';
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
  app.view.addSide = null;
  app.view.ghostRoom = null;
  snapshot();
  ops.switchSpace(app.state, id);
  app.selected = null;
  app.target = app.draft ? { type: 'draft' } : { type: 'room' };
  spaceEvent();
  persist();
  emit();
}
// 벽의 + 손잡이로 공간을 붙이는 중인 벽과, 고르기 전에 도면에 미리 보여 줄 자리.
export function pickAddSide(side) {
  app.view.addSide = side || null;
  app.view.ghostRoom = null;
  app.view.door = null;
  emit();
}
export function previewSpace(type, side = app.view.addSide) {
  const size = type && side ? makeRoom(type) : null,
    at = size && ops.sideSlot(app.state, side, size);
  const next = at ? { type, x: at.x, z: at.z, w: size.w, d: size.d } : null;
  if (JSON.stringify(next) === JSON.stringify(app.view.ghostRoom)) return;
  app.view.ghostRoom = next;
  emit();
}
export const spaceSize = (type) => {
  const r = makeRoom(type);
  return `${r.w} × ${r.d}m`;
};
// 그 벽에 붙일 수 있는 공간 유형.
export function spaceFits(type, side) {
  return !!ops.sideSlot(app.state, side, makeRoom(type));
}
// 고르는 동안 도면이 미리 보기까지 담도록 비워 둘 자리: 그 벽에 붙일 수 있는 공간 중 가장 큰 가로·세로.
export function addReserve() {
  const side = app.view.addSide;
  if (!side || app.state.scope !== 'house') return null;
  const sizes = Object.keys(ROOM_TYPES)
    .map((type) => makeRoom(type))
    .filter((size) => ops.sideSlot(app.state, side, size));
  if (!sizes.length) return null;
  return {
    side,
    w: Math.max(...sizes.map((r) => r.w)),
    d: Math.max(...sizes.map((r) => r.d)),
  };
}
export function freeSides() {
  if (spaces(app.state).length >= 12) return [];
  const smallest = makeRoom('bathroom');
  return Object.keys(ops.SIDES).filter((side) => ops.sideSlot(app.state, side, smallest));
}
export function addSpace(type, { side = null } = {}) {
  try {
    const from = app.state.name;
    snapshot();
    ops.addSpace(app.state, type, side);
    app.state.name = `나의 ${ROOM_TYPES[type].name}`;
    app.selected = null;
    app.view.addSide = null;
    app.view.ghostRoom = null;
    app.target = app.draft ? { type: 'draft' } : { type: 'room' };
    push({
      role: 'user',
      text: side
        ? `${from} ${ops.SIDES[side]}에 ${ROOM_TYPES[type].name} 붙이기`
        : `${ROOM_TYPES[type].name} 추가`,
      action: true,
    });
    push({
      role: 'assistant',
      text: side
        ? `${josa(app.state.name, '을/를')} ${from} ${ops.SIDES[side]}에 붙였어요. 끌어서 옮길 수 있고, 크기를 알려주면 바로 맞출게요.`
        : `${josa(app.state.name, '을/를')} 새로 만들었어요. 크기를 알려주면 바로 맞출게요.`,
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
    const sc =
      app.state.view === '3d'
        ? app.scenes.three
        : app.state.scope === 'house'
          ? app.scenes.house
          : app.scenes.plan;
    const url = sc?.png(app.scenes.tags?.() || []);
    if (!url) throw Error('현재 화면을 저장하지 못했어요.');
    download(url, `${app.state.scope === 'house' ? '집 전체' : app.state.name}-배치.png`);
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
  // 사진 판별 모델을 처음 올릴 때만 아일랜드로 알린다. 이미 올라와 있으면 판별은 금방 끝난다.
  if (app.ai.vision !== 'ready' && !app.ai.download) {
    app.ai.download = {
      task: 'vision',
      phase: 'init',
      name: 'SigLIP base',
      cached: true,
      at: Date.now(),
    };
    app.view.downloadOpen = false;
  }
  app.ai.vision = 'loading';
  app.ai.label = '사진 판별 모델 준비 중';
  app.ai.progress = 0;
  visionFiles.clear();
  emit();
  try {
    const raw = await runAI('classify', { image: photo.data, device: app.ai.device });
    if (app.photo !== photo) return;
    const candidates = photoCandidates(raw?.scores);
    app.ai.vision = 'ready';
    finishDownload('vision');
    photo.analyzed = true;
    photo.device = raw?.device;
    photo.candidates = candidates;
    const top = candidates[0];
    const sure = !!top && top.p >= PHOTO_CONFIDENT;
    const pct = (c) => `${Math.round(c.p * 100)}%`;
    photo.type = sure ? top.type : null;
    if (sure) {
      const base = app.draft && app.draft.type === top.type ? app.draft : makeItem(top.type);
      const next = structuredClone(base);
      next.name = TYPES[top.type].name;
      for (let i = 0; i < 3; i++)
        if (!String(next.sources[i]).startsWith('사용자')) next.sources[i] = '사진 유형 · 기본값';
      app.draft = ops.sanitizeItem(next);
      app.target = { type: 'draft' };
      app.selected = null;
    }
    const names = candidates.map((c) => TYPES[c.type].name);
    push({
      role: 'assistant',
      engine: 'siglip',
      text: sure
        ? `사진은 ${josa(names[0], '으로/로')} 보여요. 그 유형의 기본 크기로 초안을 띄웠어요. 사진만으로는 실제 cm를 알 수 없으니 아는 치수를 알려주세요.`
        : top
          ? `사진만으로는 종류를 확신하기 어려워요. 가까운 후보는 ${josa(names.join(', '), '이에요/예요')}. 맞는 것을 눌러 주세요.`
          : '사진에서 가구 종류를 읽지 못했어요. 아래에서 종류를 골라 주세요.',
      photoScores:
        candidates.map((c) => `${TYPES[c.type].name} ${pct(c)}`).join(' · ') || undefined,
      surfaces: sure
        ? [{ kind: 'furniture-size', target: { type: 'draft', id: app.draft.id } }]
        : [{ kind: 'catalog', target: roomTarget() }],
      receipt: sure ? [{ label: '사진 판별', to: names[0], tag: `SigLIP ${pct(top)}` }] : [],
      suggestions: sure
        ? [
            { label: '방에 놓기', action: 'place', primary: true },
            ...candidates.slice(1).map((c) => ({
              label: `${josa(TYPES[c.type].name, '이었/였')}나요?`,
              action: 'draft',
              arg: c.type,
            })),
          ]
        : candidates.map((c, i) => ({
            label: `${josa(TYPES[c.type].name, '으로/로')} 잡기`,
            action: 'draft',
            arg: c.type,
            primary: i === 0,
          })),
    });
  } catch (e) {
    app.ai.vision = 'error';
    app.ai.error = explainLoadError(e.message);
    failDownload('vision', app.ai.error);
    toast(`사진 판별: ${app.ai.error}`);
  } finally {
    app.busy = null;
    // 사진을 바꾸거나 취소해 중간에 끝났으면 아일랜드에 준비 중이 남지 않게 지운다.
    if (app.ai.download?.task === 'vision' && ['init', 'fetch'].includes(app.ai.download.phase))
      app.ai.download = null;
    persist();
    emit();
  }
}

// ---------- 상담 모델 ----------
// 기본은 켜짐이다. 사용자가 끄면 이 기기에 기억하고, ?model=off는 이번 방문에만 끈다(테스트·데이터 절약).
const MODEL_PREF = 'room-ggu-model';
const MODEL_CHOICE = 'room-ggu-model-choice';
function offReason() {
  try {
    if (new URLSearchParams(location.search).get('model') === 'off') return 'url';
  } catch {}
  try {
    if (localStorage.getItem(MODEL_PREF) === 'off') return 'user';
  } catch {}
  if (globalThis.navigator?.connection?.saveData) return 'save-data';
  if (globalThis.navigator?.deviceMemory && navigator.deviceMemory < 4) return 'memory';
  return '';
}
export async function bootModel() {
  const why = offReason();
  if (why) {
    app.ai.text = 'off';
    app.ai.why = why;
    emit();
    return;
  }
  let adapter = null;
  try {
    adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
  } catch {}
  if (!adapter) {
    app.ai.text = 'unsupported';
    app.ai.error = 'WebGPU를 쓸 수 없는 브라우저예요.';
    emit();
    return;
  }
  loadText({ auto: true });
}
export async function loadText({ auto = false } = {}) {
  if (app.ai.text === 'loading' || app.ai.text === 'ready') return;
  const choice = textModel(app.ai.choice);
  app.ai.text = 'loading';
  app.ai.why = '';
  app.ai.label = '상담 모델 준비 중';
  app.ai.progress = 0;
  app.ai.error = '';
  // 위쪽 아일랜드에 준비 중임을 알린다. 보관해 둔 모델이면 접힌 채 잠깐 보이고, 새로 받으면 펼쳐진다.
  app.ai.download = {
    task: 'text',
    phase: 'init',
    name: choice.name,
    cached: true,
    at: Date.now(),
  };
  app.view.downloadOpen = false;
  emit();
  try {
    const model = await runAI('load-text', { choice: choice.key });
    if (app.ai.text !== 'loading') return;
    app.ai.text = 'ready';
    app.ai.model = model;
    finishDownload('text', modelName(model));
  } catch (e) {
    if (app.ai.text !== 'loading') return;
    // 브라우저나 GPU가 아예 지원하지 않을 때만 '쓸 수 없음'으로 둔다. 그 밖의 실패는 다시 시도할 수 있다.
    app.ai.text = /WebGPU를 지원하지|GPU를 찾지 못했|shader-f16/.test(e.message)
      ? 'unsupported'
      : 'error';
    app.ai.error = explainLoadError(e.message);
    failDownload('text', app.ai.error);
  } finally {
    emit();
  }
}
export function setModelOn(on) {
  try {
    if (on) localStorage.removeItem(MODEL_PREF);
    else localStorage.setItem(MODEL_PREF, 'off');
  } catch {}
  if (on) {
    app.ai.why = '';
    loadText();
    return;
  }
  unloadAI();
  app.ai.why = 'user';
  emit();
}
// 상담 모델을 바꾼다. 고른 모델을 기억하고, 켜져 있으면 내린 뒤 새 모델을 준비한다.
export function setModelChoice(key) {
  const next = textModel(key).key;
  if (next === app.ai.choice && (app.ai.text === 'ready' || app.ai.text === 'loading')) return;
  app.ai.choice = next;
  try {
    localStorage.setItem(MODEL_CHOICE, next);
    localStorage.removeItem(MODEL_PREF);
  } catch {}
  if (pending) interruptModel();
  app.modelSeq++;
  stopAI('상담 모델을 바꿔요.');
  app.busy = null;
  app.ai = {
    ...app.ai,
    text: 'off',
    vision: 'off',
    model: null,
    progress: 0,
    label: '',
    why: '',
    download: null,
  };
  loadText();
}
export function unloadAI() {
  if (pending) interruptModel();
  app.modelSeq++;
  stopAI('모델을 껐어요.');
  app.busy = null;
  app.ai = {
    ...app.ai,
    text: 'off',
    vision: 'off',
    model: null,
    progress: 0,
    label: '',
    download: null,
  };
  toast('모델을 껐어요. 규칙으로 계속 답해요.');
}

// ---------- 내려받기 안내 ----------
// 모델 파일을 실제로 내려받는 동안에는 다이얼로그로 알린다. 이미 보관한 모델을 불러올 때는 띄우지 않는다.
const visionFiles = new Map();
function trackDownload(task, patch) {
  const now = app.ai.download,
    // 준비만 하던 중에 실제로 받기 시작하면 새 내려받기로 본다.
    fresh =
      !now || now.task !== task || now.phase === 'done' || (patch.phase === 'fetch' && now.cached);
  if (fresh && patch.phase === 'fetch') {
    app.view.downloadOpen = true;
    app.view.downloadAuto = true;
  }
  const before = fresh ? {} : now;
  // 받은 양이 늘어난 시각을 적어 둔다. 오래 그대로면 화면에서 네트워크를 확인하라고 알린다.
  const moved = fresh || patch.phase !== before.phase || (patch.mb || 0) > (before.mb || 0);
  app.ai.download = { ...before, task, ...patch, at: moved ? Date.now() : before.at };
}
// 이어서 실패한 횟수. 다시 시도까지 잠깐 기다리게 해 끊긴 네트워크에 요청이 몰리지 않게 한다.
const downloadFailures = { text: 0, vision: 0 };
const RETRY_WAIT = [0, 3000, 6000, 12000];
function finishDownload(task, name) {
  downloadFailures[task] = 0;
  if (app.ai.download?.task !== task) return;
  // 준비가 끝나면 아일랜드가 잠깐 완료를 알리고 사라진다. 펼쳐 둔 채였으면 조금 더 둔다.
  const done = {
    ...app.ai.download,
    phase: 'done',
    progress: 1,
    name: name || app.ai.download.name,
  };
  app.ai.download = done;
  setTimeout(
    () => {
      if (app.ai.download === done) {
        app.ai.download = null;
        emit();
      }
    },
    app.view.downloadOpen ? 4200 : 2400,
  );
}
function failDownload(task, message) {
  if (app.ai.download?.task !== task) return;
  const attempts = ++downloadFailures[task];
  app.ai.download = {
    ...app.ai.download,
    phase: 'error',
    error: message,
    attempts,
    retryAt: Date.now() + RETRY_WAIT[Math.min(attempts, RETRY_WAIT.length) - 1],
  };
  app.view.downloadOpen = true;
}
export function setDownloadOpen(open) {
  app.view.downloadOpen = open;
  app.view.downloadAuto = false;
  emit();
}
export function closeDownload() {
  if (app.ai.download?.phase === 'error') downloadFailures[app.ai.download.task] = 0;
  app.ai.download = null;
  emit();
}
export function cancelDownload() {
  const task = app.ai.download?.task;
  if (task) downloadFailures[task] = 0;
  app.ai.download = null;
  if (task === 'vision') cancelModel();
  else setModelOn(false);
}
export function retryDownload() {
  const task = app.ai.download?.task;
  if (Date.now() < (app.ai.download?.retryAt || 0)) return;
  app.ai.download = null;
  if (task === 'vision') analyzePhoto();
  else setModelOn(true);
}

let lastProgressEmit = 0;
onAIStatus((data) => {
  // 준비하다 실패하면 Worker가 정리하면서 먼저 '내렸다'고 알린다. 그때 꺼짐으로 바꾸면 뒤따르는
  // 실패 이유를 놓치고 내려받기 안내가 멈춘 채 남으므로, 준비 중일 때는 loadText가 결과를 정하게 둔다.
  if (data.event === 'unloaded' && data.task === 'text' && app.ai.text !== 'loading') {
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
      const step = parseProgress(label);
      label =
        step.phase === 'fetch'
          ? '상담 모델 내려받는 중'
          : step.phase === 'cache'
            ? '보관해 둔 상담 모델을 불러오는 중'
            : '이 기기에 맞게 상담 모델을 준비하는 중';
      if (step.phase === 'fetch') {
        // 받은 양은 로더가 알려준 비율을 실제 파일 크기에 곱해 어림한다.
        const part = Number.isFinite(data.progress) ? data.progress : step.percent / 100,
          total = downloadSize(data.model) || textModel(app.ai.choice).downloadMB;
        trackDownload('text', {
          phase: 'fetch',
          name: data.model ? modelName(data.model) : textModel(app.ai.choice).name,
          mb: Math.round(part * total),
          totalMB: total,
          progress: part,
        });
      } else if (
        // 다 받은 뒤 오는 준비 단계에서만 '준비 중'으로 넘긴다. 로더의 시작 문장은 받기 전에도 오므로 무시한다.
        step.phase !== 'start' &&
        app.ai.download?.task === 'text' &&
        app.ai.download.phase === 'fetch' &&
        app.ai.download.progress > 0.9
      )
        trackDownload('text', { phase: 'init', progress: 1 });
    } else {
      // 사진 판별 모델은 파일마다 진행률이 따로 온다. 큰 파일을 실제로 받을 때만 알린다.
      if (data.file && Number.isFinite(data.total))
        visionFiles.set(data.file, { loaded: data.loaded || 0, total: data.total });
      const total = [...visionFiles.values()].reduce((n, f) => n + f.total, 0),
        loaded = [...visionFiles.values()].reduce((n, f) => n + f.loaded, 0);
      label = data.status === 'progress' ? '사진 판별 모델 내려받는 중' : '사진 판별 모델 준비 중';
      if (data.status === 'progress' && total > 20e6 && loaded < total)
        trackDownload('vision', {
          phase: 'fetch',
          name: 'SigLIP base',
          mb: Math.round(loaded / 1048576),
          totalMB: Math.round(total / 1048576),
          progress: loaded / total,
        });
      else if (app.ai.download?.task === 'vision' && total && loaded >= total)
        trackDownload('vision', { phase: 'init', progress: 1 });
    }
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
  pickAvatar: () => pickAvatar(),
  pickDoor: (ids) => pickDoor(ids),
  moveDoor: (ids, center) => setDoor(ids[0], ids[1], { center }, { live: true }),
  moveAvatar: (x, z) => {
    const mx = app.state.room.w / 2,
      mz = app.state.room.d / 2;
    ops.setAvatar(app.state, {
      x: Math.max(-mx, Math.min(mx, x)),
      z: Math.max(-mz, Math.min(mz, z)),
    });
    emit();
  },
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
    app.scenes.three?.setAvatar();
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
