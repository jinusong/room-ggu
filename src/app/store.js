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
import { purposeGroups } from './purpose.js';
import { offerFurniture, purposeDraft, planTurn } from './planner.js';
import {
  appliedSize,
  followupSize,
  namedEdit,
  photoCaption,
  requestedText,
} from './consult-context.js';
import { furnitureMentions } from '../estimator.js';
import { planFromModel } from './interpret.js';
import { detectRoomType } from '../room-consult.js';
import { photoCandidates, PHOTO_CONFIDENT } from './photo.js';
import { josa, dimsText } from './text.js';
import { parseComparisonCommand, avatarLayout, poseAccepts, standAt } from '../avatar.js';
import { connections } from '../floorplan.js';
import { designRequest, readDesign, templateDesign, THEMES } from './design.js';
import {
  TEXT_MODELS,
  DEFAULT_TEXT_MODEL,
  textModel,
  modelName,
  downloadSize,
  parseProgress,
  explainLoadError,
  modelMissing,
  handheld,
} from './models.js';
export { modelName, TEXT_MODELS };

export const KEY = 'room-ggu-v2';
export const THREAD_KEY = 'room-ggu-thread-v1';
const VISION_KEY = 'room-ggu-vision-device';
const ACTIONS = new Set([
  'place',
  'place-all',
  'catalog',
  'photo',
  'tool',
  'relocate',
  'clear-target',
  'confirm-use',
  'draft',
]);
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

// 저장본을 읽는다. v4 이하에서 온 것이면 화장실 설비·기본 이름·겹친 공간을 한 번 손본다.
function loadState(raw) {
  const state = validateState(raw);
  if (raw.version < 5) ops.migrateLegacy(state);
  return state;
}
let readError = false;
let initial = exampleState();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) initial = loadState(JSON.parse(raw));
} catch {
  readError = true;
}

