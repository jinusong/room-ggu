import { useRef, useState } from 'preact/hooks';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { Icon } from './icons.js';
import { Thread } from './Thread.jsx';
import { Composer } from './Composer.jsx';
import { BrandMark } from './widgets.jsx';

const OFF_TEXT = {
  user: '모델 꺼 둠',
  url: '모델 꺼 둠',
  'save-data': '데이터 절약 모드라 모델을 켜지 않음',
  memory: '메모리가 작아 모델을 켜지 않음',
  ask: '모델을 아직 받지 않음',
  later: '모델을 아직 받지 않음',
};
// 받은 적이 없어 꺼져 있는 상태. 켜는 단추가 내려받기를 시작한다는 것을 이름으로 알린다.
const notFetched = (ai) => ai.text === 'off' && (ai.why === 'ask' || ai.why === 'later');
// 지금 누가 답하는지. 상담 상대 이름 바로 아래에 둔다.
function Status() {
  const ai = app.ai;
  if (app.busy?.kind === 'model')
    return (
      <span class="status-line">
        <Icon name="loader-circle" size={14} className="spin" />
        문장을 해석하는 중
        <button type="button" class="link" onClick={() => store.cancelModel()}>
          멈추기
        </button>
      </span>
    );
  if (app.busy?.kind === 'vision')
    return (
      <span class="status-line">
        <Icon name="loader-circle" size={14} className="spin" />
        사진 판별 중
        <button type="button" class="link" onClick={() => store.cancelModel()}>
          취소
        </button>
      </span>
    );
  // 준비 상황은 위쪽 아일랜드가 움직임으로 보여 준다. 여기서는 오래 도는 표시 없이 글로만 알린다.
  if (ai.text === 'loading')
    return (
      <span class="status-line">
        <span class="status-dot is-loading" />
        상담 모델 준비 중<span class="status-extra"> · 그동안 규칙으로 답해요</span>
        <button type="button" class="link" onClick={() => store.setModelOn(false)}>
          끄기
        </button>
      </span>
    );
  if (ai.text === 'ready')
    return (
      <span class="status-line">
        <span class="status-dot is-ready" />
        {store.modelName(ai.model)}가 이 기기에서 답해요
        <button type="button" class="link" onClick={() => store.openTool('ai')}>
          설정
        </button>
      </span>
    );
  const text =
    ai.text === 'unsupported'
      ? '이 브라우저는 모델을 못 써요'
      : ai.text === 'error'
        ? '모델 준비 실패'
        : OFF_TEXT[ai.why] || '모델 꺼짐';
  return (
    <span class="status-line">
      <span class={`status-dot is-${ai.text}`} />
      <span class="status-text">
        {text}
        <span class="status-extra"> · 규칙으로 답해요</span>
      </span>
      <button
        type="button"
        class="link"
        onClick={() => (ai.text === 'unsupported' ? store.openTool('ai') : store.setModelOn(true))}
      >
        {ai.text === 'unsupported'
          ? '자세히'
          : ai.text === 'error'
            ? '다시 시도'
            : notFetched(ai)
              ? '모델 받기'
              : '켜기'}
      </button>
    </span>
  );
}

// 대화 열의 폭. 사용자가 끌어 맞춘 값은 이 브라우저에만 기억한다.
const WIDTH_KEY = 'room-ggu-chat-width';
// 기본 폭은 화면의 절반이다(CSS). 끌어서는 화면의 70%까지 넓히되, 방 쪽에 위 도구 줄이 들어갈 폭(520px)은 남긴다.
const widthLimits = () => [
  360,
  Math.max(380, Math.min(Math.round(innerWidth * 0.7), innerWidth - 520)),
];
function applyWidth(px) {
  if (px) document.documentElement.style.setProperty('--chat-w', `${px}px`);
  else document.documentElement.style.removeProperty('--chat-w');
}
try {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  if (saved) applyWidth(Math.max(widthLimits()[0], Math.min(widthLimits()[1], saved)));
} catch {}
function Resizer({ sheetRef }) {
  const drag = useRef(null);
  const [, redraw] = useState(0);
  const set = (px, save = true) => {
    const [min, max] = widthLimits(),
      next = Math.round(Math.max(min, Math.min(max, px)));
    applyWidth(next);
    if (save)
      try {
        localStorage.setItem(WIDTH_KEY, String(next));
      } catch {}
    redraw((n) => n + 1);
  };
  const width = () => Math.round(sheetRef.current?.getBoundingClientRect().width || 0);
  const [min, max] = widthLimits();
  return (
    <div
      class="sheet-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="대화 폭 조절"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width() || undefined}
      tabIndex={0}
      title="끌어서 대화 폭 조절 · 두 번 누르면 기본 폭"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, w: width() };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.classList.add('is-resizing');
      }}
      onPointerMove={(e) => drag.current && set(drag.current.w + e.clientX - drag.current.x, false)}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        document.documentElement.classList.remove('is-resizing');
        set(width());
      }}
      onDblClick={() => {
        applyWidth(0);
        try {
          localStorage.removeItem(WIDTH_KEY);
        } catch {}
        redraw((n) => n + 1);
      }}
      onKeyDown={(e) => {
        const next = {
          ArrowLeft: width() - 24,
          ArrowRight: width() + 24,
          Home: min,
          End: max,
        }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        set(next);
      }}
    />
  );
}

