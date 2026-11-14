import { useEffect, useRef, useState } from 'preact/hooks';
import { TYPES, ROOM_TYPES } from '../catalog.js';
import { layoutWarnings, spaces } from '../data.js';
import { PlanScene } from '../plan.js';
import { HouseScene } from '../house.js';
import { clearTapes } from '../tape.js';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { findFreeSpot, fitStatus } from '../app/ops.js';
import { Icon } from './icons.js';
import { useOutside } from './widgets.jsx';

// 초안과 규격 미리보기를 방 안의 점선 가구로 계산한다.
export function ghostItem() {
  const s = app.state,
    p = app.view.preview;
  if (p?.target?.type === 'item') {
    const a = s.items.find((x) => x.id === p.target.id);
    if (a) {
      const g = { ...a, id: 'ghost', dims: p.dims };
      return { ...g, fit: fitStatus(s, g) };
    }
  }
  const d = app.draft;
  if (!d) return null;
  const cand = { ...d, id: 'ghost', dims: p?.target?.type === 'draft' ? p.dims : d.dims };
  const spot = findFreeSpot(s, cand);
  const g = { ...cand, x: spot.x, z: spot.z, angle: spot.angle };
  return { ...g, fit: spot.free ? 'fits' : fitStatus(s, g) };
}

let last = {};
const known = new WeakSet();
function syncScenes(force = false) {
  const s = app.state;
  const room = JSON.stringify([s.roomId, s.room, s.grid, s.dimensions]),
    items = JSON.stringify(s.items),
    warn = layoutWarnings(s),
    warnSig = [...warn.all].join(),
    ghost = ghostItem(),
    ghostSig = JSON.stringify(ghost),
    avatar = JSON.stringify(s.avatar);
  for (const sc of [app.scenes.three, app.scenes.plan]) {
    if (!sc) continue;
    const fresh = force || !known.has(sc);
    known.add(sc);
    if (fresh || room !== last.room) sc.renderRoom();
    if (fresh || items !== last.items || room !== last.room) sc.sync();
    if (fresh || items !== last.items || app.selected !== last.sel || warnSig !== last.warn)
      sc.decorate(app.selected, warn.all);
    if (fresh || ghostSig !== last.ghost) sc.setGhost(ghost);
    if (fresh || avatar !== last.avatar || items !== last.items || room !== last.room)
      sc.setAvatar();
  }
  app.scenes.house?.draw();
  last = { room, items, sel: app.selected, warn: warnSig, ghost: ghostSig, avatar };
}

function SpaceSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false), open);
  const list = spaces(app.state),
    r = app.state.room;
  return (
    <div class="space-switch" ref={ref}>
      <button
        class="space-button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={ROOM_TYPES[r.type].icon} size={16} />
        <span class="space-name">{app.state.scope === 'house' ? '집 전체' : app.state.name}</span>
        <span class="space-dims mono">
          {app.state.scope === 'house' ? `${list.length}개 공간` : `${r.w} × ${r.d}m`}
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div class="popover space-pop" role="menu">
          <button
            class="pop-row"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              store.openTool('floorplan');
            }}
          >
            <Icon name="house" size={16} />
            <span>집 전체 평면도</span>
          </button>
          <hr />
          <span class="pop-label">공간 {list.length} / 12</span>
          {list.map((x) => (
            <button
              key={x.roomId}
              role="menuitemradio"
              aria-checked={x.roomId === app.state.roomId}
              data-space={x.roomId}
              class={`pop-row ${x.roomId === app.state.roomId ? 'is-active' : ''}`}
              onClick={() => {
                setOpen(false);
                store.switchSpace(x.roomId);
              }}
            >
              <Icon name={ROOM_TYPES[x.room.type].icon} size={16} />
              <span>{x.name}</span>
              <small class="mono">
                {x.room.w} × {x.room.d}
              </small>
            </button>
          ))}
          <hr />
          <span class="pop-label">새 공간</span>
          <div class="pop-chips">
            {Object.entries(ROOM_TYPES).map(([k, t]) => (
              <button
                key={k}
                class="chip"
                data-newspace={k}
                disabled={list.length >= 12}
                onClick={() => {
                  setOpen(false);
                  store.addSpace(k);
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
          <button
            class="pop-row"
            onClick={() => {
              setOpen(false);
              store.openTool('spaces');
            }}
          >
            <Icon name="layers" size={16} />
            <span>공간 이름·삭제 관리</span>
          </button>
        </div>
      )}
    </div>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false), open);
  const run = (fn) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div class="more" ref={ref}>
      <button
        class="icon-btn on-stage"
        aria-label="파일과 설정"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="ellipsis" />
      </button>
      {open && (
        <div class="popover more-pop" role="menu">
          <button role="menuitem" id="export" class="pop-row" onClick={run(store.exportJSON)}>
            <Icon name="download" size={16} />
            <span>배치 파일 저장</span>
          </button>
          <button
            role="menuitem"
            id="import"
            class="pop-row"
            onClick={run(() => document.getElementById('layout-file').click())}
          >
            <Icon name="upload" size={16} />
            <span>배치 파일 불러오기</span>
          </button>
          <button role="menuitem" id="png" class="pop-row" onClick={run(store.exportPNG)}>
            <Icon name="camera" size={16} />
            <span>지금 화면 이미지로 저장</span>
          </button>
          <hr />
          <button role="menuitem" class="pop-row" onClick={run(() => store.openTool('ai'))}>
            <Icon name="cpu" size={16} />
            <span>이 기기의 AI</span>
          </button>
          <button role="menuitem" class="pop-row" onClick={run(() => store.openTool('help'))}>
            <Icon name="circle-help" size={16} />
            <span>사용 방법</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ObjectBar({ barRef, mobile }) {
  const a = app.state.items.find((x) => x.id === app.selected);
  if (!a) return <div class="object-bar" ref={barRef} hidden />;
  const open = (kind) => {
    if (mobile && app.view.sheet === 'peek') store.setSheet('half');
    store.openTool(kind, { target: { type: 'item', id: a.id } });
  };
  return (
    <div
      class="object-bar"
      ref={barRef}
      id="selection-tools"
      role="toolbar"
      aria-label={`${a.name} 도구`}
    >
      <span class="object-name">
        <span class="dot" style={{ background: a.color }} />
        <strong>{a.name}</strong>
        <small class="mono">
          {a.dims[0]} × {a.dims[2]} × {a.dims[1]}
        </small>
      </span>
      <button
        class="bar-btn"
        aria-label="크기 바꾸기"
        title="크기"
        onClick={() => open('furniture-size')}
      >
        <Icon name="ruler" />
      </button>
      <button
        class="bar-btn"
        aria-label="색 바꾸기"
        title="색"
        onClick={() => open('furniture-color')}
      >
        <Icon name="palette" />
      </button>
      <button
        class="bar-btn"
        id="rotate"
        aria-label="90도 회전"
        title="90° 회전 · R"
        onClick={() => store.itemAction('rotate')}
      >
        <Icon name="rotate-cw" />
      </button>
      <button
        class="bar-btn"
        id="duplicate"
        aria-label="가구 복제"
        title="복제"
        onClick={() => store.itemAction('duplicate')}
      >
        <Icon name="copy" />
      </button>
      <button
        class="bar-btn danger"
        id="delete"
        aria-label="가구 삭제"
        title="삭제 · Delete"
        onClick={() => store.itemAction('delete')}
      >
        <Icon name="trash-2" />
      </button>
      <button
        class="bar-btn"
        aria-label="선택 해제"
        title="선택 해제 · Esc"
        onClick={() => store.select(null)}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

export function Stage({ mobile, sheetRef }) {
  const host3d = useRef(null),
    host2d = useRef(null),
    hostHouse = useRef(null),
    stageRef = useRef(null),
    barRef = useRef(null);
  const placeBar = () => {
    const bar = barRef.current,
      stage = stageRef.current;
    if (!bar || !stage || !app.selected || app.state.scope === 'house') return;
    const sc = app.state.view === '2d' ? app.scenes.plan : app.scenes.three;
    const p = sc?.anchor(app.selected);
    if (!p || !p.visible) {
      bar.style.opacity = '0';
      return;
    }
    const r = stage.getBoundingClientRect(),
      bw = bar.offsetWidth,
      bh = bar.offsetHeight;
    const insetL =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-left')) || 0;
    const insetB =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom')) ||
      0;
    const x = Math.max(insetL + 8, Math.min(r.width - bw - 8, p.x - r.left - bw / 2));
    const y = Math.max(64, Math.min(r.height - insetB - bh - 8, p.y - r.top - bh - 12));
    bar.style.opacity = '1';
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  useEffect(() => {
    app.scenes.plan = new PlanScene(host2d.current, app.state, store.sceneCallbacks);
    app.scenes.house = new HouseScene(hostHouse.current, app.state, {
      start: store.snapshot,
      selectSpace: store.switchSpace,
      editSpace: (id) => {
        store.switchSpace(id);
        store.setScope('room');
      },
      moveSpace: (id, x, z) => store.moveSpace(id, x, z, { live: true }),
      commit: () => {
        store.persist();
        store.emit();
      },
    });
    let disposed = false;
    const fontsReady = document.fonts?.ready || Promise.resolve();
    import('../scene.js')
      .then(async ({ RoomScene }) => {
        if (disposed) return;
        app.scenes.three = new RoomScene(host3d.current, app.state, {
          ...store.sceneCallbacks,
          frame: placeBar,
        });
        syncScenes(true);
        applyInsets();
        store.emit();
      })
      .catch((e) => {
        console.warn('3D unavailable:', e?.message);
        app.view.webglError = true;
        app.state.view = '2d';
        store.toast('이 기기에서 3D를 준비하지 못해 2D 평면으로 열었어요.');
      });
    fontsReady.then(() => {
      clearTapes();
      syncScenes(true);
    });
    syncScenes(true);
    const unsub = store.subscribe((kind) => {
      if (kind === 'move') return placeBar();
      syncScenes();
      requestAnimationFrame(placeBar);
    });
    const applyInsets = () => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const r = sheet.getBoundingClientRect();
      const vh = window.visualViewport?.height || innerHeight;
      const isMobile = innerWidth < 760;
      const insets = isMobile
        ? { top: 56, bottom: Math.max(0, vh - r.top) }
        : sheet.classList.contains('is-collapsed')
          ? { left: 0, bottom: Math.max(0, innerHeight - r.top) + 8, top: 56 }
          : { left: r.right + 8, top: 56 };
      document.documentElement.style.setProperty('--inset-left', `${insets.left || 0}px`);
      document.documentElement.style.setProperty('--inset-bottom', `${insets.bottom || 0}px`);
      // 접은 시트는 왼쪽 아래 구석만 차지하므로 방 아래 도구는 화면 맨 아래에 둔다.
      document.documentElement.style.setProperty(
        '--controls-bottom',
        `${isMobile ? insets.bottom || 0 : 0}px`,
      );
      app.scenes.three?.setInsets(insets);
      app.scenes.plan?.setInsets(insets);
      app.scenes.house?.setInsets(insets);
      placeBar();
    };
    const ro = new ResizeObserver(applyInsets);
    if (sheetRef.current) ro.observe(sheetRef.current);
    window.addEventListener('resize', applyInsets);
    const t = setTimeout(applyInsets, 50);
    return () => {
      disposed = true;
      unsub();
      ro.disconnect();
      clearTimeout(t);
      window.removeEventListener('resize', applyInsets);
      app.scenes.plan?.dispose();
      app.scenes.house?.dispose();
      app.scenes.three?.dispose();
    };
  }, []);
  useEffect(() => {
    app.scenes.plan?.draw();
    app.scenes.house?.draw();
    app.scenes.three?.invalidate();
    requestAnimationFrame(placeBar);
  }, [app.state.view, app.state.scope, app.view.collapsed, app.view.sheet, mobile]);
  const s = app.state,
    warn = layoutWarnings(s);
  const house = s.scope === 'house';
  const empty = !house && !s.items.length && !app.draft;
  return (
    <main class="stage" ref={stageRef} aria-label="방 미리보기">
      <div id="viewport-3d" class="viewport" ref={host3d} hidden={house || s.view !== '3d'} />
      <div id="viewport-2d" class="viewport" ref={host2d} hidden={house || s.view !== '2d'} />
      <div id="viewport-house" class="viewport" ref={hostHouse} hidden={!house} />
      <div class="stage-top">
        <SpaceSwitcher />
        <div class="stage-tools">
          <div class="tool-group">
            <button
              class="icon-btn on-stage"
              id="undo"
              aria-label="실행 취소"
              title="실행 취소 · ⌘/Ctrl Z"
              disabled={!app.history.length}
              onClick={store.undo}
            >
              <Icon name="undo-2" />
            </button>
            <button
              class="icon-btn on-stage"
              id="redo"
              aria-label="다시 실행"
              title="다시 실행 · ⌘/Ctrl ⇧ Z"
              disabled={!app.future.length}
              onClick={store.redo}
            >
              <Icon name="redo-2" />
            </button>
          </div>
          {house ? (
            <button class="btn small on-stage" onClick={() => store.setScope('room')}>
              선택한 방 편집
            </button>
          ) : (
            <div class="segmented on-stage" role="group" aria-label="보기 방식">
              {[
                ['2d', '2D'],
                ['3d', '3D'],
              ].map(([k, l]) => (
                <button
                  key={k}
                  data-view={k}
                  class={s.view === k ? 'is-active' : ''}
                  aria-pressed={s.view === k}
                  onClick={() => store.setView(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <MoreMenu />
        </div>
      </div>
      {!house && warn.all.size > 0 && (
        <div class="stage-warning" id="warning" role="status">
          <Icon name="triangle-alert" size={16} />
          <span>
            {warn.oversized.size
              ? `방을 넘는 가구 ${warn.oversized.size}개`
              : `겹친 가구 ${warn.conflicts.size}개`}
          </span>
          <button class="link" onClick={() => store.relocate()}>
            빈자리로 옮기기
          </button>
        </div>
      )}
      {empty && (
        <div class="stage-empty" id="stage-empty">
          <strong>이 방은 비어 있어요</strong>
          <span>가구를 말하거나 고르면 점선 초안이 여기 먼저 나타나요.</span>
          <button class="btn small" onClick={() => store.openTool('catalog')}>
            가구 고르기
          </button>
        </div>
      )}
      {!house && app.draft && !app.selected && (
        <div class="draft-note" role="status">
          <span class="tape is-draft">점선</span>
          {TYPES[app.draft.type].name} 초안 · 아직 놓지 않았어요
          <button class="link" onClick={() => store.placeDraft()}>
            놓기
          </button>
        </div>
      )}
      {!house && <ObjectBar barRef={barRef} mobile={mobile} />}
      <div class="stage-bottom">
        <span class="stage-hint">
          {house
            ? '공간을 끌어 배치 · 더블클릭으로 방 편집 · 문은 연결 초안'
            : s.view === '2d'
              ? '가구를 끌어 옮기기 · 방향키로 5cm씩'
              : '빈 곳을 끌어 돌리기 · 휠로 확대 · 가구 끌어 옮기기'}
        </span>
        <div class="tool-group">
          <button
            class={`icon-btn on-stage ${s.grid ? 'is-on' : ''}`}
            id="grid"
            aria-pressed={s.grid}
            aria-label="격자 표시"
            title="격자 25cm"
            onClick={() => store.toggle('grid')}
          >
            <Icon name="grid-2x2" />
          </button>
          <button
            class={`icon-btn on-stage ${s.snap ? 'is-on' : ''}`}
            id="snap"
            aria-pressed={s.snap}
            aria-label="5cm 단위 이동"
            title="5cm 단위로 움직이기"
            onClick={() => store.toggle('snap')}
          >
            <Icon name="magnet" />
          </button>
          <button
            class={`icon-btn on-stage ${s.dimensions ? 'is-on' : ''}`}
            id="dimension"
            aria-pressed={s.dimensions}
            aria-label="치수 표시"
            title="치수 표시"
            onClick={() => store.toggle('dimensions')}
          >
            <Icon name="ruler" />
          </button>
        </div>
        <div class="tool-group">
          <button
            class="icon-btn on-stage"
            id="home"
            aria-label="방 전체 보기"
            title="방 전체 보기"
            onClick={() => (
              app.scenes.three?.home(),
              app.scenes.plan?.draw(),
              app.scenes.house?.draw()
            )}
          >
            <Icon name="maximize-2" />
          </button>
          {!house && s.view === '3d' && (
            <>
              <button
                class="icon-btn on-stage zoom-btn"
                aria-label="확대"
                onClick={() => app.scenes.three?.zoom(0.85)}
              >
                <Icon name="plus" />
              </button>
              <button
                class="icon-btn on-stage zoom-btn"
                aria-label="축소"
                onClick={() => app.scenes.three?.zoom(1.18)}
              >
                <Icon name="minus" />
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
