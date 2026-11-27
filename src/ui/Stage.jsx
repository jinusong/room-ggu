import { WindowControls } from './WindowControls.jsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { TYPES, ROOM_TYPES } from '../catalog.js';
import { layoutWarnings, spaces } from '../data.js';
import { connections, DOOR } from '../floorplan.js';
import { avatarLayout, avatarSpace, poseAccepts, POSES } from '../avatar.js';
import { RoomEditor } from './RoomEditor.jsx';
import { HouseScene } from '../house.js';
import { clearTapes } from '../tape.js';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { findFreeSpot, fitStatus } from '../app/ops.js';
import { Icon } from './icons.js';
import { josa } from '../app/text.js';
import { useOutside, useMenu } from './widgets.jsx';

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

function syncScene() {
  const scene = app.scenes.house;
  if (!scene) return;
  scene.selected = app.selected;
  scene.warnings = layoutWarnings(app.state).all;
  scene.doorSelected = app.view.door;
  scene.ghostItem = ghostItem();
  scene.ghostRoom = app.view.ghostRoom;
  scene.reserve = store.addReserve();
  scene.draw();
}

function MoreMenu({ mobile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuKeys = useMenu(ref, open, setOpen);
  const run = (fn) => (event) => {
    menuKeys.close(event.detail === 0);
    fn();
  };
  const s = app.state;
  return (
    <div class="more" ref={ref} onKeyDown={menuKeys.onKeyDown}>
      <button class="icon-btn on-stage" aria-label="파일과 설정" {...menuKeys.trigger}>
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
      role="group"
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
        title="90° 회전 (R)"
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
        title="삭제 (Delete)"
        onClick={() => store.itemAction('delete')}
      >
        <Icon name="trash-2" />
      </button>
      <button
        class="bar-btn bar-close"
        aria-label="선택 해제"
        title="선택 해제 (Esc)"
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
    home = avatarSpace(s, spaces(s)),
    layout = home && avatarLayout({ ...s, ...home });
  // 아바타가 올라간 가구를 고른 동안에는 가구 도구 막대가 그 자리를 쓰므로 이름표를 숨긴다.
  if (!layout || (app.selected && layout.item?.id === app.selected)) return null;
  const set = a.source === '사용자 설정',
    text = `키 ${a.height}cm`;
  const data = { 'data-tag-kind': set ? 'set' : 'draft', 'data-tag-text': text };
  // 가구를 고른 동안에는 가구 도구 막대가 자세를 맡으므로 이름표만 남긴다.
  if (!app.view.avatarBar || app.selected || s.roomId !== home.roomId)
    return (
      <button
        class={`stage-tag avatar-tag tape ${set ? 'is-set' : 'is-draft'}`}
        data-avatar-tag
        aria-label={`${text} 아바타, 자세 바꾸기`}
        title={set ? '직접 정한 키, 누르면 자세를 바꿔요' : '비교용 기본 키, 누르면 자세를 바꿔요'}
        onClick={() => {
          store.switchSpace(home.roomId);
          store.pickAvatar();
        }}
        {...data}
      >
        {text}
      </button>
    );
  return (
    <div class="stage-tag avatar-bar" data-avatar-tag role="group" aria-label="아바타 자세">
      <button
        class={`tape ${set ? 'is-set' : 'is-draft'}`}
        aria-label={`${text}, 키 바꾸기`}
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
                  : '이 방에 의자나 소파를 놓으면 앉을 수 있어요'
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

// 2D에서 고른 문 위에 뜨는 막대. 문은 끌어서 옮기고, 폭·여는 방향·막기는 여기서 바꾼다.
function DoorBar() {
  const s = app.state,
    ids = app.view.door;
  if (!ids) return null;
  const link = connections(spaces(s), s.floorplan).find(
    (c) => c.ids.includes(ids[0]) && c.ids.includes(ids[1]),
  );
  if (!link?.opening) return null;
  const [a, b] = link.ids,
    cm = Math.round(link.width * 100),
    set = link.door.width !== undefined,
    max = Math.min(DOOR.max * 100, Math.floor((link.length - 0.1) * 100 + 1e-6));
  return (
    <div
      class="stage-tag door-bar"
      data-door-bar
      role="group"
      aria-label={`${josa(link.names[0], '과/와')} ${link.names[1]} 사이 문`}
    >
      <button
        class="bar-btn"
        aria-label="문 폭 5cm 줄이기"
        title="폭 줄이기"
        disabled={cm - 5 < DOOR.min * 100}
        onClick={() => store.setDoor(a, b, { width: (cm - 5) / 100 })}
      >
        <Icon name="minus" />
      </button>
      <span
        class={`tape ${set ? 'is-set' : 'is-draft'}`}
        data-door-width
        title={set ? '직접 정한 문 폭' : '문 폭 80cm는 가정값이에요. 실제 문에 맞게 바꿔 주세요'}
      >
        문 {cm}cm
      </span>
      <button
        class="bar-btn"
        aria-label="문 폭 5cm 늘리기"
        title="폭 늘리기"
        disabled={cm + 5 > max}
        onClick={() => store.setDoor(a, b, { width: (cm + 5) / 100 })}
      >
        <Icon name="plus" />
      </button>
      <button
        class="bar-btn"
        aria-label="문 여는 방향 바꾸기"
        title="여는 방향 바꾸기"
        onClick={() => store.setDoor(a, b, { flip: !link.door.flip })}
      >
        <Icon name="flip" />
      </button>
      <button class="bar-btn bar-text" data-door-close onClick={() => store.closeDoor(a, b)}>
        문 막기
      </button>
      <button
        class="bar-btn"
        aria-label="문 막대 닫기"
        title="닫기"
        onClick={() => store.pickDoor(null)}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

const SIDE_NAMES = { right: '오른쪽', left: '왼쪽', back: '위쪽', front: '아래쪽' };
// 집 전체 위쪽의 공간 추가 버튼. 고른 공간에서 비어 있는 첫 벽의 고르기 창을 연다.
function AddSpaceButton({ trigger }) {
  const sides = store.freeSides(),
    full = spaces(app.state).length >= 12,
    open = !!app.view.addSide;
  return (
    <button
      class={`add-space on-stage ${open ? 'is-open' : ''}`}
      id="add-space"
      aria-label="방 추가"
      aria-expanded={open}
      disabled={!sides.length}
      title={
        full
          ? '공간은 12개까지 만들 수 있어요'
          : sides.length
            ? `${app.state.name} 옆에 공간 붙이기`
            : '고른 공간 둘레에 붙일 자리가 없어요. 다른 공간을 고르거나 옮겨 주세요'
      }
      onClick={(event) => {
        trigger.current = event.currentTarget;
        store.pickAddSide(open ? null : sides[0]);
      }}
    >
      <Icon name="plus" size={16} />
      <span>추가</span>
    </button>
  );
}
// 집 전체에서 고른 공간의 벽 바깥에 뜨는 + 손잡이. 누르면 그 벽에 붙일 공간을 고른다.
function AddHandles({ trigger }) {
  const s = app.state;
  const sides = store.freeSides(),
    picked = app.view.addSide;
  return (
    <>
      {sides.map((side) => (
        <button
          key={side}
          class={`stage-tag add-handle ${picked === side ? 'is-open' : ''}`}
          data-add-side={side}
          aria-label={`${s.name} ${SIDE_NAMES[side]}에 공간 붙이기`}
          aria-expanded={picked === side}
          title={`${SIDE_NAMES[side]}에 공간 붙이기`}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            store.pickAddSide(picked === side ? null : side);
          }}
        >
          <Icon name="plus" size={16} />
        </button>
      ))}
    </>
  );
}
// 그 벽에 붙일 공간 고르기. 가리키거나 초점을 두면 도면에 자리와 크기가 점선으로 보인다.
// 좁은 화면에서는 모형을 가리지 않게 방 아래 도구 줄 위에 옆으로 넘기는 줄로 깐다.
function AddRoomPop({ side, sides, onClose }) {
  const ref = useRef(null);
  useLayoutEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div class="editor-pop add-pop-standalone" data-add-list role="group" aria-label="방 추가">
      <div class="editor-pop-head">
        <strong>방 추가</strong>
        <button class="icon-btn" aria-label="방 추가 닫기" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <label class="editor-side">
        <span>붙일 위치</span>
        <select
          ref={ref}
          value={side}
          onChange={(event) => store.pickAddSide(event.currentTarget.value)}
        >
          {sides.map((key) => (
            <option key={key} value={key}>
              {SIDE_NAMES[key]}
            </option>
          ))}
        </select>
      </label>
      <div
        class="add-grid"
        onPointerLeave={() => store.previewSpace(null)}
        onFocusOut={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) store.previewSpace(null);
        }}
      >
        {Object.entries(ROOM_TYPES).map(([type, info]) => {
          const fits = store.spaceFits(type, side);
          return (
            <button
              key={type}
              data-add-type={type}
              disabled={!fits}
              onPointerEnter={() => fits && store.previewSpace(type, side)}
              onFocus={() => fits && store.previewSpace(type, side)}
              onClick={() => {
                store.addSpace(type, { side });
                document.getElementById('add-space')?.focus();
              }}
            >
              <Icon name={info.icon} size={16} />
              <span>{info.name}</span>
              <small class="mono">{fits ? store.spaceSize(type) : '자리 부족'}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FloorplanControls({ addTrigger }) {
  const ref = useRef(null);
  const cancel = useRef(null);
  const [confirm, setConfirm] = useState(false);
  const state = app.state;
  const list = spaces(state);
  const side = app.view.addSide;
  const editing = app.view.roomEditor;
  const deleting = confirm && !side && !editing;
  const closeAdd = (restoreFocus) => {
    store.pickAddSide(null);
    if (!restoreFocus) return;
    const trigger = addTrigger.current?.isConnected
      ? addTrigger.current
      : document.getElementById('add-space');
    trigger?.focus({ preventScroll: true });
  };
  const close = (event) => {
    const escape = event?.key === 'Escape';
    if (!escape && event?.target?.closest?.('[data-add-side]')) return;
    if (side) closeAdd(escape);
    else if (escape) document.getElementById(editing ? 'edit-space' : 'delete-space')?.focus();
    if (editing) store.setRoomEditor(false);
    if (confirm) setConfirm(false);
  };
  useOutside(ref, close, Boolean(side || editing || confirm));
  useEffect(() => setConfirm(false), [state.roomId]);
  useEffect(() => {
    if (side || editing) setConfirm(false);
  }, [side, editing]);
  useLayoutEffect(() => {
    if (deleting) cancel.current?.focus();
  }, [deleting]);
  return (
    <div class="floorplan-controls" ref={ref} role="group" aria-label="방 편집 도구">
      <label class="floorplan-room-picker">
        <Icon name={ROOM_TYPES[state.room.type].icon} size={16} />
        <select
          aria-label="선택한 방"
          value={state.roomId}
          onChange={(event) => store.switchSpace(event.currentTarget.value)}
        >
          {list.map((room) => (
            <option key={room.roomId} value={room.roomId}>
              {room.name}
            </option>
          ))}
        </select>
      </label>
      <AddSpaceButton trigger={addTrigger} />
      <button
        id="edit-space"
        class="editor-command on-stage"
        aria-label="방 편집"
        aria-expanded={editing}
        onClick={() => {
          setConfirm(false);
          store.setRoomEditor(!editing);
        }}
      >
        <Icon name="pencil" size={16} />
        <span>편집</span>
      </button>
      <button
        id="delete-space"
        class="editor-command on-stage"
        aria-label="방 삭제"
        aria-expanded={deleting}
        disabled={list.length < 2}
        data-room-delete
        onClick={() => {
          if (editing) store.setRoomEditor(false);
          if (side) store.pickAddSide(null);
          setConfirm(!confirm);
        }}
      >
        <Icon name="trash-2" size={16} />
        <span>삭제</span>
      </button>
      {editing && <RoomEditor key={state.roomId} room={state.room} name={state.name} />}
      {side && <AddRoomPop side={side} sides={store.freeSides()} onClose={() => closeAdd(true)} />}
      {deleting && (
        <div class="editor-pop delete-room-pop" role="group" aria-label="방 삭제 확인">
          <strong>{josa(state.name, '을/를')} 삭제할까요?</strong>
          {state.items.length > 0 && <p>이 방의 가구 {state.items.length}개도 함께 삭제돼요.</p>}
          <div class="editor-pop-foot">
            <button
              class="btn small"
              ref={cancel}
              onClick={() => {
                setConfirm(false);
                document.getElementById('delete-space')?.focus();
              }}
            >
              취소
            </button>
            <button
              class="btn small delete-room-confirm"
              data-room-delete-confirm
              onClick={() => {
                setConfirm(false);
                store.deleteSpace(state.roomId);
                document.querySelector('.floorplan-room-picker select')?.focus();
              }}
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomTags() {
  const { state } = app;
  return spaces(state).map((room) => {
    const selected = room.roomId === state.roomId;
    const dims = `${room.room.w} × ${room.room.d}m`;
    return (
      <div
        key={room.roomId}
        class={`stage-tag room-tag ${selected ? 'is-selected' : ''}`}
        data-room-tag={room.roomId}
      >
        <span
          class="tag-main"
          title={`${room.name} ${dims}`}
          data-tag-kind={selected ? 'selected' : 'room'}
          data-tag-text={state.dimensions ? `${room.name} ${dims}` : room.name}
        >
          <Icon name={ROOM_TYPES[room.room.type].icon} size={14} />
          <span class="tag-name">{room.name}</span>
          {state.dimensions && <span class="tag-dims mono">{dims}</span>}
        </span>
      </div>
    );
  });
}

export function Stage({ mobile, sheetRef }) {
  const hostHouse = useRef(null),
    stageRef = useRef(null),
    barRef = useRef(null),
    tagsRef = useRef(null),
    addTrigger = useRef(null);
  const bounds = () => {
    const css = getComputedStyle(document.documentElement),
      r = stageRef.current.getBoundingClientRect();
    return {
      r,
      left: (parseFloat(css.getPropertyValue('--inset-left')) || 0) + 8,
      bottom: r.height - (parseFloat(css.getPropertyValue('--inset-bottom')) || 0) - 8,
      top: 56,
    };
  };
  const placeBar = () => {
    const bar = barRef.current,
      stage = stageRef.current;
    if (!bar || !stage || !app.selected) return;
    const sc = app.scenes.house;
    const p = sc?.anchor(app.selected);
    if (!p || !p.visible) {
      bar.style.opacity = '0';
      return;
    }
    const { r, left, bottom, top } = bounds(),
      bw = bar.offsetWidth,
      bh = bar.offsetHeight;
    const x = Math.max(left, Math.min(r.width - bw - 8, p.x - r.left - bw / 2));
    const above = p.y - r.top - bh - 12;
    const center = sc.anchor(app.selected, { center: true });
    const below = (center ? center.y * 2 - p.y : p.y) - r.top + 12;
    const ideal = above >= top + 8 ? above : below;
    const y = Math.max(top + 8, Math.min(bottom - bh, ideal));
    bar.style.opacity = '1';
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  // 이름표를 장면의 기준점에 붙인다. 3D에서는 겹치는 이름표를 아래로 밀어 서로 가리지 않게 한다.
  const placeTags = () => {
    const layer = tagsRef.current,
      sc = app.scenes.house;
    if (!layer || !stageRef.current || !sc) return;
    const { r, left, bottom, top } = bounds(),
      placed = [];
    // 가구 도구 막대가 떠 있으면 이름표가 그 아래로 숨지 않게 자리를 비켜 준다.
    const bar = barRef.current;
    if (bar && !bar.hidden && bar.style.opacity !== '0' && app.selected) {
      const b = bar.getBoundingClientRect();
      placed.push({ x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height });
    }
    // 문 막대가 떠 있는 동안 그 밑에 깔리는 이름표는 밀어내지 않고 잠시 숨긴다. 밀려난 이름표가 문을 덮지 않게 한다.
    let guard = null;
    const put = (el, x, y) => {
      const w = el.offsetWidth,
        h = el.offsetHeight;
      x = Math.max(left, Math.min(r.width - w - 8, x));
      y = Math.max(top, Math.min(bottom - h, y));
      if (
        guard &&
        x < guard.x + guard.w + 4 &&
        x + w + 4 > guard.x &&
        y < guard.y + guard.h + 4 &&
        y + h + 4 > guard.y
      ) {
        el.style.visibility = 'hidden';
        return;
      }
      for (const o of placed)
        if (x < o.x + o.w + 4 && x + w + 4 > o.x && y < o.y + o.h + 4 && y + h + 4 > o.y)
          y = o.y + o.h + 4;
      placed.push({ x, y, w, h });
      el.style.visibility = '';
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    // 고른 문의 막대는 문 바로 위에 두고, 이름표는 그 자리를 비켜 간다.
    const doorBar = layer.querySelector('[data-door-bar]'),
      doorAt = doorBar && sc.doorAnchor?.(app.view.door);
    if (doorBar && (!doorAt || !doorAt.visible)) doorBar.style.visibility = 'hidden';
    else if (doorBar) {
      put(
        doorBar,
        doorAt.x - r.left - doorBar.offsetWidth / 2,
        // 세로 벽의 문은 위아래로 길다. 문과 열리는 호를 가리지 않게 문 위쪽 끝보다 위에 둔다.
        doorAt.y - r.top - (doorAt.vertical ? doorAt.half : 0) - doorBar.offsetHeight - 14,
      );
      guard = placed[placed.length - 1];
    }
    const tags = [...layer.querySelectorAll('[data-room-tag]')]
      .map((el) => ({ el, p: sc.tagAnchor?.(el.dataset.roomTag) }))
      // 고른 공간의 이름표를 먼저 놓아 제 자리를 지키게 하고, 나머지는 위에서부터 놓는다.
      .sort(
        (a, b) =>
          b.el.classList.contains('is-selected') - a.el.classList.contains('is-selected') ||
          (a.p?.y || 0) - (b.p?.y || 0),
      );
    const share = (r.width - left - 8) / Math.max(1, tags.length),
      density = share >= 150 ? 0 : share >= 80 ? 1 : 2;
    const placeTag = ({ el, p }) => {
      if (!p || !p.visible) {
        el.style.visibility = 'hidden';
        return;
      }
      // 좁은 공간에서는 크기 표시를 먼저 접고, 더 좁으면 아이콘만 남긴다. 고른 공간은 줄이지 않는다.
      // 2D는 방 폭으로, 방 밖에 놓이는 3D는 공간 수와 화면 폭으로 정해 매 프레임 바뀌지 않게 한다.
      const selected = el.classList.contains('is-selected'),
        room = p.corner && !selected ? p.width - 16 : Infinity,
        name = el.querySelector('.tag-name')?.textContent.length || 0,
        crowd = p.corner || selected ? 0 : density;
      el.classList.toggle('is-icon', room < 64 || crowd === 2);
      el.classList.toggle('is-narrow', room < name * 12 + 112 || crowd >= 1);
      el.style.maxWidth =
        Number.isFinite(room) && room >= 64 ? `${Math.max(44, Math.round(room))}px` : '';
      if (p.corner) put(el, p.x - r.left + 8, p.y - r.top + 8);
      else put(el, p.x - r.left - el.offsetWidth / 2, p.y - r.top - el.offsetHeight - 4);
    };
    // 고른 공간의 이름표를 먼저 놓고, + 손잡이가 그 옆으로 비킨 뒤, 나머지 이름표가 빈자리를 찾는다.
    const chosen = tags.filter((t) => t.el.classList.contains('is-selected'));
    chosen.forEach(placeTag);
    // + 손잡이는 벽 가운데 바깥에 둔다. 이름표와 겹치면 벽을 따라 옆으로 비켜 둘 다 누를 수 있게 한다.
    const sides = sc.sideAnchors?.() || [];
    // 문은 눌러서 고르고 끌어 옮기는 자리다. 손잡이가 그 위에 놓이지 않게 한다.
    const doorways = (sc.doorSpots?.() || []).map((d) =>
      d.vertical
        ? { x: d.x - r.left - 16, y: d.y - r.top - d.half - 8, w: 32, h: d.half * 2 + 16 }
        : { x: d.x - r.left - d.half - 8, y: d.y - r.top - 16, w: d.half * 2 + 16, h: 32 },
    );
    for (const el of layer.querySelectorAll('[data-add-side]')) {
      const p = sides.find((a) => a.side === el.dataset.addSide);
      if (!p || !p.visible) {
        el.style.visibility = 'hidden';
        continue;
      }
      const w = el.offsetWidth,
        h = el.offsetHeight,
        hits = (x, y) =>
          [...placed, ...doorways].some(
            (o) => x < o.x + o.w + 4 && x + w + 4 > o.x && y < o.y + o.h + 4 && y + h + 4 > o.y,
          );
      let x = p.x - r.left - w / 2,
        y = p.y - r.top - h / 2;
      if (hits(x, y) && p.along) {
        const reach = Math.max(0, p.span / 2 - w / 2);
        for (let t = 12; t <= reach; t += 12) {
          const free = [t, -t].find((n) => !hits(x + p.along[0] * n, y + p.along[1] * n));
          if (free !== undefined) {
            x += p.along[0] * free;
            y += p.along[1] * free;
            break;
          }
        }
      }
      // 화면 밖이나 방 위 도구·아래 시트에 가리는 손잡이, 비킬 자리가 없어 문을 덮는 손잡이는 숨긴다.
      const onDoor = doorways.some(
        (o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y,
      );
      if (onDoor || x < left - 4 || x + w > r.width - 4 || y < top || y + h > bottom) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = '';
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      placed.push({ x, y, w, h });
    }
    tags.filter((t) => !chosen.includes(t)).forEach(placeTag);
    const tag = layer.querySelector('[data-avatar-tag]'),
      p = tag && sc.avatarAnchor?.();
    if (tag && (!p || !p.visible)) tag.style.visibility = 'hidden';
    else if (tag)
      put(
        tag,
        p.x - r.left - tag.offsetWidth / 2,
        p.below ? p.y - r.top + 6 : p.y - r.top - tag.offsetHeight - 6,
      );
  };
  const place = () => {
    placeBar();
    placeTags();
  };
  useEffect(() => {
    app.scenes.house = new HouseScene(hostHouse.current, app.state, {
      ...store.sceneCallbacks,
      selectSpace: store.switchSpace,
      editSpace: store.editSpace,
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
    const fontsReady = document.fonts?.ready || Promise.resolve();
    fontsReady.then(() => {
      clearTapes();
      syncScene();
    });
    syncScene();
    const unsub = store.subscribe((kind) => {
      if (kind === 'move') return place();
      syncScene();
      requestAnimationFrame(place);
    });
    const applyInsets = () => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const r = sheet.getBoundingClientRect();
      const vh = window.visualViewport?.height || innerHeight;
      const isMobile = innerWidth < 900;
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
      app.scenes.house?.setInsets(insets);
      place();
    };
    const ro = new ResizeObserver(applyInsets);
    if (sheetRef.current) ro.observe(sheetRef.current);
    window.addEventListener('resize', applyInsets);
    const t = setTimeout(applyInsets, 50);
    return () => {
      unsub();
      ro.disconnect();
      clearTimeout(t);
      window.removeEventListener('resize', applyInsets);
      app.scenes.house?.dispose();
      app.scenes.house = null;
    };
  }, []);
  useEffect(() => {
    app.scenes.house?.draw();
    requestAnimationFrame(place);
  }, [app.view.collapsed, app.view.sheet, mobile]);

  const s = app.state,
    warn = layoutWarnings(s);
  const [problemItems, problemLabel] =
    [
      [warn.oversized, '방을 넘는 가구'],
      [warn.blockedDoors, '문 앞을 막는 가구'],
      [warn.blockedWindows, '창 앞을 가리는 가구'],
      [warn.conflicts, '겹친 가구'],
    ].find(([ids]) => ids.size) || [];
  const findProblemItem = () => {
    const ids = [...problemItems];
    store.select(ids[(ids.indexOf(app.selected) + 1) % ids.length]);
  };
  const avatarOn = !!avatarLayout(s);
  const history = (
    <div class="tool-group">
      <button
        class="icon-btn on-stage"
        id="undo"
        aria-label="실행 취소"
        title="실행 취소 (⌘/Ctrl Z)"
        disabled={!app.history.length}
        onClick={store.undo}
      >
        <Icon name="undo-2" />
      </button>
      <button
        class="icon-btn on-stage"
        id="redo"
        aria-label="다시 실행"
        title="다시 실행 (⌘/Ctrl ⇧ Z)"
        disabled={!app.future.length}
        onClick={store.redo}
      >
        <Icon name="redo-2" />
      </button>
    </div>
  );
  return (
    <main class="stage" ref={stageRef} aria-label="집 전체 평면도 편집기">
      <div id="viewport-house" class="viewport" ref={hostHouse} />
      <div class="stage-tags" ref={tagsRef}>
        <RoomTags />
        <AddHandles trigger={addTrigger} />
        <DoorBar />
        <AvatarTag mobile={mobile} />
      </div>
      <WindowControls />
      <div class="stage-top">
        <FloorplanControls addTrigger={addTrigger} />
        <div class="stage-tools">
          {!mobile && history}
          <MoreMenu mobile={mobile} />
        </div>
      </div>
      {problemItems && (
        <div class="stage-warning" id="warning">
          <Icon name="triangle-alert" size={16} />
          <span role="status">
            {problemLabel} {problemItems.size}개
          </span>
          <button class="link" aria-label={`${problemLabel} 찾기`} onClick={findProblemItem}>
            찾기
          </button>
          <button class="link" onClick={() => store.relocate('배치 경고 정리')}>
            자동 정리
          </button>
        </div>
      )}
      {app.draft && !app.selected && (
        <div class="draft-note" role="status">
          <span class="tape is-draft">점선</span>
          {TYPES[app.draft.type].name} 초안을 아직 놓지 않았어요
          <button
            class="link"
            disabled={store.photoCaptionBusy()}
            onClick={() => store.placeDraft()}
          >
            놓기
          </button>
        </div>
      )}
      <ObjectBar barRef={barRef} mobile={mobile} />
      <div class="stage-bottom">
        {mobile ? history : <span class="stage-hint">방 바닥이나 가구를 끌어 옮기세요.</span>}
        <div class="tool-group">
          <button
            class={`icon-btn on-stage ${avatarOn ? 'is-on' : ''}`}
            id="avatar-toggle"
            aria-pressed={avatarOn}
            aria-label="내 키 아바타 표시"
            title={avatarOn ? '아바타 숨기기' : '아바타를 세워 내 키로 크기 비교'}
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
                title="격자 50cm, 화장실 타일 30cm"
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
            aria-label="집 전체를 화면에 맞추기"
            title="집 전체를 화면에 맞추기"
            onClick={() => app.scenes.house?.draw()}
          >
            <Icon name="maximize-2" />
          </button>
        </div>
      </div>
    </main>
  );
}
