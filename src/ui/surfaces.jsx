import {
  MODEL_USAGE,
  modelEvidence,
  MODEL_EVIDENCE_CONTEXT,
  modelCoverage,
  modelCaution,
} from '../app/model-capabilities.js';
import { uses, activityTypes } from '../app/purpose.js';
import { catalogMatches } from '../estimator.js';
import { WINDOW_WALLS, MAX_WINDOWS } from '../windows.js';
// 대화 안에 나타나는 생성형 UI 컴포넌트. 모델은 이름만 고르고, 값과 동작은 모두 앱 상태에 연결된다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  TYPES,
  ROOM_TYPES,
  CATEGORIES,
  WALL_COLORS,
  FLOOR_COLORS,
  FURNITURE_COLORS,
} from '../catalog.js';
import { layoutWarnings, spaces } from '../data.js';
import { SURFACE_KINDS } from '../ui-schema.js';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { findFreeSpot, fitStatus, clearance, pyeong, wallName, floorName } from '../app/ops.js';
import { josa } from '../app/text.js';
import { avatarLayout, poseAccepts, poseFor, POSES } from '../avatar.js';
import { floorplanWarnings, connections, DOOR } from '../floorplan.js';
import { TEXT_MODELS, sizeText } from '../app/models.js';
import { THEMES } from '../app/design.js';
import { Icon } from './icons.js';
import {
  Stepper,
  MiniPlan,
  Corner,
  Silhouette,
  FitBadge,
  Tape,
  HeightScale,
  sourceLabel,
} from './widgets.jsx';

function Head({ icon, title, meta, children }) {
  return (
    <header class="surface-head">
      <span class="surface-icon">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      {meta && <span class="surface-meta">{meta}</span>}
      {children}
    </header>
  );
}
const SIZE_NAMES = ['아담하게', '기본', '넉넉하게'];

function Avatar() {
  const s = app.state,
    a = s.avatar,
    layout = avatarLayout(s);
  const away =
    a.enabled && a.roomId && a.roomId !== s.roomId
      ? spaces(s).find((r) => r.roomId === a.roomId)
      : null;
  const targets = s.items.filter((i) => poseAccepts(poseFor(i), i));
  return (
    <>
      <Head
        icon="person-standing"
        title="내 키로 크기 비교"
        meta={layout ? `${a.height}cm · ${POSES[layout.pose]}` : '선택 기능'}
      />
      <Stepper
        label="내 키"
        ariaLabel="아바타 키"
        value={a.height}
        unit="cm"
        min={80}
        max={230}
        step={1}
        source={a.source}
        onFocus={() => store.beginEdit('avatar-height')}
        onBlur={store.endEdit}
        onLive={(height) => store.updateAvatar({ height, enabled: true }, null, { live: true })}
        onCommit={(height) => store.updateAvatar({ height, enabled: true })}
      />
      <HeightScale
        height={a.height}
        source={a.source}
        room={s.room}
        items={s.items}
        focus={layout?.item?.id || app.selected}
      />
      <div class="pose-chips" role="group" aria-label="아바타 자세">
        <button
          class={`chip ${layout?.pose === 'standing' ? 'is-active' : ''}`}
          aria-pressed={layout?.pose === 'standing'}
          onClick={() => store.setPose('standing')}
        >
          바닥에 서기
        </button>
        {targets.map((i) => {
          const pose = poseFor(i),
            on = layout?.item?.id === i.id;
          return (
            <button
              key={i.id}
              class={`chip ${on ? 'is-active' : ''}`}
              aria-pressed={on}
              data-pose-target={i.type}
              onClick={() => store.setPose(pose, i.id)}
            >
              {i.name}에 {pose === 'lying' ? '눕기' : '앉기'}
            </button>
          );
        })}
      </div>
      {!targets.length && (
        <p class="surface-hint">의자·소파·침대를 이 방에 놓으면 앉히거나 눕혀 볼 수 있어요.</p>
      )}
      {layout?.warnings.map((w) => (
        <p class="warn-text" role="status" key={w}>
          {w}
        </p>
      ))}
      {away && <p class="surface-hint">아바타는 지금 {away.name}에 있어요.</p>}
      <footer class="surface-foot">
        <span class="foot-note">
          {layout
            ? layout.pose === 'standing'
              ? layout.outside
                ? '아바타는 방 옆에 서 있어요. 끌어서 방 안으로 옮기거나 눌러서 자세를 바꿔요'
                : '아바타를 끌어 방 안팎으로 옮기거나 눌러서 자세를 바꿔요'
              : '가구를 옮기거나 돌리면 아바타도 함께 움직여요'
            : '아바타는 켜지 않아도 배치에는 영향이 없어요'}
        </span>
        <button
          class="btn small"
          onClick={() =>
            layout ? store.updateAvatar({ enabled: false }, null) : store.setPose('standing')
          }
        >
          {layout ? '아바타 숨기기' : away ? '이 방으로 데려오기' : '이 방에 세우기'}
        </button>
      </footer>
      <p class="surface-hint">
        키만 실제 값이고 팔다리 비율·앉은 높이는 단순 모형이에요. 실제 착석감과 침대에서 쓸 수 있는
        길이는 제품에서 확인해 주세요.
      </p>
    </>
  );
}

