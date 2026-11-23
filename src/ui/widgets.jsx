import { useEffect, useLayoutEffect, useRef, useState, useId } from 'preact/hooks';
import { footprint } from '../data.js';
import { Icon } from './icons.js';
import { isComposingKey, parseStepperValue } from '../ui-input.js';

// 상담 상대의 얼굴. 대화 머리와 답마다 같은 표식을 쓴다.
export function BrandMark() {
  return (
    <span class="chat-avatar" aria-hidden="true">
      <img
        class="brand-mark"
        src={`${import.meta.env.BASE_URL}room-ggu-icon.png`}
        alt=""
        width="32"
        height="32"
      />
    </span>
  );
}

// 줄자 칩: 사용자가 정한 값은 노란 줄자, 초안 값은 점선 연필 표시.
export function Tape({ children, source = '', title }) {
  const user = String(source).startsWith('사용자');
  return (
    <span class={`tape ${user ? 'is-set' : 'is-draft'}`} title={title || source || undefined}>
      {children}
    </span>
  );
}
export function sourceLabel(source = '') {
  if (source === '비교용 기본값' || source === '가정값' || source === '자동 위치') return source;
  if (source.startsWith('사용자')) return '직접 정한 값';
  if (source.startsWith('AI') || source.includes('모델')) return '모델 단서로 고친 초안';
  if (source.startsWith('대화')) return '대화로 가늠한 초안';
  if (source.startsWith('사진')) return '사진 유형 기본값';
  if (source.startsWith('불러온')) return '불러온 값';
  return '유형 기본값';
}

const fmt = (n) => String(Math.round(n * 100) / 100);

export function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  source,
  ariaLabel,
  onLive,
  onCommit,
  onFocus,
  onBlur,
}) {
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  // 값이 밖에서 바뀌면 입력란과 안내를 그 값에 맞춘다. 범위를 벗어나 남겨 둔 글은 다시 손댈 때까지 둔다.
  useEffect(() => {
    if (focused || error) return;
    setText(fmt(value));
  }, [value, focused]);
  useEffect(() => {
    setError('');
    if (!focused) setText(fmt(value));
  }, [value]);
  const parse = (t) => parseStepperValue(t, min, max);
  const bump = (dir) => {
    const n = Math.min(max, Math.max(min, Math.round((value + dir * step) * 100) / 100));
    setError('');
    onCommit(n);
  };
  return (
    <div class={`stepper ${error ? 'has-error' : ''}`}>
      <span class="stepper-label">{label}</span>
      <div class="stepper-control">
        <button
          type="button"
          class="step"
          aria-label={`${ariaLabel} 줄이기`}
          onClick={() => bump(-1)}
        >
          <Icon name="minus" size={16} />
        </button>
        <label class="stepper-field">
          <input
            aria-label={ariaLabel}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            inputMode="decimal"
            value={text}
            onFocus={() => {
              setFocused(true);
              onFocus?.();
            }}
            onInput={(e) => {
              setText(e.currentTarget.value);
              const n = parse(e.currentTarget.value);
              // 치는 도중에는 틀렸다고 알리지 않는다. 맞는 값이 되면 안내를 바로 지우고 반영한다.
              if (n !== null) {
                setError('');
                onLive(n);
              }
            }}
            onKeyDown={(e) => {
              if (isComposingKey(e)) return;
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                bump(1);
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                bump(-1);
              }
            }}
            onBlur={(e) => {
              setFocused(false);
              const raw = e.currentTarget.value.trim(),
                n = parse(raw);
              // 입력을 마쳤을 때 범위를 벗어났으면 쓴 글을 남기고 이유를 알린다. 값은 바꾸지 않는다.
              if (n === null && raw) setError(`${min}~${max}${unit}`);
              else if (n === null) {
                setError('');
                setText(fmt(value));
              }
              onBlur?.();
            }}
          />
          <span class="unit">{unit}</span>
        </label>
        <button
          type="button"
          class="step"
          aria-label={`${ariaLabel} 늘리기`}
          onClick={() => bump(1)}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
      {(error || source !== false) && (
        <span class="stepper-source">
          {error ? (
            <em id={errorId} class="field-error" role="alert">
              {error} 범위로 입력해 주세요. 지금 값 {fmt(value)}
              {unit}
            </em>
          ) : (
            <Tape source={source}>{sourceLabel(source)}</Tape>
          )}
        </span>
      )}
    </div>
  );
}

