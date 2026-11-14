// 대화 안에 나타나는 생성형 UI 컴포넌트. 모델은 이름만 고르고, 값과 동작은 모두 앱 상태에 연결된다.
import { useEffect, useMemo, useState } from 'preact/hooks';
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
import { avatarLayout, POSES, SEATS } from '../avatar.js';
import { floorplanWarnings } from '../floorplan.js';
import { Icon } from './icons.js';
import { Stepper, MiniPlan, Corner, Silhouette, FitBadge, Tape, sourceLabel } from './widgets.jsx';

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
  const candidates = s.items.filter((i) => i.type === 'bed' || SEATS.has(i.type));
  const targetFor = (pose) => {
    const accepts = (i) => (pose === 'lying' ? i.type === 'bed' : SEATS.has(i.type));
    return (
      candidates.find((i) => i.id === app.selected && accepts(i)) ||
      candidates.find((i) => i.id === a.itemId && accepts(i)) ||
      candidates.find(accepts)
    );
  };
  return (
    <>
      <Head
        icon="person-standing"
        title="내 키로 크기 비교"
        meta={layout ? `${a.height}cm · ${POSES[layout.pose]}` : '선택 기능'}
      />
      <p class="surface-hint">
        가구와 같은 축척의 아바타예요. 키를 입력하거나 “내 키 175cm야”라고 말해 보세요.
      </p>
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
      <div class="comparison-poses" role="group" aria-label="아바타 자세">
        {Object.entries(POSES).map(([pose, label]) => (
          <button
            class={`btn small ${layout?.pose === pose ? 'primary' : ''}`}
            aria-pressed={layout?.pose === pose}
            disabled={pose !== 'standing' && !targetFor(pose)}
            onClick={() => store.updateAvatar({ pose, enabled: true }, targetFor(pose)?.id)}
          >
            {label}
          </button>
        ))}
      </div>
      <label class="comparison-select">
        비교할 가구
        <select
          aria-label="아바타와 비교할 가구"
          value={layout?.item?.id || ''}
          onChange={(e) => {
            const item = candidates.find((i) => i.id === e.currentTarget.value);
            store.updateAvatar(
              {
                pose: item ? (item.type === 'bed' ? 'lying' : 'sitting') : 'standing',
                enabled: true,
              },
              item?.id,
            );
          }}
        >
          <option value="">바닥에 서 있기</option>
          {candidates.map((i) => (
            <option value={i.id}>
              {i.name} · {i.dims[0]} × {i.dims[2]}cm
            </option>
          ))}
        </select>
      </label>
      {!candidates.length && (
        <p class="surface-hint">의자·소파·침대를 방에 놓으면 앉거나 누울 수 있어요.</p>
      )}
      {layout?.warnings.map((w) => (
        <p class="warn-text" role="status">
          {w}
        </p>
      ))}
      <footer class="surface-foot">
        <span class="foot-note">서 있는 아바타는 끌어 옮길 수 있어요</span>
        <button class="btn small" onClick={() => store.updateAvatar({ enabled: !layout })}>
          {layout ? '아바타 숨기기' : '이 방에 표시'}
        </button>
      </footer>
      <p class="surface-hint">
        신체 비율과 착석 높이를 단순화했어요. 실제 착석감과 침대의 사용 가능 길이는 제품에서 확인해
        주세요.
      </p>
    </>
  );
}

function Floorplan() {
  const s = app.state,
    list = spaces(s),
    conflicts = floorplanWarnings(list, s.floorplan);
  return (
    <>
      <Head
        icon="house"
        title="집 전체 평면도"
        meta={`${list.length}개 공간 · ${list.reduce((sum, r) => sum + r.room.w * r.room.d, 0).toFixed(1)}m²`}
      />
      <p class="surface-hint">
        공간을 끌어 옮겨 집 모양을 맞춰 보세요. 맞닿은 벽의 문과 화장실 설비는 배치 초안이에요.
      </p>
      <div class="comparison-poses">
        <button class="btn small primary" onClick={() => store.setScope('house')}>
          집 전체 보기
        </button>
        <button class="btn small" disabled={list.length >= 12} onClick={store.attachBathroom}>
          이 방 옆에 화장실 붙이기
        </button>
      </div>
      {conflicts.size > 0 && (
        <p class="warn-text" role="status">
          공간 {conflicts.size}개가 겹쳐요. 크기나 위치를 조정해 주세요.
        </p>
      )}
      <div class="house-rooms">
        {list.map((r) => {
          const p = s.floorplan.positions[r.roomId];
          return (
            <div class={`house-room ${r.roomId === s.roomId ? 'is-active' : ''}`} key={r.roomId}>
              <div class="house-room-head">
                <Icon name={ROOM_TYPES[r.room.type].icon} size={16} />
                <strong>{r.name}</strong>
                <button
                  class="link"
                  aria-label={`${r.name} 편집`}
                  onClick={() => {
                    store.switchSpace(r.roomId);
                    store.setScope('room');
                  }}
                >
                  방 편집
                </button>
              </div>
              <small class="mono">
                {r.room.w} × {r.room.d}m · 가구 {r.items.length}개
              </small>
              <div class="house-position">
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
            </div>
          );
        })}
      </div>
      <p class="surface-hint">
        좌표는 공간의 중심이에요. 방별 2D·3D에서 가구와 크기를 편집하면 집 전체에도 반영돼요.
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

let previewPromise = null;
function useThumbnails() {
  const [map, setMap] = useState(null);
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      previewPromise ||= import('../catalog-renderer.js').then((m) => m.furniturePreviews());
      previewPromise.then((m) => live && setMap(m)).catch(() => {});
    }, 60);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, []);
  return map;
}