export const app = {
  state: initial,
  thread: [],
  draft: null,
  // 한 문장에서 가구를 여럿 말했을 때 차례를 기다리는 초안. 앞의 초안을 놓으면 다음 것이 뜬다.
  queue: [],
  design: null,
  selected: null,
  target: { type: 'room' },
  photo: null,
  photoLoading: false,
  photoError: '',
  fileLoading: false,
  fileError: '',
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
    visionLabel: '',
    visionProgress: 0,
    visionError: '',
    // 내려받기 안내: task는 text|vision, phase는 connect|fetch|init|done|error.
    download: null,
    downloads: { text: null, vision: null },
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
    // 휴대 기기에서 모델을 받기 전에 띄우는 물음. { name, mb }
    modelAsk: null,
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
    app.view.saveStatus = '자동 저장 불가, 파일로 저장해 주세요';
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
    if (t.spaceRequest) turn.spaceRequest = cleanText(t.spaceRequest, 1500);
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
        photoId: cleanText(s?.photoId, 40) || undefined,
        primary: !!s?.primary,
      }))
      .filter((s) => s.label && (s.text || s.action));
    const rec = t.confirmation || t.recommendation;
    if (rec && Array.isArray(rec.types) && typeof rec.text === 'string') {
      const types = [
        ...new Set(rec.types.filter((k) => typeof k === 'string' && Object.hasOwn(TYPES, k))),
      ].slice(0, 3);
      if (types.length) {
        const saved = { types, text: cleanText(rec.text, 1500) };
        if (!t.confirmation) turn.recommendation = saved;
        else if (
          Object.hasOwn(purposeGroups, rec.activity) &&
          types.every((k) => purposeGroups[rec.activity].includes(k))
        )
          turn.confirmation = { ...saved, activity: rec.activity };
      }
    }
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
    localStorage.setItem(
      THREAD_KEY,
      JSON.stringify({ turns, draft: app.draft, queue: app.queue, design: app.design }),
    );
  } catch {}
}
try {
  const raw = JSON.parse(localStorage.getItem(THREAD_KEY) || 'null');
  if (raw && Array.isArray(raw.turns))
    app.thread = raw.turns.slice(-MAX_TURNS).map(sanitizeTurn).filter(Boolean);
  if (raw?.draft) app.draft = ops.sanitizeItem(raw.draft);
  if (app.draft && Array.isArray(raw?.queue))
    app.queue = raw.queue.slice(0, 23).map(ops.sanitizeItem);
  try {
    if (
      raw?.design &&
      Object.hasOwn(THEMES, raw.design.theme) &&
      typeof raw.design.surfaceId === 'string' &&
      typeof raw.design.base === 'string' &&
      raw.design.base.length < 300000
    ) {
      app.design = {
        surfaceId: raw.design.surfaceId.slice(0, 100),
        base: raw.design.base,
        theme: raw.design.theme,
        mode: raw.design.mode === 'theme' ? 'theme' : 'house',
        state: validateState(raw.design.state),
        applied: !!raw.design.applied,
        omitted: Array.isArray(raw.design.omitted)
          ? raw.design.omitted.slice(0, 120).map((x) => cleanText(x, 100))
          : [],
        skipped: Array.isArray(raw.design.skipped)
          ? raw.design.skipped.slice(0, 12).map((x) => cleanText(x, 40))
          : [],
      };
    }
  } catch {
    app.design = null;
  }
} catch {
  app.thread = [];
  app.queue = [];
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
  if (app.design) {
    if (designBase() === app.design.base) app.design.applied = false;
    else if (designBase() === designBase(app.design.state)) app.design.applied = true;
  }
  if (!app.state.items.some((a) => a.id === app.selected)) {
    app.selected = null;
    if (app.target.type === 'item') app.target = app.draft ? { type: 'draft' } : { type: 'room' };
  }
  if (roomBefore !== app.state.roomId) spaceEvent();
}
// 되돌리기 전후를 비교해 무엇이 바뀌었는지 한두 마디로 말한다. "방금 바꾼 내용"만으로는 무엇이 사라졌는지 알기 어렵다.
export function describeRestore(before, after) {
  const rooms = (st) => new Map(spaces(st).map((r) => [r.roomId, r])),
    was = rooms(before),
    now = rooms(after),
    names = (list) => {
      const out = list.slice(0, 2).join(', ');
      return list.length > 2 ? `${out} 외 ${list.length - 2}개` : out;
    },
    gone = [],
    back = [],
    changed = [],
    lines = [];
  for (const [id, r] of was) if (!now.has(id)) lines.push(`${josa(r.name, '이/가')} 없어졌어요.`);
  for (const [id, r] of now)
    if (!was.has(id)) lines.push(`${josa(r.name, '이/가')} 다시 생겼어요.`);
  for (const [id, r] of now) {
    const old = was.get(id);
    if (!old) continue;
    const a = old.room,
      b = r.room;
    if (a.type !== b.type || a.w !== b.w || a.d !== b.d || a.h !== b.h)
      lines.push(`${r.name} 크기와 유형을 ${a.w} × ${a.d}m에서 ${b.w} × ${b.d}m로 되돌렸어요.`);
    else if (a.wallColor !== b.wallColor || a.floorColor !== b.floorColor)
      lines.push(`${r.name} 벽과 바닥 색을 되돌렸어요.`);
    // 저장 형식의 키 순서는 되살릴 때 달라질 수 있어 보이는 값만 비교한다.
    const look = (i) => JSON.stringify([i.type, i.name, i.dims, i.x, i.z, i.angle, i.color]),
      items = new Map(old.items.map((i) => [i.id, i]));
    for (const i of r.items) {
      const o = items.get(i.id);
      if (!o) back.push(nameOf(i));
      else if (look(o) !== look(i)) changed.push(nameOf(i));
      items.delete(i.id);
    }
    for (const o of items.values()) gone.push(nameOf(o));
  }
  if (gone.length) lines.push(`${josa(names(gone), '이/가')} 빠졌어요.`);
  if (back.length) lines.push(`${josa(names(back), '이/가')} 다시 놓였어요.`);
  if (changed.length) lines.push(`${names(changed)} 크기와 자리를 되돌렸어요.`);
  return lines.slice(0, 3).join(' ');
}
// opts.quiet: 대화에서 부른 되돌리기는 답 문장에 결과를 쓰므로 알림을 띄우지 않는다.
// 단추의 onClick으로 불리면 첫 인자가 이벤트라 quiet가 아니다.
export function undo(opts) {
  if (finishWindowGesture(true)) return true;
  if (!app.history.length) return false;
  const before = structuredClone(app.state);
  app.future.push(JSON.stringify(app.state));
  restore(app.history.pop());
  const said = describeRestore(before, app.state) || '바뀐 내용이 없어요.';
  if (opts?.quiet !== true) toast(`되돌렸어요. ${said}`);
  persist();
  emit();
  return said;
}
export function redo(opts) {
  if (finishWindowGesture(true)) return true;
  if (!app.future.length) return false;
  const before = structuredClone(app.state);
  app.history.push(JSON.stringify(app.state));
  restore(app.future.pop());
  const said = describeRestore(before, app.state) || '바뀐 내용이 없어요.';
  if (opts?.quiet !== true) toast(`다시 적용했어요. ${said}`);
  persist();
  emit();
  return said;
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
let roomEpoch = 0;
function spaceEvent() {
  roomEpoch++;
  const r = app.state.room;
  event(`${app.state.name}: ${ROOM_TYPES[r.type].name} ${r.w} × ${r.d}m`);
}
export function clearThread() {
  if (pending) {
    app.modelSeq++;
    pending = null;
    interruptAI();
  }
  if (app.busy?.kind === 'model') app.busy = null;
  if (app.busy?.kind === 'vision') cancelModel();
  app.thread = [];
  app.design = null;
  app.draft = null;
  app.queue = [];
  app.photo = null;
  photoReadSeq++;
  app.photoLoading = false;
  app.photoError = '';
  fileReadSeq++;
  app.fileLoading = false;
  app.fileError = '';
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
  const { item, free } = placeOne(d);
  turn.receipt.push({
    label: '배치',
    to: `${item.name} ${dimsText(item.dims)}cm`,
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
  // 기다리던 초안이 있으면 이어서 띄운다. 대상도 새 초안으로 옮긴다.
  const next = app.queue.shift();
  if (next) {
    app.draft = next;
    app.selected = null;
    app.target = { type: 'draft' };
    turn.text = free
      ? `${josa(item.name, '을/를')} 방에 놓았어요. 이어서 ${nameOf(next)} 초안을 띄웠어요.`
      : `${josa(item.name, '을/를')} 놓았지만 빈자리가 없어 다른 가구와 겹쳐요. 이어서 ${nameOf(next)} 초안을 띄웠어요.`;
    turn.receipt.push({ label: '새 초안', to: `${nameOf(next)} ${dimsText(next.dims)}cm` });
    turn.surfaces.push({ kind: 'furniture-size', target: { type: 'draft', id: next.id } });
    turn.suggestions = [
      { label: '방에 놓기', action: 'place', primary: true },
      ...(app.queue.length ? [{ label: '남은 가구 모두 놓기', action: 'place-all' }] : []),
      { label: '다른 가구', action: 'catalog' },
    ];
  }
}
// 초안 하나를 방에 놓고, 그 초안을 다루던 도구가 놓인 가구를 계속 다루게 한다.
function placeOne(d) {
  const placed = ops.placeItem(app.state, d);
  linkPlacedDraft(d, placed.item);
  return placed;
}
function linkPlacedDraft(d, item) {
  if (app.draft?.id === d.id) app.draft = null;
  for (const t of app.thread)
    for (const s of t.surfaces || [])
      if (s.target?.type === 'draft' && (!s.target.id || s.target.id === d.id))
        s.target = { type: 'item', id: item.id };
  app.selected = item.id;
  app.target = { type: 'item', id: item.id };
}
// 전체가 들어가는지 먼저 검사한다. 실패하면 배치와 실행 취소 기록을 보존한다.
function placeBatch(state, list) {
  if (state.items.length + list.length > ops.MAX_ITEMS)
    throw Error('한 방에 가구 100개까지 놓을 수 있어요. 가구를 빼거나 나눠 놓아 주세요.');
  const staged = { ...state, items: [...state.items] };
  const placed = list.map((d) => ops.placeItem(staged, d));
  const blocked = placed.filter(({ free }) => !free).length;
  if (blocked)
    throw Error(
      `${blocked}개가 들어갈 빈자리가 없어요. 크기를 줄이거나 들어가는 가구만 하나씩 놓아 주세요.`,
    );
  return placed;
}
// 지금 초안과 기다리는 초안을 한꺼번에 놓는다. 되돌리기 한 번으로 모두 물린다.
function placeAllInto(turn) {
  const list = [app.draft, ...app.queue].filter(Boolean);
  if (!list.length) return placeDraftInto(turn);
  const placed = placeBatch(app.state, list);
  snapshot();
  app.state.items.push(...placed.map(({ item }) => item));
  const names = [];
  for (const [i, { item }] of placed.entries()) {
    linkPlacedDraft(list[i], item);
    names.push(item.name);
    turn.receipt.push({ label: '배치', to: `${item.name} ${dimsText(item.dims)}cm` });
  }
  app.draft = null;
  app.queue = [];
  const all = names.map((n, i) => (i < names.length - 1 ? josa(n, '과/와') : n)).join(' ');
  turn.text = `${josa(all, '을/를')} 방에 놓았어요. 도면에서 끌어 옮기거나 회전할 수 있어요.`;
  turn.suggestions = [
    { label: '가구 목록', action: 'tool', arg: 'items' },
    { label: '다른 가구', action: 'catalog' },
  ];
}

function runAction(action, arg, turn) {
  const s = app.state;
  // 문장에 적은 가구(arg.id)가 있으면 그 가구, 아니면 고른 가구에 한다.
  const item = (arg?.id && s.items.find((a) => a.id === arg.id)) || subject();
  switch (action) {
    case 'undo': {
      const said = undo({ quiet: true });
      turn.text = !said
        ? '되돌릴 내용이 없어요.'
        : typeof said === 'string'
          ? `되돌렸어요. ${said}`
          : turn.text;
      break;
    }
    case 'redo': {
      const said = redo({ quiet: true });
      turn.text = !said
        ? '다시 적용할 내용이 없어요.'
        : typeof said === 'string'
          ? `다시 적용했어요. ${said}`
          : turn.text;
      break;
    }
    case 'furnish-room': {
      const next = structuredClone(s);
      ops.switchSpace(next, arg.roomId);
      const placed = placeBatch(
        next,
        arg.types.map((type) => makeItem(type)),
      );
      snapshot();
      if (arg.roomId !== s.roomId) {
        app.selected = null;
        app.target = app.draft ? { type: 'draft' } : { type: 'room' };
      }
      next.items.push(...placed.map(({ item }) => item));
      Object.assign(s, next, { scope: 'room' });
      turn.roomId = s.roomId;
      for (const { item } of placed)
        turn.receipt.push({ label: '배치', to: TYPES[item.type].name });
      turn.text = `${s.name}에 ${josa(placed.map(({ item }) => TYPES[item.type].name).join(', '), '을/를')} 놓았어요.`;
      turn.surfaces.push({ kind: 'items', target: roomTarget() });
      break;
    }
    case 'focus-item': {
      const room = spaces(s).find((r) => r.roomId === arg.roomId);
      const item = room?.items.find((i) => i.id === arg.id);
      if (!item) throw Error('그 가구를 찾지 못했어요.');
      if (s.roomId !== room.roomId) switchSpace(room.roomId);
      s.scope = 'room';
      app.selected = item.id;
      app.target = { type: 'item', id: item.id };
      turn.roomId = s.roomId;
      turn.text = `${room.name}에서 ${josa(nameOf(item), '을/를')} 골랐어요. 바꿀 치수를 말해 주세요.`;
      turn.surfaces.push({ kind: 'furniture-dims', target: { type: 'item', id: item.id } });
      break;
    }
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
      // 겹친 것이 공간일 수도, 가구일 수도 있다. 공간부터 떼어 놓고 가구를 정리한다.
      const sp = ops.separateSpaces(s),
        r = ops.relocateConflicts(s),
        lines = [],
        both = (names) =>
          [...new Set(names)].map((n, i, a) => (i < a.length - 1 ? josa(n, '과/와') : n)).join(' ');
      if (sp.overlapped.length)
        lines.push(
          sp.remaining
            ? `${josa(both(sp.overlapped), '이/가')} 겹쳐 있는데 옮길 자리를 찾지 못했어요. 집 전체 2D에서 끌어 떼어 주세요.`
            : `${josa(both(sp.overlapped), '이/가')} 겹쳐 있었어요. ${josa(both(sp.moved), '을/를')} 겹치지 않게 옆으로 옮겼어요.`,
        );
      if (r.moved)
        lines.push(
          `가구 ${r.moved}개를 빈자리로 옮겼어요.${r.remaining ? ` ${r.remaining}개는 방보다 크거나 자리가 없어 그대로 두었어요.` : ''}`,
        );
      else if (r.remaining)
        lines.push('옮길 빈자리가 없어요. 가구 크기를 줄이거나 방을 넓혀 주세요.');
      else if (!sp.overlapped.length)
        lines.push('겹치거나 벽을 넘는 가구, 문이나 창 앞을 가리는 가구가 없어요.');
      turn.text = lines.join(' ');
      if (sp.moved.length)
        turn.receipt.push({ label: '집 배치', to: `${sp.moved.length}개 공간 이동` });
      if (r.moved) turn.receipt.push({ label: '자리 정리', to: `${r.moved}개 이동` });
      turn.surfaces.push({ kind: 'impact', target: roomTarget() });
      break;
    }
    case 'rotate-space': {
      snapshot();
      const r = ops.rotateSpace(s, arg?.id || s.roomId);
      turn.text = `${josa(r.name, '을/를')} 오른쪽으로 90° 돌렸어요. 이제 가로 ${r.w}m, 세로 ${r.d}m이고 가구도 함께 돌렸어요.${r.moved.length ? ' 옆 공간은 겹치지 않게 옮겼어요.' : ''}`;
      turn.receipt.push({ label: '방 돌리기', from: `${r.d} × ${r.w}m`, to: `${r.w} × ${r.d}m` });
      turn.suggestions = [
        { label: '한 번 더 돌리기', text: `${r.name} 돌려줘` },
        { label: '되돌리기', text: '되돌려줘' },
      ];
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
      turn.suggestions = [
        { label: '가구 고르기', action: 'catalog' },
        ...(s.otherRooms.length ? [{ label: '공간 정리', action: 'tool', arg: 'spaces' }] : []),
      ];
      break;
    }
    case 'example':
      snapshot();
      ops.loadExample(s);
      app.selected = null;
      turn.text = '예시 방을 불러왔어요. 침대, 책상, 의자, 책장이 놓여 있어요.';
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
      // 고르지 않은 가구를 뺐으면 고른 가구는 그대로 둔다.
      if (app.selected === item.id || app.target?.id === item.id) {
        app.selected = null;
        app.target = app.draft ? { type: 'draft' } : { type: 'room' };
      }
      turn.text = `${josa(nameOf(item), '을/를')} 뺐어요. 되돌리기로 다시 놓을 수 있어요.`;
      turn.receipt.push({ label: '삭제', to: nameOf(item) });
      break;
    case 'place':
      placeDraftInto(turn);
      break;
    case 'place-all':
      placeAllInto(turn);
      break;
  }
}

function applyPlan(plan, turn) {
  if (plan.action) return runAction(plan.action, plan.arg, turn);
  const c = plan.changes || {};
  const s = app.state;
  const remote =
    plan.destination &&
    plan.destination !== s.roomId &&
    (c.room ||
      c.item ||
      c.draft ||
      plan.ask === 'item' ||
      plan.recommendation ||
      plan.confirmation);
  const staged = remote ? structuredClone(s) : null;
  if (staged) ops.switchSpace(staged, plan.destination);
  let roomRows, itemRows;
  // 방 이동과 편집을 함께 검증하고 성공한 배치에만 한 번의 실행 취소를 남긴다.
  if (staged) {
    if (c.room && !c.addSpace) roomRows = ops.setRoom(staged, c.room);
    if (c.item) itemRows = ops.updateItem(staged, c.item.id, c.item.next);
    if (c.draft) ops.sanitizeItem(c.draft);
    snapshot();
    Object.assign(s, staged);
    app.selected = null;
    app.target = { type: 'room' };
    if (plan.ask !== 'item' && !plan.recommendation && !plan.confirmation) {
      app.draft = null;
      app.queue = [];
    }
    s.scope = 'room';
    turn.roomId = s.roomId;
    turn.receipt.push({ label: '대상 공간', to: s.name });
  }
  if (c.addSpace) {
    snapshot();
    // "화장실 옆에"처럼 기준 공간을 말했으면 그 공간의 벽에, 아니면 지금 방의 벽에 붙인다.
    const near = c.near || null;
    ops.addSpace(s, c.addSpace, near?.side || null, {
      room: c.room,
      anchor: near?.roomId || null,
      strict: false,
      label: c.label || null,
    });
    app.selected = null;
    app.target = app.draft ? { type: 'draft' } : { type: 'room' };
    const at = ops.attachedTo(s, s.roomId, near?.roomId || null),
      where = at ? `${at.name} ${ops.SIDES[at.side]}` : '';
    turn.receipt.push({ label: '새 공간', to: s.name });
    if (where) turn.receipt.push({ label: '자리', to: where });
    turn.receipt.push({ label: '크기', to: `${s.room.w} × ${s.room.d} × ${s.room.h}m` });
    // 모델이 쓴 답이 아니면, 실제로 붙은 자리를 넣어 앱이 답을 쓴다.
    if (plan.replyBy !== 'model' && plan.intent !== 'compound') {
      const lines = [];
      if (near?.missing)
        lines.push(`${josa(near.missing, '이/가')} 아직 없어서 지금 방을 기준으로 잡았어요.`);
      else if (near?.side && at && at.side !== near.side)
        lines.push(`${ops.SIDES[near.side]}에는 자리가 없어 다른 벽에 붙였어요.`);
      lines.push(
        where
          ? `${where}에 ${josa(s.name, '을/를')} 붙였어요.`
          : `${josa(s.name, '을/를')} 새로 만들었어요.`,
        `가로 ${s.room.w}m, 세로 ${s.room.d}m예요. 크기를 알려주면 바로 맞출게요.`,
      );
      turn.text = lines.join(' ');
    }
  } else if (c.room) {
    if (!staged) {
      snapshot();
      if (c.room.wallColor !== s.room.wallColor || c.room.floorColor !== s.room.floorColor)
        rememberFinish(s.room);
    }
    turn.receipt.push(...(roomRows || ops.setRoom(s, c.room)));
  }
  if (c.item) {
    if (!staged) snapshot();
    turn.receipt.push(...(itemRows || ops.updateItem(s, c.item.id, c.item.next)));
    // 이름으로 고친 가구를 다음 말의 대상으로 이어 준다. 답을 기다리며 새로 고른 대상은 유지한다.
    const sameTarget = (a, b) => a?.type === b?.type && a?.id === b?.id && a?.roomId === b?.roomId;
    if (staged || !plan.sourceTarget || sameTarget(app.target, plan.sourceTarget)) {
      app.selected = c.item.id;
      app.target = { type: 'item', id: c.item.id };
    }
  }
  if (c.draft) {
    const before = app.draft;
    app.draft = ops.sanitizeItem(c.draft);
    app.target = { type: 'draft' };
    app.selected = null;
    if (plan.mode === 'new' || !before)
      turn.receipt.push({
        label: '새 초안',
        to: `${TYPES[app.draft.type].name} ${dimsText(app.draft.dims)}cm`,
      });
    else turn.receipt.push(...ops.diffItem(before, app.draft).map((r) => ({ ...r, tag: '초안' })));
    // 새 초안을 잡으면 예전에 기다리던 초안은 버리고, 이번에 함께 말한 가구만 차례로 둔다.
    if (plan.mode === 'new' || c.queue)
      app.queue = (c.queue || []).slice(0, 23).map(ops.sanitizeItem);
    for (const q of c.queue ? app.queue : [])
      turn.receipt.push({
        label: '다음 초안',
        to: `${TYPES[q.type].name} ${dimsText(q.dims)}cm`,
      });
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
// said는 이번 문장 앞의 사용자 말이다. "왜 화장실로 만들어?" 같은 말이 가리키는 앞 요청을 찾을 때 쓴다.
function context() {
  const said = app.thread
    .filter((t) => t.role === 'user' && !t.action && t.text)
    .slice(-5, -1)
    .map((t) => t.text);
  return { state: app.state, target: app.target, draft: app.draft, queue: app.queue, said };
}
function modelContext(ctx) {
  const { state, target: selected, draft } = ctx;
  const s = selected.type === 'item' ? state.items.find((i) => i.id === selected.id) : draft;
  const r = state.room;
  const target =
    selected.type === 'item' && s
      ? `선택한 가구 ${s.name}(${s.type})`
      : selected.type === 'draft' && s
        ? `방에 놓기 전 초안 ${s.name}(${s.type})`
        : '방';
  return {
    target: s && selected.type !== 'room' ? `${target} ${dimsText(s.dims)}cm` : target,
    furniture: [...new Set(state.items.map((i) => TYPES[i.type].name))].slice(0, 12),
    room: `${state.name} · ${ROOM_TYPES[r.type].name} 가로 ${r.w}m 세로 ${r.d}m 천장 ${r.h}m · 놓인 가구 ${state.items.length}개${draft ? ` · 초안 ${draft.name}` : ''}`,
    photo:
      app.photo?.analyzed &&
      app.photo.roomId === state.roomId &&
      selected.type === 'draft' &&
      app.photo.draftId === draft?.id
        ? `사진 분류 후보: ${(app.photo.candidates || []).map((c) => TYPES[c.type].name).join(', ')}. 현재 고른 초안: ${draft?.name || '없음'}. 사진 자체나 실제 치수는 제공되지 않음.`
        : undefined,
    spaces: spaces(state)
      .filter((x) => x.roomId !== state.roomId)
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

const measurements = new WeakMap();
function finishTurn(turn, plan, meta) {
  Object.assign(turn, {
    text: [turn.photoIntro, plan.reply].filter(Boolean).join(' '),
    surfaces: (plan.surfaces || []).map((s) => ({ id: turnId(), ...s })),
    suggestions: plan.suggestions || [],
    status: 'done',
    ...meta,
  });
  if (plan.spaceRequest) turn.spaceRequest = plan.spaceRequest;
  if (plan.recommendation) turn.recommendation = plan.recommendation;
  if (plan.confirmation) turn.confirmation = plan.confirmation;
  if (plan.note) turn.note = plan.note;
  try {
    if (!plan.error) {
      applyPlan(plan, turn);
      const m = plan.measureText && appliedSize(plan.measureText, plan, app);
      if (m) measurements.set(turn, m);
    } else turn.tone = 'error';
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
  if ((!text && !pendingPhoto) || app.busy || app.photoLoading || app.fileLoading) return;
  const last = app.thread.at(-1);
  if (!pendingPhoto && last?.confirmation && /^(?:네|응|그래|맞아(?:요)?)[.!]?$/.test(text))
    return confirmFurnitureUse(last);
  const recSurface = last?.surfaces?.find((s) => s.kind === 'recommendations');
  if (recSurface && !pendingPhoto) {
    const rec = recommendationFor(recSurface.id);
    const ordinal = text.match(
      /^(첫|두|세|[123])\s*(?:번째|번|째)(?:로|로 할게|로 해줘|요)?[.!]?$/,
    );
    const index = ordinal && { 첫: 0, 두: 1, 세: 2, 1: 0, 2: 1, 3: 2 }[ordinal[1]];
    const choice =
      rec?.active && (ordinal ? rec.types[index] : rec.types.find((k) => text === TYPES[k].name));
    if (choice) return chooseRecommendation(recSurface.id, choice);
    if (rec?.active && ordinal) {
      push({ role: 'user', text });
      finishTurn(
        push({ role: 'assistant', text: '' }),
        {
          reply: `후보가 ${rec.types.length}개예요. 아래에서 하나 골라 주세요.`,
          recommendation: { types: rec.types, text: rec.text },
          surfaces: [{ kind: 'recommendations', target: { type: 'room' } }],
        },
        { engine: 'app' },
      );
      return;
    }
  }
  const history = historyForModel();
  push({ role: 'user', text, ...(pendingPhoto ? { photo: pendingPhoto.data } : {}) });
  const turn = push({ role: 'assistant', text: '' });
  let extra = [];
  if (pendingPhoto) {
    pendingPhoto.sent = true;
    pendingPhoto.surfaceId = turnId();
    extra = [{ id: pendingPhoto.surfaceId, kind: 'photo', target: { type: 'room' } }];
  }
  if (pendingPhoto) {
    pendingPhoto.caption = text;
    pendingPhoto.captionPending = !!text;
    pendingPhoto.roomId = app.state.roomId;
    pendingPhoto.history = history;
    const auto =
      app.ai.vision === 'ready' ||
      (!['user', 'url', 'later', 'ask'].includes(app.ai.why) && !handheld());
    finishTurn(
      turn,
      {
        reply: auto
          ? `사진을 받았어요. 가구 종류를 확인할게요.${text ? ' 함께 보낸 설명도 반영해요.' : ''}`
          : `사진을 받았어요. 아래에서 사진 판별을 시작하거나 종류를 직접 골라 주세요.${text ? ' 고른 종류에 설명도 반영해요.' : ''}`,
        surfaces: extra,
      },
      { engine: 'app' },
    );
    if (auto) await analyzePhoto();
    return;
  }
  if (last?.spaceRequest && last.roomId === app.state.roomId) {
    const name = text.replace(/(?:으로|로)?(?:\s*해\s*줘|요)?[.!]?$/u, '').trim();
    const type = detectRoomType(name);
    if (type && (ROOM_TYPES[type].name === name || ['안방', '욕실', '부엌'].includes(name)))
      return respondToText(
        `${last.spaceRequest}. 거기는 ${ROOM_TYPES[type].name}임`,
        turn,
        history,
        extra,
      );
  }
  return respondToText(text, turn, history, extra);
}

async function respondToText(text, turn, history, extra = []) {
  if (
    app.design &&
    /^(?:이대로\s*)?(?:초안\s*|집\s*전체\s*)?(?:적용|반영)(?:해\s*줘|해줘|해|하자|할게|해요)?[.!]?$/u.test(
      text.trim(),
    )
  ) {
    const error = applyDesign();
    finishTurn(
      turn,
      {
        reply: error || '초안을 적용했어요. 방 이름표를 눌러 들어가거나 가구를 끌어 다듬어 보세요.',
        surfaces: [{ kind: 'floorplan', target: { type: 'room' } }],
      },
      { engine: 'app' },
    );
    return;
  }
  if (
    /창문|창호/.test(text) &&
    !/(?:창문|창호)\s*(?:바로\s*)?(?:옆|앞|아래|밑|맞은편|근처)/.test(text)
  ) {
    finishTurn(
      turn,
      {
        reply: '창문은 아래 도구에서 벽과 치수, 위치를 정해 주세요.',
        surfaces: [{ kind: 'windows', target: roomTarget() }],
      },
      { engine: 'app' },
    );
    return;
  }
  const design = designRequest(text);
  if (design) return respondToDesign(design, turn);
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
  const original = text;
  text = requestedText(text, app.state);
  const named = namedEdit(text, app.state);
  if (named?.focusType) {
    const hits = named.room.items.filter((i) => i.type === named.focusType);
    const plan =
      hits.length === 1
        ? { action: 'focus-item', arg: { roomId: named.room.roomId, id: hits[0].id }, surfaces: [] }
        : {
            reply: hits.length
              ? `${named.room.name}에 ${josa(TYPES[named.focusType].name, '이/가')} ${hits.length}개 있어요. 그 방의 도면에서 하나를 골라 주세요.`
              : `${named.room.name}에 ${josa(TYPES[named.focusType].name, '이/가')} 없어요.`,
            surfaces: [],
          };
    finishTurn(turn, plan, { engine: 'app' });
    return;
  }
  const ctx = context();
  if (named?.room) {
    text = named.text;
    if (named.room.roomId !== app.state.roomId) {
      ctx.state = structuredClone(app.state);
      ops.switchSpace(ctx.state, named.room.roomId);
      Object.assign(ctx, { target: { type: 'room' }, draft: null, queue: [] });
    } else if (ctx.target.type === 'draft') {
      Object.assign(ctx, { target: { type: 'room' }, draft: null, queue: [] });
    }
  }
  const previous = app.thread.findLast(
    (t) => t !== turn && t.role === 'assistant' && t.status === 'done',
  );
  const followup = followupSize(text, ctx, named?.room ? null : measurements.get(previous));
  text = followup.text;
  ctx.guard = named?.guard || followup.guard;
  const wrap = (plan) =>
    withPhoto(
      {
        ...plan,
        sourceTarget: app.target,
        destination: named?.room?.roomId,
        measureText: text,
      },
      extra,
    );
  if (app.ai.text !== 'ready') {
    finishTurn(turn, wrap(planTurn(text, ctx)), { engine: 'rule', fallback: fallbackReason() });
    return;
  }
  const version = ++app.modelSeq;
  const turnContext = structuredClone(ctx);
  const submittedTarget = structuredClone(app.target);
  const base = consultationBase(),
    epoch = roomEpoch;
  const stale = () => epoch !== roomEpoch || base !== consultationBase();
  turn.status = 'thinking';
  turn.engine = engineName();
  app.busy = { kind: 'model', turnId: turn.id };
  pending = { version, turn };
  emit();
  let plan, meta, timer;
  try {
    const raw = await Promise.race([
      runAI('interpret', { text, history, context: modelContext(turnContext) }),
      new Promise(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(Object.assign(Error('모델 답이 늦어요.'), { timeout: true })),
            MODEL_TIMEOUT,
          )),
      ),
    ]);
    if (version !== app.modelSeq) return;
    if (stale())
      throw Object.assign(Error('상담 중에 배치가 바뀌었어요. 지금 상태에서 다시 말해 주세요.'), {
        stale: true,
      });
    plan = planFromModel(raw, text, turnContext);
    if (plan.fallback) {
      meta = { engine: 'rule', fallback: plan.fallback };
      plan = planTurn(text, turnContext);
    } else {
      const fixes = plan.fixes || [];
      if (text !== original) fixes.unshift('문장에서 지정한 대상과 직전 치수를 반영');
      meta = { engine: engineName(), fixes };
    }
  } catch (e) {
    if (version !== app.modelSeq) return;
    if (e.timeout) interruptAI();
    if (e.stale || stale()) {
      plan = {
        reply: '상담 중에 배치가 바뀌었어요. 지금 상태에서 다시 말해 주세요.',
        surfaces: [],
      };
      meta = { engine: 'app' };
    } else {
      meta = {
        engine: 'rule',
        fallback: e.timeout ? 'timeout' : 'invalid',
        note: e.timeout ? undefined : `모델 답을 쓰지 못했어요: ${e.message}`,
      };
      plan = planTurn(text, turnContext);
    }
  } finally {
    clearTimeout(timer);
  }
  pending = null;
  app.busy = null;
  finishTurn(turn, { ...wrap(plan), sourceTarget: submittedTarget }, meta);
}

// 보기 옵션이나 선택 표시가 달라져도 요청 당시의 가구를 다룬다. 방 전환과 배치 편집은 만료시킨다.
const consultationBase = () => {
  const { roomId, room, items, otherRooms, floorplan, avatar } = app.state;
  return JSON.stringify([roomId, room, items, otherRooms, floorplan, avatar, app.draft, app.queue]);
};

// 보기 전환은 초안을 만료시키지 않는다. 방·가구·문을 실제로 편집했을 때만 다시 상담한다.
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const designBase = (state = app.state) =>
  JSON.stringify(
    canonical({
      rooms: spaces(state)
        .slice()
        .sort((a, b) => a.roomId.localeCompare(b.roomId)),
      floorplan: state.floorplan,
      avatar: state.avatar,
    }),
  );
export function designStale() {
  return !!app.design && app.design.base !== designBase();
}
export function applyDesign() {
  const d = app.design;
  if (!d || d.applied) return '적용할 새 초안이 없어요. 원하는 구성을 다시 말해 주세요.';
  if (designStale()) return '초안 뒤에 배치가 바뀌었어요. 지금 배치를 기준으로 다시 요청해 주세요.';
  // 검증을 끝낸 뒤 스냅샷 한 번으로 전체 변경을 기록한다.
  const next = validateState(d.state);
  snapshot();
  Object.assign(app.state, next);
  app.selected = null;
  app.draft = null;
  app.queue = [];
  app.target = { type: 'room' };
  d.applied = true;
  push({
    role: 'event',
    text: `${THEMES[d.theme].name} ${d.mode === 'house' ? '집 전체' : '마감'} 초안을 적용했어요. 실행 취소로 되돌릴 수 있어요.`,
  });
  persist();
  emit();
  return null;
}
async function respondToDesign(request, turn) {
  const version = ++app.modelSeq,
    base = designBase();
  const model = app.ai.text === 'ready';
  let timer;
  turn.status = 'thinking';
  turn.engine = model ? engineName() : 'rule';
  app.busy = { kind: 'model', turnId: turn.id };
  pending = { version, turn, text: request.text, extra: [], design: request };
  emit();
  try {
    // 면적은 원문에서 읽은 값만 쓰고 모델이 새로 정하지 않는다.
    if (
      request.mode === 'house' &&
      (!Number.isFinite(request.areaM2) || request.areaM2 < 40 || request.areaM2 > 660)
    )
      throw Error('집 전체 면적을 40~660m²(약 12~200평)로 알려 주세요.');
    const generate = async () => {
      let correction;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await runAI('design', { request, correction });
        if (version !== app.modelSeq) throw Error('초안 만들기를 멈췄어요.');
        try {
          return readDesign(raw, request);
        } catch (e) {
          if (attempt) throw e;
          correction = e.correction || e.message;
          turn.note = '빠진 공간과 가구를 확인해 초안을 보완하는 중이에요.';
          emit();
        }
      }
    };
    const spec = model
      ? await Promise.race([
          generate(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  Object.assign(Error('집 전체 초안이 오래 걸려요. 다시 요청해 주세요.'), {
                    timeout: true,
                  }),
                ),
              90000,
            );
          }),
        ])
      : templateDesign(request);
    if (version !== app.modelSeq) return;
    if (base !== designBase())
      throw Error('상담 중에 배치가 바뀌었어요. 지금 배치를 기준으로 다시 요청해 주세요.');
    const built = ops.buildDesign(app.state, spec),
      surfaceId = turnId();
    app.design = { ...built, mode: spec.mode, theme: spec.theme, base, surfaceId, applied: false };
    finishTurn(
      turn,
      {
        reply:
          spec.mode === 'house'
            ? `${THEMES[spec.theme].name} 테마로 집 전체 초안을 준비했어요. 공간과 가구를 아래에서 확인한 뒤 적용해 주세요. 적용하면 현재 배치를 바꾸며, 한 번에 되돌릴 수 있어요.`
            : `${THEMES[spec.theme].name} 테마로 모든 공간의 벽과 바닥, 가구 색을 맞춘 초안이에요. 크기와 위치는 유지해요.`,
        surfaces: [{ id: surfaceId, kind: 'design', target: { type: 'room' } }],
        note: !model ? '상담 모델을 쓰지 않은 기본 구성 초안이에요.' : undefined,
      },
      model ? { engine: engineName() } : { engine: 'rule', fallback: fallbackReason() },
    );
  } catch (e) {
    if (version !== app.modelSeq) return;
    if (e.timeout) interruptAI();
    finishTurn(
      turn,
      {
        reply: /[가-힣]/.test(e.message)
          ? e.message
          : '상담 모델이 초안을 완성하지 못했어요. 다시 요청하거나 다른 모델을 골라 주세요.',
        surfaces: [],
        error: true,
      },
      { engine: model ? engineName() : 'rule', note: '집 전체 초안을 적용하지 않았어요.' },
    );
  } finally {
    clearTimeout(timer);
    if (version === app.modelSeq) {
      pending = null;
      app.busy = null;
      emit();
    }
  }
}

function fixRoomTargets(turn) {
  for (const s of turn.surfaces || []) {
    // 상태 연산이 나중에 덧붙인 도구에도 재열기·A2UI 수명 관리용 ID를 준다.
    s.id ||= turnId();
    if (s.target?.type === 'room') s.target = { type: 'room', roomId: app.state.roomId };
    if (s.target?.type === 'draft' && !s.target.id && app.draft)
      s.target = { type: 'draft', id: app.draft.id };
  }
}

// 진행 중인 생성만 멈춘다. 이미 준비된 모델은 그대로 둔다.
export function interruptModel() {
  if (!pending) return;
  const { turn, design } = pending;
  pending = null;
  app.modelSeq++;
  interruptAI();
  app.busy = null;
  finishTurn(
    turn,
    { reply: design ? '집 전체 초안 만들기를 멈췄어요.' : '상담을 멈췄어요.', surfaces: [] },
    { engine: 'app' },
  );
}

// 답 생성과 사진 판별은 각각 멈춘다. 사진을 취소해도 Gemma 다운로드는 계속된다.
export function cancelModel() {
  if (pending) return interruptModel();
  if (app.busy?.kind !== 'vision') return;
  app.busy = null;
  stopAI('사진 판별을 취소했어요.', 'vision');
  app.ai.vision = 'off';
  setLaneDownload('vision', null);
  toast('사진 판별을 취소했어요.');
  emit();
}

// ---------- 직접 연 도구와 버튼 동작 ----------
const TOOL_TEXT = {
  recommendations: '가구를 어디에 쓸지 알려 주세요.',
  design: '집 전체 면적과 원하는 테마를 말해 주세요. 예: 100평 집 전체를 재팬디로 꾸며줘.',
  avatar:
    '키를 알려주면 가구와 같은 축척의 아바타를 세워요. 의자나 소파, 침대에는 앉히거나 눕혀 볼 수 있어요.',
  floorplan: '방과 화장실을 2D와 3D로 함께 보세요. 공간 위치는 2D에서 끌어 맞출 수 있어요.',
  'room-size': '방 크기를 정해 볼까요? 숫자를 바로 고치거나 “가로 4m 세로 3m”처럼 말해도 돼요.',
  'room-type': '어떤 공간인가요? 유형을 바꾸면 직접 정한 치수는 그대로 두고 나머지만 바꿔요.',
  windows:
    '벽을 고르고 창 크기와 위치를 cm로 입력해 주세요. 집 전체와 배치 파일에도 함께 반영해요.',
  finishes: '벽과 바닥을 골라 보세요. 바꾸기 전과 후를 나란히 보여드려요.',
  catalog: '놓고 싶은 가구를 골라 주세요. 고르면 크기 초안이 방 안에 먼저 나타나요.',
  spaces: '공간마다 크기와 가구를 따로 저장해요. 최대 12개까지 만들 수 있어요.',
  items: '이 방에 놓인 가구예요. 누르면 도면에서 선택돼요.',
  files: '배치는 파일로 저장하거나 불러올 수 있어요. 사진과 대화는 파일에 넣지 않아요.',
  ai: '이 기기에서 실행하는 모델이에요. 준비하지 않아도 기본 상담과 배치는 그대로 쓸 수 있어요.',
  help: '이렇게 쓰면 돼요.',
  impact: '겹친 공간과, 겹치거나 벽을 넘은 가구를 확인해요.',
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
  finishes: '벽과 바닥 열기',
  catalog: '가구 고르기',
  spaces: '내 공간 열기',
  items: '가구 목록 열기',
  files: '저장과 불러오기',
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
    text: scope === 'furniture' && s ? `${s.name}: ${TOOL_TEXT[kind]}` : TOOL_TEXT[kind],
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
      ? layout.outside
        ? '방 옆에 세웠어요. 끌어서 방 안으로 옮겨 보세요'
        : '방에 세웠어요'
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
  finishWindowGesture(true);
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
    `${josa(names[0], '과/와')} ${names[1]} 사이 문을 막았어요. 집 전체 도구의 문 목록에서 다시 낼 수 있어요`,
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
    event('화장실을 방 옆에 붙였어요. 변기, 세면대, 샤워부스는 가구처럼 옮기거나 뺄 수 있어요');
    persist();
    emit();
  } catch (e) {
    toast(e.message);
  }
}

