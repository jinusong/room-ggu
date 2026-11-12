import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { furniture, disposeGroup } from './furniture.js';
import { tapeCanvas, PAPER } from './tape.js';
export { PAPER };

// 종이 위에 놓인 1:50 실내 모형처럼 보이는 3D 장면.
// 뒤쪽·왼쪽 벽은 단면(어두운 윗면)으로, 앞쪽·오른쪽은 낮은 턱으로만 표시해 안을 들여다본다.
const INK = '#2a2824';
const WARN = '#c4452f';
const WALL_T = 0.1;

const planks = new Map();
function plankTexture(color) {
  if (planks.has(color)) return planks.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const base = new T.Color(color);
  const rows = 6,
    rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 3) * 170 + (r % 2) * 60;
    for (let k = -2; k < 3; k++) {
      const x = offset + k * 300,
        tone = base.clone().offsetHSL(0, 0, (((((r * 7 + k * 13) % 9) + 9) % 9) - 4) * 0.005);
      g.fillStyle = `#${tone.getHexString()}`;
      g.fillRect(x, r * rh, 300, rh);
      g.fillStyle = 'rgba(40,28,16,0.12)';
      g.fillRect(x, r * rh, 2, rh);
    }
    g.fillStyle = 'rgba(40,28,16,0.1)';
    g.fillRect(0, r * rh, 512, 2);
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = `rgba(60,40,20,${0.035 + (i % 3) * 0.015})`;
      g.beginPath();
      const y = r * rh + 8 + i * (rh / 7);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 50 + r + i) * 1.5);
      g.stroke();
    }
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  planks.set(color, tex);
  return tex;
}

// sizeAttenuation이 꺼진 스프라이트는 화면 높이에 비례해 커지므로 높이로 나눠 약 22px로 맞춘다.
const TAPE_PX = 22;
function tapeScale(sprite, height) {
  const s = (TAPE_PX * 0.62) / Math.max(200, height);
  sprite.scale.set(s * sprite.userData.aspect, s, 1);
}
function tapeSprite(text, opts, height = 800) {
  const { canvas, aspect } = tapeCanvas(text, opts);
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(
    new T.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }),
  );
  sprite.userData.aspect = aspect;
  sprite.userData.tape = true;
  tapeScale(sprite, height);
  sprite.renderOrder = 10;
  return sprite;
}

