import { useEffect, useRef, useState } from 'preact/hooks';
import { TYPES, ROOM_TYPES } from '../catalog.js';
import { layoutWarnings, spaces } from '../data.js';
import { roomOpenings } from '../floorplan.js';
import { avatarLayout, avatarSpace, poseAccepts, POSES } from '../avatar.js';
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
  const list = s.scope === 'house' ? spaces(s) : null;
  const room = JSON.stringify([
      s.scope,
      s.roomId,
      list ? list.map((r) => [r.roomId, r.name, r.room]) : s.room,
      s.floorplan,
      s.grid,
      s.dimensions,
    ]),
    items = JSON.stringify(list ? list.map((r) => r.items) : s.items),
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
    if (fresh || ghostSig !== last.ghost || room !== last.room) sc.setGhost(ghost);
    if (fresh || avatar !== last.avatar || items !== last.items || room !== last.room)
      sc.setAvatar();
    if (fresh || s.scope !== last.scope) sc.home?.();
    else if (room !== last.room && !sc.userMoved) sc.home?.();
  }
  app.scenes.house?.draw();
  last = { room, items, sel: app.selected, warn: warnSig, ghost: ghostSig, avatar, scope: s.scope };
}

// 방과 집 전체를 오가는 길잡이. 지금 범위의 버튼을 다시 누르면 공간 목록이 열린다.
function ScopeNav() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false), open);
  const s = app.state,
    list = spaces(s),
    r = s.room,
    house = s.scope === 'house';
  const close = (fn) => () => {
    setOpen(false);
    fn();
  };
  return (
    <nav class="scope-nav" ref={ref} aria-label="보기 범위">
      <button
        class={`scope-btn scope-house ${house ? 'is-active' : ''}`}
        id="scope-house"
        aria-pressed={house}
        aria-expanded={house ? open : undefined}
        title={house ? '공간 목록' : '집 전체 보기'}
        onClick={() => (house ? setOpen(!open) : (setOpen(false), store.setScope('house')))}
      >
        <Icon name="house" size={16} />
        <span class="scope-label">집 전체</span>
        <span class="scope-count mono" aria-label={`공간 ${list.length}개`}>
          {list.length}
        </span>
        {house && <Icon name="chevron-down" size={16} />}
      </button>
      <button
        class={`scope-btn space-button ${house ? '' : 'is-active'}`}
        id="scope-room"
        aria-pressed={!house}
        aria-expanded={house ? undefined : open}
        title={house ? '이 방 편집' : '공간 목록'}
        onClick={() => (house ? (setOpen(false), store.setScope('room')) : setOpen(!open))}
      >
        <Icon name={ROOM_TYPES[r.type].icon} size={16} />
        <span class="space-name">{s.name}</span>
        <span class="space-dims mono">
          {r.w} × {r.d}m
        </span>
        {!house && <Icon name="chevron-down" size={16} />}
      </button>
      {open && (
        <div class="popover space-pop" role="group" aria-label="공간 목록">
          <span class="pop-label">
            공간 {list.length} / 12 · {house ? '누르면 그 방을 편집해요' : '누르면 그 방으로 가요'}
          </span>
          {list.map((x) => (
            <button
              key={x.roomId}
              aria-current={x.roomId === s.roomId ? 'true' : undefined}
              data-space={x.roomId}
              class={`pop-row ${x.roomId === s.roomId ? 'is-active' : ''}`}
              onClick={close(() => store.editSpace(x.roomId))}
            >
              <Icon name={ROOM_TYPES[x.room.type].icon} size={16} />
              <span>{x.name}</span>
              <small class="mono">
                {x.room.w} × {x.room.d}
              </small>
            </button>
          ))}
          <hr />
          <span class="pop-label">지금 방 옆에 새 공간</span>
          <div class="pop-chips">
            {Object.entries(ROOM_TYPES).map(([k, t]) => (
              <button
                key={k}
                class="chip"
                data-newspace={k}
                disabled={list.length >= 12}
                onClick={close(() => store.addSpace(k))}
              >
                {t.name}
              </button>
            ))}
          </div>
          <hr />
          {!house && (
            <button class="pop-row" onClick={close(() => store.setScope('house'))}>
              <Icon name="house" size={16} />
              <span>집 전체에서 함께 보기</span>
            </button>
          )}
          <button class="pop-row" onClick={close(() => store.openTool('spaces'))}>
            <Icon name="layers" size={16} />
            <span>공간 이름·삭제 관리</span>
          </button>
        </div>
      )}
    </nav>
  );
}

