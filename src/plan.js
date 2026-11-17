import { windowOpenings } from './windows.js';
import { TYPES, footprint, spaces } from './data.js';
import { tapeCanvas, drawTags, PAPER } from './tape.js';
import { avatarLayout, avatarHit, avatarReach, avatarApron, LIMBS } from './avatar.js';
import { roomOpenings, doorSwing } from './floorplan.js';

// 건축 평면도 방식의 2D 도면. 벽은 먹색 단면, 가구는 위에서 본 기호와 이름으로 그린다.
const INK = '#2a2824';
const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';
const TALL = new Set(['wardrobe', 'shelf', 'fridge', 'shoe_cabinet']);

// 위에서 본 아바타. 관절 좌표(m)를 그대로 그려 가구와 같은 축척을 유지한다.
export function drawAvatar(c, a, ox, oy, s) {
  const j = a.joints,
    h = a.h,
    at = (p) => [p[0] * s, p[2] * s],
    line = (from, to, width) => {
      c.lineWidth = Math.max(2, width * s);
      c.beginPath();
      c.moveTo(...at(from));
      c.lineTo(...at(to));
      c.stroke();
    };
  c.save();
  c.translate(ox + a.x * s, oy + a.z * s);
  // 방 밖에서는 받침 위에 선다. 3D의 받침과 같은 크기다.
  if (a.outside) {
    c.beginPath();
    c.arc(0, 0, h * 0.2 * s, 0, Math.PI * 2);
    c.fillStyle = '#f7f5ef';
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(42,40,36,0.28)';
    c.stroke();
  }
  c.rotate((-a.angle * Math.PI) / 180);
  c.lineCap = 'round';
  c.strokeStyle = '#667669';
  c.fillStyle = '#667669';
  for (const [from, to] of LIMBS)
    line(j[from], j[to], h * (from.includes('Hip') || from.includes('Knee') ? 0.075 : 0.05));
  for (const side of ['left', 'right']) line(j[side + 'Foot'], j[side + 'Toe'], h * 0.055);
  c.strokeStyle = '#59695c';
  const spine = Math.hypot(j.shoulder[0] - j.hip[0], j.shoulder[2] - j.hip[2]);
  if (spine > h * 0.08) line(j.hip, j.shoulder, h * 0.24);
  c.fillStyle = '#59695c';
  c.beginPath();
  c.ellipse(...at(j.shoulder), h * 0.16 * s, h * 0.085 * s, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#48574b';
  c.beginPath();
  c.arc(...at(j.head), Math.max(3, h * 0.062 * s), 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// 문을 끌어 잡는 범위(m). 화면에서 최소 pixels만큼은 잡히게 한다.
export function doorHit(o, p, scale, pixels = 14) {
  const reach = Math.max(0.12, pixels / scale),
    along = o.vertical ? p.z - o.z : p.x - o.x,
    across = o.vertical ? p.x - o.x : p.z - o.z;
  return Math.abs(along) <= o.width / 2 + reach * 0.4 && Math.abs(across) <= reach;
}

// 연결 문: 벽을 비우고 문짝과 열리는 호를 그린다. 자동으로 놓인 문은 점선, 직접 옮기거나 폭을 정한 문은 실선이다.
export function drawWindow(c, o, ox, oy, scale, thickness) {
  c.save();
  c.translate(ox + o.x * scale, oy + o.z * scale);
  if (o.vertical) c.rotate(Math.PI / 2);
  const width = o.width * scale,
    depth = Math.max(5, thickness);
  c.fillStyle = PAPER;
  c.fillRect(-width / 2, -depth / 2 - 1, width, depth + 2);
  c.strokeStyle = '#536e75';
  c.lineWidth = 1.5;
  c.strokeRect(-width / 2, -depth / 2, width, depth);
  c.beginPath();
  c.moveTo(-width / 2, 0);
  c.lineTo(width / 2, 0);
  c.moveTo(0, -depth / 2);
  c.lineTo(0, depth / 2);
  c.stroke();
  c.restore();
}

export function drawDoor(c, o, ox, oy, s, wall, selected = false) {
  const { hinge, along, leaf } = doorSwing(o),
    w = o.width * s,
    hx = ox + hinge[0] * s,
    hy = oy + hinge[1] * s;
  c.save();
  c.strokeStyle = PAPER;
  c.lineCap = 'butt';
  c.lineWidth = wall;
  c.beginPath();
  c.moveTo(hx, hy);
  c.lineTo(hx + along[0] * w, hy + along[1] * w);
  c.stroke();
  c.strokeStyle = '#77776b';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(hx, hy);
  c.lineTo(hx + leaf[0] * w, hy + leaf[1] * w);
  c.stroke();
  c.setLineDash(o.custom ? [] : [3, 3]);
  c.beginPath();
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * (Math.PI / 2),
      x = hx + (Math.cos(t) * along[0] + Math.sin(t) * leaf[0]) * w,
      y = hy + (Math.cos(t) * along[1] + Math.sin(t) * leaf[1]) * w;
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  }
  c.stroke();
  if (selected) {
    // 고른 문은 문턱 자리에 줄자 노랑 선을 긋는다.
    c.setLineDash([]);
    c.strokeStyle = '#d9a21b';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(hx, hy);
    c.lineTo(hx + along[0] * w, hy + along[1] * w);
    c.stroke();
  }
  c.restore();
}

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
      const inside = (a) => {
        const dx = p.x - a.x,
          dz = p.z - a.z,
          r = (a.angle * Math.PI) / 180;
        const x = dx * Math.cos(r) - dz * Math.sin(r),
          z = dx * Math.sin(r) + dz * Math.cos(r);
        return Math.abs(x) <= a.dims[0] / 200 && Math.abs(z) <= a.dims[2] / 200;
      };
      // 앉거나 누운 아바타는 가구 위를 덮는다. 그 가구를 누르면 가구가 잡히게 하고,
      // 아바타는 머리 위 이름표나 가구 밖으로 나온 부분으로 고른다.
      const avatar = avatarLayout(this.state);
      if (avatar && avatarHit(avatar, p.x, p.z) && !(avatar.item && inside(avatar.item)))
        return { id: 'avatar', x: avatar.x, z: avatar.z, fixed: avatar.pose !== 'standing' };
      for (const a of [...this.state.items].sort((a, b) => (a.type === 'rug') - (b.type === 'rug')))
        if (inside(a)) return a;
      return null;
    };
    // 이 방 벽에 난 문. 가구가 그 위에 없을 때만 잡힌다.
    this.doorAt = (p, e) =>
      roomOpenings(spaces(this.state), this.state.floorplan, this.state.roomId).find((o) =>
        doorHit(o, p, this.scale, e?.pointerType === 'touch' ? 22 : 14),
      );
    this.down = (e) => {
      if (e.button !== 0) return;
      const p = this.point(e),
        hit = this.hit(p),
        door = !hit && this.cb.moveDoor ? this.doorAt(p, e) : null;
      if (door) {
        // 문은 벽을 따라서만 움직인다. 누른 지점과 문 가운데의 차이를 유지한다.
        this.drag = {
          door,
          grab: (door.vertical ? p.z : p.x) - (door.vertical ? door.z : door.x),
          px: e.clientX,
          py: e.clientY,
          started: false,
        };
        this.cb.select(null);
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (hit?.id !== 'avatar') this.cb.select(hit?.id || null);
      if (hit) {
        this.drag = {
          id: hit.id,
          dx: hit.x - p.x,
          dz: hit.z - p.z,
          px: e.clientX,
          py: e.clientY,
          fixed: !!hit.fixed,
          started: false,
          // 아바타를 끄는 동안에는 도면 축척을 그대로 둔다. 놓은 뒤에 아바타가 선 자리까지 다시 맞춘다.
          apron: hit.id === 'avatar' ? this.apron() : null,
        };
        this.canvas.setPointerCapture(e.pointerId);
      }
    };
    this.move = (e) => {
      const p = this.point(e);
      if (!this.drag) {
        const door = !this.hit(p) && this.cb.moveDoor ? this.doorAt(p, e) : null;
        this.canvas.style.cursor = door
          ? door.vertical
            ? 'ns-resize'
            : 'ew-resize'
          : this.hit(p)
            ? 'grab'
            : '';
        return;
      }
      if (this.drag.door) {
        const { door, grab } = this.drag;
        if (
          !this.drag.started &&
          Math.hypot(e.clientX - this.drag.px, e.clientY - this.drag.py) < 4
        )
          return;
        if (!this.drag.started) {
          this.drag.started = true;
          this.cb.start?.();
        }
        // 방 안 좌표를 집 전체 좌표로 옮겨 넘긴다.
        const origin = this.state.floorplan.positions[this.state.roomId];
        this.cb.moveDoor(
          [this.state.roomId, door.roomId],
          (door.vertical ? p.z + origin.z : p.x + origin.x) - grab,
        );
        return;
      }
      // 손가락이 살짝 흔들린 정도는 누르기로 본다. 앉거나 누운 아바타는 가구를 따라가므로 끌지 않는다.
      if (
        this.drag.fixed ||
        (!this.drag.started && Math.hypot(e.clientX - this.drag.px, e.clientY - this.drag.py) < 4)
      )
        return;
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
        const { started, id, door } = this.drag;
        this.drag = null;
        this.canvas.style.cursor = '';
        if (started && id === 'avatar') this.draw();
        if (started) this.cb.commit();
        else if (door) this.cb.pickDoor?.([this.state.roomId, door.roomId]);
        else if (id === 'avatar') this.cb.pickAvatar?.();
      }
    };
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.up);
    this.draw();
  }
  // 방 밖에 선 아바타까지 담으려고 방 둘레에 더 잡는 자리(m).
  apron() {
    return avatarApron(avatarLayout(this.state), this.state.room);
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
  // 고른 문의 막대 자리: 문 가운데.
  windowPoint(e, wall) {
    const p = this.point(e);
    return {
      u: ['left', 'right'].includes(wall)
        ? p.z + this.state.room.d / 2
        : p.x + this.state.room.w / 2,
      v: null,
    };
  }
  windowFrames() {
    if (!this.scale || this.state.scope === 'house') return [];
    const r = this.canvas.getBoundingClientRect();
    return windowOpenings(this.state.room).map((w) => {
      const cx = r.left + this.ox + w.x * this.scale,
        cy = r.top + this.oy + w.z * this.scale,
        half = (w.width * this.scale) / 2;
      return {
        id: w.id,
        points: w.vertical
          ? [
              { x: cx + 10, y: cy - half },
              { x: cx + 10, y: cy + half },
              { x: cx - 10, y: cy + half },
              { x: cx - 10, y: cy - half },
            ]
          : [
              { x: cx - half, y: cy + 10 },
              { x: cx + half, y: cy + 10 },
              { x: cx + half, y: cy - 10 },
              { x: cx - half, y: cy - 10 },
            ],
        visible: true,
      };
    });
  }
  doorAnchor(ids) {
    if (!ids || !this.scale || !ids.includes(this.state.roomId)) return null;
    const o = roomOpenings(spaces(this.state), this.state.floorplan, this.state.roomId).find((o) =>
      ids.includes(o.roomId),
    );
    if (!o) return null;
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.left + this.ox + o.x * this.scale,
      y: r.top + this.oy + o.z * this.scale,
      half: (o.width / 2) * this.scale,
      vertical: o.vertical,
      visible: true,
    };
  }
  // 문 이름표 자리: 문 안쪽으로 조금 들어온 점. 이름표를 누르면 그 문 너머의 공간으로 간다.
  doorAnchors() {
    if (!this.scale) return [];
    const r = this.canvas.getBoundingClientRect(),
      inset = 20 / this.scale;
    return roomOpenings(spaces(this.state), this.state.floorplan, this.state.roomId).map((o) => ({
      roomId: o.roomId,
      x:
        r.left +
        this.ox +
        (o.x + (o.wall === 'right' ? -inset : o.wall === 'left' ? inset : 0)) * this.scale,
      y:
        r.top +
        this.oy +
        (o.z + (o.wall === 'front' ? -inset : o.wall === 'back' ? inset : 0)) * this.scale,
      visible: true,
    }));
  }
  // 아바타 이름표 자리: 몸이 차지한 범위의 위쪽 가운데.
  avatarAnchor() {
    const a = avatarLayout(this.state);
    if (!a || !this.scale) return null;
    const r = this.canvas.getBoundingClientRect(),
      b = avatarReach(a),
      rad = (a.angle * Math.PI) / 180;
    const zs = [
      [b.minX, b.minZ],
      [b.maxX, b.minZ],
      [b.minX, b.maxZ],
      [b.maxX, b.maxZ],
    ].map(([x, z]) => -x * Math.sin(rad) + z * Math.cos(rad));
    // 방 앞쪽 바깥에 서 있으면 이름표를 몸 아래에 둬 벽과 치수선을 가리지 않는다.
    const below = a.outside && a.z > this.state.room.d / 2;
    return {
      x: r.left + this.ox + a.x * this.scale,
      y: r.top + this.oy + (a.z + (below ? Math.max(...zs) : Math.min(...zs))) * this.scale,
      below,
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
      ah = Math.max(80, H - top - bottom - pad * 2),
      apron = this.drag?.apron || this.apron();
    this.scale = Math.max(
      8,
      Math.min(aw / (room.w + apron.left + apron.right), ah / (room.d + apron.top + apron.bottom)),
    );
    this.ox = left + (W - left - right) / 2 + ((apron.left - apron.right) / 2) * this.scale;
    this.oy = top + (H - top - bottom) / 2 + ((apron.top - apron.bottom) / 2) * this.scale;
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
    const doors = roomOpenings(spaces(this.state), this.state.floorplan, this.state.roomId);
    for (const o of doors)
      drawDoor(c, o, this.ox, this.oy, s, wt * 2 + 2, !!this.doorSelected?.includes(o.roomId));
    for (const o of windowOpenings(room)) drawWindow(c, o, this.ox, this.oy, s, wt * 2);
    const items = [...this.state.items].sort((a, b) => (b.type === 'rug') - (a.type === 'rug'));
    for (const a of items)
      this.item(c, a, { warn: this.warnings.has(a.id), selected: a.id === this.selected });
    if (this.ghostItem) this.item(c, this.ghostItem, { ghost: true });
    const avatar = avatarLayout(this.state);
    if (avatar) drawAvatar(c, avatar, this.ox, this.oy, s);
  }
  item(c, a, { warn = false, selected = false, ghost = false, named = true }) {
    const s = this.scale,
      fw = (a.dims[0] * s) / 100,
      fd = (a.dims[2] * s) / 100;
    c.save();
    c.translate(this.ox + a.x * s, this.oy + a.z * s);
    c.rotate((-a.angle * Math.PI) / 180);
    c.globalAlpha = ghost ? 0.55 : 1;
    c.fillStyle = a.color;
    c.beginPath();
    if (a.type === 'lamp' || a.type === 'plant' || a.type === 'basin')
      c.ellipse(0, 0, fw / 2, fd / 2, 0, 0, Math.PI * 2);
    else if (a.type === 'toilet') {
      // 벽 쪽 물탱크와 앞으로 나온 변기.
      c.roundRect(-fw * 0.45, -fd / 2, fw * 0.9, fd * 0.26, 2);
      c.moveTo(fw / 2, fd * 0.12);
      c.ellipse(0, fd * 0.12, fw / 2, fd * 0.38, 0, 0, Math.PI * 2);
    } else c.roundRect(-fw / 2, -fd / 2, fw, fd, Math.min(4, fw / 6, fd / 6));
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
      case 'office_chair':
      case 'chair':
        c.moveTo(-fw / 2 + 2, -fd * 0.34);
        c.lineTo(fw / 2 - 2, -fd * 0.34);
        break;
      case 'rug':
        c.setLineDash([3, 3]);
        c.rect(-fw * 0.44, -fd * 0.44, fw * 0.88, fd * 0.88);
        break;
      case 'desk':
      case 'island':
      case 'kitchen_counter':
      case 'dining':
      case 'coffee':
      case 'bench':
        c.rect(-fw / 2 + 4, -fd / 2 + 4, fw - 8, fd - 8);
        break;
      case 'dryer':
      case 'washer':
        c.arc(0, 0, Math.min(fw, fd) * 0.3, 0, Math.PI * 2);
        break;
      case 'basin':
        c.strokeStyle = 'rgba(42,40,36,0.35)';
        c.ellipse(0, fd * 0.04, fw * 0.32, fd * 0.3, 0, 0, Math.PI * 2);
        break;
      case 'toilet':
        c.strokeStyle = 'rgba(42,40,36,0.35)';
        c.ellipse(0, fd * 0.16, fw * 0.3, fd * 0.24, 0, 0, Math.PI * 2);
        break;
      case 'shower':
        // 유리 가림막(왼쪽)과 배수구.
        c.strokeStyle = 'rgba(42,40,36,0.45)';
        c.setLineDash([3, 3]);
        c.rect(-fw / 2 + 3, -fd / 2 + 3, fw - 6, fd - 6);
        c.moveTo(Math.min(fw, fd) * 0.08, 0);
        c.arc(0, 0, Math.min(fw, fd) * 0.08, 0, Math.PI * 2);
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
    if (!named) return;
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
  png(tags = []) {
    this.draw();
    if (!tags.length) return this.canvas.toDataURL('image/png');
    const out = document.createElement('canvas'),
      ratio = this.canvas.width / this.host.clientWidth;
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const g = out.getContext('2d');
    g.drawImage(this.canvas, 0, 0);
    g.scale(ratio, ratio);
    drawTags(g, tags);
    return out.toDataURL('image/png');
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
