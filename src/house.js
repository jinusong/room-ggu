import { PlanScene, drawAvatar, drawDoor, drawWindow, doorHit } from './plan.js';
import { spaces } from './data.js';
import { FLAT_TYPES } from './catalog.js';
import { floorplanWarnings, normalizeFloorplan, roomBounds } from './floorplan.js';
import { PAPER } from './tape.js';
import { houseLayout } from './house-geometry.js';
import { avatarLayout, avatarSpace, avatarRect, avatarReach } from './avatar.js';

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
    // 방 밖에 선 아바타도 화면에 담는다.
    const stand = avatarSpace(this.state, list),
      standAt = stand && plan.positions[stand.roomId],
      body = standAt && avatarRect(avatarLayout({ ...this.state, ...stand }));
    if (body)
      bounds.push({
        left: standAt.x + body.left,
        right: standAt.x + body.right,
        top: standAt.z + body.top,
        bottom: standAt.z + body.bottom,
      });
    // 공간을 붙일 벽을 고르는 동안에는 붙을 자리까지 화면에 담는다. 종류를 바꿔 봐도 축척이 흔들리지 않는다.
    const reserve = this.reserve,
      at = reserve && plan.positions[this.state.roomId];
    if (at) {
      const { w, d } = this.state.room,
        b = roomBounds({ room: this.state.room }, at);
      if (reserve.side === 'right')
        bounds.push({ ...b, left: b.right, right: b.right + reserve.w });
      if (reserve.side === 'left') bounds.push({ ...b, right: b.left, left: b.left - reserve.w });
      if (reserve.side === 'front')
        bounds.push({ ...b, top: b.bottom, bottom: b.bottom + reserve.d });
      if (reserve.side === 'back') bounds.push({ ...b, bottom: b.top, top: b.top - reserve.d });
      // 붙는 공간이 이 방보다 길면 벽을 따라서도 넘친다.
      const last = bounds[bounds.length - 1];
      if (reserve.side === 'right' || reserve.side === 'left')
        last.bottom = Math.max(last.bottom, b.top + Math.max(d, reserve.d));
      else last.right = Math.max(last.right, b.left + Math.max(w, reserve.w));
    }
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
      c.fillStyle = r.room.floorColor;
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
      for (const a of [...r.items].sort((a, b) => FLAT_TYPES.has(b.type) - FLAT_TYPES.has(a.type)))
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
    for (const o of layout.windows) drawWindow(c, o, ox, oy, scale, wall);
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
    // 붙이려는 공간의 자리와 크기를 점선으로 미리 보여 준다.
    const g = this.ghostRoom;
    if (g) {
      const x = ox + (g.x - g.w / 2) * scale,
        y = oy + (g.z - g.d / 2) * scale;
      c.save();
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillRect(x, y, g.w * scale, g.d * scale);
      c.setLineDash([6, 5]);
      c.strokeStyle = INK;
      c.lineWidth = 1.5;
      c.strokeRect(x, y, g.w * scale, g.d * scale);
      c.setLineDash([]);
      c.fillStyle = '#545049';
      c.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (g.w * scale > 64 && g.d * scale > 24)
        c.fillText(`${g.w} × ${g.d}m`, x + (g.w * scale) / 2, y + (g.d * scale) / 2);
      c.restore();
    }
  }
  // 고른 공간의 네 벽 바깥. + 손잡이를 여기에 둔다.
  sideAnchors() {
    const r = spaces(this.state).find((r) => r.roomId === this.state.roomId),
      p = this.state.floorplan.positions[this.state.roomId];
    if (!r || !p || !this.scale) return [];
    const rect = this.canvas.getBoundingClientRect(),
      { w, d } = r.room,
      gap = 22 / this.scale;
    return [
      ['right', w / 2 + gap, 0],
      ['left', -w / 2 - gap, 0],
      ['back', 0, -d / 2 - gap],
      ['front', 0, d / 2 + gap],
    ].map(([side, x, z]) => ({
      side,
      x: rect.left + this.ox + (p.x + x) * this.scale,
      y: rect.top + this.oy + (p.z + z) * this.scale,
      // 벽을 따라가는 화면 방향과 벽 길이. 이름표와 겹치면 이 방향으로 비킨다.
      along: x ? [0, 1] : [1, 0],
      span: (x ? d : w) * this.scale,
      visible: true,
    }));
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
  // 고른 공간의 벽에 난 문들의 화면 자리. + 손잡이가 문을 덮지 않게 비킬 때 쓴다.
  doorSpots() {
    if (!this.scale) return [];
    const rect = this.canvas.getBoundingClientRect();
    return houseLayout(this.state)
      .openings.filter((o) => o.roomIds.includes(this.state.roomId))
      .map((o) => ({
        x: rect.left + this.ox + o.x * this.scale,
        y: rect.top + this.oy + o.z * this.scale,
        half: (o.width / 2) * this.scale,
        vertical: o.vertical,
      }));
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
    // 몸이 차지한 범위의 위쪽 가운데에 붙인다. 방 앞쪽 바깥에 서 있으면 몸 아래에 둬 벽을 가리지 않는다.
    const rect = this.canvas.getBoundingClientRect(),
      b = avatarReach(a),
      rad = (a.angle * Math.PI) / 180,
      zs = [
        [b.minX, b.minZ],
        [b.maxX, b.minZ],
        [b.minX, b.maxZ],
        [b.maxX, b.maxZ],
      ].map(([x, z]) => -x * Math.sin(rad) + z * Math.cos(rad)),
      below = a.outside && a.z > home.room.d / 2;
    return {
      x: rect.left + this.ox + (p.x + a.x) * this.scale,
      y:
        rect.top + this.oy + (p.z + a.z + (below ? Math.max(...zs) : Math.min(...zs))) * this.scale,
      below,
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
