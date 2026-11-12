import { useEffect, useRef, useState } from 'preact/hooks';
import { footprint } from '../data.js';
import { Icon } from './icons.js';

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
  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);
  const parse = (t) => {
    const n = Number(String(t).replace(',', '.'));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
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
            inputMode="decimal"
            value={text}
            onFocus={() => {
              setFocused(true);
              onFocus?.();
            }}
            onInput={(e) => {
              setText(e.currentTarget.value);
              const n = parse(e.currentTarget.value);
              setError(n === null && e.currentTarget.value ? `${min}~${max}${unit}` : '');
              if (n !== null) onLive(n);
            }}
            onKeyDown={(e) => {
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
              const n = parse(e.currentTarget.value);
              if (n === null) {
                setText(fmt(value));
                setError('');
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
      <span class="stepper-source">
        {error ? (
          <em class="field-error">{error} 범위로 입력해 주세요</em>
        ) : (
          <Tape source={source}>{sourceLabel(source)}</Tape>
        )}
      </span>
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
  useEffect(() => {
    if (!active) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('pointerdown', h);
      document.removeEventListener('keydown', k);
    };
  }, [active]);
}

export function footprintOf(item) {
  return footprint(item);
}

export function useAutosize(value) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);
  return ref;
}
