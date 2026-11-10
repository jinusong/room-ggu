import { TYPES } from './data.js';
export class PlanScene {
  constructor(host, state, cb) {
    this.host = host;
    this.state = state;
    this.cb = cb;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', '2D 평면도. 가구를 선택하고 드래그해 이동하세요.');
    this.canvas.tabIndex = 0;
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.selected = null;
    this.warnings = new Set();
    this.drag = null;
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(host);
    this.down = (e) => {
      if (e.button !== 0) return;
      const p = this.point(e);
      let hit = null;
      for (const a of [...state.items]
        .sort((a, b) => (a.type === 'rug' ? -1 : 0) - (b.type === 'rug' ? -1 : 0))
        .reverse()) {
        const dx = p.x - a.x,
          dz = p.z - a.z,
          r = (a.angle * Math.PI) / 180;
        const x = dx * Math.cos(r) - dz * Math.sin(r),
          z = dx * Math.sin(r) + dz * Math.cos(r);
        if (Math.abs(x) <= a.dims[0] / 200 && Math.abs(z) <= a.dims[2] / 200) {
          hit = a;
          break;
        }
      }
      this.cb.select(hit?.id || null);
      if (hit) {
        this.cb.start?.();
        this.drag = { id: hit.id, dx: hit.x - p.x, dz: hit.z - p.z };
        this.canvas.setPointerCapture(e.pointerId);
      }
    };
    this.move = (e) => {
      if (!this.drag) return;
      const p = this.point(e);
      this.cb.move(this.drag.id, p.x + this.drag.dx, p.z + this.drag.dz);
      this.draw();
    };
    this.up = () => {
      if (this.drag) {
        this.drag = null;
        this.cb.commit();
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
  sync() {
    this.draw();
  }
  renderRoom() {
    this.draw();
  }
  decorate(id, warnings) {
    this.selected = id;
    this.warnings = warnings;
    this.draw();
  }
  draw() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(devicePixelRatio, 2);
    this.canvas.width = w * ratio;
    this.canvas.height = h * ratio;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const c = this.ctx;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#efeee9';
    c.fillRect(0, 0, w, h);
    const room = this.state.room;
    this.scale = Math.min((w - 112) / room.w, (h - 128) / room.d);
    this.scale = Math.max(1, this.scale);
    this.ox = w / 2;
    this.oy = h / 2;
    const x = this.ox - (room.w * this.scale) / 2,
      y = this.oy - (room.d * this.scale) / 2,
      rw = room.w * this.scale,
      rh = room.d * this.scale;
    c.fillStyle = room.floorColor || '#faf9f5';
    c.shadowColor = '#28282015';
    c.shadowBlur = 24;
    c.shadowOffsetY = 8;
    c.fillRect(x, y, rw, rh);
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    if (this.state.grid) {
      c.strokeStyle = '#b5b2a72b';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i <= room.w + 0.001; i += 0.25) {
        c.moveTo(x + i * this.scale, y);
        c.lineTo(x + i * this.scale, y + rh);
      }
      for (let i = 0; i <= room.d + 0.001; i += 0.25) {
        c.moveTo(x, y + i * this.scale);
        c.lineTo(x + rw, y + i * this.scale);
      }
      c.stroke();
    }
    c.strokeStyle = room.wallColor || '#888c83';
    c.lineWidth = 5;
    c.strokeRect(x, y, rw, rh);
    c.font = '500 12px system-ui';
    c.fillStyle = '#767b72';
    c.textAlign = 'center';
    c.fillText(`${room.w * 100} cm`, this.ox, y - 22);
    c.save();
    c.translate(x - 24, this.oy);
    c.rotate(-Math.PI / 2);
    c.fillText(`${room.d * 100} cm`, 0, 0);
    c.restore();
    for (const a of [...this.state.items].sort(
      (a, b) => (a.type === 'rug' ? -1 : 0) - (b.type === 'rug' ? -1 : 0),
    )) {
      c.save();
      c.translate(this.ox + a.x * this.scale, this.oy + a.z * this.scale);
      c.rotate((-a.angle * Math.PI) / 180);
      const fw = (a.dims[0] * this.scale) / 100,
        fd = (a.dims[2] * this.scale) / 100;
      c.fillStyle = a.color;
      c.strokeStyle = this.warnings.has(a.id)
        ? '#bc4b35'
        : a.id === this.selected
          ? '#b75639'
          : '#555b4a55';
      c.lineWidth = a.id === this.selected || this.warnings.has(a.id) ? 2.5 : 1;
      c.beginPath();
      c.roundRect(-fw / 2, -fd / 2, fw, fd, 3);
      c.fill();
      c.stroke();
      c.strokeStyle = '#ffffffa0';
      c.lineWidth = 2;
      if (a.type === 'bed') {
        c.fillStyle = '#f5f2e9';
        c.fillRect(-fw * 0.4, -fd * 0.43, fw * 0.8, fd * 0.17);
        c.beginPath();
        c.moveTo(-fw * 0.48, -fd * 0.12);
        c.lineTo(fw * 0.48, -fd * 0.12);
        c.stroke();
      }
      if (a.type === 'sofa') {
        c.beginPath();
        c.moveTo(-fw * 0.4, -fd * 0.3);
        c.lineTo(fw * 0.4, -fd * 0.3);
        c.moveTo(0, -fd * 0.3);
        c.lineTo(0, fd * 0.4);
        c.stroke();
      }
      if (a.type === 'shelf' || a.type === 'wardrobe') {
        c.beginPath();
        c.moveTo(0, -fd / 2);
        c.lineTo(0, fd / 2);
        c.stroke();
      }
      c.fillStyle = '#252b24';
      c.font = '500 11px system-ui';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (fw > 35 && fd > 20) c.fillText(TYPES[a.type].name, 0, fd * 0.12);
      if (a.id === this.selected && this.state.dimensions) {
        c.font = '11px system-ui';
        c.fillStyle = '#9d432d';
        c.fillText(`${a.dims[0]} cm`, 0, fd / 2 + 15);
        c.save();
        c.translate(fw / 2 + 15, 0);
        c.rotate(-Math.PI / 2);
        c.fillText(`${a.dims[2]} cm`, 0, 0);
        c.restore();
      }
      c.restore();
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