function confirmFurnitureUse(turn) {
  if (
    !turn?.confirmation ||
    turn !== app.thread.at(-1) ||
    turn.roomId !== app.state.roomId ||
    app.busy ||
    app.fileLoading ||
    app.photoLoading
  )
    return;
  const { types, text, activity } = turn.confirmation;
  push({ role: 'user', text: activity + ' 용도예요', action: true });
  finishTurn(push({ role: 'assistant', text: '' }), offerFurniture(text, types), { engine: 'app' });
}

export function runSuggestion(sug) {
  if (sug.action === 'confirm-use') {
    const last = app.thread.at(-1);
    if (last?.suggestions?.includes(sug)) return confirmFurnitureUse(last);
    return;
  }
  // 공간 지우기는 마지막 답의 단추일 때만 실행한다. 지난 답의 단추로 다른 배치를 지우지 않게 한다.
  if (sug.action === 'delete-space') {
    const last = app.thread.at(-1);
    if (!last?.suggestions?.includes(sug) || app.busy) return;
    push({ role: 'user', text: sug.label, action: true });
    return deleteSpace(sug.arg);
  }
  if (sug.action === 'draft' && (!sug.photoId || sug.photoId !== app.photo?.surfaceId)) {
    toast('이전 사진의 후보예요. 지금 사진에서 종류를 골라 주세요.');
    return;
  }
  if (sug.text) return send(sug.text);
  if (sug.action === 'place') return placeDraft(sug.label);
  if (sug.action === 'place-all') return placeDraft(sug.label, 'place-all');
  if (sug.action === 'catalog') return openTool('catalog');
  if (sug.action === 'tool' && sug.arg) return openTool(sug.arg);
  if (sug.action === 'photo') return pickPhoto();
  if (sug.action === 'relocate') return relocate();
  if (sug.action === 'draft' && sug.arg) return createDraft(sug.arg, { via: 'photo' });
}

