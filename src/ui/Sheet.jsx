import { useRef, useState } from 'preact/hooks';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { Icon } from './icons.js';
import { Thread } from './Thread.jsx';
import { Composer } from './Composer.jsx';

export function Brand() {
  return (
    <span class="brand" aria-label="룸꾸">
      <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20V4h16" />
        <rect x="9" y="11" width="8" height="5" rx="1" />
      </svg>
      <span class="brand-name">룸꾸</span>
    </span>
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
        <Brand />
        <span class="sheet-title">이야기하며 꾸미는 방</span>
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
          <span>{lastAssistant.modelReply || lastAssistant.text}</span>
          <Icon name="chevron-up" size={16} />
        </button>
      )}
      {!collapsed && <Thread mobile={mobile} />}
      <Composer
        onFocusChange={(f) => {
          if (mobile && f && snap === 'peek') store.setSheet('half');
        }}
      />
    </aside>
  );
}
