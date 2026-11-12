import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { Stage } from './Stage.jsx';
import { Sheet } from './Sheet.jsx';
import { Icon } from './icons.js';

const MOBILE = 760;

function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(
    () =>
      store.subscribe((kind) => {
        if (kind !== 'move') force();
      }),
    [],
  );
}

// 모바일 키보드가 올라오면 보이는 영역 높이에 맞춰 입력창을 그 위에 둔다.
function useViewport() {
  const [mobile, setMobile] = useState(() => innerWidth < MOBILE);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const h = vv?.height || innerHeight;
      document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
      document.documentElement.style.setProperty('--vv-top', `${Math.round(vv?.offsetTop || 0)}px`);
      setMobile(innerWidth < MOBILE);
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return mobile;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target.closest?.('input,textarea,select,[contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('chat-input')?.focus();
        return;
      }
      if (e.key === 'Escape' && app.selected) store.select(null);
      if (!app.selected) return;
      if (['Delete', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        store.itemAction('delete');
      }
      if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) store.itemAction('rotate');
      const v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
        e.key
      ];
      if (v) {
        e.preventDefault();
        const a = app.state.items.find((x) => x.id === app.selected);
        const step = e.shiftKey ? 0.25 : 0.05;
        store.snapshot();
        store.sceneCallbacks.move(a.id, a.x + v[0] * step, a.z + v[1] * step);
        store.sceneCallbacks.commit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

function Toast() {
  const t = app.view.toast;
  return (
    <div id="toast" class={`toast ${t ? 'is-visible' : ''}`} role="status" aria-live="polite">
      {t?.text}
    </div>
  );
}

export function App() {
  useStore();
  const mobile = useViewport();
  useShortcuts();
  const sheetRef = useRef(null);
  const photoRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    store.registerPhotoInput(photoRef.current);
    store.persist();
    if (app.readError) store.toast('이전 배치를 읽지 못해 예시 방으로 열었어요.');
    window.__roomggu = {
      app,
      anchor: (id, opts) =>
        (app.state.view === '2d' ? app.scenes.plan : app.scenes.three)?.anchor(id, opts),
      ready: () => !!app.scenes.three || app.view.webglError,
    };
    const hide = (e) => {
      store.persist();
      if (!e.persisted) {
        app.scenes.three?.dispose();
        app.scenes.plan?.dispose();
      }
    };
    window.addEventListener('pagehide', hide);
    return () => window.removeEventListener('pagehide', hide);
  }, []);
  return (
    <div
      class={`app ${mobile ? 'is-mobile' : 'is-desktop'} ${dragging ? 'is-dropping' : ''}`}
      onDragOver={(e) => {
        if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
        if (f) store.attachPhoto(f);
        else if ([...(e.dataTransfer?.files || [])].some((x) => x.name.endsWith('.json')))
          store.importJSON(e.dataTransfer.files[0]);
      }}
    >
      <Stage mobile={mobile} sheetRef={sheetRef} />
      <Sheet mobile={mobile} sheetRef={sheetRef} />
      {dragging && (
        <div class="drop-hint" aria-hidden="true">
          <Icon name="image-plus" size={24} />
          가구 사진을 놓으면 대화에 붙어요
        </div>
      )}
      <Toast />
      <input
        id="photo-file"
        ref={photoRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          store.attachPhoto(e.currentTarget.files[0]);
          e.currentTarget.value = '';
        }}
      />
      <input
        id="layout-file"
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          store.importJSON(e.currentTarget.files[0]);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
