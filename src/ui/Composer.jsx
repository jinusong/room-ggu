import { useRef, useState } from 'preact/hooks';
import { TYPES, ROOM_TYPES } from '../catalog.js';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { josa } from '../app/text.js';
import { Icon } from './icons.js';
import { useAutosize, useOutside } from './widgets.jsx';

const TOOLS = [
  ['catalog', '가구 고르기', 'armchair'],
  ['photo', '가구 사진 올리기', 'image-plus'],
  ['room-size', '방 크기', 'ruler'],
  ['room-type', '공간 유형', 'layout-grid'],
  ['finishes', '벽과 바닥', 'paint-roller'],
  ['spaces', '내 공간', 'layers'],
  ['items', '이 방의 가구', 'list'],
  ['files', '저장과 불러오기', 'folder-open'],
  ['ai', '이 기기의 AI', 'cpu'],
  ['help', '사용 방법', 'circle-help'],
];
const ITEM_TOOLS = [
  ['furniture-size', '규격 비교', 'columns-3'],
  ['furniture-dims', '치수 직접 입력', 'ruler'],
  ['furniture-color', '색상', 'palette'],
];

let draftText = '';

function TargetChip() {
  const t = app.target,
    s = store.subject(t);
  if (s)
    return (
      <div class={`target ${t.type === 'draft' ? 'is-draft' : 'is-item'}`}>
        <span class="dot" style={{ background: s.color }} />
        <span class="target-text">
          <strong>{s.name}</strong>
          <small>{t.type === 'draft' ? '초안 · 아직 방에 놓지 않음' : '선택한 가구'}</small>
        </span>
        <button
          type="button"
          class="icon-btn"
          aria-label="대상을 방으로 바꾸기"
          onClick={() => store.setTarget({ type: 'room' })}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    );
  const r = app.state.room;
  return (
    <div class="target is-room">
      <Icon name={ROOM_TYPES[r.type].icon} size={16} />
      <span class="target-text">
        <strong>{app.state.name}</strong>
        <small class="mono">
          {r.w} × {r.d} × {r.h}m
        </small>
      </span>
    </div>
  );
}

function placeholder() {
  const s = store.subject();
  if (app.target.type === 'item' && s) return `${josa(s.name, '을/를')} 어떻게 바꿀까요?`;
  if (app.target.type === 'draft' && s) return `${TYPES[s.type].name} 크기를 말해 주세요`;
  return '방이나 가구를 말해 주세요';
}

function Status() {
  const ai = app.ai;
  if (app.busy?.kind === 'model')
    return (
      <span class="status-line">
        <Icon name="loader-circle" size={14} className="spin" />
        모델이 답을 쓰는 중
        <button type="button" class="link" onClick={() => store.cancelModel()}>
          취소
        </button>
      </span>
    );
  if (ai.text === 'loading' || app.busy?.kind === 'vision')
    return (
      <span class="status-line">
        <Icon name="loader-circle" size={14} className="spin" />
        {ai.label || '모델 준비 중'}
        {ai.progress > 0 && ` · ${Math.round(ai.progress * 100)}%`}
        <button type="button" class="link" onClick={() => store.cancelModel()}>
          취소
        </button>
      </span>
    );
  if (ai.text === 'ready')
    return (
      <span class="status-line">
        <span class="status-dot is-ready" />
        {String(ai.model).startsWith('gemma') ? 'Gemma 3 1B' : 'Qwen3 0.6B'} · 이 기기에서 실행 중
        <button type="button" class="link" onClick={() => store.openTool('ai')}>
          설정
        </button>
      </span>
    );
  return (
    <span class="status-line">
      <span class="status-dot" />
      기본 상담 · 규칙 기반
      <button type="button" class="link" onClick={() => store.openTool('ai')}>
        모델 켜기
      </button>
    </span>
  );
}

export function Composer({ onFocusChange }) {
  const [text, setText] = useState(draftText);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const ref = useAutosize(text);
  useOutside(menuRef, () => setMenu(false), menu);
  const busy = app.busy?.kind === 'model';
  const pending = app.photo && !app.photo.sent ? app.photo : null;
  const submit = (e) => {
    e?.preventDefault();
    if (busy || (!text.trim() && !pending)) return;
    const value = text;
    setText('');
    draftText = '';
    store.send(value);
  };
  const runTool = (kind) => {
    setMenu(false);
    if (kind === 'photo') store.pickPhoto();
    else store.openTool(kind);
  };
  const hasSubject = !!store.subject();
  return (
    <form class="composer" onSubmit={submit} aria-label="상담 입력">
      <TargetChip />
      {pending && (
        <div class="photo-tray">
          <img src={pending.data} alt="첨부할 가구 사진" />
          <span>사진을 붙였어요. 설명을 덧붙이거나 그대로 보내세요.</span>
          <button
            type="button"
            class="icon-btn"
            aria-label="사진 빼기"
            onClick={() => store.removePhoto()}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      <div class="composer-box">
        <div class="tool-menu-wrap" ref={menuRef}>
          <button
            type="button"
            class="icon-btn"
            aria-label="도구 열기"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Icon name="plus" />
          </button>
          {menu && (
            <div class="tool-menu" role="menu">
              {hasSubject &&
                ITEM_TOOLS.map(([k, l, i]) => (
                  <button key={k} type="button" role="menuitem" onClick={() => runTool(k)}>
                    <Icon name={i} size={16} />
                    {l}
                  </button>
                ))}
              {hasSubject && <hr />}
              {TOOLS.map(([k, l, i]) => (
                <button key={k} type="button" role="menuitem" onClick={() => runTool(k)}>
                  <Icon name={i} size={16} />
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea
          id="chat-input"
          ref={ref}
          rows={1}
          maxLength={1500}
          aria-label="공간 또는 가구 설명"
          placeholder={placeholder()}
          value={text}
          onInput={(e) => {
            setText(e.currentTarget.value);
            draftText = e.currentTarget.value;
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
          }}
          onPaste={(e) => {
            const file = [...(e.clipboardData?.files || [])].find((f) =>
              f.type.startsWith('image/'),
            );
            if (file) {
              e.preventDefault();
              store.attachPhoto(file);
            }
          }}
        />
        <button
          type="button"
          class="icon-btn"
          aria-label="가구 사진 첨부"
          title="가구 사진 첨부"
          onClick={() => store.pickPhoto()}
        >
          <Icon name="image-plus" />
        </button>
        <button class="send" aria-label="설명 보내기" disabled={busy || (!text.trim() && !pending)}>
          <Icon name="arrow-up" />
        </button>
      </div>
      <div class="composer-foot">
        <Status />
        <span class="save-state">{app.view.saveStatus}</span>
      </div>
    </form>
  );
}