// 실제 방 비율의 작은 평면도. 가구 위치·겹침·초안 자리를 함께 보여준다.
export function MiniPlan({
  room,
  items,
  ghost,
  warnings = new Set(),
  focus,
  label = '방 평면 미리보기',
}) {
  const pad = Math.max(room.w, room.d) * 0.16,
    fs = Math.max(room.w, room.d) * 0.085;
  const wall = Math.max(0.06, Math.max(room.w, room.d) * 0.018);
  const rect = (a, extra = {}) => {
    const fw = a.dims[0] / 100,
      fd = a.dims[2] / 100,
      cx = a.x + room.w / 2,
      cz = a.z + room.d / 2;
    return (
      <rect
        x={cx - fw / 2}
        y={cz - fd / 2}
        width={fw}
        height={fd}
        rx={Math.min(0.04, fw / 8)}
        transform={`rotate(${-a.angle} ${cx} ${cz})`}
        {...extra}
      />
    );
  };
  return (
    <svg
      class="miniplan"
      viewBox={`${-pad} ${-pad - fs} ${room.w + pad * 2} ${room.d + pad * 2 + fs}`}
      role="img"
      aria-label={label}
    >
      <rect
        x={-wall}
        y={-wall}
        width={room.w + wall * 2}
        height={room.d + wall * 2}
        class="mp-wall"
      />
      <rect x={0} y={0} width={room.w} height={room.d} fill={room.floorColor} class="mp-floor" />
      {items.map((a) => {
        const warn = warnings.has(a.id);
        return rect(a, {
          key: a.id,
          fill: a.color,
          class: `mp-item ${warn ? 'is-warn' : ''} ${focus === a.id ? 'is-focus' : ''}`,
        });
      })}
      {ghost && rect(ghost, { class: `mp-ghost is-${ghost.fit || 'fits'}`, fill: ghost.color })}
      <g class="mp-dim">
        <text x={room.w / 2} y={-wall - fs * 0.5} font-size={fs} text-anchor="middle">
          {Math.round(room.w * 100)}
        </text>
        <text
          x={-wall - fs * 0.5}
          y={room.d / 2}
          font-size={fs}
          text-anchor="middle"
          transform={`rotate(-90 ${-wall - fs * 0.5} ${room.d / 2})`}
        >
          {Math.round(room.d * 100)}
        </text>
      </g>
    </svg>
  );
}