function MoreMenu({ mobile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, () => setOpen(false), open);
  const run = (fn) => () => {
    setOpen(false);
    fn();
  };
  const s = app.state;
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
          {mobile && (
            <>
              {[
                ['grid', '격자 표시', 'grid-2x2'],
                ['snap', '5cm 단위로 움직이기', 'magnet'],
              ].map(([key, label, icon]) => (
                <button
                  key={key}
                  role="menuitemcheckbox"
                  aria-checked={s[key]}
                  id={key}
                  class="pop-row"
                  onClick={() => store.toggle(key)}
                >
                  <Icon name={icon} size={16} />
                  <span>{label}</span>
                  {s[key] && <Icon name="check" size={16} />}
                </button>
              ))}
              <hr />
            </>
          )}
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
  // 앉거나 누울 수 있는 가구는 여기서 바로 아바타를 올려 본다.
  const pose = poseAccepts('lying', a) ? 'lying' : poseAccepts('sitting', a) ? 'sitting' : null,
    layout = avatarLayout(app.state),
    posed = !!pose && layout?.item?.id === a.id,
    poseLabel = pose === 'lying' ? '아바타 눕혀 보기' : '아바타 앉혀 보기';
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
      {pose && (
        <button
          class={`bar-btn bar-pose ${posed ? 'is-on' : ''}`}
          id="pose"
          aria-pressed={posed}
          aria-label={posed ? '아바타 일으키기' : poseLabel}
          title={posed ? '아바타 일으키기' : poseLabel}
          onClick={() => store.setPose(posed ? 'standing' : pose, a.id)}
        >
          <Icon name="person-standing" />
          <span>{posed ? '일으키기' : pose === 'lying' ? '눕히기' : '앉히기'}</span>
        </button>
      )}
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
        class="bar-btn bar-close"
        aria-label="선택 해제"
        title="선택 해제 · Esc"
        onClick={() => store.select(null)}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

// 아바타 이름표. 누르면 자세를 바꾸는 막대로 펼쳐진다. 직접 정한 키는 노란 줄자, 기본 키는 점선이다.
function AvatarTag({ mobile }) {
  const s = app.state,
    a = s.avatar,
    house = s.scope === 'house',
    layout = house
      ? (() => {
          const home = avatarSpace(s, spaces(s));
          return home ? avatarLayout({ ...s, ...home }) : null;
        })()
      : avatarLayout(s);
  // 아바타가 올라간 가구를 고른 동안에는 가구 도구 막대가 그 자리를 쓰므로 이름표를 숨긴다.
  if (!layout || (!house && app.selected && layout.item?.id === app.selected)) return null;
  const set = a.source === '사용자 설정',
    text = `키 ${a.height}cm`;
  const data = { 'data-tag-kind': set ? 'set' : 'draft', 'data-tag-text': text };
  if (house)
    return (
      <span
        class={`stage-tag avatar-tag tape ${set ? 'is-set' : 'is-draft'}`}
        data-avatar-tag
        {...data}
      >
        {text}
      </span>
    );
  // 가구를 고른 동안에는 가구 도구 막대가 자세를 맡으므로 이름표만 남긴다.
  if (!app.view.avatarBar || app.selected)
    return (
      <button
        class={`stage-tag avatar-tag tape ${set ? 'is-set' : 'is-draft'}`}
        data-avatar-tag
        aria-label={`${text} 아바타 · 자세 바꾸기`}
        title={
          set ? '직접 정한 키 · 누르면 자세를 바꿔요' : '비교용 기본 키 · 누르면 자세를 바꿔요'
        }
        onClick={() => store.pickAvatar()}
        {...data}
      >
        {text}
      </button>
    );
  return (
    <div class="stage-tag avatar-bar" data-avatar-tag role="toolbar" aria-label="아바타 자세">
      <button
        class={`tape ${set ? 'is-set' : 'is-draft'}`}
        aria-label={`${text} · 키 바꾸기`}
        title="키 바꾸기"
        onClick={() => {
          if (mobile && app.view.sheet === 'peek') store.setSheet('half');
          store.openTool('avatar');
        }}
        {...data}
      >
        {text}
      </button>
      <div class="segmented" role="group" aria-label="자세">
        {Object.entries(POSE_SHORT).map(([pose, label]) => (
          <button
            key={pose}
            data-pose={pose}
            class={layout.pose === pose ? 'is-active' : ''}
            aria-pressed={layout.pose === pose}
            disabled={pose !== 'standing' && !store.poseTarget(pose)}
            title={
              pose !== 'standing' && !store.poseTarget(pose)
                ? pose === 'lying'
                  ? '이 방에 침대를 놓으면 누울 수 있어요'
                  : '이 방에 의자·소파를 놓으면 앉을 수 있어요'
                : POSES[pose]
            }
            onClick={() => store.setPose(pose)}
          >
            {label}
          </button>
        ))}
      </div>
      {layout.pose === 'standing' && (
        <button
          class="bar-btn bar-turn"
          aria-label="아바타 90도 돌리기"
          title="90° 돌리기"
          onClick={() => store.updateAvatar({ angle: a.angle + 90 }, null)}
        >
          <Icon name="rotate-cw" />
        </button>
      )}
      <button
        class="bar-btn"
        aria-label="아바타 숨기기"
        title="아바타 숨기기"
        onClick={() => store.updateAvatar({ enabled: false }, null)}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
const POSE_SHORT = { standing: '서기', sitting: '앉기', lying: '눕기' };

// 방 편집 화면의 문 이름표. 문 너머가 어느 공간인지 알리고, 누르면 그 공간으로 간다.
function DoorTags() {
  const s = app.state;
  return roomOpenings(spaces(s), s.floorplan, s.roomId).map((o) => (
    <button
      key={o.roomId}
      class="stage-tag door-tag"
      data-door-tag={o.roomId}
      data-tag-kind="room"
      data-tag-text={`${o.name} 문`}
      aria-label={`${o.name}(으)로 가는 문 · 그 공간 편집`}
      title="문 위치는 초안이에요 · 누르면 그 공간으로 가요"
      onClick={() => store.editSpace(o.roomId)}
    >
      <Icon name={ROOM_TYPES[o.type].icon} size={14} />
      <span class="tag-name">{o.name}</span>
      <Icon name="arrow-right" size={14} />
    </button>
  ));
}

// 집 전체에서 공간마다 붙는 이름표. 고른 공간의 이름표에서 바로 방 편집으로 들어간다.
function RoomTags() {
  const s = app.state;
  return spaces(s).map((r) => {
    const selected = r.roomId === s.roomId,
      dims = `${r.room.w} × ${r.room.d}m`;
    return (
      <div
        key={r.roomId}
        class={`stage-tag room-tag ${selected ? 'is-selected' : ''}`}
        data-room-tag={r.roomId}
      >
        <button
          class="tag-main"
          aria-pressed={selected}
          aria-label={`${r.name} ${dims}${selected ? ' · 선택됨' : ' 선택'}`}
          data-tag-kind={selected ? 'selected' : 'room'}
          data-tag-text={s.dimensions ? `${r.name} ${dims}` : r.name}
          onClick={() => store.switchSpace(r.roomId)}
          onDblClick={() => store.editSpace(r.roomId)}
        >
          <Icon name={ROOM_TYPES[r.room.type].icon} size={14} />
          <span class="tag-name">{r.name}</span>
          {s.dimensions && <span class="tag-dims mono">{dims}</span>}
        </button>
        {selected && (
          <button
            class="tag-edit"
            aria-label="선택한 방 편집"
            onClick={() => store.editSpace(r.roomId)}
          >
            방 편집
            <Icon name="arrow-right" size={14} />
          </button>
        )}
      </div>
    );
  });
}

export function Stage({ mobile, sheetRef }) {
  const host3d = useRef(null),
    host2d = useRef(null),
    hostHouse = useRef(null),
    stageRef = useRef(null),
    barRef = useRef(null),
    tagsRef = useRef(null);
  const activeScene = () =>
    app.state.view === '3d'
      ? app.scenes.three
      : app.state.scope === 'house'
        ? app.scenes.house
        : app.scenes.plan;
  const bounds = () => {
    const css = getComputedStyle(document.documentElement),
      r = stageRef.current.getBoundingClientRect();
    return {
      r,
      left: (parseFloat(css.getPropertyValue('--inset-left')) || 0) + 8,
      bottom: r.height - (parseFloat(css.getPropertyValue('--inset-bottom')) || 0) - 8,
    };
  };
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
    const { r, left, bottom } = bounds(),
      bw = bar.offsetWidth,
      bh = bar.offsetHeight;
    const x = Math.max(left, Math.min(r.width - bw - 8, p.x - r.left - bw / 2));
    const y = Math.max(64, Math.min(bottom - bh, p.y - r.top - bh - 12));
    bar.style.opacity = '1';
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  // 이름표를 장면의 기준점에 붙인다. 3D에서는 겹치는 이름표를 아래로 밀어 서로 가리지 않게 한다.
  const placeTags = () => {
    const layer = tagsRef.current,
      sc = activeScene();
    if (!layer || !stageRef.current || !sc) return;
    const { r, left, bottom } = bounds(),
      placed = [];
    // 가구 도구 막대가 떠 있으면 이름표가 그 아래로 숨지 않게 자리를 비켜 준다.
    const bar = barRef.current;
    if (bar && !bar.hidden && bar.style.opacity !== '0' && app.selected) {
      const b = bar.getBoundingClientRect();
      placed.push({ x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height });
    }
    const put = (el, x, y) => {
      const w = el.offsetWidth,
        h = el.offsetHeight;
      x = Math.max(left, Math.min(r.width - w - 8, x));
      y = Math.max(56, Math.min(bottom - h, y));
      for (const o of placed)
        if (x < o.x + o.w + 4 && x + w + 4 > o.x && y < o.y + o.h + 4 && y + h + 4 > o.y)
          y = o.y + o.h + 4;
      placed.push({ x, y, w, h });
      el.style.visibility = '';
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    const tags = [...layer.querySelectorAll('[data-room-tag]')]
      .map((el) => ({ el, p: sc.tagAnchor?.(el.dataset.roomTag) }))
      .sort((a, b) => (a.p?.y || 0) - (b.p?.y || 0));
    for (const { el, p } of tags) {
      if (!p || !p.visible) {
        el.style.visibility = 'hidden';
        continue;
      }
      // 좁은 공간에서는 이름을 남기고 크기 표시를 먼저 접는다. 글자 수로 어림해 매 프레임 바뀌지 않게 한다.
      const room = p.corner && !el.classList.contains('is-selected') ? p.width - 16 : Infinity,
        name = el.querySelector('.tag-name')?.textContent.length || 0;
      el.style.maxWidth = Number.isFinite(room) ? `${Math.max(44, Math.round(room))}px` : '';
      el.classList.toggle('is-narrow', room < name * 12 + 112);
      if (p.corner) put(el, p.x - r.left + 8, p.y - r.top + 8);
      else put(el, p.x - r.left - el.offsetWidth / 2, p.y - r.top - el.offsetHeight - 4);
    }
    const doors = sc.doorAnchors?.() || [];
    for (const el of layer.querySelectorAll('[data-door-tag]')) {
      const p = doors.find((d) => d.roomId === el.dataset.doorTag);
      if (!p || !p.visible) el.style.visibility = 'hidden';
      else put(el, p.x - r.left - el.offsetWidth / 2, p.y - r.top - el.offsetHeight / 2);
    }
    const tag = layer.querySelector('[data-avatar-tag]'),
      p = tag && sc.avatarAnchor?.();
    if (tag && (!p || !p.visible)) tag.style.visibility = 'hidden';
    else if (tag) put(tag, p.x - r.left - tag.offsetWidth / 2, p.y - r.top - tag.offsetHeight - 6);
  };
  const place = () => {
    placeBar();
    placeTags();
  };
  useEffect(() => {
    const houseCallbacks = {
      selectSpace: store.switchSpace,
      editSpace: store.editSpace,
    };
    app.scenes.plan = new PlanScene(host2d.current, app.state, store.sceneCallbacks);
    app.scenes.house = new HouseScene(hostHouse.current, app.state, {
      ...houseCallbacks,
      start: store.snapshot,
      moveSpace: (id, x, z) => store.moveSpace(id, x, z, { live: true }),
      commit: () => {
        store.persist();
        store.emit();
      },
    });
    // 저장하는 이미지에도 화면의 이름표를 같은 자리에 그린다.
    app.scenes.tags = () => {
      const stage = stageRef.current.getBoundingClientRect();
      return [...(tagsRef.current?.querySelectorAll('[data-tag-kind]') || [])]
        .filter((el) => el.closest('.stage-tag').style.visibility !== 'hidden')
        .map((el) => {
          const b = el.getBoundingClientRect();
          return {
            x: b.left - stage.left,
            y: b.top - stage.top,
            w: b.width,
            h: b.height,
            kind: el.dataset.tagKind,
            text: el.dataset.tagText,
          };
        });
    };
    let disposed = false;
    const fontsReady = document.fonts?.ready || Promise.resolve();
    import('../scene.js')
      .then(async ({ RoomScene }) => {
        if (disposed) return;
        app.scenes.three = new RoomScene(host3d.current, app.state, {
          ...store.sceneCallbacks,
          ...houseCallbacks,
          frame: place,
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
      if (kind === 'move') return place();
      syncScenes();
      requestAnimationFrame(place);
    });
    const applyInsets = () => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const r = sheet.getBoundingClientRect();
      const vh = window.visualViewport?.height || innerHeight;
      const isMobile = innerWidth < 760;
      // 모바일에서는 방 아래 도구 줄만큼 더 띄워 모형이 버튼에 가리지 않게 한다.
      const insets = isMobile
        ? { top: 56, bottom: Math.max(0, vh - r.top) + 48 }
        : sheet.classList.contains('is-collapsed')
          ? { left: 0, bottom: Math.max(0, innerHeight - r.top) + 8, top: 56 }
          : { left: r.right + 8, top: 56, bottom: 48 };
      const sheetBottom = isMobile ? Math.max(0, vh - r.top) : insets.left ? 0 : insets.bottom;
      document.documentElement.style.setProperty('--inset-left', `${insets.left || 0}px`);
      document.documentElement.style.setProperty('--inset-bottom', `${sheetBottom}px`);
      // 접은 시트는 왼쪽 아래 구석만 차지하므로 방 아래 도구는 화면 맨 아래에 둔다.
      document.documentElement.style.setProperty(
        '--controls-bottom',
        `${isMobile ? sheetBottom : 0}px`,
      );
      app.scenes.three?.setInsets(insets);
      app.scenes.plan?.setInsets(insets);
      app.scenes.house?.setInsets(insets);
      place();
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
    requestAnimationFrame(place);
  }, [app.state.view, app.state.scope, app.view.collapsed, app.view.sheet, mobile]);
  const s = app.state,
    warn = layoutWarnings(s);
  const house = s.scope === 'house';
  // 화장실은 설비 초안이 이미 놓여 있으므로 빈 방 안내를 띄우지 않는다.
  const empty = !house && !s.items.length && !app.draft && s.room.type !== 'bathroom';
  const avatarOn = !!avatarLayout(s);
  const history = (
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
  );
  return (
    <main class="stage" ref={stageRef} aria-label={house ? '집 전체 미리보기' : '방 미리보기'}>
      <div id="viewport-3d" class="viewport" ref={host3d} hidden={s.view !== '3d'} />
      <div id="viewport-2d" class="viewport" ref={host2d} hidden={house || s.view !== '2d'} />
      <div
        id="viewport-house"
        class="viewport"
        ref={hostHouse}
        hidden={!house || s.view !== '2d'}
      />
      <div class="stage-tags" ref={tagsRef}>
        {house ? <RoomTags /> : <DoorTags />}
        <AvatarTag mobile={mobile} />
      </div>
      <div class="stage-top">
        <ScopeNav />
        <div class="stage-tools">
          {!mobile && history}
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
                title={k === '2d' ? '위에서 본 평면도' : '돌려 보는 입체 모형'}
                onClick={() => store.setView(k)}
              >
                {l}
              </button>
            ))}
          </div>
          <MoreMenu mobile={mobile} />
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
        {mobile ? (
          history
        ) : (
          <span class="stage-hint">
            {house
              ? s.view === '3d'
                ? '끌어서 돌려 보기 · 공간을 눌러 고르고 두 번 눌러 편집'
                : '공간을 끌어 집 모양 맞추기 · 벽이 닿으면 문이 이어져요 · 두 번 눌러 편집'
              : s.view === '2d'
                ? '가구를 끌어 옮기기 · 방향키로 5cm씩'
                : '빈 곳을 끌어 돌리기 · 휠로 확대 · 가구 끌어 옮기기'}
          </span>
        )}
        <div class="tool-group">
          <button
            class={`icon-btn on-stage ${avatarOn ? 'is-on' : ''}`}
            id="avatar-toggle"
            aria-pressed={avatarOn}
            aria-label="내 키 아바타 표시"
            title={avatarOn ? '아바타 숨기기' : '내 키로 크기 비교 · 아바타 세우기'}
            onClick={() => {
              if (mobile && !avatarOn && app.view.sheet === 'full') store.setSheet('half');
              store.toggleAvatar();
            }}
          >
            <Icon name="person-standing" />
          </button>
          {!mobile && (
            <>
              <button
                class={`icon-btn on-stage ${s.grid ? 'is-on' : ''}`}
                id="grid"
                aria-pressed={s.grid}
                aria-label="격자 표시"
                title={house ? '격자 50cm · 화장실 타일 30cm' : '격자 25cm'}
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
            </>
          )}
          <button
            class={`icon-btn on-stage ${s.dimensions ? 'is-on' : ''}`}
            id="dimension"
            aria-pressed={s.dimensions}
            aria-label="치수 표시"
            title="치수와 이름표의 크기 표시"
            onClick={() => store.toggle('dimensions')}
          >
            <Icon name="ruler" />
          </button>
        </div>
        <div class="tool-group">
          <button
            class="icon-btn on-stage"
            id="home"
            aria-label={house ? '집 전체를 화면에 맞추기' : '방 전체 보기'}
            title={house ? '집 전체를 화면에 맞추기' : '방 전체 보기'}
            onClick={() => (
              app.scenes.three?.home(),
              app.scenes.plan?.draw(),
              app.scenes.house?.draw()
            )}
          >
            <Icon name="maximize-2" />
          </button>
          {s.view === '3d' && (
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