export function recommendationFor(surfaceId) {
  const turn = app.thread.findLast((t) =>
    t.surfaces?.some((s) => s.id === surfaceId && s.kind === 'recommendations'),
  );
  if (!turn?.recommendation) return null;
  const active =
    app.thread.at(-1) === turn &&
    app.state.roomId === turn.roomId &&
    !app.busy &&
    !app.fileLoading &&
    !app.photoLoading;
  return { ...turn.recommendation, active };
}

export function chooseRecommendation(surfaceId, type) {
  const rec = recommendationFor(surfaceId);
  if (!rec?.active || !rec.types.includes(type)) return;
  push({ role: 'user', action: true, text: TYPES[type].name + ' 고르기' });
  finishTurn(push({ role: 'assistant', text: '' }), purposeDraft(rec.text, type), {
    engine: 'app',
  });
}

export function placeDraft(label = '방에 놓기', action = 'place') {
  push({ role: 'user', text: label, action: true });
  const turn = push({ role: 'assistant', text: '' });
  try {
    if (action === 'place-all') placeAllInto(turn);
    else placeDraftInto(turn);
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
  const photo = via === 'photo' ? app.photo : null;
  if (photo?.roomId && photo.roomId !== app.state.roomId) {
    toast('사진을 보낸 공간으로 돌아온 뒤 종류를 골라 주세요.');
    return;
  }
  if (app.busy?.kind === 'vision') cancelModel();
  const item = makeItem(type);
  const previous = photo && app.draft?.id === photo.draftId ? app.draft : null;
  if (previous) {
    for (let i = 0; i < 3; i++)
      if (String(previous.sources[i]).startsWith('사용자')) {
        item.dims[i] = previous.dims[i];
        item.sources[i] = previous.sources[i];
      }
    item.color = previous.color;
  }
  item.name = TYPES[type].name;
  app.draft = item;
  app.queue = [];
  app.selected = null;
  app.target = { type: 'draft' };
  push({
    role: 'user',
    text:
      via === 'photo' ? `${josa(TYPES[type].name, '으로/로')} 잡기` : `${TYPES[type].name} 고르기`,
    action: true,
  });
  if (via === 'photo')
    for (let i = 0; i < 3; i++)
      if (!String(item.sources[i]).startsWith('사용자')) item.sources[i] = '사진 유형 기본값';
  const turn = push({
    role: 'assistant',
    text: `${TYPES[type].name} 초안을 방 안에 먼저 띄웠어요. 규격을 고르거나 아는 치수를 말해 주세요.`,
    surfaces: [{ kind: 'furniture-size', target: { type: 'draft', id: item.id } }],
    suggestions: [
      { label: '방에 놓기', action: 'place', primary: true },
      { label: '치수 말하기', text: `${TYPES[type].name} 가로 ` },
      { label: '색 바꾸기', text: `${TYPES[type].name} 색을 바꾸고 싶어` },
    ].filter((x) => via === 'catalog' || x.action),
    receipt: [{ label: '새 초안', to: `${TYPES[type].name} ${dimsText(item.dims)}cm` }],
  });
  persist();
  emit();
  if (photo) {
    photo.draftId = item.id;
    photo.chosenType = type;
    photo.roomId ||= app.state.roomId;
    return applyPhotoCaption(photo, turn);
  }
}

export function relocate(label = '겹친 가구 정리') {
  push({ role: 'user', text: label, action: true });
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

// 실패한 방 크기 변경은 배치와 실행 취소 기록을 건드리지 않는다.
function editRoom(make, { live = false } = {}) {
  try {
    const next = structuredClone(app.state);
    ops.setRoom(next, make(next.room));
    if (!live) snapshot();
    Object.assign(app.state, next);
    commit();
  } catch (e) {
    toast(e.message);
    return e.message;
  }
}
export function setRoomDim(key, value, opts = {}) {
  return editRoom((room) => ops.roomWithDims(room, { [key]: value }), opts);
}
export function setRoomPreset(index) {
  return editRoom((room) => ops.roomWithPreset(room, index));
}
export function setRoomType(type) {
  return editRoom((room) => ops.roomWithType(room, type));
}
export function setFinish(key, color) {
  if (app.state.room[key] === color) return;
  const before = app.state.room;
  const error = editRoom((room) => ops.roomWithFinish(room, key, color));
  if (!error) rememberFinish(before);
}
function editWindow(change, { live = false, inline = false } = {}) {
  try {
    const next = structuredClone(app.state);
    change(next);
    if (!live) snapshot();
    Object.assign(app.state, next);
    commit();
  } catch (e) {
    if (!inline) toast(e.message);
    return e.message;
  }
}
export const addWindow = (wall) => editWindow((s) => ops.addWindow(s, wall));
export const setWindow = (id, patch, opts) => editWindow((s) => ops.setWindow(s, id, patch), opts);
export const removeWindow = (id) => editWindow((s) => ops.removeWindow(s, id));
// 포인터 한 번의 조작을 실행 취소 한 번으로 묶고, 취소·무효 이동은 기록을 남기지 않는다.
let windowGesture = null;
export function beginWindowGesture(id) {
  finishWindowGesture(true);
  if (!app.state.room.windows?.some((w) => w.id === id)) return;
  windowGesture = {
    id,
    roomId: app.state.roomId,
    room: structuredClone(app.state.room),
    history: [...app.history],
    future: [...app.future],
    changed: false,
  };
}
export function dragWindow(patch) {
  const g = windowGesture;
  if (!g || g.roomId !== app.state.roomId) return '다른 공간으로 이동했어요.';
  try {
    const next = structuredClone(app.state);
    ops.setWindow(next, g.id, patch);
    if (JSON.stringify(next.room) === JSON.stringify(app.state.room)) return;
    if (!g.changed) {
      snapshot();
      g.changed = true;
    }
    Object.assign(app.state, next);
    emit();
  } catch (e) {
    return e.message;
  }
}
export function finishWindowGesture(cancel = false) {
  const g = windowGesture;
  if (!g) return false;
  windowGesture = null;
  if (cancel && g.changed) {
    const r =
      g.roomId === app.state.roomId
        ? app.state
        : app.state.otherRooms.find((r) => r.roomId === g.roomId);
    if (r) r.room = g.room;
    app.history = g.history;
    app.future = g.future;
  }
  persist();
  emit();
  return true;
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
    a.sources = a.dims.map(() => `사용자 선택(${p.label})`);
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
  finishWindowGesture(true);
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
// 집 전체에서 고른 공간을 통째로 90° 돌린다. 가구와 아바타가 함께 돌고, 옆 공간은 겹치지 않게 비킨다.
export function rotateSpace(id = app.state.roomId) {
  try {
    snapshot();
    const r = ops.rotateSpace(app.state, id);
    app.view.door = null;
    event(
      `${josa(r.name, '을/를')} 90° 돌렸어요. 가로 ${r.w}m, 세로 ${r.d}m${r.moved.length ? '. 옆 공간은 겹치지 않게 옮겼어요' : ''}`,
    );
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
    event(`${josa(name, '을/를')} 삭제했어요. 되돌리기로 복구할 수 있어요`);
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
  finishWindowGesture(true);
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
let fileReadSeq = 0;
export function cancelImport() {
  if (!app.fileLoading) return;
  fileReadSeq++;
  app.fileLoading = false;
  app.fileError = '';
  toast('배치 불러오기를 취소했어요.');
}
export async function importJSON(file) {
  if (!file) return;
  const seq = ++fileReadSeq;
  const stamp = () => JSON.stringify([designBase(), app.state.roomId, app.draft, app.queue]);
  const before = stamp();
  app.fileLoading = true;
  app.fileError = '';
  emit();
  try {
    if (file.size > 5e6) throw Error('배치 파일은 5MB 이하로 선택해주세요.');
    const next = loadState(JSON.parse(await file.text()));
    if (seq !== fileReadSeq) return;
    if (stamp() !== before)
      throw Error(
        '파일을 읽는 동안 직접 고친 배치를 유지했어요. 다시 불러오면 파일의 배치로 바꿔요.',
      );
    // 불러오기 전에 시작한 상담·사진의 결과가 새 파일에 섞이지 않게 한다.
    if (pending) {
      const { turn } = pending;
      pending = null;
      app.modelSeq++;
      interruptAI();
      turn.status = 'done';
      turn.engine = 'app';
      turn.text = '배치 파일을 불러와 이전 상담을 멈췄어요.';
    }
    if (app.busy?.kind === 'model') app.busy = null;
    if (app.busy?.kind === 'vision') cancelModel();
    finishWindowGesture(true);
    snapshot();
    Object.assign(app.state, next);
    for (const a of app.state.items) clampItem(a, app.state.room);
    if (app.view.webglError) app.state.view = '2d';
    app.selected = null;
    app.draft = null;
    app.queue = [];
    app.design = null;
    app.target = { type: 'room' };
    app.photo = null;
    photoReadSeq++;
    app.photoLoading = false;
    app.photoError = '';
    Object.assign(app.view, {
      preview: null,
      door: null,
      doorList: false,
      addSide: null,
      ghostRoom: null,
      avatarBar: false,
      menu: null,
    });
    event(`배치 파일에서 공간 ${spaces(app.state).length}개를 불러왔어요`);
    persist();
    emit();
    toast('배치를 불러왔어요.');
  } catch (e) {
    if (seq !== fileReadSeq) return;
    app.fileError =
      e instanceof SyntaxError
        ? '배치 JSON 형식을 읽지 못했어요. 룸꾸에서 저장한 배치 파일을 선택해 주세요.'
        : e.message;
    toast(`불러오기 실패: ${app.fileError}`);
  } finally {
    if (seq === fileReadSeq) {
      app.fileLoading = false;
      emit();
    }
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
let photoReadSeq = 0;
export function registerPhotoInput(el) {
  photoInput = el;
}
export function pickPhoto() {
  photoInput?.click();
}
export async function attachPhoto(file) {
  if (!file) return;
  const seq = ++photoReadSeq;
  app.photoLoading = true;
  app.photoError = '';
  emit();
  try {
    const data = await imageData(file);
    if (seq !== photoReadSeq) return;
    if (app.busy?.kind === 'vision') cancelModel();
    app.photo = { data, caption: '', analyzed: false, sent: false, type: null };
  } catch (e) {
    if (seq === photoReadSeq) app.photoError = e.message;
  } finally {
    if (seq === photoReadSeq) {
      app.photoLoading = false;
      emit();
    }
  }
}
export function removePhoto() {
  photoReadSeq++;
  app.photoLoading = false;
  app.photoError = '';
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
function makePhotoDraft(photo, type) {
  const before =
    app.draft && app.draft.id === photo.draftId && app.draft.type === type
      ? app.draft
      : makeItem(type);
  const next = structuredClone(before);
  next.name = TYPES[type].name;
  for (let i = 0; i < 3; i++)
    if (!String(next.sources[i]).startsWith('사용자')) next.sources[i] = '사진 유형 기본값';
  app.draft = ops.sanitizeItem(next);
  app.queue = [];
  photo.draftId = app.draft.id;
  app.target = { type: 'draft' };
  app.selected = null;
}
async function applyPhotoCaption(photo, turn) {
  if (!photo.captionPending || photo !== app.photo || photo.roomId !== app.state.roomId) return;
  photo.captionPending = false;
  turn.photoIntro = turn.text;
  const caption = photoCaption(requestedText(photo.caption, app.state), app.draft?.type);
  if (!caption) return;
  await respondToText(caption, turn, photo.history || historyForModel());
}
export async function analyzePhoto() {
  const photo = app.photo;
  if (!photo || !photo.sent || app.busy || app.photoLoading) return;
  photo.roomId ||= app.state.roomId;
  const editStamp = () => JSON.stringify([app.state, app.draft, app.queue, app.target]);
  const before = editStamp();
  const job = { kind: 'vision', photo };
  app.busy = job;
  setLaneDownload(
    'vision',
    {
      task: 'vision',
      phase: 'init',
      name: 'SigLIP base',
      cached: true,
      at: Date.now(),
    },
    true,
  );
  app.view.downloadOpen = false;
  app.ai.vision = 'loading';
  app.ai.visionLabel = '사진 판별 모델 준비 중';
  app.ai.visionProgress = 0;
  app.ai.visionError = '';
  photo.error = '';
  visionFiles.clear();
  emit();
  try {
    const raw = await runAI('classify', { image: photo.data, device: app.ai.device });
    if (app.photo !== photo || app.busy !== job) return;
    const candidates = photoCandidates(raw?.scores);
    app.ai.vision = 'ready';
    finishDownload('vision');
    photo.analyzed = true;
    photo.device = raw?.device;
    photo.candidates = candidates;
    const top = candidates[0];
    const clear = requestedText(photo.caption || '', app.state);
    const described = [
      ...new Set(
        furnitureMentions(clear)
          .filter((m) => !m.ref)
          .map((m) => m.type),
      ),
    ];
    const conflict = !!top && described.length === 1 && described[0] !== top.type;
    const sure = !!top && top.p >= PHOTO_CONFIDENT && !conflict;
    const sameRoom = photo.roomId === app.state.roomId;
    const unchanged = sameRoom && before === editStamp();
    const pct = (c) => `${Math.round(c.p * 100)}%`;
    photo.type = sure ? top.type : null;
    if (sure && unchanged) makePhotoDraft(photo, top.type);
    const names = candidates.map((c) => TYPES[c.type].name);
    const choices = [
      ...new Set([...(conflict ? [top.type, described[0]] : []), ...candidates.map((c) => c.type)]),
    ].slice(0, 3);
    const turn = push({
      role: 'assistant',
      engine: 'siglip',
      text: !sameRoom
        ? '사진 판별 중 공간이 바뀌어 초안을 만들지 않았어요. 사진을 보낸 공간으로 돌아온 뒤 종류를 골라 주세요.'
        : !unchanged
          ? '사진 판별 중 직접 바꾼 배치를 유지했어요. 사진의 후보를 고르면 새 초안을 만들고 함께 보낸 설명을 반영해요.'
          : conflict
            ? `사진은 ${TYPES[top.type].name}, 설명은 ${TYPES[described[0]].name}을 가리켜요. 어느 쪽인지 골라 주세요. 치수와 색은 고른 가구에 반영할게요.`
            : sure
              ? `사진은 ${josa(names[0], '으로/로')} 보여요. 크기는 유형 기본값이며 사진에서 실제 cm를 잰 값은 아니에요.`
              : top
                ? `사진만으로는 종류를 확신하기 어려워요. 가까운 후보는 ${josa(names.join(', '), '이에요/예요')}. 맞는 것을 고르면 함께 보낸 설명도 반영해요.`
                : '사진에서 가구 종류를 읽지 못했어요. 아래에서 종류를 골라 주세요. 함께 보낸 설명은 보관하고 있어요.',
      photoScores: candidates.map((c) => `${TYPES[c.type].name} ${pct(c)}`).join(', ') || undefined,
      surfaces:
        sure && unchanged
          ? [{ kind: 'furniture-size', target: { type: 'draft', id: app.draft.id } }]
          : [],
      receipt:
        sure && unchanged ? [{ label: '사진 판별', to: names[0], tag: `SigLIP ${pct(top)}` }] : [],
      suggestions:
        sure && unchanged
          ? [
              { label: '방에 놓기', action: 'place', primary: true },
              ...candidates.slice(1).map((c) => ({
                label: `${josa(TYPES[c.type].name, '이었/였')}나요?`,
                action: 'draft',
                arg: c.type,
                photoId: photo.surfaceId,
              })),
            ]
          : choices.map((type, i) => ({
              label: `${josa(TYPES[type].name, '으로/로')} 잡기`,
              action: 'draft',
              arg: type,
              photoId: photo.surfaceId,
              primary: i === 0,
            })),
    });
    app.busy = null;
    if (sure && unchanged) await applyPhotoCaption(photo, turn);
  } catch (e) {
    if (app.photo !== photo || app.busy !== job) return;
    app.ai.vision = 'error';
    app.ai.visionError = explainLoadError(e.message);
    photo.error = app.ai.visionError;
    failDownload('vision', app.ai.visionError);
    toast(`사진 판별: ${app.ai.visionError}`);
  } finally {
    if (app.busy === job) app.busy = null;
    persist();
    emit();
  }
}

// ---------- 상담 모델 ----------
// 기본은 켜짐이다. 사용자가 끄면 이 기기에 기억하고, ?model=off는 이번 방문에만 끈다(테스트·데이터 절약).
// 휴대 기기에서는 모델이 보관돼 있지 않으면 받기 전에 먼저 묻는다. '나중에'를 고르면 그것도 기억한다.
const MODEL_PREF = 'room-ggu-model';
const MODEL_CHOICE = 'room-ggu-model-choice';
function offReason() {
  try {
    if (new URLSearchParams(location.search).get('model') === 'off') return 'url';
  } catch {}
  try {
    const pref = localStorage.getItem(MODEL_PREF);
    if (pref === 'off') return 'user';
    if (pref === 'later') return 'later';
  } catch {}
  if (globalThis.navigator?.connection?.saveData) return 'save-data';
  if (globalThis.navigator?.deviceMemory && navigator.deviceMemory < 4) return 'memory';
  return '';
}
// 이 기기의 GPU가 모델을 돌릴 수 있는지, 어떤 가중치를 쓰는지. 한 번 확인한 결과를 다시 쓴다.
let gpuInfo = null;
async function gpu() {
  if (gpuInfo) return gpuInfo;
  let adapter = null;
  try {
    adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
  } catch {}
  const info = { ok: !!adapter, f16: !!adapter?.features?.has?.('shader-f16') };
  if (info.ok) gpuInfo = info;
  return info;
}
// 지금 고른 상담 모델로 이 기기가 실제로 받을 파일과 아직 받지 않은 양.
// total: 모델 전체 크기(MB). mb: 지금 받아야 할 양. partial: 받다 만 것이 있어 일부만 받으면 된다.
async function textTarget() {
  const g = await gpu(),
    choice = textModel(app.ai.choice),
    id = g.f16 ? choice.f16 : choice.f32,
    total = downloadSize(id) || choice.downloadMB,
    state = g.ok ? await modelMissing(id) : { cached: false, missingMB: null },
    partial = !state.cached && state.missingMB !== null && state.missingMB < total * 0.95;
  return {
    ok: g.ok,
    id,
    name: modelName(id),
    total,
    cached: state.cached,
    partial,
    mb: partial ? Math.max(1, state.missingMB) : total,
  };
}
// 휴대 기기에서 아직 다 받지 않은 모델이면 받기 전에 물어야 한다.
async function mustAsk() {
  if (!handheld()) return false;
  const target = await textTarget();
  return target.ok && !target.cached;
}
export async function bootModel() {
  const why = offReason();
  if (why) {
    app.ai.text = 'off';
    app.ai.why = why;
    emit();
    return;
  }
  if (!(await gpu()).ok) {
    app.ai.text = 'unsupported';
    app.ai.error = 'WebGPU를 쓸 수 없는 브라우저예요.';
    emit();
    return;
  }
  if (await mustAsk()) {
    app.ai.text = 'off';
    app.ai.why = 'ask';
    await openModelAsk();
    return;
  }
  loadText({ auto: true });
}
// 모델을 받을지 묻는 팝업. 누르기 전에는 아무것도 받지 않는다.
export async function openModelAsk() {
  const target = await textTarget();
  app.view.modelAsk = {
    name: target.name,
    mb: target.mb,
    total: target.total,
    partial: target.partial,
  };
  emit();
}
export function acceptModel() {
  if (!app.view.modelAsk) return;
  app.view.asked = app.view.modelAsk;
  app.view.modelAsk = null;
  setModelOn(true, { confirmed: 'asked' });
}
export function declineModel() {
  if (!app.view.modelAsk) return;
  app.view.modelAsk = null;
  try {
    localStorage.setItem(MODEL_PREF, 'later');
  } catch {}
  app.ai.text = 'off';
  app.ai.why = 'later';
  toast('모델 없이 시작해요. 대화 위쪽 ‘모델 받기’로 언제든 받을 수 있어요.');
  emit();
}
export async function loadText({ auto = false, fresh = false } = {}) {
  if (app.ai.text === 'loading' || app.ai.text === 'ready') return;
  const choice = textModel(app.ai.choice);
  const version = app.modelSeq;
  app.ai.text = 'loading';
  app.ai.why = '';
  app.ai.label = '상담 모델 준비 중';
  app.ai.progress = 0;
  app.ai.error = '';
  // 위쪽 아일랜드에 준비 중임을 알린다. 보관해 둔 모델이면 접힌 채 잠깐 보이고, 새로 받으면 펼쳐진다.
  setLaneDownload('text', {
    task: 'text',
    phase: 'init',
    name: choice.name,
    cached: true,
    at: Date.now(),
  });
  if (app.ai.download?.task === 'text') app.view.downloadOpen = false;
  if (fresh) {
    setLaneDownload('text', {
      task: 'text',
      phase: 'connect',
      name: app.view.asked?.name || choice.name,
      mb: 0,
      totalMB: app.view.asked?.total || choice.downloadMB,
      progress: 0,
      at: Date.now(),
    });
    if (app.ai.download?.task === 'text') {
      app.view.downloadOpen = true;
      app.view.downloadAuto = true;
    }
  }
  emit();
  try {
    const model = await runAI('load-text', { choice: choice.key });
    if (app.ai.text !== 'loading' || version !== app.modelSeq || choice.key !== app.ai.choice)
      return;
    app.ai.text = 'ready';
    app.ai.model = model;
    finishDownload('text', modelName(model));
  } catch (e) {
    if (app.ai.text !== 'loading' || version !== app.modelSeq || choice.key !== app.ai.choice)
      return;
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
export function setModelOn(on, { confirmed = false } = {}) {
  // 휴대 기기에서 켤 때는 받을 것이 남아 있으면 먼저 묻는다. 팝업에서 받겠다고 한 뒤에는 바로 진행한다.
  if (on && !confirmed && handheld()) {
    mustAsk().then((ask) => (ask ? openModelAsk() : setModelOn(true, { confirmed: true })));
    return;
  }
  try {
    if (on) localStorage.removeItem(MODEL_PREF);
    else localStorage.setItem(MODEL_PREF, 'off');
  } catch {}
  if (on) {
    app.ai.why = '';
    loadText({ fresh: confirmed === 'asked' });
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
  stopAI('상담 모델을 바꿔요.', 'text');
  if (app.busy?.kind === 'model') app.busy = null;
  setLaneDownload('text', null);
  app.ai = {
    ...app.ai,
    text: 'off',
    model: null,
    progress: 0,
    label: '',
    why: '',
  };
  setModelOn(true);
}
export function unloadAI() {
  if (pending) interruptModel();
  app.modelSeq++;
  stopAI('모델을 껐어요.', 'text');
  if (app.busy?.kind === 'model') app.busy = null;
  setLaneDownload('text', null);
  app.ai = {
    ...app.ai,
    text: 'off',
    model: null,
    progress: 0,
    label: '',
  };
  toast('모델을 껐어요. 규칙으로 계속 답해요.');
}

// ---------- 내려받기 안내 ----------
// 모델 파일을 실제로 내려받는 동안에는 다이얼로그로 알린다. 이미 보관한 모델을 불러올 때는 띄우지 않는다.
const visionFiles = new Map();
function laneDownload(task) {
  return app.ai.downloads[task] || (app.ai.download?.task === task ? app.ai.download : null);
}
function setLaneDownload(task, download, focus = false) {
  app.ai.downloads[task] = download;
  if (focus || !app.ai.download || app.ai.download.task === task) {
    const before = app.ai.download;
    app.ai.download = download || app.ai.downloads[task === 'text' ? 'vision' : 'text'];
    if (before?.task !== app.ai.download?.task && app.ai.download?.phase === 'error')
      app.view.downloadOpen = true;
  }
}
function trackDownload(task, patch) {
  const now = laneDownload(task);
  const fresh =
    !now || now.phase === 'done' || (['connect', 'fetch'].includes(patch.phase) && now.cached);
  const before = fresh ? {} : now;
  const moved = fresh || patch.phase !== before.phase || (patch.mb || 0) > (before.mb || 0);
  setLaneDownload(task, { ...before, task, ...patch, at: moved ? Date.now() : before.at });
  if (fresh && ['connect', 'fetch'].includes(patch.phase) && app.ai.download?.task === task) {
    app.view.downloadOpen = true;
    app.view.downloadAuto = true;
  }
}
const downloadFailures = { text: 0, vision: 0 };
const RETRY_WAIT = [0, 3000, 6000, 12000];
function finishDownload(task, name) {
  downloadFailures[task] = 0;
  const before = laneDownload(task);
  if (!before) return;
  const done = { ...before, phase: 'done', progress: 1, name: name || before.name };
  setLaneDownload(task, done);
  setTimeout(
    () => {
      if (laneDownload(task) === done) {
        setLaneDownload(task, null);
        emit();
      }
    },
    app.view.downloadOpen ? 4200 : 2400,
  );
}
function failDownload(task, message) {
  const before = laneDownload(task);
  if (!before) return;
  const attempts = ++downloadFailures[task];
  setLaneDownload(task, {
    ...before,
    phase: 'error',
    error: message,
    attempts,
    retryAt: Date.now() + RETRY_WAIT[Math.min(attempts, RETRY_WAIT.length) - 1],
  });
  if (app.ai.download?.task === task) app.view.downloadOpen = true;
}
export function setDownloadOpen(open) {
  app.view.downloadOpen = open;
  app.view.downloadAuto = false;
  emit();
}
export function closeDownload() {
  if (app.ai.download?.phase === 'error') downloadFailures[app.ai.download.task] = 0;
  if (app.ai.download) setLaneDownload(app.ai.download.task, null);
  emit();
}
export function cancelDownload() {
  const task = app.ai.download?.task;
  if (task) downloadFailures[task] = 0;
  if (task) setLaneDownload(task, null);
  if (task === 'vision') cancelModel();
  else setModelOn(false);
}
export function retryDownload() {
  const task = app.ai.download?.task;
  if (Date.now() < (app.ai.download?.retryAt || 0)) return;
  if (task) setLaneDownload(task, null);
  if (task === 'vision') analyzePhoto();
  else setModelOn(true, { confirmed: true });
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
    // 실행 중 실패는 해당 요청의 catch가 오류 안내를 마무리한다. 먼저 off로 바꾸면
    // loadText가 취소로 오인해 실패 이유와 다시 시도를 놓친다.
    if ((!data.task || data.task === 'text') && (!data.failed || app.ai.text !== 'loading')) {
      app.ai.text = data.failed ? 'error' : 'off';
      app.ai.model = null;
      if (data.failed) app.ai.error = explainLoadError(data.error);
    }
    if ((!data.task || data.task === 'vision') && (!data.failed || app.ai.vision !== 'loading')) {
      app.ai.vision = data.failed ? 'error' : 'off';
      if (data.failed) app.ai.visionError = explainLoadError(data.error);
    }
  }
  if (data.event === 'progress') {
    let label = data.text || '모델 준비 중';
    if (data.task === 'text') {
      const step = data.phase ? data : parseProgress(label);
      label =
        step.phase === 'connect'
          ? '상담 모델 파일에 연결하는 중'
          : step.phase === 'fetch'
            ? '상담 모델 내려받는 중'
            : step.phase === 'cache'
              ? '보관해 둔 상담 모델을 불러오는 중'
              : '이 기기에 맞게 상담 모델을 준비하는 중';
      if (step.phase === 'connect') {
        trackDownload('text', { phase: 'connect', name: modelName(data.model), cached: false });
      } else if (step.phase === 'fetch') {
        // 직접 받는 경로는 전송 중인 바이트를 쓰고, 로더 문장만 있을 때는 비율로 어림한다.
        const part = Number.isFinite(data.progress) ? data.progress : step.percent / 100,
          total = data.totalMB || downloadSize(data.model) || textModel(app.ai.choice).downloadMB;
        trackDownload('text', {
          phase: 'fetch',
          name: data.model ? modelName(data.model) : textModel(app.ai.choice).name,
          mb: Number.isFinite(data.mb) ? data.mb : Math.round(part * total),
          totalMB: total,
          progress: part,
        });
      } else if (
        // 다 받은 뒤 오는 준비 단계에서만 '준비 중'으로 넘긴다. 로더의 시작 문장은 받기 전에도 오므로 무시한다.
        step.phase !== 'start' &&
        laneDownload('text')?.phase === 'fetch' &&
        laneDownload('text').progress > 0.9
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
      else if (laneDownload('vision') && total && loaded >= total)
        trackDownload('vision', { phase: 'init', progress: 1 });
    }
    if (data.task === 'vision') {
      app.ai.visionLabel = label;
      if (Number.isFinite(data.progress))
        app.ai.visionProgress = Math.min(1, Math.max(0, data.progress));
    } else {
      app.ai.label = label;
      if (Number.isFinite(data.progress)) app.ai.progress = Math.min(1, Math.max(0, data.progress));
    }
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
  // 아바타는 방 안팎 어디로든 끌 수 있다. 벽에 걸치는 자리는 가까운 쪽으로 붙는다.
  moveAvatar: (x, z) => {
    const at = standAt(app.state.room, app.state.avatar.height, x, z);
    ops.setAvatar(app.state, { x: at.x, z: at.z });
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