function Catalog() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const thumbs = useThumbnails();
  const list = Object.entries(TYPES).filter(
    ([, t]) => (cat === 'all' || t.category === cat) && t.name.includes(q.trim()),
  );
  const total = Object.values(TYPES).reduce((n, t) => n + t.presets.length, 0);
  return (
    <>
      <Head icon="armchair" title="가구 고르기" meta={`20종 · ${total}가지 크기`} />
      <label class="search">
        <Icon name="search" size={16} />
        <input
          aria-label="가구 검색"
          placeholder="소파, 식탁, 책장"
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
        />
      </label>
      <div class="chips-row is-scroll" role="group" aria-label="가구 분류">
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
              <span class="mono">{t.presets.length}가지</span>
            </button>
          ))}
        </div>
      ) : (
        <p class="surface-empty">찾는 가구가 없어요. 다른 이름으로 찾아보세요.</p>
      )}
    </>
  );
}

function Impact() {
  const s = app.state,
    warn = layoutWarnings(s);
  const rows = s.items.filter((a) => warn.all.has(a.id));
  return (
    <>
      <Head
        icon="triangle-alert"
        title="배치 확인"
        meta={rows.length ? `확인 필요 ${rows.length}개` : '문제 없음'}
      />
      {rows.length ? (
        <ul class="rows">
          {rows.map((a) => (
            <li key={a.id}>
              <button class="row" onClick={() => store.select(a.id)}>
                <span class="dot" style={{ background: a.color }} />
                <span class="row-main">
                  <strong>{a.name}</strong>
                  <small>
                    {warn.oversized.has(a.id) ? '방보다 크거나 벽을 넘어요' : '다른 가구와 겹쳐요'}
                  </small>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="surface-ok">
          <Icon name="check" size={16} />
          겹치거나 벽을 넘은 가구가 없어요.
        </p>
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
      <div class="photo-surface">
        <img src={p.data} alt="첨부한 가구 사진" />
        <div class="photo-side">
          {p.analyzed ? (
            <>
              <p class="photo-result">
                {p.type
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
                {loading ? app.ai.label || '사진 판별 중' : '사진으로 종류 확인'}
              </button>
              {loading && (
                <progress max="1" value={app.ai.progress} aria-label="사진 모델 진행률" />
              )}
            </>
          )}
        </div>
      </div>
      <div class="chips-row is-wrap" aria-label="직접 종류 고르기">
        {['sofa', 'bed', 'desk', 'dining', 'chair', 'wardrobe', 'shelf', 'cabinet'].map((k) => (
          <button key={k} class="chip" onClick={() => store.createDraft(k, { via: 'photo' })}>
            <Icon name={TYPES[k].icon} size={14} />
            {TYPES[k].name}
          </button>
        ))}
        <button class="chip" onClick={() => store.openTool('catalog')}>
          다른 종류
        </button>
      </div>
    </>
  );
}

function AIPanel() {
  const ai = app.ai;
  const loading = ai.text === 'loading';
  const textState = {
    off: ai.why === 'user' || ai.why === 'url' ? '꺼 둠' : '켜지 않음',
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
          <strong>상담 모델 · Gemma 3 1B</strong>
          <small>{textState} · 기본으로 켜짐 · 처음 한 번 약 700MB · WebGPU 필요</small>
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
            {ai.text === 'error' ? '다시 시도' : '켜기'}
          </button>
        )}
      </div>
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
            <small>룸꾸 v1~v3 파일</small>
          </span>
        </button>
        <button class="file-action" onClick={() => store.exportPNG()}>
          <Icon name="camera" />
          <span>
            <strong>지금 화면 이미지로</strong>
            <small>{app.state.view === '2d' ? '2D 평면' : '3D 모형'} · PNG</small>
          </span>
        </button>
      </div>
      <p class="surface-hint">
        자동 저장은 이 브라우저에만 남아요. 사진과 대화는 배치 파일에 넣지 않아요.
      </p>
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
          <b>저장</b>
          <span>배치 파일이나 이미지로 저장해요. ⌘/Ctrl+Z로 되돌려요.</span>
        </li>
      </ol>
      <p class="surface-hint">치수는 배치를 위한 초안이에요. 구매·설치 전에는 실제로 재 주세요.</p>
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
  avatar: Avatar,
  floorplan: Floorplan,
  'room-size': RoomSize,
  'room-type': RoomType,
  finishes: Finishes,
  'furniture-size': FurnitureSize,
  'furniture-dims': FurnitureDims,
  'furniture-color': FurnitureColor,
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
    case 'avatar':
      return `${s.avatar.height}cm · ${POSES[s.avatar.pose]}`;
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
    case 'impact':
      return `확인 필요 ${layoutWarnings(s).all.size}개`;
    case 'spaces':
      return `${spaces(s).length}개`;
    case 'items':
      return `${s.items.length}개`;
    default:
      return '';
  }
}

export function Surface({ spec, live, onOpen }) {
  const meta = SURFACE_KINDS[spec.kind];
  if (!meta) return null;
  const roomElsewhere =
    meta.scope === 'room' && spec.target?.roomId && spec.target.roomId !== app.state.roomId;
  if (!live)
    return (
      <button class="surface-chip" data-surface-chip={spec.kind} onClick={onOpen}>
        <Icon name={meta.icon} size={16} />
        <span>{meta.title}</span>
        <small>{roomElsewhere ? '다른 공간' : surfaceSummary(spec)}</small>
        <Icon name="chevron-down" size={16} />
      </button>
    );
  const Body = BODIES[spec.kind];
  return (
    <section class="surface" data-surface={spec.kind} aria-label={meta.title}>
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
