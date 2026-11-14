import { TYPES, footprint } from './data.js';
import { tapeCanvas, PAPER } from './tape.js';
import { avatarLayout, LIMBS } from './avatar.js';

// 건축 평면도 방식의 2D 도면. 벽은 먹색 단면, 가구는 위에서 본 기호와 이름으로 그린다.
const INK = '#2a2824';
const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';
const TALL = new Set(['wardrobe', 'shelf', 'fridge', 'shoe_cabinet']);

export class PlanScene {
  constructor(host, state, cb) {
    this.host = host;
    this.state = state;
    this.cb = cb;
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', '2D 평면도. 가구를 끌어 옮기고 방향키로 미세 조정해요.');
    this.canvas.tabIndex = 0;
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.selected = null;
    this.warnings = new Set();
    this.ghostItem = null;
    this.drag = null;
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(host);
    this.hit = (p) => {
      const avatar = avatarLayout(this.state);
      if (
        avatar?.pose === 'standing' &&
        Math.hypot(p.x - avatar.x, p.z - avatar.z) < avatar.h * 0.18
      )
        return { id: 'avatar', x: avatar.x, z: avatar.z };
      for (const a of [...this.state.items].sort(
        (a, b) => (a.type === 'rug') - (b.type === 'rug'),
      )) {
        const dx = p.x - a.x,
          dz = p.z - a.z,
          r = (a.angle * Math.PI) / 180;
        const x = dx * Math.cos(r) - dz * Math.sin(r),
          z = dx * Math.sin(r) + dz * Math.cos(r);
        if (Math.abs(x) <= a.dims[0] / 200 && Math.abs(z) <= a.dims[2] / 200) return a;
      }
      return null;
    };
    this.down = (e) => {
      if (e.button !== 0) return;
      const p = this.point(e),
        hit = this.hit(p);
      if (hit?.id !== 'avatar') this.cb.select(hit?.id || null);
      if (hit) {
        this.drag = { id: hit.id, dx: hit.x - p.x, dz: hit.z - p.z, started: false };
        this.canvas.setPointerCapture(e.pointerId);
      }
    };
    this.move = (e) => {
      const p = this.point(e);
      if (!this.drag) {
        this.canvas.style.cursor = this.hit(p) ? 'grab' : '';
        return;
      }
      if (!this.drag.started) {
        this.drag.started = true;
        this.cb.start?.();
      }
      this.canvas.style.cursor = 'grabbing';
      if (this.drag.id === 'avatar') this.cb.moveAvatar?.(p.x + this.drag.dx, p.z + this.drag.dz);
      else this.cb.move(this.drag.id, p.x + this.drag.dx, p.z + this.drag.dz);
    };
    this.up = () => {
      if (this.drag) {
        const started = this.drag.started;
        this.drag = null;
        this.canvas.style.cursor = '';
        if (started) this.cb.commit();
      }
    };
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.up);
    this.draw();
  }
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.ox) / this.scale,
      z: (e.clientY - r.top - this.oy) / this.scale,
    };
  }
  setInsets(insets) {
    this.insets = { left: 0, right: 0, top: 0, bottom: 0, ...insets };
    this.draw();
  }
  sync() {
    this.draw();
  }
  renderRoom() {
    this.draw();
  }
  invalidate() {
    this.draw();
  }
  moveObject() {
    this.draw();
  }
  decorate(id, warnings) {
    this.selected = id;
    this.warnings = warnings;
    this.draw();
  }
  setGhost(item) {
    this.ghostItem = item || null;
    this.draw();
  }
  setAvatar() {
    this.draw();
  }
  anchor(id, { center = false } = {}) {
    const a = id === 'ghost' ? this.ghostItem : this.state.items.find((x) => x.id === id);
    if (!a || !this.scale) return null;
    const r = this.canvas.getBoundingClientRect(),
      f = footprint(a);
    return {
      x: r.left + this.ox + a.x * this.scale,
      y: r.top + this.oy + (center ? a.z : a.z - f.d / 2) * this.scale - (center ? 0 : 8),
      visible: true,
    };
  }
  tape(c, text, x, y, angle = 0, opts) {
    const { canvas, aspect } = tapeCanvas(text, opts);
    const h = 20,
      w = h * aspect;
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.drawImage(canvas, -w / 2, -h / 2, w, h);
    c.restore();
  }
  draw() {
    const W = this.host.clientWidth,
      H = this.host.clientHeight;
    if (!W || !H) return;
    const ratio = Math.min(devicePixelRatio, 2);
    if (
      this.canvas.width !== Math.round(W * ratio) ||
      this.canvas.height !== Math.round(H * ratio)
    ) {
      this.canvas.width = Math.round(W * ratio);
      this.canvas.height = Math.round(H * ratio);
      this.canvas.style.width = W + 'px';
      this.canvas.style.height = H + 'px';
    }
    const c = this.ctx,
      { left, right, top, bottom } = this.insets;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    const room = this.state.room,
      pad = W < 600 ? 44 : 72;
    const aw = Math.max(80, W - left - right - pad * 2),
      ah = Math.max(80, H - top - bottom - pad * 2);
    this.scale = Math.max(8, Math.min(aw / room.w, ah / room.d));
    this.ox = left + (W - left - right) / 2;
    this.oy = top + (H - top - bottom) / 2;
    const s = this.scale,
      rw = room.w * s,
      rh = room.d * s,
      x0 = this.ox - rw / 2,
      y0 = this.oy - rh / 2,
      wt = Math.max(5, 0.1 * s);
    c.fillStyle = INK;
    c.shadowColor = 'rgba(40,32,20,0.14)';
    c.shadowBlur = 18;
    c.shadowOffsetY = 6;
    c.fillRect(x0 - wt, y0 - wt, rw + wt * 2, rh + wt * 2);
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.fillStyle = room.floorColor;
    c.fillRect(x0, y0, rw, rh);
    c.fillStyle = 'rgba(255,255,255,0.42)';
    c.fillRect(x0, y0, rw, rh);
    c.strokeStyle = 'rgba(60,40,20,0.08)';
    c.lineWidth = 1;
    c.beginPath();
    for (let z = 0.2; z < room.d; z += 0.2) {
      c.moveTo(x0, y0 + z * s);
      c.lineTo(x0 + rw, y0 + z * s);
    }
    c.stroke();
    if (this.state.grid) {
      for (const [step, alpha] of [
        [0.25, 0.07],
        [1, 0.16],
      ]) {
        c.strokeStyle = `rgba(42,40,36,${alpha})`;
        c.beginPath();
        for (let i = step; i < room.w - 0.001; i += step) {
          c.moveTo(x0 + i * s, y0);
          c.lineTo(x0 + i * s, y0 + rh);
        }
        for (let i = step; i < room.d - 0.001; i += step) {
          c.moveTo(x0, y0 + i * s);
          c.lineTo(x0 + rw, y0 + i * s);
        }
        c.stroke();
      }
    }
    c.strokeStyle = 'rgba(42,40,36,0.45)';
    c.lineWidth = 1;
    const ly = y0 - wt - 22,
      lx = x0 - wt - 22;
    c.beginPath();
    c.moveTo(x0, ly);
    c.lineTo(x0 + rw, ly);
    c.moveTo(x0, ly - 5);
    c.lineTo(x0, ly + 5);
    c.moveTo(x0 + rw, ly - 5);
    c.lineTo(x0 + rw, ly + 5);
    c.moveTo(lx, y0);
    c.lineTo(lx, y0 + rh);
    c.moveTo(lx - 5, y0);
    c.lineTo(lx + 5, y0);
    c.moveTo(lx - 5, y0 + rh);
    c.lineTo(lx + 5, y0 + rh);
    c.stroke();
    this.tape(c, `${Math.round(room.w * 100)} cm`, this.ox, ly);
    this.tape(c, `${Math.round(room.d * 100)} cm`, lx, this.oy, -Math.PI / 2);
    const items = [...this.state.items].sort((a, b) => (b.type === 'rug') - (a.type === 'rug'));
    for (const a of items)
      this.item(c, a, { warn: this.warnings.has(a.id), selected: a.id === this.selected });
    if (this.ghostItem) this.item(c, this.ghostItem, { ghost: true });
    this.drawAvatar(c);
  }
  drawAvatar(c) {
    const a = avatarLayout(this.state);
    if (!a) return;
    const s = this.scale;
    c.save();
    c.translate(this.ox + a.x * s, this.oy + a.z * s);
    c.rotate((-a.angle * Math.PI) / 180);
    c.strokeStyle = '#526354';
    c.fillStyle = '#667669';
    c.lineCap = 'round';
    for (const [from, to] of [...LIMBS, ['hip', 'shoulder']]) {
      c.lineWidth = Math.max(3, a.h * (from === 'hip' ? 0.2 : 0.05) * s);
      c.beginPath();
      c.moveTo(a.joints[from][0] * s, a.joints[from][2] * s);
      c.lineTo(a.joints[to][0] * s, a.joints[to][2] * s);
      c.stroke();
    }
    const head = a.joints.head;
    c.beginPath();
    c.arc(head[0] * s, head[2] * s, Math.max(3, a.h * 0.06 * s), 0, Math.PI * 2);
    c.fill();
    c.restore();
    this.tape(
      c,
      `키 ${a.height} cm`,
      this.ox + a.x * s,
      this.oy + (a.z + (a.pose === 'lying' ? a.h / 2 : a.h * 0.25)) * s + 20,
      0,
      { fill: '#fbfaf7' },
    );
  }
  item(c, a, { warn = false, selected = false, ghost = false }) {
    const s = this.scale,
      fw = (a.dims[0] * s) / 100,
      fd = (a.dims[2] * s) / 100;
    c.save();
    c.translate(this.ox + a.x * s, this.oy + a.z * s);
    c.rotate((-a.angle * Math.PI) / 180);
    c.globalAlpha = ghost ? 0.55 : 1;
    c.fillStyle = a.color;
    c.beginPath();
    if (a.type === 'lamp' || a.type === 'plant') c.ellipse(0, 0, fw / 2, fd / 2, 0, 0, Math.PI * 2);
    else c.roundRect(-fw / 2, -fd / 2, fw, fd, Math.min(4, fw / 6, fd / 6));
    c.fill();
    c.globalAlpha = 1;
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(42,40,36,0.55)';
    if (ghost) {
      c.setLineDash([5, 4]);
      c.strokeStyle = INK;
      c.lineWidth = 1.5;
    }
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 1.5;
    c.beginPath();
    switch (a.type) {
      case 'bed':
        c.fillStyle = 'rgba(250,248,242,0.92)';
        c.fillRect(-fw * 0.44, -fd * 0.44, fw * 0.88, fd * 0.16);
        c.moveTo(-fw / 2, -fd * 0.08);
        c.lineTo(fw / 2, -fd * 0.08);
        break;
      case 'sofa':
      case 'armchair':
        c.rect(-fw / 2 + 3, -fd / 2 + 3, fw - 6, fd * 0.2);
        c.moveTo(-fw * 0.38, -fd * 0.28);
        c.lineTo(-fw * 0.38, fd / 2 - 3);
        c.moveTo(fw * 0.38, -fd * 0.28);
        c.lineTo(fw * 0.38, fd / 2 - 3);
        break;
      case 'chair':
        c.moveTo(-fw / 2 + 2, -fd * 0.34);
        c.lineTo(fw / 2 - 2, -fd * 0.34);
        break;
      case 'rug':
        c.setLineDash([3, 3]);
        c.rect(-fw * 0.44, -fd * 0.44, fw * 0.88, fd * 0.88);
        break;
      case 'desk':
      case 'dining':
      case 'coffee':
      case 'bench':
        c.rect(-fw / 2 + 4, -fd / 2 + 4, fw - 8, fd - 8);
        break;
      case 'washer':
        c.arc(0, 0, Math.min(fw, fd) * 0.3, 0, Math.PI * 2);
        break;
      case 'cabinet':
      case 'side':
      case 'tvstand':
      case 'dresser':
        c.moveTo(-fw / 2 + 2, fd / 2 - 4);
        c.lineTo(fw / 2 - 2, fd / 2 - 4);
        break;
    }
    if (TALL.has(a.type)) {
      c.moveTo(-fw / 2 + 2, -fd / 2 + 2);
      c.lineTo(fw / 2 - 2, fd / 2 - 2);
    }
    c.stroke();
    c.setLineDash([]);
    if (warn || selected) {
      c.lineWidth = 2.5;
      c.strokeStyle = warn ? '#c4452f' : '#d9a21b';
      c.strokeRect(-fw / 2 - 3, -fd / 2 - 3, fw + 6, fd + 6);
      if (warn) {
        c.save();
        c.beginPath();
        c.rect(-fw / 2, -fd / 2, fw, fd);
        c.clip();
        c.strokeStyle = 'rgba(196,69,47,0.35)';
        c.lineWidth = 1;
        c.beginPath();
        for (let k = -fw - fd; k < fw + fd; k += 8) {
          c.moveTo(k - fd / 2, fd / 2);
          c.lineTo(k + fd / 2, -fd / 2);
        }
        c.stroke();
        c.restore();
      }
    }
    if (selected && this.state.dimensions) {
      this.tape(c, `${a.dims[0]}`, 0, fd / 2 + 18);
      this.tape(c, `${a.dims[2]}`, fw / 2 + 18, 0, -Math.PI / 2);
    }
    c.restore();
    // 이름은 가구가 돌아가도 똑바로 읽히게 회전 없이 쓴다.
    const f = footprint(a),
      bw = f.w * s,
      bd = f.d * s;
    const label = ghost ? `${TYPES[a.type].name} 초안` : TYPES[a.type].name;
    c.font = `500 12px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const tw = c.measureText(label).width + 8,
      cx = this.ox + a.x * s,
      cy = this.oy + a.z * s;
    if (bw > tw && bd > 18 && a.type !== 'rug') {
      c.fillStyle = 'rgba(255,255,255,0.82)';
      c.fillRect(cx - tw / 2, cy - 8, tw, 16);
      c.fillStyle = INK;
      c.fillText(label, cx, cy);
    } else if (a.type === 'rug' && bw > 60) {
      c.fillStyle = 'rgba(42,40,36,0.6)';
      c.fillText(label, cx, cy + bd / 2 - 12);
    }
  }
  png() {
    this.draw();
    return this.canvas.toDataURL('image/png');
  }
  dispose() {
    this.resize.disconnect();
    for (const [e, f] of [
      ['pointerdown', this.down],
      ['pointermove', this.move],
      ['pointerup', this.up],
      ['pointercancel', this.up],
    ])
      this.canvas.removeEventListener(e, f);
  }
}