// 문 하나의 위치·폭·여는 방향. 위치는 맞닿은 벽 구간의 왼쪽(세로 벽은 위쪽) 끝에서 문까지의 거리다.
function DoorRow({ link }) {
  const [a, b] = link.ids,
    key = `door-${a}-${b}`,
    cm = (m) => Math.round(m * 100),
    width = cm(link.width),
    edge = cm(link.center - link.width / 2 - link.wall.start),
    widest = Math.min(cm(DOOR.max), Math.floor((link.length - 0.1) * 100 + 1e-6)),
    furthest = Math.max(5, cm(link.length - link.width) - 5),
    title = `${link.names[0]} ↔ ${link.names[1]}`,
    from = link.wall.vertical ? '위쪽' : '왼쪽';
  return (
    <div class="house-position house-door" data-door-row={`${a}|${b}`}>
      <div class="house-door-head">
        <strong>{title}</strong>
        <small class="mono">
          맞닿은 벽 {cm(link.length)}cm{link.closed ? '' : ` · ${from} 끝부터 잼`}
        </small>
      </div>
      {link.closed ? (
        <div class="door-actions">
          <span class="tape is-draft">문 없음</span>
          <button
            class="btn small"
            data-door-open
            onClick={() => store.setDoor(a, b, { closed: false })}
          >
            <Icon name="door-open" size={16} />문 내기
          </button>
        </div>
      ) : (
        <>
          <Stepper
            label="위치"
            ariaLabel={`${title} 문 위치 · 벽 ${from} 끝에서`}
            value={edge}
            unit="cm"
            source={link.door.offset !== undefined ? '사용자 설정' : '자동 위치'}
            step={5}
            min={5}
            max={furthest}
            onFocus={() => store.beginEdit(`${key}-edge`)}
            onBlur={store.endEdit}
            onLive={(v) => store.setDoor(a, b, { edge: v / 100, exact: true }, { live: true })}
            onCommit={(v) => store.setDoor(a, b, { edge: v / 100, exact: true })}
          />
          <Stepper
            label="문 폭"
            ariaLabel={`${title} 문 폭`}
            value={width}
            unit="cm"
            source={link.door.width !== undefined ? '사용자 설정' : '가정값'}
            step={5}
            min={cm(DOOR.min)}
            max={widest}
            onFocus={() => store.beginEdit(`${key}-width`)}
            onBlur={store.endEdit}
            onLive={(v) => store.setDoor(a, b, { width: v / 100 }, { live: true })}
            onCommit={(v) => store.setDoor(a, b, { width: v / 100 })}
          />
          <div class="door-actions">
            <button
              class="btn small"
              onClick={() => store.setDoor(a, b, { flip: !link.door.flip })}
            >
              <Icon name="flip" size={16} />
              여는 방향 바꾸기
            </button>
            {(link.opening?.custom || link.door.flip) && (
              <button class="btn small" onClick={() => store.setDoor(a, b, { reset: true })}>
                자동으로 되돌리기
              </button>
            )}
            <button class="btn small" data-door-close onClick={() => store.closeDoor(a, b)}>
              <Icon name="door-closed" size={16} />문 막기
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Floorplan() {
  const s = app.state,
    list = spaces(s),
    conflicts = floorplanWarnings(list, s.floorplan),
    links = connections(list, s.floorplan),
    blocked = links.filter((l) => l.closed).length,
    house = s.scope === 'house';
  return (
    <>
      <Head
        icon="house"
        title="집 전체"
        meta={`${list.length}개 공간 · ${list.reduce((sum, r) => sum + r.room.w * r.room.d, 0).toFixed(1)}m²`}
      />
      <div class="house-actions">
        <div class="segmented" role="group" aria-label="집 전체 보기 방식">
          {['2d', '3d'].map((view) => (
            <button
              key={view}
              class={house && s.view === view ? 'is-active' : ''}
              aria-pressed={house && s.view === view}
              onClick={() => {
                store.setScope('house');
                store.setView(view);
              }}
            >
              {view === '2d' ? '2D 평면도' : '3D 모형'}
            </button>
          ))}
        </div>
        <button class="btn small" disabled={list.length >= 12} onClick={store.attachBathroom}>
          <Icon name="bath" size={16} />이 방 옆에 화장실 붙이기
        </button>
      </div>
      {conflicts.size > 0 && (
        <div class="warn-row" role="status">
          <p class="warn-text">공간 {conflicts.size}개가 겹쳐요.</p>
          <button
            class="btn small"
            data-separate
            onClick={() => store.relocate('겹친 공간 떼어 놓기')}
          >
            <Icon name="move" size={16} />
            겹치지 않게 떼어 놓기
          </button>
        </div>
      )}
      <ul class="rows house-rooms">
        {list.map((r) => (
          <li key={r.roomId} class={r.roomId === s.roomId ? 'is-active' : ''}>
            <div class="row is-static">
              <Icon name={ROOM_TYPES[r.room.type].icon} size={16} />
              <button class="row-main as-button" onClick={() => store.switchSpace(r.roomId)}>
                <strong>{r.name}</strong>
                <small class="mono">
                  {r.room.w} × {r.room.d}m · 가구 {r.items.length}개
                  {conflicts.has(r.roomId) ? ' · 겹침' : ''}
                </small>
              </button>
              <button
                class="icon-btn"
                aria-label={`${r.name} 90도 돌리기`}
                title="방 돌리기 · 가구도 함께 돌아요"
                onClick={() => store.rotateSpace(r.roomId)}
              >
                <Icon name="rotate-cw" size={16} />
              </button>
              <button
                class="btn small"
                aria-label={`${r.name} 편집`}
                onClick={() => store.editSpace(r.roomId)}
              >
                방 편집
              </button>
            </div>
          </li>
        ))}
      </ul>
      <details class="house-positions">
        <summary>위치를 숫자로 맞추기</summary>
        <p class="surface-hint">공간 중심의 좌표예요. 보통은 2D에서 끌어 맞추는 편이 쉬워요.</p>
        {list.map((r) => {
          const p = s.floorplan.positions[r.roomId];
          return (
            <div class="house-position" key={r.roomId}>
              <strong>{r.name}</strong>
              {['x', 'z'].map((k) => (
                <Stepper
                  key={k}
                  label={k === 'x' ? '좌우' : '위아래'}
                  ariaLabel={`${r.name} ${k === 'x' ? '좌우' : '위아래'} 위치`}
                  value={p[k]}
                  unit="m"
                  source={false}
                  step={0.1}
                  min={-200}
                  max={200}
                  onFocus={() => store.beginEdit(`position-${r.roomId}-${k}`)}
                  onBlur={store.endEdit}
                  onLive={(v) =>
                    store.moveSpace(r.roomId, k === 'x' ? v : p.x, k === 'z' ? v : p.z, {
                      live: true,
                      exact: true,
                    })
                  }
                  onCommit={(v) =>
                    store.moveSpace(r.roomId, k === 'x' ? v : p.x, k === 'z' ? v : p.z, {
                      exact: true,
                    })
                  }
                />
              ))}
            </div>
          );
        })}
      </details>
      {links.length > 0 && (
        <details
          class="house-positions house-doors"
          open={app.view.doorList}
          onToggle={(e) => store.setDoorList(e.currentTarget.open)}
        >
          <summary>
            문 {links.length - blocked}개{blocked ? ` · 막은 벽 ${blocked}곳` : ''} · 위치와 폭
            맞추기
          </summary>
          <p class="surface-hint">
            2D에서는 문을 끌어 옮길 수 있어요. 문을 누르면 폭·여는 방향·막기 막대가 떠요.
          </p>
          {links.map((link) => (
            <DoorRow key={link.ids.join('|')} link={link} />
          ))}
        </details>
      )}
      <p class="surface-hint">
        벽이 맞닿으면 가운데에 80cm 문을 자동으로 그려요. 폭 80cm는 가정값이니 실제 문에 맞게 바꿔
        주세요. 낮춘 안쪽 벽은 배치를 가늠하기 위한 초안이에요. 화장실 설비는 다른 가구처럼 옮기거나
        뺄 수 있어요.
      </p>
    </>
  );
}

function RoomSize() {
  const s = app.state,
    r = s.room,
    warn = layoutWarnings(s);
  return (
    <>
      <Head
        icon="ruler"
        title="방 크기"
        meta={`${(r.w * r.d).toFixed(1)}m² · ${pyeong(r.w, r.d).toFixed(1)}평`}
      />
      <div class="room-size">
        <MiniPlan room={r} items={s.items} warnings={warn.all} />
        <div class="steppers">
          {[
            ['w', '가로'],
            ['d', '세로'],
            ['h', '천장'],
          ].map(([k, label]) => (
            <Stepper
              key={k}
              label={label}
              unit="m"
              value={r[k]}
              step={0.1}
              min={1}
              max={15}
              source={r.sources[k]}
              ariaLabel={`방 ${label === '천장' ? '천장 높이' : label}`}
              onFocus={() => store.beginEdit(`room-${k}`)}
              onLive={(v) => store.setRoomDim(k, v, { live: true })}
              onCommit={(v) => store.setRoomDim(k, v)}
              onBlur={store.endEdit}
            />
          ))}
        </div>
      </div>
      <div class="chips-row" aria-label={`${ROOM_TYPES[r.type].name} 크기 초안`}>
        {ROOM_TYPES[r.type].sizes.map(([w, d, h], i) => (
          <button
            key={i}
            class={`preset ${r.w === w && r.d === d && r.h === h ? 'is-active' : ''}`}
            aria-pressed={r.w === w && r.d === d && r.h === h}
            onClick={() => store.setRoomPreset(i)}
          >
            <span>{SIZE_NAMES[i]}</span>
            <b class="mono">
              {w} × {d}
            </b>
          </button>
        ))}
      </div>
      <footer class="surface-foot">
        <span class="foot-note">
          <Icon name={ROOM_TYPES[r.type].icon} size={16} />
          {ROOM_TYPES[r.type].name} · 가구 {s.items.length}개
          {warn.all.size > 0 && <em class="warn-text"> · 확인 필요 {warn.all.size}개</em>}
        </span>
        <button class="link" onClick={() => store.openTool('room-type')}>
          유형 바꾸기
        </button>
      </footer>
    </>
  );
}

function RoomType() {
  const r = app.state.room;
  return (
    <>
      <Head icon="layout-grid" title="공간 유형" meta={ROOM_TYPES[r.type].name} />
      <div class="type-grid">
        {Object.entries(ROOM_TYPES).map(([k, t]) => (
          <button
            key={k}
            class={`type-tile ${r.type === k ? 'is-active' : ''}`}
            aria-pressed={r.type === k}
            onClick={() => store.setRoomType(k)}
          >
            <Icon name={t.icon} />
            <strong>{t.name}</strong>
            <span class="mono">
              {t.sizes[1][0]} × {t.sizes[1][1]}m
            </span>
          </button>
        ))}
      </div>
      <p class="surface-hint">직접 정한 치수는 유형을 바꿔도 그대로 남아요.</p>
    </>
  );
}

function WindowEditor({ window: w, index }) {
  const [values, setValues] = useState(w);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    setValues(w);
    setError('');
  }, [w]);
  const update = (key, value) => {
    setValues({ ...values, [key]: value });
    setError('');
  };
  return (
    <form
      class="window-editor"
      data-window={w.id}
      onSubmit={(e) => {
        e.preventDefault();
        const patch = Object.fromEntries(
          ['offset', 'width', 'height', 'sill'].map((k) => [k, Number(values[k])]),
        );
        patch.wall = values.wall;
        setError(store.setWindow(w.id, patch) || '');
      }}
    >
      <div class="window-head">
        <strong>창문 {index + 1}</strong>
        <Tape source="사용자 설정">직접 설정</Tape>
        <button
          class="icon-btn"
          type="button"
          aria-label={`창문 ${index + 1} 삭제`}
          onClick={() => store.removeWindow(w.id)}
        >
          <Icon name="trash-2" size={16} />
        </button>
      </div>
      <label class="window-wall">
        벽 방향
        <select
          aria-label={`창문 ${index + 1} 벽 방향`}
          value={values.wall}
          onChange={(e) => update('wall', e.currentTarget.value)}
        >
          {Object.entries(WINDOW_WALLS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div class="window-fields">
        {[
          ['width', '폭', 30],
          ['height', '높이', 30],
          ['offset', '벽 끝에서', 5],
          ['sill', '바닥에서', 10],
        ].map(([key, label, min]) => (
          <label key={key}>
            {label}
            <span>
              <input
                aria-label={`창문 ${index + 1} ${label}`}
                type="number"
                min={min}
                max={1500}
                step="1"
                required
                value={
                  values[key] === '' ? '' : Math.round(Number(values[key]) * 100 * 1000) / 1000
                }
                onInput={(e) =>
                  update(
                    key,
                    e.currentTarget.value === '' ? '' : Number(e.currentTarget.value) / 100,
                  )
                }
              />
              <small>cm</small>
            </span>
          </label>
        ))}
      </div>
      <p class="surface-hint">벽 끝은 정면 벽의 왼쪽 끝, 옆벽의 위쪽 끝이에요.</p>
      <div class="window-error" role="alert">
        {error}
      </div>
      <button class="btn" type="submit">
        창문 변경 적용
      </button>
    </form>
  );
}
function Windows() {
  const windows = app.state.room.windows || [];
  const [wall, setWall] = useState('back');
  const [error, setError] = useState('');
  return (
    <>
      <Head icon="grid-2x2" title="창문 설정" meta={`${windows.length} / ${MAX_WINDOWS}`} />
      {!windows.length && (
        <p class="surface-empty">설정한 창문이 없어요. 벽을 고르고 첫 창문을 추가해 보세요.</p>
      )}
      {windows.map((w, i) => (
        <WindowEditor key={w.id} window={w} index={i} />
      ))}
      <div class="window-add">
        <label>
          추가할 벽
          <select
            aria-label="새 창문 벽 방향"
            value={wall}
            onChange={(e) => {
              setWall(e.currentTarget.value);
              setError('');
            }}
          >
            {Object.entries(WINDOW_WALLS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button
          class="btn primary"
          disabled={windows.length >= MAX_WINDOWS}
          onClick={() => setError(store.addWindow(wall) || '')}
        >
          <Icon name="plus" size={16} />
          창문 추가
        </button>
      </div>
      <div class="window-error" role="alert">
        {error}
      </div>
      <p class="surface-hint">
        2D·3D와 배치 파일에 저장해요. 앞쪽·오른쪽 벽은 낮춰 보여도 창은 실제 높이에 남아요. 자동
        문은 창문을 피해 옮겨질 수 있어요. 햇빛·채광은 계산하지 않아요.
      </p>
    </>
  );
}

function Finishes() {
  const r = app.state.room;
  const [hover, setHover] = useState(null);
  const last = app.view.lastFinish?.roomId === app.state.roomId ? app.view.lastFinish : null;
  const changed =
    last && (last.before.wallColor !== r.wallColor || last.before.floorColor !== r.floorColor);
  const candidate = hover
    ? { ...r, [hover.key]: hover.color }
    : changed
      ? { ...r, ...last.before }
      : null;
  const row = (key, label, list, name) => (
    <div class="finish-row" role="group" aria-label={label}>
      <span class="finish-label">
        {label}
        <small>{name(r[key])}</small>
      </span>
      <div class="swatches">
        {list.map(([n, c]) => (
          <button
            key={c}
            class={`swatch ${key === 'floorColor' ? 'is-floor' : ''} ${r[key] === c ? 'is-active' : ''}`}
            style={{ '--swatch': c }}
            aria-label={`${label} ${n}`}
            aria-pressed={r[key] === c}
            title={n}
            onMouseEnter={() => setHover({ key, color: c })}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover({ key, color: c })}
            onBlur={() => setHover(null)}
            onClick={() => store.setFinish(key, c)}
          />
        ))}
        <label class="swatch is-custom" title="직접 고르기">
          <Icon name="pencil" size={14} />
          <input
            type="color"
            aria-label={`${label} 직접 고르기`}
            value={r[key]}
            onChange={(e) => store.setFinish(key, e.currentTarget.value)}
          />
        </label>
      </div>
    </div>
  );
  return (
    <>
      <Head
        icon="paint-roller"
        title="벽과 바닥"
        meta={`${wallName(r.wallColor)} · ${floorName(r.floorColor)}`}
      />
      <div class="corners">
        <Corner wall={r.wallColor} floor={r.floorColor} label="지금" active />
        {candidate ? (
          <Corner
            wall={candidate.wallColor}
            floor={candidate.floorColor}
            label={hover ? '미리보기' : '바꾸기 전'}
          />
        ) : (
          <div class="corner-empty">색에 마우스를 올리면 여기서 비교해요</div>
        )}
      </div>
      {row('wallColor', '벽', WALL_COLORS, wallName)}
      {row('floorColor', '바닥', FLOOR_COLORS, floorName)}
      <footer class="surface-foot">
        <span class="foot-note">창문도 벽에 맞춰 설정해요</span>
        <button class="btn" onClick={() => store.openTool('windows')}>
          창문 설정
        </button>
      </footer>
    </>
  );
}

// 초안은 빈자리를, 배치된 가구는 현재 자리를 기준으로 규격마다 들어가는지 계산한다.
function presetFits(item, isDraft) {
  const s = app.state;
  return TYPES[item.type].presets.map((p) => {
    const cand = { ...item, dims: p.dims };
    if (isDraft) {
      const spot = findFreeSpot(s, cand);
      return fitStatus(s, { ...cand, x: spot.x, z: spot.z, angle: spot.angle });
    }
    return fitStatus(s, cand);
  });
}

function MissingSubject({ target }) {
  return (
    <p class="surface-gone">
      <Icon name="circle-alert" size={16} />
      {target.type === 'draft'
        ? '이 초안은 방에 놓였거나 새 초안으로 바뀌었어요.'
        : '이 가구는 지금 방에 없어요.'}
    </p>
  );
}

function PlaceFoot({ target, item }) {
  if (target.type !== 'draft') {
    const c = clearance(app.state, item);
    return (
      <footer class="surface-foot">
        <span class="foot-note mono">
          벽까지 ← {c.left} · {c.right} → · ↑ {c.back} · {c.front} ↓ cm
        </span>
      </footer>
    );
  }
  return (
    <footer class="surface-foot">
      <span class="foot-note">방 안의 점선이 놓일 자리예요</span>
      <button class="btn primary" onClick={() => store.placeDraft()}>
        <Icon name="corner-down-right" size={16} />
        방에 놓기
      </button>
    </footer>
  );
}

function FurnitureSize({ target }) {
  const item = store.subject(target);
  if (!item) return <MissingSubject target={target} />;
  const t = TYPES[item.type],
    isDraft = target.type === 'draft';
  const fits = presetFits(item, isDraft);
  const maxW = Math.max(...t.presets.map((p) => Math.max(p.dims[0], p.dims[2] * 1.4)));
  const scale = 76 / maxW;
  const preview = app.view.preview;
  return (
    <>
      <Head icon={t.icon} title={`${t.name} 규격`} meta={isDraft ? '초안' : '방에 놓임'} />
      <div
        class="size-cards"
        style={{ '--cols': t.presets.length === 4 ? 4 : 3 }}
        role="group"
        aria-label={`${t.name} 크기 초안`}
      >
        {t.presets.map((p, i) => {
          const active = p.dims.every((n, k) => n === item.dims[k]);
          return (
            <button
              key={p.label}
              class={`size-card ${active ? 'is-active' : ''} ${preview?.index === i ? 'is-preview' : ''}`}
              aria-pressed={active}
              onMouseEnter={() => store.setPreview({ target, dims: p.dims, index: i })}
              onMouseLeave={() => store.setPreview(null)}
              onFocus={() => store.setPreview({ target, dims: p.dims, index: i })}
              onBlur={() => store.setPreview(null)}
              onClick={() => store.setItemPreset(target, i)}
            >
              <Silhouette dims={p.dims} scale={scale} color={item.color} />
              <strong>{p.label}</strong>
              <span class="mono">
                {p.dims[0]} × {p.dims[2]}
              </span>
              <small class="size-h">높이 {p.dims[1]}</small>
              <FitBadge fit={fits[i]} />
            </button>
          );
        })}
      </div>
      <DimsLine item={item} target={target} />
      <PlaceFoot target={target} item={item} />
    </>
  );
}

function DimsLine({ item, target }) {
  return (
    <div class="dims-line">
      {[
        [0, '가로'],
        [2, '깊이'],
        [1, '높이'],
      ].map(([i, label]) => (
        <span key={i} class="dims-cell">
          <small>{label}</small>
          <Tape source={item.sources[i]} title={sourceLabel(item.sources[i])}>
            {item.dims[i]}
          </Tape>
        </span>
      ))}
      <span class="dims-unit">cm</span>
      <button class="link" onClick={() => store.openTool('furniture-dims', { target })}>
        직접 입력
      </button>
    </div>
  );
}

function FurnitureDims({ target }) {
  const item = store.subject(target);
  if (!item) return <MissingSubject target={target} />;
  const t = TYPES[item.type];
  const range = (i) => {
    const v = t.presets.map((p) => p.dims[i]);
    return `${Math.min(...v)}–${Math.max(...v)}`;
  };
  return (
    <>
      <Head
        icon="ruler"
        title={`${t.name} 치수`}
        meta={target.type === 'draft' ? '초안' : '방에 놓임'}
      />
      <div class="field-pair">
        <label class="field">
          <span>이름</span>
          <input
            maxLength={100}
            value={item.name}
            aria-label="가구 이름"
            onChange={(e) => store.setItemName(target, e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>종류</span>
          <select
            aria-label="가구 종류"
            value={item.type}
            onChange={(e) => store.setItemType(target, e.currentTarget.value)}
          >
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="steppers">
        {[
          [0, '가로'],
          [2, '깊이'],
          [1, '높이'],
        ].map(([i, label]) => (
          <Stepper
            key={`${item.id}-${i}`}
            label={
              <>
                {label} <small class="range">보통 {range(i)}</small>
              </>
            }
            unit="cm"
            value={item.dims[i]}
            step={5}
            min={1}
            max={1500}
            source={item.sources[i]}
            ariaLabel={`가구 ${label}`}
            onFocus={() => store.beginEdit(`item-${item.id}-${i}`)}
            onLive={(v) => store.setItemDim(target, i, v, { live: true })}
            onCommit={(v) => store.setItemDim(target, i, v)}
            onBlur={store.endEdit}
          />
        ))}
      </div>
      <PlaceFoot target={target} item={item} />
    </>
  );
}

function FurnitureColor({ target }) {
  const item = store.subject(target);
  if (!item) return <MissingSubject target={target} />;
  return (
    <>
      <Head
        icon="palette"
        title={`${TYPES[item.type].name} 색상`}
        meta={target.type === 'draft' ? '초안' : '방에 놓임'}
      />
      <div class="swatches is-large" role="group" aria-label="가구 색상">
        {FURNITURE_COLORS.map(([n, c]) => (
          <button
            key={c}
            class={`swatch ${item.color === c ? 'is-active' : ''}`}
            style={{ '--swatch': c }}
            aria-label={`가구 색상 ${n}`}
            aria-pressed={item.color === c}
            title={n}
            onClick={() => store.setItemColor(target, c)}
          />
        ))}
        <label class="swatch is-custom" title="직접 고르기">
          <Icon name="pencil" size={14} />
          <input
            type="color"
            aria-label="가구 색상 직접 고르기"
            value={item.color}
            onChange={(e) => store.setItemColor(target, e.currentTarget.value)}
          />
        </label>
      </div>
      <p class="surface-hint">색은 모양을 확인하기 위한 표시예요. 실제 재질과 다를 수 있어요.</p>
      {target.type === 'draft' && <PlaceFoot target={target} item={item} />}
    </>
  );
}

function useThumbnails(types) {
  const key = types?.join(',') ?? '*';
  const [map, setMap] = useState(null);
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      import('../catalog-renderer.js')
        .then((m) => {
          if (live) setMap(m.furniturePreviews(key === '*' ? undefined : key.split(',')));
        })
        .catch(() => {});
    }, 60);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [key]);
  return map;
}

function Recommendations({ spec }) {
  const rec = store.recommendationFor(spec.id);
  const thumbs = useThumbnails(rec?.types || []);
  const listRef = useRef(null);
  useEffect(() => {
    if (!rec?.active || !matchMedia('(max-width: 899px)').matches) return;
    const list = listRef.current;
    const frame = requestAnimationFrame(() =>
      list?.scrollIntoView({ block: 'nearest', behavior: 'instant' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [spec.id, rec?.active]);
  if (!rec) return <p class="surface-hint">원하는 용도를 말하면 여기에 후보가 나와요.</p>;
  return (
    <>
      <Head icon="armchair" title="용도에 맞는 가구" meta={rec.types.length + '가지'} />
      <div
        ref={listRef}
        class="purpose-list"
        data-count={rec.types.length}
        role="group"
        aria-label="추천 가구"
      >
        {rec.types.map((k) => (
          <button
            key={k}
            type="button"
            class="purpose-option"
            data-choice={k}
            disabled={!rec.active}
            onClick={() => {
              store.chooseRecommendation(spec.id, k);
              requestAnimationFrame(() =>
                [...document.querySelectorAll('.suggestions .is-primary')]
                  .at(-1)
                  ?.focus({ preventScroll: true }),
              );
            }}
          >
            <span class="purpose-preview">
              {thumbs?.get(k) ? (
                <img src={thumbs.get(k)} alt="" />
              ) : (
                <Icon name={TYPES[k].icon} size={24} />
              )}
            </span>
            <span>
              <strong>{TYPES[k].name}</strong>
              <small>{uses[k]}</small>
            </span>
            {rec.active && <Icon name="chevron-right" size={16} />}
          </button>
        ))}
      </div>
      {!rec.active && (
        <p class="surface-hint">지난 추천이에요. 다른 후보를 보려면 용도를 다시 말해 주세요.</p>
      )}
    </>
  );
}

function Catalog() {
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const thumbs = useThumbnails();
  const matchingUses = activityTypes(q.trim());
  const list = Object.entries(TYPES).filter(
    ([k, t]) =>
      (cat === 'all' || t.category === cat) && (catalogMatches(k, q) || matchingUses.includes(k)),
  );
  const total = Object.values(TYPES).reduce((n, t) => n + t.presets.length, 0);
  return (
    <>
      <Head
        icon="armchair"
        title="가구 고르기"
        meta={`${Object.keys(TYPES).length}종 · ${total}가지 크기`}
      />
      <div class="search catalog-search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          aria-label="가구 검색"
          placeholder="이름이나 용도 검색 (예: 식탁, 독서)"
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
        {q && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => {
              setQ('');
              inputRef.current?.focus();
            }}
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      <div class="chips-row is-scroll catalog-filters" role="group" aria-label="가구 분류">
        {Object.entries(CATEGORIES).map(([k, v]) => (
          <button
            key={k}
            class={`chip ${cat === k ? 'is-active' : ''}`}
            aria-pressed={cat === k}
            onClick={() => setCat(k)}
          >
            {v}
          </button>
        ))}
      </div>
      <p class="surface-hint" role="status">
        {CATEGORIES[cat]} · {list.length}종
      </p>
      {list.length ? (
        <div class="catalog-grid">
          {list.map(([k, t]) => (
            <button key={k} class="catalog-card" data-type={k} onClick={() => store.createDraft(k)}>
              <span class="catalog-visual">
                {thumbs?.get(k) ? (
                  <img src={thumbs.get(k)} alt="" />
                ) : (
                  <Icon name={t.icon} size={24} />
                )}
              </span>
              <strong>{t.name}</strong>
              <span class="catalog-size">기본 폭 {t.dims[0]}cm</span>
            </button>
          ))}
        </div>
      ) : (
        <div class="surface-empty">
          <p>“{q || CATEGORIES[cat]}”에 맞는 가구가 없어요.</p>
          <button
            class="btn"
            onClick={() => {
              setQ('');
              setCat('all');
            }}
          >
            검색·분류 초기화
          </button>
        </div>
      )}
    </>
  );
}

function Impact() {
  const s = app.state,
    warn = layoutWarnings(s);
  const rows = s.items.filter((a) => warn.all.has(a.id));
  // 겹친 공간도 여기서 함께 알린다. "겹친다"는 말이 가구가 아니라 방을 가리킬 때가 있다.
  const list = spaces(s),
    clash = floorplanWarnings(list, s.floorplan),
    rooms = list.filter((r) => clash.has(r.roomId)),
    total = rows.length + rooms.length;
  return (
    <>
      <Head
        icon="triangle-alert"
        title="배치 확인"
        meta={total ? `확인 필요 ${total}개` : '문제 없음'}
      />
      {rooms.length > 0 && (
        <ul class="rows">
          {rooms.map((r) => (
            <li key={r.roomId}>
              <button class="row" onClick={() => store.switchSpace(r.roomId)}>
                <Icon name={ROOM_TYPES[r.room.type].icon} size={16} />
                <span class="row-main">
                  <strong>{r.name}</strong>
                  <small>다른 공간과 겹쳐요</small>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {rooms.length > 0 && (
        <footer class="surface-foot">
          <span class="foot-note">지금 방은 그대로 두고 겹친 공간을 옆으로 옮겨요</span>
          <button class="btn" data-separate onClick={() => store.relocate('겹친 공간 떼어 놓기')}>
            <Icon name="move" size={16} />
            공간 떼어 놓기
          </button>
        </footer>
      )}
      {rows.length ? (
        <ul class="rows">
          {rows.map((a) => (
            <li key={a.id}>
              <button class="row" onClick={() => store.select(a.id)}>
                <span class="dot" style={{ background: a.color }} />
                <span class="row-main">
                  <strong>{a.name}</strong>
                  <small>
                    {warn.oversized.has(a.id)
                      ? '방보다 크거나 벽을 넘어요'
                      : warn.blockedDoors.has(a.id)
                        ? '문 앞 통로를 막고 있어요'
                        : warn.blockedWindows.has(a.id)
                          ? '창 앞 20cm를 가리고 있어요'
                          : '다른 가구와 겹쳐요'}
                  </small>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !rooms.length && (
          <p class="surface-ok">
            <Icon name="check" size={16} />
            겹침·벽 넘침이나 문·창 앞을 가리는 가구가 없어요.
          </p>
        )
      )}
      {rows.length > 0 && (
        <footer class="surface-foot">
          <span class="foot-note">러그 위 가구는 겹침으로 보지 않아요</span>
          <button class="btn" onClick={() => store.relocate()}>
            <Icon name="move" size={16} />
            빈자리로 옮기기
          </button>
        </footer>
      )}
    </>
  );
}

function Spaces() {
  const list = spaces(app.state);
  const [confirm, setConfirm] = useState(null);
  return (
    <>
      <Head icon="layers" title="내 공간" meta={`${list.length} / 12`} />
      <ul class="rows">
        {list.map((r) => {
          const active = r.roomId === app.state.roomId;
          return (
            <li key={r.roomId} class={active ? 'is-active' : ''}>
              <div class="row is-static">
                <Icon name={ROOM_TYPES[r.room.type].icon} size={16} />
                <span class="row-main">
                  {active ? (
                    <input
                      class="inline-input"
                      aria-label="공간 이름"
                      maxLength={100}
                      value={r.name}
                      onChange={(e) => store.renameRoom(e.currentTarget.value)}
                    />
                  ) : (
                    <strong>{r.name}</strong>
                  )}
                  <small class="mono">
                    {ROOM_TYPES[r.room.type].name} · {r.room.w} × {r.room.d}m · 가구{' '}
                    {r.items.length}
                  </small>
                </span>
                {active ? (
                  <span class="here">지금 공간</span>
                ) : (
                  <button class="btn small" onClick={() => store.switchSpace(r.roomId)}>
                    열기
                  </button>
                )}
                {list.length > 1 &&
                  (confirm === r.roomId ? (
                    <button
                      class="btn small danger"
                      onClick={() => (setConfirm(null), store.deleteSpace(r.roomId))}
                    >
                      삭제
                    </button>
                  ) : (
                    <button
                      class="icon-btn"
                      aria-label={`${r.name} 삭제`}
                      onClick={() => setConfirm(r.roomId)}
                    >
                      <Icon name="trash-2" size={16} />
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      <div class="new-space">
        <span>새 공간</span>
        <div class="chips-row is-wrap">
          {Object.entries(ROOM_TYPES).map(([k, t]) => (
            <button
              key={k}
              class="chip"
              disabled={list.length >= 12}
              onClick={() => store.addSpace(k)}
            >
              <Icon name="plus" size={14} />
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Items() {
  const s = app.state,
    warn = layoutWarnings(s);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Head icon="list" title="이 방의 가구" meta={`${s.items.length}개`} />
      {s.items.length ? (
        <ul class="rows">
          {s.items.map((a) => (
            <li key={a.id} class={a.id === app.selected ? 'is-active' : ''}>
              <div class="row is-static">
                <span class="dot" style={{ background: a.color }} />
                <button class="row-main as-button" onClick={() => store.select(a.id)}>
                  <strong>{a.name}</strong>
                  <small class="mono">
                    {a.dims[0]} × {a.dims[2]} × {a.dims[1]}cm
                    {warn.all.has(a.id) ? ' · 확인 필요' : ''}
                  </small>
                </button>
                <button
                  class="icon-btn"
                  aria-label={`${a.name} 빼기`}
                  onClick={() => store.removeById(a.id)}
                >
                  <Icon name="trash-2" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p class="surface-empty">아직 놓인 가구가 없어요.</p>
      )}
      <footer class="surface-foot">
        <button class="link" onClick={() => store.openTool('catalog')}>
          가구 고르기
        </button>
        {s.items.length > 0 &&
          (confirm ? (
            <button
              class="btn small danger"
              onClick={() => (setConfirm(false), store.clearItemsAction())}
            >
              {s.items.length}개 모두 빼기
            </button>
          ) : (
            <button class="link danger" onClick={() => setConfirm(true)}>
              가구 비우기
            </button>
          ))}
        {!s.items.length && (
          <button class="link" onClick={() => store.loadExampleAction()}>
            예시 방 불러오기
          </button>
        )}
      </footer>
    </>
  );
}

function Photo({ spec }) {
  const [allKinds, setAllKinds] = useState(false);
  const [query, setQuery] = useState('');
  const p = app.photo;
  if (!p || p.surfaceId !== spec.id)
    return (
      <>
        <Head icon="image" title="가구 사진" />
        <p class="surface-gone">
          <Icon name="image" size={16} />
          사진은 저장하지 않아요. 새로고침했거나 다른 사진을 올리면 다시 볼 수 없어요.
        </p>
      </>
    );
  const loading = app.busy?.kind === 'vision';
  return (
    <>
      <Head icon="image" title="가구 사진" meta={p.analyzed ? '판별함' : '판별 전'} />
      <p class="surface-hint">
        가구 하나가 잘 보이는 사진을 올려 주세요. JPG·PNG·WebP, 최대 20MB예요.
      </p>
      <div class="photo-surface">
        <img src={p.data} alt="첨부한 가구 사진" />
        <div class="photo-side">
          {p.analyzed ? (
            <>
              <p class="photo-result">
                {p.chosenType
                  ? `직접 고른 종류: ${TYPES[p.chosenType].name}`
                  : p.type
                    ? `${josa(TYPES[p.type].name, '으로/로')} 보여요.`
                    : p.candidates?.length
                      ? '종류를 확신하지 못했어요. 후보를 골라 주세요.'
                      : '종류를 읽지 못했어요.'}
              </p>
              {p.candidates?.length > 0 && (
                <ul class="photo-candidates">
                  {p.candidates.map((c) => (
                    <li key={c.type}>
                      <button
                        class="link"
                        onClick={() => store.createDraft(c.type, { via: 'photo' })}
                      >
                        {TYPES[c.type].name}
                      </button>
                      <span class="mono">{Math.round(c.p * 100)}%</span>
                    </li>
                  ))}
                </ul>
              )}
              <p class="surface-hint">
                SigLIP · {p.device === 'wasm' ? 'CPU' : 'GPU'}에서 실행. 사진만으로는 cm를 잴 수
                없어 크기는 유형 기본값이에요.
              </p>
              <p class="surface-hint">
                %는 후보 간 상대 점수예요. 정답 확률이나 치수 정확도가 아니에요.
              </p>
            </>
          ) : (
            <>
              <p class="surface-hint">
                사진 판별 모델이 20가지 가구 중 가까운 종류를 골라요. 처음 한 번 GPU는 약 150MB,
                CPU는 약 210MB를 내려받고, 사진은 이 기기 밖으로 보내지 않아요.
              </p>
              <div class="segmented" role="group" aria-label="사진 판별 방식">
                {[
                  ['webgpu', 'GPU'],
                  ['wasm', 'CPU 호환'],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    class={app.ai.device === k ? 'is-active' : ''}
                    aria-pressed={app.ai.device === k}
                    onClick={() => store.setVisionDevice(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <button
                class="btn primary"
                disabled={!!app.busy}
                onClick={() => store.analyzePhoto()}
              >
                <Icon
                  name={loading ? 'loader-circle' : 'scan'}
                  size={16}
                  className={loading ? 'spin' : ''}
                />
                {loading ? app.ai.visionLabel || '사진 판별 중' : '사진으로 종류 확인'}
              </button>
              {loading && (
                <progress max="1" value={app.ai.visionProgress} aria-label="사진 모델 진행률" />
              )}
            </>
          )}
        </div>
      </div>
      {p.error && !p.analyzed && (
        <p class="photo-error" role="alert">
          {p.error} CPU 호환으로 바꿔 다시 시도하거나 종류를 직접 골라 주세요.
        </p>
      )}
      <div class="chips-row is-wrap" aria-label="직접 종류 고르기">
        {['sofa', 'bed', 'desk', 'dining', 'chair', 'wardrobe', 'shelf', 'cabinet'].map((k) => (
          <button key={k} class="chip" onClick={() => store.createDraft(k, { via: 'photo' })}>
            <Icon name={TYPES[k].icon} size={14} />
            {TYPES[k].name}
          </button>
        ))}
        <button class="chip" aria-expanded={allKinds} onClick={() => setAllKinds(!allKinds)}>
          다른 종류
        </button>
      </div>
      {allKinds && (
        <div class="photo-kind-picker">
          <label class="search">
            <Icon name="search" size={16} />
            <input
              aria-label="사진의 가구 종류 검색"
              placeholder="가구 이름으로 검색"
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
          <div class="photo-kind-grid" aria-label="사진의 전체 가구 종류">
            {Object.entries(TYPES)
              .filter(([k]) => catalogMatches(k, query))
              .map(([k, t]) => (
                <button class="chip" key={k} onClick={() => store.createDraft(k, { via: 'photo' })}>
                  {t.name}
                </button>
              ))}
          </div>
          {!Object.keys(TYPES).some((k) => catalogMatches(k, query)) && (
            <p class="surface-hint" role="status">
              맞는 종류가 없어요. 검색어를 바꿔 주세요.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function Design({ spec }) {
  const d = app.design;
  if (!d || d.surfaceId !== spec.id)
    return (
      <p class="surface-gone">
        새 초안은 마지막 상담에 있어요. 면적과 테마를 말하면 다시 준비해 드려요.
      </p>
    );
  const rooms = spaces(d.state),
    area = rooms.reduce((n, r) => n + r.room.w * r.room.d, 0),
    stale = !d.applied && store.designStale();
  return (
    <>
      <Head
        icon="house"
        title={`${THEMES[d.theme].name} · ${d.mode === 'house' ? '집 전체 초안' : '마감 초안'}`}
        meta={`${rooms.length}개 공간 · 약 ${(area / 3.3058).toFixed(1)}평`}
      />
      <div class="design-palette" aria-label="테마 색상">
        {[THEMES[d.theme].wall, THEMES[d.theme].floor, ...THEMES[d.theme].colors].map(
          (color, i) => (
            <span key={i} style={{ background: color }} />
          ),
        )}
        <small>벽 · 바닥 · 가구</small>
      </div>
      <ul class="design-rooms" aria-label="공간별 구성">
        {rooms.map((r) => (
          <li key={r.roomId}>
            <Icon name={ROOM_TYPES[r.room.type].icon} size={16} />
            <div>
              <strong>{r.name}</strong>
              <small>{r.items.map((i) => TYPES[i.type].name).join(' · ') || '가구 없음'}</small>
            </div>
            <span class="mono">{(r.room.w * r.room.d).toFixed(1)}m²</span>
          </li>
        ))}
      </ul>
      {!!d.omitted.length && (
        <p class="warn-text" role="status">
          빈자리가 없어 남겨 둔 가구: {d.omitted.join(', ')}. 공간을 넓히거나 가구를 직접 더해
          주세요.
        </p>
      )}
      <p class="surface-hint">
        가구와 마감을 배치하는 초안이에요. 공간별 치수는 면적을 나눈 가정값이며 직접 고칠 수 있어요.
      </p>
      <footer class="surface-foot">
        <span class="foot-note" role="status">
          {d.applied
            ? '적용됨 · 실행 취소로 되돌리기'
            : stale
              ? '배치가 바뀌었어요. 지금 배치를 기준으로 다시 요청해 주세요.'
              : d.mode === 'house'
                ? '적용하면 현재 배치를 바꿔요'
                : '치수와 위치는 유지해요'}
        </span>
        <button
          class="btn primary"
          disabled={d.applied || stale}
          onClick={() => {
            const error = store.applyDesign();
            if (error) store.toast(error);
          }}
        >
          {d.applied ? '적용됨' : '초안 적용'}
        </button>
      </footer>
    </>
  );
}

function AIPanel() {
  const ai = app.ai;
  const loading = ai.text === 'loading';
  const textState = {
    off:
      ai.why === 'user' || ai.why === 'url'
        ? '꺼 둠'
        : ai.why === 'ask' || ai.why === 'later'
          ? '아직 받지 않음'
          : '켜지 않음',
    loading: ai.label || '준비 중',
    ready: `${store.modelName(ai.model)} 실행 중`,
    error: '준비 실패',
    unsupported: 'WebGPU 없음',
  }[ai.text];
  return (
    <>
      <Head
        icon="cpu"
        title="이 기기의 AI"
        meta={ai.text === 'ready' ? '모델이 해석' : '규칙으로 처리'}
      />
      <div class="model-row">
        <span class={`status-dot is-${ai.text}`} />
        <div class="row-main">
          <strong>상담 모델</strong>
          <small>{textState} · 기본으로 켜짐 · WebGPU 필요</small>
          {(ai.text === 'error' || ai.text === 'unsupported') && ai.error && (
            <small class="field-error">{ai.error}</small>
          )}
          {loading && <progress max="1" value={ai.progress} aria-label="상담 모델 진행률" />}
        </div>
        {ai.text === 'ready' || loading ? (
          <button class="btn small" onClick={() => store.setModelOn(false)}>
            끄기
          </button>
        ) : ai.text === 'unsupported' ? null : (
          <button class="btn small primary" onClick={() => store.setModelOn(true)}>
            {ai.text === 'error'
              ? '다시 시도'
              : ai.why === 'ask' || ai.why === 'later'
                ? '모델 받기'
                : '켜기'}
          </button>
        )}
      </div>
      <div class="model-choices" role="radiogroup" aria-label="상담 모델 고르기">
        {Object.values(TEXT_MODELS).map((m) => (
          <button
            key={m.key}
            role="radio"
            aria-label={m.name}
            aria-describedby={`model-cap-${m.key}`}
            aria-checked={ai.choice === m.key}
            tabIndex={ai.choice === m.key ? 0 : -1}
            data-model={m.key}
            class={`model-choice ${ai.choice === m.key ? 'is-active' : ''}`}
            aria-disabled={ai.text === 'unsupported' ? 'true' : undefined}
            onClick={() => {
              if (ai.text !== 'unsupported') store.setModelChoice(m.key);
            }}
            onKeyDown={(e) => {
              const keys = Object.keys(TEXT_MODELS),
                at = keys.indexOf(m.key);
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? keys.length - 1
                    : ['ArrowRight', 'ArrowDown'].includes(e.key)
                      ? (at + 1) % keys.length
                      : ['ArrowLeft', 'ArrowUp'].includes(e.key)
                        ? (at + keys.length - 1) % keys.length
                        : null;
              if (next === null) return;
              e.preventDefault();
              if (ai.text !== 'unsupported') store.setModelChoice(keys[next]);
              e.currentTarget.parentElement.querySelector(`[data-model="${keys[next]}"]`)?.focus();
            }}
          >
            <strong>{m.name}</strong>
            <small>{m.note}</small>
            <span class="model-capability" id={`model-cap-${m.key}`}>
              {MODEL_USAGE[m.key]}
            </span>
            <small class="model-evidence">{modelCoverage(m.key)}</small>
            <small class="model-evidence">{modelEvidence(m.key)}</small>
            {modelCaution(m.key) && <small>{modelCaution(m.key)}</small>}
            <span class="mono">내려받기 약 {sizeText(m.downloadMB)}</span>
            <span class="mono">
              GPU 약 {(m.vramMB / 1000).toFixed(1)}~{(m.vramF32MB / 1000).toFixed(1)}GB
            </span>
            {m.f32Note && <small>{m.f32Note}</small>}
          </button>
        ))}
      </div>
      <p class="surface-hint model-evidence-context">{MODEL_EVIDENCE_CONTEXT}</p>
      <p class="surface-hint">
        네 모델 모두 같은 편집 도구를 써요. 집 전체는 모델이 공간별 가구 구성을 고르고 앱이
        치수·충돌을 검사한 초안이에요. 사진 판별은 별도 SigLIP 모델이 20종만 다루며 실제 cm
        치수·채광·시공 도면은 계산하지 않아요.
      </p>
      <p class="surface-hint model-note">
        기본은 Gemma 4 E2B예요. 다운로드를 줄이려면 Qwen3 0.6B, GPU 메모리를 아끼려면 Gemma 3 1B를
        골라 보세요. 모델에 따라 상담 결과와 속도가 달라요. 고르면 새 모델을 한 번 받아요.
      </p>
      <div class="model-row">
        <span class={`status-dot is-${ai.vision}`} />
        <div class="row-main">
          <strong>사진 판별 · SigLIP base</strong>
          <small>
            {ai.vision === 'ready' ? '준비됨' : '사진을 보내면 준비'} · GPU 약 150MB, CPU 약 210MB
          </small>
        </div>
      </div>
      <p class="surface-hint">
        켜 두면 모델이 문장을 해석하고, 앱은 숫자·범위·말하지 않은 속성만 확인해요. 모델이 준비되기
        전이나 쓸 수 없는 기기에서는 규칙으로 답해요. 모델 파일은 공개 저장소에서 한 번 내려받아
        브라우저에 보관될 수 있고, 대화와 사진은 추론 서버로 보내지 않아요.
      </p>
    </>
  );
}

function Files() {
  return (
    <>
      <Head icon="folder-open" title="저장과 불러오기" meta={app.view.saveStatus} />
      <div class="file-actions">
        <button class="file-action" onClick={() => store.exportJSON()}>
          <Icon name="download" />
          <span>
            <strong>배치 파일 저장</strong>
            <small>공간 {spaces(app.state).length}개 · JSON</small>
          </span>
        </button>
        <button class="file-action" onClick={() => document.getElementById('layout-file')?.click()}>
          <Icon name="upload" />
          <span>
            <strong>배치 파일 불러오기</strong>
            <small>룸꾸 배치 파일(JSON)</small>
          </span>
        </button>
        <button class="file-action" onClick={() => store.exportPNG()}>
          <Icon name="camera" />
          <span>
            <strong>지금 화면 이미지로</strong>
            <small>
              {app.state.scope === 'house' ? '집 전체 ' : ''}
              {app.state.view === '2d' ? '2D 평면' : '3D 모형'} · PNG
            </small>
          </span>
        </button>
      </div>
      <p class="surface-hint">
        자동 저장은 이 브라우저에만 남아요. 사진과 대화는 배치 파일에 넣지 않아요.
      </p>
      <p class="surface-hint">
        불러오면 현재 배치와 미배치 초안을 바꿔요. 기존 배치는 실행 취소로 복구해요.
      </p>
      {app.fileError && <p class="field-error">{app.fileError}</p>}
    </>
  );
}

function Help() {
  return (
    <>
      <Head icon="circle-help" title="사용 방법" />
      <ol class="help-steps">
        <li>
          <b>말하거나 올리기</b>
          <span>
            “침실 가로 4m 세로 3.5m”, “두 명이 앉는 소파”처럼 말하거나 가구 사진을 올려요.
          </span>
        </li>
        <li>
          <b>도구로 다듬기</b>
          <span>대화에 나타난 크기·규격·마감 도구를 만지면 방에 바로 반영돼요.</span>
        </li>
        <li>
          <b>방에 놓기</b>
          <span>점선 초안을 놓은 뒤 끌어 옮겨요. 선택한 가구는 입력창의 대상이 돼요.</span>
        </li>
        <li>
          <b>내 키로 가늠하기</b>
          <span>
            방 아래의 사람 버튼을 누르거나 “내 키 175cm”라고 말하면 같은 축척의 아바타가 서요. 의자·
            소파·침대를 고르면 앉히거나 눕힐 수 있어요.
          </span>
        </li>
        <li>
          <b>집 전체로 잇기</b>
          <span>
            위쪽의 ‘집 전체’에서 방과 화장실을 함께 봐요. 2D에서 공간을 끌어 ㄱ자 같은 모양을
            만들고, 3D에서 돌려 본 뒤 이름표의 ‘방 편집’으로 들어가요.
          </span>
        </li>
        <li>
          <b>저장</b>
          <span>배치 파일이나 이미지로 저장해요. ⌘/Ctrl+Z로 되돌려요.</span>
        </li>
      </ol>
      <p class="surface-hint">치수는 배치를 위한 초안이에요. 구매·설치 전에는 실제로 재 주세요.</p>
      <a class="link" href="./review/" target="_blank" rel="noopener noreferrer">
        업데이트와 사진 검증 결과
      </a>
    </>
  );
}

function OtherSpace({ roomId }) {
  const r = spaces(app.state).find((x) => x.roomId === roomId);
  if (!r) return <p class="surface-gone">삭제한 공간의 도구예요.</p>;
  return (
    <p class="surface-gone">
      <Icon name="layers" size={16} />
      {r.name}의 도구예요.
      <button class="link" onClick={() => store.switchSpace(roomId)}>
        이 공간으로 이동
      </button>
    </p>
  );
}

const BODIES = {
  design: Design,
  avatar: Avatar,
  floorplan: Floorplan,
  'room-size': RoomSize,
  'room-type': RoomType,
  windows: Windows,
  finishes: Finishes,
  'furniture-size': FurnitureSize,
  'furniture-dims': FurnitureDims,
  'furniture-color': FurnitureColor,
  recommendations: Recommendations,
  catalog: Catalog,
  impact: Impact,
  spaces: Spaces,
  items: Items,
  photo: Photo,
  ai: AIPanel,
  files: Files,
  help: Help,
};

export function surfaceSummary(spec) {
  const s = app.state;
  const item = store.subject(spec.target);
  switch (spec.kind) {
    case 'avatar': {
      const layout = avatarLayout(s);
      return `${s.avatar.height}cm · ${layout ? POSES[layout.pose] : '숨김'}`;
    }
    case 'floorplan':
      return `${spaces(s).length}개 공간`;
    case 'room-size':
      return `${s.room.w} × ${s.room.d} × ${s.room.h}m`;
    case 'room-type':
      return ROOM_TYPES[s.room.type].name;
    case 'finishes':
      return `${wallName(s.room.wallColor)} · ${floorName(s.room.floorColor)}`;
    case 'furniture-size':
    case 'furniture-dims':
      return item
        ? `${item.name} ${item.dims[0]} × ${item.dims[2]} × ${item.dims[1]}`
        : '지금 없음';
    case 'furniture-color':
      return item ? item.name : '지금 없음';
    case 'impact': {
      // 겹친 공간도 함께 센다.
      const n = layoutWarnings(s).all.size + floorplanWarnings(spaces(s), s.floorplan).size;
      return n ? `확인 필요 ${n}개` : '문제 없음';
    }
    case 'recommendations':
      return (
        store
          .recommendationFor(spec.id)
          ?.types.map((k) => TYPES[k].name)
          .join(' · ') || ''
      );
    case 'spaces':
      return `${spaces(s).length}개`;
    case 'windows':
      return `${s.room.windows?.length || 0}개`;
    case 'items':
      return `${s.items.length}개`;
    default:
      return '';
  }
}

export function NativeTool({ spec, live, onOpen, summary, protocol }) {
  const meta = SURFACE_KINDS[spec.kind];
  if (!meta) return null;
  const roomElsewhere =
    meta.scope === 'room' && spec.target?.roomId && spec.target.roomId !== app.state.roomId;
  if (!live)
    return (
      <button class="surface-chip" data-surface-chip={spec.kind} onClick={onOpen} {...protocol}>
        <Icon name={meta.icon} size={16} />
        <span>{meta.title}</span>
        <small>{roomElsewhere ? '다른 공간' : summary}</small>
        <Icon name="chevron-down" size={16} />
      </button>
    );
  const Body = BODIES[spec.kind];
  return (
    <section class="surface" data-surface={spec.kind} aria-label={meta.title} {...protocol}>
      {roomElsewhere ? (
        <OtherSpace roomId={spec.target.roomId} />
      ) : (
        <Body spec={spec} target={spec.target} />
      )}
    </section>
  );
}

export function useSurfacePreview() {
  return useMemo(() => app.view.preview, [app.rev]);
}