function frame(item, color, opacity, dashed = false) {
  const g = new T.Group(),
    w = item.dims[0] / 100,
    d = item.dims[2] / 100,
    t = 0.022;
  const m = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
  const segs = dashed ? 6 : 1;
  for (const [len, x, z, rot] of [
    [w, 0, -d / 2, 0],
    [w, 0, d / 2, 0],
    [d, -w / 2, 0, Math.PI / 2],
    [d, w / 2, 0, Math.PI / 2],
  ])
    for (let i = 0; i < segs; i++) {
      const part = dashed ? len / (segs * 2) : len + t;
      const bar = new T.Mesh(new T.BoxGeometry(part, 0.004, t), m);
      const off = dashed ? -len / 2 + (len / segs) * (i + 0.25) + part / 2 : 0;
      bar.position.set(x + (rot ? 0 : off), 0.006, z + (rot ? off : 0));
      bar.rotation.y = rot;
      g.add(bar);
    }
  const fill = new T.Mesh(
    new T.PlaneGeometry(w, d),
    new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.004;
  g.add(fill);
  g.position.set(item.x, 0, item.z);
  g.rotation.y = (item.angle * Math.PI) / 180;
  g.renderOrder = 3;
  return g;
}

export class RoomScene {
  constructor(host, state, callbacks) {
    this.host = host;
    this.state = state;
    this.cb = callbacks;
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.width = 1;
    this.height = 1;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(PAPER);
    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 760 ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute(
      'aria-label',
      '3D 방 모형. 가구를 끌어 옮기고, 빈 곳을 끌어 시점을 돌려요.',
    );
    host.append(this.renderer.domElement);
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.5;
    this.camera = new T.PerspectiveCamera(30, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 60;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('start', () => {
      this.userMoved = true;
    });
    this.scene.add(new T.HemisphereLight('#fffdf8', '#d6cdbc', 0.9));
    this.sun = new T.DirectionalLight('#fff3df', 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const ground = new T.Mesh(
      new T.PlaneGeometry(80, 80),
      new T.ShadowMaterial({ color: '#4a4336', opacity: 0.14 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.081;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.room = new T.Group();
    this.objects = new T.Group();
    this.overlay = new T.Group();
    this.ghost = new T.Group();
    this.scene.add(this.room, this.objects, this.ghost, this.overlay);
    this.ray = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    this.drag = null;
    this.press = null;
    this.down = (e) => {
      if (e.button !== 0) return;
      this.point(e);
      const hit = this.ray
        .intersectObjects(this.objects.children, true)
        .find((h) => h.object.isMesh);
      this.press = { x: e.clientX, y: e.clientY, hit: !!hit };
      if (!hit) return;
      let obj = hit.object;
      while (obj.parent !== this.objects) obj = obj.parent;
      this.cb.select(obj.userData.id);
      const p = new T.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, p)) {
        const a = this.state.items.find((x) => x.id === obj.userData.id);
        if (!a) return;
        this.drag = { id: a.id, dx: a.x - p.x, dz: a.z - p.z, started: false };
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    this.move = (e) => {
      if (!this.drag) {
        if (e.buttons) return;
        this.point(e);
        const over = this.ray
          .intersectObjects(this.objects.children, true)
          .some((h) => h.object.isMesh);
        this.renderer.domElement.style.cursor = over ? 'grab' : '';
        return;
      }
      this.point(e);
      const p = new T.Vector3();
      if (!this.ray.ray.intersectPlane(this.plane, p)) return;
      if (!this.drag.started) {
        this.drag.started = true;
        this.cb.start?.();
      }
      this.renderer.domElement.style.cursor = 'grabbing';
      this.cb.move(this.drag.id, p.x + this.drag.dx, p.z + this.drag.dz);
    };
    this.up = (e) => {
      if (this.drag) {
        const started = this.drag.started;
        this.drag = null;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = '';
        if (started) this.cb.commit();
      } else if (
        this.press &&
        !this.press.hit &&
        Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 5
      )
        this.cb.select(null);
      this.press = null;
    };
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    this.resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height);
      this.applyView();
      if (!this.userMoved) this.home();
    });
    this.resize.observe(host);
    this.renderRoom();
    this.sync();
    this.home();
    this.dirty = true;
    this.renderer.setAnimationLoop(() => {
      const moved = this.controls.update();
      if (moved || this.dirty) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
        this.cb.frame?.();
      }
    });
  }
  point(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
  }
  setInsets(insets) {
    const next = { left: 0, right: 0, top: 0, bottom: 0, ...insets };
    if (['left', 'right', 'top', 'bottom'].every((k) => Math.abs(next[k] - this.insets[k]) < 1))
      return;
    this.insets = next;
    this.applyView();
    if (!this.userMoved) this.home();
  }
  applyView() {
    const { left, right, top, bottom } = this.insets,
      W = this.width,
      H = this.height;
    this.camera.aspect = W / H;
    this.camera.setViewOffset(W, H, -(left - right) / 2, -(top - bottom) / 2, W, H);
    this.camera.updateProjectionMatrix();
    for (const g of [this.room, this.overlay])
      g?.traverse((o) => o.userData.tape && tapeScale(o, H));
    this.dirty = true;
  }
  clear(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      disposeGroup(o);
    }
  }
  renderRoom() {
    this.clear(this.room);
    const { w, d, h, wallColor, floorColor } = this.state.room;
    const span = Math.max(w, d);
    if (this.lastSpan && Math.abs(this.lastSpan - span) > 0.01 && !this.userMoved) this.home();
    this.lastSpan = span;
    Object.assign(this.sun.shadow.camera, {
      left: -span / 2 - 2,
      right: span / 2 + 2,
      top: span / 2 + 2,
      bottom: -span / 2 - 2,
      near: 0.5,
      far: 40,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.position.set(span * 0.5 + 2, 9, span * 0.7 + 3);
    const edge = new T.MeshStandardMaterial({ color: '#d8d2c5', roughness: 1 });
    const cap = new T.MeshStandardMaterial({ color: INK, roughness: 0.9 });
    const map = plankTexture(floorColor).clone();
    map.repeat.set(w / 1.6, d / 1.6);
    map.needsUpdate = true;
    const top = new T.MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.82 });
    const floor = new T.Mesh(new T.BoxGeometry(w, 0.08, d), [edge, edge, top, edge, edge, edge]);
    floor.position.y = -0.04;
    floor.receiveShadow = true;
    floor.castShadow = true;
    this.room.add(floor);
    const wallMat = new T.MeshStandardMaterial({ color: wallColor, roughness: 0.96 });
    const walls = [
      [w + WALL_T, h + 0.08, WALL_T, -WALL_T / 2, h / 2, -d / 2 - WALL_T / 2],
      [WALL_T, h + 0.08, d, -w / 2 - WALL_T / 2, h / 2, 0],
    ];
    for (const [a, b, c, x, y, z] of walls) {
      const m = new T.Mesh(new T.BoxGeometry(a, b, c), [
        wallMat,
        wallMat,
        cap,
        wallMat,
        wallMat,
        wallMat,
      ]);
      m.position.set(x, y - 0.04, z);
      m.receiveShadow = true;
      m.castShadow = true;
      this.room.add(m);
    }
    const curb = new T.MeshStandardMaterial({ color: '#e6e1d6', roughness: 1 });
    const curbCap = new T.MeshStandardMaterial({ color: '#8d877b', roughness: 1 });
    for (const [a, b, c, x, y, z] of [
      [WALL_T, 0.12, d + WALL_T, w / 2 + WALL_T / 2, 0.02, WALL_T / 2],
      [w + WALL_T * 2, 0.12, WALL_T, 0, 0.02, d / 2 + WALL_T / 2],
    ]) {
      const m = new T.Mesh(new T.BoxGeometry(a, b, c), [curb, curb, curbCap, curb, curb, curb]);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.room.add(m);
    }
    const base = new T.MeshStandardMaterial({
      color: new T.Color(wallColor).offsetHSL(0, 0, -0.08),
      roughness: 0.8,
    });
    for (const [a, b, c, x, y, z] of [
      [w, 0.07, 0.012, 0, 0.035, -d / 2 + 0.006],
      [0.012, 0.07, d, -w / 2 + 0.006, 0.035, 0],
    ]) {
      const m = new T.Mesh(new T.BoxGeometry(a, b, c), base);
      m.position.set(x, y, z);
      this.room.add(m);
    }
    if (this.state.grid) {
      const fine = [],
        bold = [];
      for (let x = 0; x <= w + 0.001; x += 0.25)
        (Math.abs(x % 1) < 0.01 ? bold : fine).push(
          x - w / 2,
          0.002,
          -d / 2,
          x - w / 2,
          0.002,
          d / 2,
        );
      for (let z = 0; z <= d + 0.001; z += 0.25)
        (Math.abs(z % 1) < 0.01 ? bold : fine).push(
          -w / 2,
          0.002,
          z - d / 2,
          w / 2,
          0.002,
          z - d / 2,
        );
      for (const [pts, o] of [
        [fine, 0.1],
        [bold, 0.22],
      ])
        this.room.add(
          new T.LineSegments(
            new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(pts, 3)),
            new T.LineBasicMaterial({
              color: '#3a3326',
              transparent: true,
              opacity: o,
              depthWrite: false,
            }),
          ),
        );
    }
    if (this.state.dimensions) {
      const wl = tapeSprite(`${Math.round(w * 100)} cm`, undefined, this.height);
      wl.position.set(0, 0.06, d / 2 + WALL_T + 0.32);
      const dl = tapeSprite(`${Math.round(d * 100)} cm`, undefined, this.height);
      dl.position.set(w / 2 + WALL_T + 0.42, 0.06, 0);
      const hl = tapeSprite(`천장 ${Math.round(h * 100)} cm`, { fill: '#ffffff' }, this.height);
      hl.position.set(-w / 2 - WALL_T, h + 0.14, -d / 2 - WALL_T);
      this.roomTapes = [wl, dl];
      for (const t of this.roomTapes) t.visible = !this.selected;
      this.room.add(wl, dl, hl);
    }
    this.dirty = true;
  }
  fitDistance() {
    const { w, d, h } = this.state.room;
    const { left, right, top, bottom } = this.insets;
    const W = this.width,
      H = this.height;
    const radius = Math.sqrt(w * w + d * d + h * h * 0.5) / 2 + 0.35;
    const tan = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
    const tv = tan * Math.max(0.2, (H - top - bottom) / H),
      th = tan * (W / H) * Math.max(0.2, (W - left - right) / W);
    return (radius / Math.min(tv, th)) * 1.04;
  }
  home() {
    this.userMoved = false;
    const h = this.state.room.h;
    this.controls.target.set(0, h * 0.28, 0);
    const dir = new T.Vector3(0.66, 0.62, 0.8).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, this.fitDistance());
    this.controls.maxDistance = Math.max(30, this.fitDistance() * 3);
    this.controls.update();
    this.dirty = true;
  }
  top() {
    this.userMoved = true;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, this.fitDistance() * 1.1, 0.001);
    this.dirty = true;
  }
  zoom(f) {
    this.userMoved = true;
    this.camera.position.sub(this.controls.target).multiplyScalar(f).add(this.controls.target);
    this.dirty = true;
  }
  sync() {
    this.clear(this.objects);
    for (const i of this.state.items) this.objects.add(furniture(i));
    this.decorate(this.selected, this.warnings || new Set());
  }
  moveObject(id, x, z) {
    const o = this.objects.children.find((c) => c.userData.id === id);
    if (o) o.position.set(x, 0, z);
    this.decorate(this.selected, this.warnings || new Set());
  }
  setGhost(item) {
    this.clear(this.ghost);
    this.ghostItem = item || null;
    if (item) {
      this.ghost.add(furniture(item, { ghost: true }));
      this.ghost.add(frame(item, INK, 0.05, true));
    }
    this.dirty = true;
  }
  decorate(id, warnings) {
    this.selected = id;
    this.warnings = warnings;
    // 가구를 고르면 방 치수 라벨을 숨겨 가구 치수와 겹치지 않게 한다.
    for (const t of this.roomTapes || []) t.visible = !id;
    this.clear(this.overlay);
    for (const a of this.state.items) {
      const warn = warnings.has(a.id);
      if (a.id === id || warn)
        this.overlay.add(frame(a, warn ? WARN : '#e2ae2a', warn ? 0.14 : 0.12));
    }
    const a = id && this.state.items.find((x) => x.id === id);
    if (a && this.state.dimensions) {
      const [w, h, d] = a.dims.map((n) => n / 100);
      const g = new T.Group();
      const wl = tapeSprite(`${a.dims[0]}`, undefined, this.height);
      wl.position.set(0, 0.05, d / 2 + 0.22);
      const dl = tapeSprite(`${a.dims[2]}`, undefined, this.height);
      dl.position.set(w / 2 + 0.26, 0.05, 0);
      const hl = tapeSprite(`H ${a.dims[1]}`, { fill: '#ffffff' }, this.height);
      hl.position.set(0, h + 0.16, 0);
      g.add(wl, dl, hl);
      g.position.set(a.x, 0, a.z);
      g.rotation.y = (a.angle * Math.PI) / 180;
      this.overlay.add(g);
    }
    this.dirty = true;
  }
  anchor(id, { center = false } = {}) {
    const a = id === 'ghost' ? this.ghostItem : this.state.items.find((x) => x.id === id);
    if (!a) return null;
    const y = center ? a.dims[1] / 200 : a.dims[1] / 100 + 0.12;
    const v = new T.Vector3(a.x, y, a.z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + ((v.x + 1) / 2) * r.width,
      y: r.top + ((1 - v.y) / 2) * r.height,
      visible: v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05,
    };
  }
  invalidate() {
    this.dirty = true;
  }
  png() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
  dispose() {
    this.resize.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    for (const [e, f] of [
      ['pointerdown', this.down],
      ['pointermove', this.move],
      ['pointerup', this.up],
      ['pointercancel', this.up],
    ])
      this.renderer.domElement.removeEventListener(e, f);
    for (const g of [this.room, this.objects, this.overlay, this.ghost]) this.clear(g);
    this.envMap.dispose();
    this.renderer.dispose();
  }
}