const SNAPS = ['peek', 'half', 'full'];

export function Sheet({ mobile, sheetRef }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const drag = useRef(null);
  const collapsed = !mobile && app.view.collapsed;
  const snap = app.view.sheet;
  const onHandleDown = (e) => {
    if (!mobile) return;
    const el = sheetRef.current;
    drag.current = { y: e.clientY, h: el.getBoundingClientRect().height, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    const el = sheetRef.current;
    el.style.height = `${Math.max(150, Math.min(window.innerHeight - 56, d.h + dy))}px`;
    el.classList.add('is-dragging');
  };
  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    const el = sheetRef.current;
    if (!d || !el) return;
    el.classList.remove('is-dragging');
    if (!d.moved) {
      store.setSheet(SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length]);
      return;
    }
    const h = el.getBoundingClientRect().height / (window.visualViewport?.height || innerHeight);
    el.style.height = '';
    store.setSheet(h < 0.36 ? 'peek' : h < 0.75 ? 'half' : 'full');
  };
  const lastAssistant = [...app.thread].reverse().find((t) => t.role === 'assistant');
  return (
    <aside
      ref={sheetRef}
      class={`sheet ${mobile ? 'is-mobile' : 'is-desktop'} ${collapsed ? 'is-collapsed' : ''}`}
      data-snap={mobile ? snap : undefined}
      aria-label="룸꾸 상담"
    >
      {mobile && (
        <button
          class="sheet-handle"
          aria-label={snap === 'full' ? '대화 줄이기' : '대화 넓히기'}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <span />
        </button>
      )}
      <header class="sheet-head">
        <BrandMark />
        <div class="chat-id">
          <span class="chat-name">
            <strong>룸꾸</strong>
            <span class="sheet-title">방 꾸미기 상담</span>
          </span>
          <Status />
        </div>
        <div class="sheet-actions">
          {app.thread.length > 0 &&
            (confirmClear ? (
              <button
                class="btn small"
                onClick={() => {
                  setConfirmClear(false);
                  store.clearThread();
                }}
              >
                대화 지우기
              </button>
            ) : (
              <button
                class="icon-btn"
                aria-label="새 대화"
                title="새 대화"
                onClick={() => setConfirmClear(true)}
              >
                <Icon name="square-pen" />
              </button>
            ))}
          {!mobile && (
            <button
              class="icon-btn"
              aria-label={collapsed ? '대화 펼치기' : '대화 접기'}
              title={collapsed ? '대화 펼치기' : '대화 접기'}
              onClick={() => store.setCollapsed(!collapsed)}
            >
              <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} />
            </button>
          )}
        </div>
      </header>
      {(collapsed || (mobile && snap === 'peek')) && lastAssistant && (
        <button
          class="collapsed-last"
          onClick={() => (mobile ? store.setSheet('half') : store.setCollapsed(false))}
        >
          <span>{lastAssistant.text}</span>
          <Icon name="chevron-up" size={16} />
        </button>
      )}
      {!collapsed && <Thread mobile={mobile} />}
      <Composer
        mobile={mobile}
        onFocusChange={(f) => {
          if (mobile && f && snap === 'peek') store.setSheet('half');
        }}
      />
      {!mobile && !collapsed && <Resizer sheetRef={sheetRef} />}
    </aside>
  );
}
