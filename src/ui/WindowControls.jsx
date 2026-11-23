import { useEffect, useRef, useState } from 'preact/hooks';
import { app } from '../app/store.js';
import * as store from '../app/store.js';
import { dragWindowPatch } from '../window-drag.js';
import { Icon } from './icons.js';
const NAMES = { bl: '왼쪽 아래', br: '오른쪽 아래', tr: '오른쪽 위', tl: '왼쪽 위' };
export function WindowControls() {
  const root = useRef(null),
    gesture = useRef(null);
  const [selected, select] = useState(null),
    [error, setError] = useState('');
  const scene = () => (app.state.view === '2d' ? app.scenes.plan : app.scenes.three);
  const finish = (cancel = false) => {
    if (!gesture.current) return;
    gesture.current = null;
    store.finishWindowGesture(cancel);
  };
  useEffect(() => {
    let frame;
    const place = () => {
      const el = root.current,
        stage = el?.parentElement,
        sc = scene();
      if (el && stage && sc) {
        const r = stage.getBoundingClientRect(),
          frames = sc.windowFrames?.() || [];
        for (const node of el.querySelectorAll('[data-window-control]')) {
          const f = frames.find((f) => f.id === node.dataset.windowControl);
          node.style.visibility = !f?.visible ? 'hidden' : '';
          if (!f?.visible) continue;
          const points = f.points.map((p) => ({ x: p.x - r.left, y: p.y - r.top }));
          const minX = Math.min(...points.map((p) => p.x)),
            minY = Math.min(...points.map((p) => p.y));
          const width = Math.max(1, Math.max(...points.map((p) => p.x)) - minX),
            height = Math.max(1, Math.max(...points.map((p) => p.y)) - minY);
          const pane = node.querySelector('[data-window-pane]');
          pane.style.transform = `translate(${minX}px,${minY}px)`;
          pane.style.width = `${width}px`;
          pane.style.height = `${height}px`;
          pane.style.clipPath = `polygon(${points.map((p) => `${((p.x - minX) / width) * 100}% ${((p.y - minY) / height) * 100}%`).join(',')})`;
          const outline = node.querySelector('polygon');
          outline?.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
          for (const button of node.querySelectorAll('[data-window-handle]')) {
            const p = points[['bl', 'br', 'tr', 'tl'].indexOf(button.dataset.windowHandle)];
            const center = {
              x: points.reduce((n, p) => n + p.x, 0) / 4,
              y: points.reduce((n, p) => n + p.y, 0) / 4,
            };
            const distance = Math.hypot(p.x - center.x, p.y - center.y) || 1;
            button.style.transform = `translate(${p.x + ((p.x - center.x) / distance) * 18 - 22}px,${p.y + ((p.y - center.y) / distance) * 18 - 22}px)`;
          }
          const bar = node.querySelector('[data-window-toolbar]');
          if (bar) {
            const inset =
              parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue('--inset-left'),
              ) || 0;
            const x = Math.max(
              inset + 8,
              Math.min(r.width - bar.offsetWidth - 8, minX + width / 2 - bar.offsetWidth / 2),
            );
            const hidden =
              parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue('--inset-bottom'),
              ) || 0;
            let y = minY - bar.offsetHeight - 44;
            if (y < 58) y = minY + height + 36;
            y = Math.max(58, Math.min(r.height - hidden - bar.offsetHeight - 12, y));
            bar.style.transform = `translate(${x}px,${y}px)`;
          }
        }
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    const outside = (e) => {
      if (!root.current?.contains(e.target)) {
        finish(true);
        select(null);
        setError('');
      }
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        finish(true);
        select(null);
        setError('');
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      finish(true);
    };
  }, [app.state.roomId, app.state.view, app.state.scope]);
  const start = (e, w, mode) => {
    if (e.button !== 0 || gesture.current) return;
    const point = scene()?.windowPoint?.(e, w.wall);
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    select(w.id);
    setError('');
    store.select(null);
    store.beginWindowGesture(w.id);
    gesture.current = {
      id: w.id,
      room: structuredClone(app.state.room),
      base: { ...w },
      point,
      mode,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const g = gesture.current;
    if (!g) return;
    const point = scene()?.windowPoint?.(e, g.base.wall);
    if (!point) return;
    e.preventDefault();
    setError(
      store.dragWindow(dragWindowPatch(g.room, g.base, g.point, point, g.mode, app.state.snap)) ||
        '',
    );
  };
  const key = (e, w, mode) => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[
      e.key
    ];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 0.25 : 0.05;
    const start = { u: 0, v: app.state.view === '2d' ? null : 0 },
      point = {
        u:
          (app.state.view === '2d' && ['left', 'right'].includes(w.wall)
            ? delta[0] - delta[1]
            : delta[0]) * step,
        v: app.state.view === '2d' ? null : delta[1] * step,
      };
    setError(
      store.setWindow(w.id, dragWindowPatch(app.state.room, w, start, point, mode, false)) || '',
    );
  };
  if (app.state.scope === 'house') return null;
  return (
    <div class="window-controls" ref={root}>
      {(app.state.room.windows || []).map((w, i) => (
        <div key={w.id} data-window-control={w.id} class={selected === w.id ? 'is-selected' : ''}>
          <button
            class="window-pane"
            data-window-pane={w.id}
            aria-label={`창문 ${i + 1} 선택 및 이동`}
            aria-pressed={selected === w.id}
            onPointerDown={(e) => start(e, w, 'move')}
            onPointerMove={move}
            onPointerUp={() => finish()}
            onPointerCancel={() => finish(true)}
            onLostPointerCapture={() => finish()}
            onFocus={() => {
              select(w.id);
              store.select(null);
            }}
            onKeyDown={(e) => key(e, w, 'move')}
          />
          {selected === w.id && (
            <>
              <svg class="window-outline" aria-hidden="true">
                <polygon />
              </svg>
              {(app.state.view === '2d' ? ['bl', 'br'] : ['bl', 'br', 'tr', 'tl']).map((mode) => (
                <button
                  key={mode}
                  class="window-resize"
                  data-window-handle={mode}
                  aria-label={`창문 ${i + 1} ${app.state.view === '2d' ? (mode.includes('l') ? '시작 쪽 폭' : '끝 쪽 폭') : NAMES[mode] + ' 크기'} 조절`}
                  onPointerDown={(e) => start(e, w, mode)}
                  onPointerMove={move}
                  onPointerUp={() => finish()}
                  onPointerCancel={() => finish(true)}
                  onLostPointerCapture={() => finish()}
                  onKeyDown={(e) => key(e, w, mode)}
                >
                  <span />
                </button>
              ))}
              <div
                class="window-toolbar"
                data-window-toolbar
                role="group"
                aria-label={`창문 ${i + 1} 도구`}
              >
                <button
                  class="icon-btn"
                  aria-label="창문 이동 손잡이"
                  onPointerDown={(e) => start(e, w, 'move')}
                  onPointerMove={move}
                  onPointerUp={() => finish()}
                  onPointerCancel={() => finish(true)}
                  onLostPointerCapture={() => finish()}
                  onKeyDown={(e) => key(e, w, 'move')}
                >
                  <Icon name="move" size={16} />
                </button>
                <span class="tape is-set">
                  {Math.round(w.width * 100)} × {Math.round(w.height * 100)}cm
                </span>
                <button
                  class="icon-btn"
                  aria-label="창문 치수 직접 입력"
                  onClick={() => store.openTool('windows')}
                >
                  <Icon name="ruler" size={16} />
                </button>
                <button class="icon-btn" aria-label="창문 선택 닫기" onClick={() => select(null)}>
                  <Icon name="x" size={16} />
                </button>
                <small>
                  {app.state.view === '2d'
                    ? '끌어서 이동, 양끝으로 폭 조절'
                    : '끌어서 이동, 모서리로 크기 조절'}
                </small>
                {error && <p role="status">{error}</p>}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