// 키와 가구 높이를 같은 축척의 정면도로 나란히 세운다. 높이는 입력한 치수 그대로다.
export function HeightScale({ height, source, room, items, focus }) {
  const S = 44,
    h = height / 100,
    user = String(source).startsWith('사용자');
  const seen = new Set(),
    list = [];
  for (const a of items) {
    const key = `${a.type}|${a.dims.join()}`;
    if (a.dims[1] < 5 || seen.has(key)) continue;
    seen.add(key);
    list.push(a);
  }
  const shown = list.slice(0, 6),
    top = Math.max(h, room.h, ...shown.map((a) => a.dims[1] / 100)),
    H = top * S + 34,
    base = top * S + 14,
    y = (m) => base - m * S;
  let x = 34 + h * 0.34 * S + 14;
  const bars = shown.map((a) => {
    const w = Math.max(10, (a.dims[0] / 100) * S),
      bar = { a, x, w };
    x += w + 10;
    return bar;
  });
  const W = Math.max(x, 200),
    px = 34 + h * 0.17 * S,
    part = (ratio) => h * ratio * S;
  return (
    <div class="height-scale">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`키 ${height}cm와 가구 ${shown.length}개의 높이를 같은 축척으로 비교한 그림`}
      >
        <line class="hs-floor" x1="26" y1={base} x2={W} y2={base} />
        {room.h <= top && (
          <>
            <line class="hs-ceiling" x1="26" y1={y(room.h)} x2={W} y2={y(room.h)} />
            <text class="hs-note" x={W - 2} y={y(room.h) + 10} text-anchor="end">
              천장 {Math.round(room.h * 100)}
            </text>
          </>
        )}
        {[0.5, 1, 1.5, 2]
          .filter((m) => m < top)
          .map((m) => (
            <g key={m}>
              <line class="hs-tick" x1="22" y1={y(m)} x2="28" y2={y(m)} />
              <text class="hs-axis" x="19" y={y(m) + 3} text-anchor="end">
                {m * 100}
              </text>
            </g>
          ))}
        <line class={`hs-level ${user ? 'is-set' : ''}`} x1="26" y1={y(h)} x2={W} y2={y(h)} />
        <g class="hs-person">
          <circle cx={px} cy={y(h * 0.935)} r={part(0.065)} />
          <rect
            x={px - part(0.13)}
            y={y(h * 0.83)}
            width={part(0.26)}
            height={part(0.33)}
            rx={part(0.05)}
          />
          <rect x={px - part(0.115)} y={y(h * 0.54)} width={part(0.1)} height={part(0.54)} rx="2" />
          <rect x={px + part(0.015)} y={y(h * 0.54)} width={part(0.1)} height={part(0.54)} rx="2" />
        </g>
        <text class="hs-name" x={px} y={base + 13} text-anchor="middle">
          나
        </text>
        {bars.map(({ a, x, w }) => (
          <g key={a.id} class={`hs-item ${focus === a.id ? 'is-focus' : ''}`}>
            <rect
              x={x}
              y={y(a.dims[1] / 100)}
              width={w}
              height={(a.dims[1] / 100) * S}
              rx="2"
              fill={a.color}
            />
            <text class="hs-value" x={x + w / 2} y={y(a.dims[1] / 100) - 4} text-anchor="middle">
              {a.dims[1]}
            </text>
            <text class="hs-name" x={x + w / 2} y={base + 13} text-anchor="middle">
              {a.name.length > 5 && w < 60 ? `${a.name.slice(0, 4)}…` : a.name}
            </text>
          </g>
        ))}
      </svg>
      <p class="height-scale-note">
        <span class={`tape ${user ? 'is-set' : 'is-draft'}`}>{height}</span>
        cm 선과 가구 높이를 같은 축척으로 그렸어요
        {list.length > shown.length ? `, 가구는 ${shown.length}개까지` : ''}
      </p>
    </div>
  );
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt)))));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// 마감 비교용 등각 모서리. 왼쪽 벽은 그늘, 오른쪽 벽은 빛을 받는다.
export function Corner({ wall, floor, label, active }) {
  const lines = [];
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    const sx = 60 - 46 * t,
      sy = 46 + 23 * t;
    lines.push(<line key={i} x1={sx} y1={sy} x2={sx + 46} y2={sy + 23} />);
  }
  return (
    <figure class={`corner ${active ? 'is-active' : ''}`}>
      <svg viewBox="0 0 120 96" role="img" aria-label={label}>
        <polygon points="60,46 14,69 60,92 106,69" fill={floor} />
        <g class="corner-planks">{lines}</g>
        <polygon points="60,46 14,69 14,23 60,0" fill={shade(wall, -0.1)} />
        <polygon points="60,46 106,69 106,23 60,0" fill={wall} />
        <polyline points="14,23 60,0 106,23" class="corner-cap" />
        <line x1="60" y1="0" x2="60" y2="46" class="corner-seam" />
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

// 규격 비교용 실루엣. 같은 축척으로 그려 크기 차이를 바로 비교한다.
export function Silhouette({ dims, scale, color }) {
  const w = Math.max(6, dims[0] * scale),
    d = Math.max(4, dims[2] * scale);
  return (
    <span class="silhouette" aria-hidden="true">
      <span style={{ width: `${w}px`, height: `${d}px`, background: color }} />
    </span>
  );
}

export function FitBadge({ fit }) {
  const map = {
    fits: ['check', '들어가요'],
    overlap: ['triangle-alert', '겹쳐요'],
    door: ['triangle-alert', '문 앞을 막아요'],
    window: ['triangle-alert', '창 앞을 가려요'],
    oversize: ['circle-alert', '방보다 커요'],
  };
  const [icon, text] = map[fit] || map.fits;
  return (
    <span class={`fit fit-${fit}`}>
      <Icon name={icon} size={14} />
      {text}
    </span>
  );
}

export function useOutside(ref, onClose, active) {
  useLayoutEffect(() => {
    if (!active) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose(e);
    };
    const k = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target.closest?.('[aria-modal="true"]'))
        return;
      e.preventDefault();
      e.stopPropagation();
      onClose(e);
    };
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', k, true);
    return () => {
      document.removeEventListener('pointerdown', h);
      document.removeEventListener('keydown', k, true);
    };
  }, [active]);
}

