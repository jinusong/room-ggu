import { useRef, useState } from 'preact/hooks';
import { TYPES, ROOM_TYPES } from '../catalog.js';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { josa } from '../app/text.js';
import { Icon } from './icons.js';
import { useAutosize, useOutside } from './widgets.jsx';

// 입력창의 + 메뉴. 가구 → 공간 → 가늠·집 전체 → 파일·설정 순서로 묶는다.
const TOOL_GROUPS = [
  [
    ['catalog', '가구 고르기', 'armchair'],
    ['photo', '가구 사진 올리기', 'image-plus'],
    ['items', '이 방의 가구', 'list'],
  ],
  [
    ['room-size', '방 크기', 'ruler'],
    ['room-type', '공간 유형', 'layout-grid'],
    ['windows', '창문 설정', 'grid-2x2'],
    ['finishes', '벽과 바닥', 'paint-roller'],
    ['spaces', '내 공간', 'layers'],
  ],
  [
    ['avatar', '내 키로 비교', 'person-standing'],
    ['floorplan', '집 전체 보기', 'house'],
  ],
  [
    ['files', '저장과 불러오기', 'folder-open'],
    ['ai', '이 기기의 AI', 'cpu'],
    ['help', '사용 방법', 'circle-help'],
  ],
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

export function Composer({ onFocusChange, mobile }) {
  const [text, setText] = useState(draftText);
  const [menu, setMenu] = useState(false);
  const [menuMax, setMenuMax] = useState(420);
  const menuRef = useRef(null);
  // 메뉴는 입력창 위로 열린다. 시트가 낮아도 잘리지 않게 위쪽 여유만큼만 키운다.
  const toggleMenu = () => {
    const box = menuRef.current?.getBoundingClientRect(),
      sheet = menuRef.current?.closest('.sheet')?.getBoundingClientRect();
    if (box && sheet) setMenuMax(Math.max(160, Math.min(440, box.top - sheet.top - 12)));
    setMenu(!menu);
  };
  const ref = useAutosize(text);
  useOutside(menuRef, () => setMenu(false), menu);
  const busy = !!app.busy;
  const pending = app.photo && !app.photo.sent ? app.photo : null;
  const submit = (e) => {
    e?.preventDefault();
    if (app.busy || (!text.trim() && !pending)) return;
    const value = text;
    setText('');
    draftText = '';
    store.send(value);
  };
  const runTool = (kind) => {
    setMenu(false);
    if (kind === 'photo') store.pickPhoto();
    else if (kind === 'avatar' && !store.avatarHere()) store.toggleAvatar();
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
            onClick={toggleMenu}
          >
            <Icon name="plus" />
          </button>
          {menu && (
            <div class="tool-menu" role="menu" style={{ maxHeight: `${menuMax}px` }}>
              {(hasSubject ? [ITEM_TOOLS, ...TOOL_GROUPS] : TOOL_GROUPS).map((group, n) => (
                <div class="tool-group-grid" role="group" key={n}>
                  {group.map(([k, l, i]) => (
                    <button
                      key={k}
                      type="button"
                      role="menuitem"
                      data-tool={k}
                      onClick={() => runTool(k)}
                    >
                      <Icon name={i} size={16} />
                      <span>{l}</span>
                    </button>
                  ))}
                </div>
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
        {!mobile && <span class="composer-hint">Enter로 보내기 · Shift+Enter로 줄바꿈</span>}
        <span class="save-state">{app.view.saveStatus}</span>
      </div>
    </form>
  );
}
