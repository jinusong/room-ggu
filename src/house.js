import { PlanScene, drawAvatar, drawDoor, drawFixtures, doorHit } from './plan.js';
import { spaces } from './data.js';
import { floorplanWarnings, normalizeFloorplan, roomBounds } from './floorplan.js';
import { PAPER } from './tape.js';
import { houseLayout } from './house-geometry.js';
import { avatarLayout, avatarSpace } from './avatar.js';

const INK = '#2a2824';
export class HouseScene extends PlanScene {
  constructor(host, state, cb) {
    super(host, state, cb);
    this.canvas.setAttribute(
      'aria-label',
      '집 전체 평면도. 공간과 문을 끌어 옮기고, 공간을 더블클릭하면 방을 편집해요.',
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
    this.doorAt = (p, e) =>
      houseLayout(state).openings.find((o) =>
        doorHit(o, p, this.scale, e?.pointerType === 'touch' ? 22 : 14),
      );
    this.down = (e) => {
      if (e.button !== 0) return;
      const p = this.point(e),
        door = this.doorAt(p, e),
        r = this.spaceAt(p);
      if (door) {
        this.drag = {
          door,
          grab: (door.vertical ? p.z : p.x) - (door.vertical ? door.z : door.x),
          px: e.clientX,
          py: e.clientY,
          started: false,
        };
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      cb.pickDoor?.(null);
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
        const at = this.point(e),
          door = this.doorAt(at, e);
        this.canvas.style.cursor = door
          ? door.vertical
            ? 'ns-resize'
            : 'ew-resize'
          : this.spaceAt(at)
            ? 'grab'
            : '';
        return;
      }
      if (!this.drag.started && Math.hypot(e.clientX - this.drag.px, e.clientY - this.drag.py) < 4)
        return;
      if (!this.drag.started) {
        this.drag.started = true;
        cb.start?.();
      }
      const p = this.point(e);
      if (this.drag.door) {
        const { door, grab } = this.drag;
        cb.moveDoor?.(door.roomIds, (door.vertical ? p.z : p.x) - grab);
        return;
      }
      this.canvas.style.cursor = 'grabbing';
      cb.moveSpace(this.drag.id, p.x + this.drag.dx, p.z + this.drag.dz);
    };
    this.up = () => {
      const moved = this.drag?.started,
        door = this.drag?.door;
      this.drag = null;
      this.canvas.style.cursor = '';
      if (door) cb.pickDoor?.(door.roomIds);
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
    const conflicts = floorplanWarnings(list, plan),
      layout = houseLayout(this.state),
      wall = Math.max(3, 0.08 * scale);
    // 가구 이름은 넉넉히 확대됐을 때만 적는다. 방 이름표는 화면 위 이름표가 맡는다.
    const names = scale >= 90;
    for (const r of layout.rooms) {
      const p = r.position,
        b = r.bounds;
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
      this.ox = ox + p.x * scale;
      this.oy = oy + p.z * scale;
      if (r.room.type === 'bathroom') drawFixtures(c, r.room, r.openings, this.ox, this.oy, scale);
      for (const a of [...r.items].sort((a, b) => (b.type === 'rug') - (a.type === 'rug')))
        this.item(c, a, { named: names });
      this.ox = ox;
      this.oy = oy;
    }
    for (const r of layout.rooms) {
      const b = r.bounds;
      c.strokeStyle = conflicts.has(r.roomId) ? '#b03d29' : INK;
      c.lineWidth = wall;
      c.strokeRect(ox + b.left * scale, oy + b.top * scale, r.room.w * scale, r.room.d * scale);
    }
    const picked = this.doorSelected;
    for (const o of layout.openings)
      drawDoor(
        c,
        o,
        ox,
        oy,
        scale,
        wall + 2,
        !!picked && o.roomIds.includes(picked[0]) && o.roomIds.includes(picked[1]),
      );
    // 고른 공간은 벽 안쪽에 줄자 노랑 테두리를 둘러 표시한다.
    const active = layout.rooms.find((r) => r.roomId === this.state.roomId);
    if (active) {
      const b = active.bounds,
        inset = wall / 2 + 2;
      c.strokeStyle = '#d9a21b';
      c.lineWidth = 2.5;
      c.strokeRect(
        ox + b.left * scale + inset,
        oy + b.top * scale + inset,
        Math.max(0, active.room.w * scale - inset * 2),
        Math.max(0, active.room.d * scale - inset * 2),
      );
    }
    const home = avatarSpace(this.state, list);
    if (home) {
      const a = avatarLayout({ ...this.state, ...home }),
        p = plan.positions[home.roomId];
      if (a) drawAvatar(c, a, ox + p.x * scale, oy + p.z * scale, scale);
    }
  }
  // 이름표 자리: 공간의 안쪽 왼쪽 위 모서리.
  tagAnchor(id) {
    const r = spaces(this.state).find((r) => r.roomId === id),
      p = this.state.floorplan.positions[id];
    if (!r || !p || !this.scale) return null;
    const rect = this.canvas.getBoundingClientRect(),
      b = roomBounds(r, p);
    return {
      x: rect.left + this.ox + b.left * this.scale,
      y: rect.top + this.oy + b.top * this.scale,
      width: r.room.w * this.scale,
      corner: true,
      visible: true,
    };
  }
  // 고른 문의 막대 자리: 문 가운데.
  doorAnchor(ids) {
    if (!ids || !this.scale) return null;
    const o = houseLayout(this.state).openings.find(
      (o) => o.roomIds.includes(ids[0]) && o.roomIds.includes(ids[1]),
    );
    if (!o) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.ox + o.x * this.scale,
      y: rect.top + this.oy + o.z * this.scale,
      half: (o.width / 2) * this.scale,
      vertical: o.vertical,
      visible: true,
    };
  }
  avatarAnchor() {
    const list = spaces(this.state),
      home = avatarSpace(this.state, list);
    if (!home || !this.scale) return null;
    const a = avatarLayout({ ...this.state, ...home }),
      p = this.state.floorplan.positions[home.roomId];
    if (!a || !p) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.ox + (p.x + a.x) * this.scale,
      y: rect.top + this.oy + (p.z + a.z) * this.scale - a.h * 0.5 * this.scale,
      visible: true,
    };
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