export function footprintOf(item) {
  return footprint(item);
}

export function useAutosize(value) {
  const ref = useRef(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    const sheet = el.closest('.sheet'),
      composer = el.closest('.composer');
    const min = parseFloat(getComputedStyle(el).minHeight) || 40;
    let max = 168;
    if (sheet && composer) {
      const other = composer.offsetHeight - el.offsetHeight;
      const chrome = [...sheet.children]
        .filter(
          (n) =>
            n !== composer &&
            !n.classList.contains('thread') &&
            !n.classList.contains('sheet-resize'),
        )
        .reduce((sum, n) => sum + n.offsetHeight, 0);
      const height = sheet.classList.contains('is-collapsed')
        ? (window.visualViewport?.height || innerHeight) - 48
        : sheet.clientHeight;
      max = Math.max(min, Math.min(max, height - chrome - other - 12));
    }
    el.style.height = 'auto';
    el.style.height = `${Math.max(min, Math.min(el.scrollHeight, max))}px`;
  };
  useLayoutEffect(resize, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(schedule);
    for (const node of [el.closest('.sheet'), el.closest('.composer'), el.closest('.composer-box')])
      if (node) observer.observe(node);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, []);
  return ref;
}

// 포인터와 키보드가 같은 메뉴 항목과 닫기 동작을 쓴다.
export function useMenu(ref, active, onChange) {
  const trigger = useRef(null),
    initial = useRef(null);
  const items = () =>
    [
      ...(ref.current?.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]') || []),
    ].filter((el) => !el.disabled);
  const close = (restore = false) => {
    onChange(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  useOutside(ref, (event) => close(event?.key === 'Escape'), active);
  useLayoutEffect(() => {
    if (!active || !initial.current) return;
    const list = items();
    (initial.current === 'last' ? list.at(-1) : list[0])?.focus({ preventScroll: true });
    initial.current = null;
  }, [active]);
  const openAt = (last) => {
    initial.current = last ? 'last' : 'first';
    onChange(true);
    if (active) {
      const list = items();
      (last ? list.at(-1) : list[0])?.focus();
      initial.current = null;
    }
  };
  return {
    close,
    trigger: {
      ref: trigger,
      'aria-haspopup': 'menu',
      'aria-expanded': active,
      onClick: (event) => {
        initial.current = event.detail === 0 ? 'first' : null;
        onChange(!active);
      },
      onKeyDown: (event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        openAt(event.key === 'ArrowUp');
      },
    },
    onKeyDown: (event) => {
      if (!active || isComposingKey(event)) return;
      if (event.key === 'Tab') {
        const list = [
          ...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]'),
        ].filter(
          (el) =>
            !el.disabled &&
            el.tabIndex >= 0 &&
            el.getClientRects().length &&
            !el.closest('[inert]') &&
            (!ref.current?.contains(el) || el === trigger.current),
        );
        const at = list.indexOf(trigger.current),
          next = list[(at + (event.shiftKey ? -1 : 1) + list.length) % list.length];
        event.preventDefault();
        close();
        next?.focus();
        return;
      }
      const list = items(),
        at = list.indexOf(document.activeElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? list.length - 1
            : event.key === 'ArrowDown'
              ? (at + 1) % list.length
              : event.key === 'ArrowUp'
                ? (at - 1 + list.length) % list.length
                : null;
      if (next === null || !list.length) return;
      event.preventDefault();
      event.stopPropagation();
      list[next].focus({ preventScroll: true });
      list[next].scrollIntoView({ block: 'nearest' });
    },
  };
}
