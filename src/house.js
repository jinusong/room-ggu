import { PlanScene } from './plan.js';
import { spaces } from './data.js';
import { floorplanWarnings, normalizeFloorplan, roomBounds, sharedOpening } from './floorplan.js';
import { PAPER } from './tape.js';

const INK = '#2a2824';
export class HouseScene extends PlanScene {
  constructor(host, state, cb) {
    super(host, state, cb);
    this.canvas.setAttribute(
      'aria-label',
      '집 전체 평면도. 공간을 끌어 옮기고 더블클릭하면 방을 편집해요.',
    );
    for (const [event, fn] of [
      ['pointerdown', this.down],
      ['pointermove', this.move],
      ['pointerup', this.up],
      ['pointercancel', this.up],
    ])
      this.canvas.removeEventListener(event, fn);
    this.spaceAt = (p) =>
      [...spaces(state)].reverse().find((r) => {
        const b = roomBounds(r, state.floorplan.positions[r.roomId]);
        return p.x >= b.left && p.x <= b.right && p.z >= b.top && p.z <= b.bottom;
      });
    this.down = (e) => {
      if (e.button !== 0) return;
      const p = this.point(e),
        r = this.spaceAt(p);
      if (!r) return;
      const pos = state.floorplan.positions[r.roomId];
      this.drag = {
        id: r.roomId,
        dx: pos.x - p.x,
        dz: pos.z - p.z,
        px: e.clientX,
        py: e.clientY,
        started: false,
      };
      cb.selectSpace(r.roomId);
      this.canvas.setPointerCapture(e.pointerId);
    };
    this.move = (e) => {
      if (!this.drag) {
        this.canvas.style.cursor = this.spaceAt(this.point(e)) ? 'grab' : '';
        return;
      }
      if (!this.drag.started && Math.hypot(e.clientX - this.drag.px, e.clientY - this.drag.py) < 4)
        return;
      if (!this.drag.started) {
        this.drag.started = true;
        cb.start?.();
      }
      const p = this.point(e);
      this.canvas.style.cursor = 'grabbing';
      cb.moveSpace(this.drag.id, p.x + this.drag.dx, p.z + this.drag.dz);
    };
    this.up = () => {
      const moved = this.drag?.started;
      this.drag = null;
      this.canvas.style.cursor = '';
      if (moved) cb.commit();
      this.draw();
    };
    this.double = (e) => {
      const r = this.spaceAt(this.point(e));
      if (r) cb.editSpace(r.roomId);
    };
    for (const [event, fn] of [
      ['pointerdown', this.down],
      ['pointermove', this.move],
      ['pointerup', this.up],
      ['pointercancel', this.up],
      ['dblclick', this.double],
    ])
      this.canvas.addEventListener(event, fn);
  }
  draw() {
    const W = this.host.clientWidth,
      H = this.host.clientHeight;
    if (!W || !H) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * ratio);
    this.canvas.height = Math.round(H * ratio);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    const c = this.ctx,
      list = spaces(this.state),
      plan = normalizeFloorplan(this.state.floorplan, list);
    const bounds = list.map((r) => roomBounds(r, plan.positions[r.roomId]));
    const minX = Math.min(...bounds.map((b) => b.left)),
      maxX = Math.max(...bounds.map((b) => b.right));
    const minZ = Math.min(...bounds.map((b) => b.top)),
      maxZ = Math.max(...bounds.map((b) => b.bottom));
    const { left, right, top, bottom } = this.insets,
      pad = W < 600 ? 32 : 64;
    if (!this.drag?.started || !this.scale) {
      this.scale = Math.max(
        0.2,
        Math.min(
          Math.max(60, W - left - right - pad * 2) / (maxX - minX),
          Math.max(60, H - top - bottom - pad * 2) / (maxZ - minZ),
        ),
      );
      this.ox = left + (W - left - right) / 2 - ((minX + maxX) / 2) * this.scale;
      this.oy = top + (H - top - bottom) / 2 - ((minZ + maxZ) / 2) * this.scale;
    }
    const scale = this.scale,
      ox = this.ox,
      oy = this.oy;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    const conflicts = floorplanWarnings(list, plan);
    for (const r of list) {
      const p = plan.positions[r.roomId],
        b = roomBounds(r, p);
      const x = ox + b.left * scale,
        y = oy + b.top * scale,
        w = r.room.w * scale,
        d = r.room.d * scale;
      c.fillStyle = r.room.type === 'bathroom' ? '#dce1dc' : r.room.floorColor;
      c.fillRect(x, y, w, d);
      c.fillStyle = 'rgba(255,255,255,0.34)';
      c.fillRect(x, y, w, d);
      if (this.state.grid) {
        c.strokeStyle = 'rgba(42,40,36,0.08)';
        c.lineWidth = 1;
        c.beginPath();
        const step = r.room.type === 'bathroom' ? 0.3 : 0.5;
        for (let n = step; n < r.room.w; n += step) {
          c.moveTo(x + n * scale, y);
          c.lineTo(x + n * scale, y + d);
        }
        for (let n = step; n < r.room.d; n += step) {
          c.moveTo(x, y + n * scale);
          c.lineTo(x + w, y + n * scale);
        }
        c.stroke();
      }
      c.strokeStyle = conflicts.has(r.roomId) ? '#b03d29' : INK;
      c.lineWidth = Math.max(3, 0.08 * scale);
      c.strokeRect(x, y, w, d);
      if (r.roomId === this.state.roomId) {
        c.strokeStyle = '#8c927f';
        c.lineWidth = 2;
        c.strokeRect(x + 5, y + 5, Math.max(0, w - 10), Math.max(0, d - 10));
      }
      this.ox = ox + p.x * scale;
      this.oy = oy + p.z * scale;
      for (const a of [...r.items].sort((a, b) => (b.type === 'rug') - (a.type === 'rug')))
        this.item(c, a, {});
      this.ox = ox;
      this.oy = oy;
      if (r.room.type === 'bathroom') this.bathroom(c, x, y, w, d);
      const labelY = y + Math.min(22, d * 0.18);
      c.font = `500 ${Math.min(13, Math.max(9, scale * 0.25))}px system-ui`;
      c.textAlign = 'center';
      const name = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name;
      const textWidth = Math.min(w - 12, c.measureText(name).width + 12);
      c.fillStyle = '#fbfaf7';
      c.fillRect(x + (w - textWidth) / 2, labelY - 13, textWidth, 18);
      c.save();
      c.beginPath();
      c.rect(x + 6, y + 4, Math.max(0, w - 12), 24);
      c.clip();
      c.fillStyle = INK;
      c.fillText(name, x + w / 2, labelY);
      c.restore();
      if (this.state.dimensions && w > 65) {
        c.font = '10px "JetBrains Mono", monospace';
        c.fillStyle = INK;
        c.fillText(`${r.room.w} × ${r.room.d}m`, x + w / 2, y + d - 12);
      }
    }
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const o = sharedOpening(
          list[i],
          plan.positions[list[i].roomId],
          list[j],
          plan.positions[list[j].roomId],
        );
        if (!o) continue;
        c.save();
        c.translate(ox + o.x * scale, oy + o.z * scale);
        if (o.vertical) c.rotate(-Math.PI / 2);
        const width = o.width * scale;
        c.strokeStyle = PAPER;
        c.lineWidth = Math.max(6, 0.12 * scale);
        c.beginPath();
        c.moveTo(-width / 2, 0);
        c.lineTo(width / 2, 0);
        c.stroke();
        c.strokeStyle = '#77776b';
        c.lineWidth = 1;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.arc(-width / 2, 0, width, -Math.PI / 2, 0);
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(-width / 2, 0);
        c.lineTo(-width / 2, -width);
        c.stroke();
        c.restore();
      }
  }
  bathroom(c, x, y, w, d) {
    c.save();
    c.strokeStyle = '#737d77';
    c.fillStyle = '#fbfaf7';
    c.lineWidth = 1.5;
    const scale = this.scale;
    c.beginPath();
    c.roundRect(
      x + w * 0.15,
      y + d * 0.25,
      Math.min(0.4 * scale, w * 0.25),
      Math.min(0.65 * scale, d * 0.3),
      6,
    );
    c.fill();
    c.stroke();
    c.beginPath();
    c.ellipse(x + w * 0.72, y + d * 0.4, w * 0.12, d * 0.08, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.setLineDash([3, 3]);
    c.strokeRect(x + w * 0.52, y + d * 0.62, w * 0.36, d * 0.23);
    c.restore();
  }
  anchor(id) {
    const r = spaces(this.state).find((r) => r.roomId === id),
      p = this.state.floorplan.positions[id];
    if (!r || !p) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.ox + p.x * this.scale,
      y: rect.top + this.oy + p.z * this.scale,
      visible: true,
    };
  }
  dispose() {
    this.canvas.removeEventListener('dblclick', this.double);
    super.dispose();
  }
}
