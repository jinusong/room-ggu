import { windowOpenings, wallPieces } from './windows.js';
import { windowModel } from './window-three.js';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { furniture, disposeGroup } from './furniture.js';
import { tapeCanvas, drawTags, PAPER } from './tape.js';
import { avatarModel } from './avatar-three.js';
import { avatarLayout, avatarSpace, avatarRect, HOME_VIEW } from './avatar.js';
import { spaces } from './data.js';
import { houseLayout } from './house-geometry.js';
import { roomOpenings, doorSwing } from './floorplan.js';
import { houseStructure, houseFurniture } from './house-three.js';
export { PAPER };

// 종이 위에 놓인 1:50 실내 모형처럼 보이는 3D 장면.
// 뒤쪽·왼쪽 벽은 단면(어두운 윗면)으로, 앞쪽·오른쪽은 낮은 턱으로만 표시해 안을 들여다본다.
const INK = '#2a2824';
const WARN = '#c4452f';
const WALL_T = 0.1;
const DOOR_H = 2.05;

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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 900 ? 1.5 : 2));
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
    // 카메라 이동·격자 표시로는 물체의 그림자가 바뀌지 않는다.
    this.renderer.shadowMap.autoUpdate = false;
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
    this.ground = ground;
    this.scene.add(ground);
    this.room = new T.Group();
    this.objects = new T.Group();
    this.overlay = new T.Group();
    this.ghost = new T.Group();
    this.comparison = new T.Group();
    this.scene.add(this.room, this.objects, this.ghost, this.overlay, this.comparison);
    this.ray = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    this.drag = null;
    this.press = null;
    this.down = (e) => {
      if (e.button !== 0) return;
      if (this.state.scope === 'house') {
        this.press = { x: e.clientX, y: e.clientY, house: true };
        return;
      }
      this.point(e);
      const hit = this.ray
        .intersectObjects(
          [...this.objects.children, ...this.comparison.children.filter((o) => o.userData.avatar)],
          true,
        )
        .find((h) => h.object.isMesh);
      this.press = { x: e.clientX, y: e.clientY, hit: !!hit };
      if (!hit) return;
      let obj = hit.object;
      let root = obj;
      while (root.parent && root.parent !== this.comparison && root.parent !== this.objects)
        root = root.parent;
      if (root.userData.avatar) {
        const p = new T.Vector3(),
          a = avatarLayout(this.state);
        this.press.avatar = true;
        // 서 있을 때만 끌어 옮긴다. 앉거나 누운 아바타는 가구를 따라간다.
        if (a?.pose === 'standing' && this.ray.ray.intersectPlane(this.plane, p)) {
          this.drag = { id: 'avatar', dx: a.x - p.x, dz: a.z - p.z, started: false };
          this.controls.enabled = false;
          this.renderer.domElement.setPointerCapture(e.pointerId);
        }
        return;
      }
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
      if (this.state.scope === 'house') {
        if (!e.buttons) this.renderer.domElement.style.cursor = this.pickRoom(e) ? 'pointer' : '';
        return;
      }
      if (!this.drag) {
        if (e.buttons) return;
        this.point(e);
        const over = this.ray
          .intersectObjects(this.objects.children, true)
          .some((h) => h.object.isMesh);
        this.renderer.domElement.style.cursor = over ? 'grab' : '';
        return;
      }
      if (
        !this.drag.started &&
        this.press &&
        Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 4
      )
        return;
      this.point(e);
      const p = new T.Vector3();
      if (!this.ray.ray.intersectPlane(this.plane, p)) return;
      if (!this.drag.started) {
        this.drag.started = true;
        this.cb.start?.();
      }
      this.renderer.domElement.style.cursor = 'grabbing';
      if (this.drag.id === 'avatar') this.cb.moveAvatar?.(p.x + this.drag.dx, p.z + this.drag.dz);
      else this.cb.move(this.drag.id, p.x + this.drag.dx, p.z + this.drag.dz);
    };
    this.up = (e) => {
      const cancelled = e.type === 'pointercancel';
      if (this.press?.house) {
        if (!cancelled && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 5) {
          const id = this.pickRoom(e);
          if (id) this.cb.selectSpace?.(id);
        }
        this.press = null;
        return;
      }
      const tapped =
        !cancelled &&
        this.press &&
        Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 5;
      if (this.drag) {
        const started = this.drag.started,
          avatar = this.drag.id === 'avatar';
        this.drag = null;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = '';
        if (started && avatar && !cancelled) this.fitAvatar();
        if (started) this.cb.commit(cancelled);
        else if (this.press?.avatar && tapped) this.cb.pickAvatar?.();
      } else if (this.press?.avatar && tapped) this.cb.pickAvatar?.();
      else if (tapped && !this.press.hit) this.cb.select(null);
      this.press = null;
    };
    this.double = (e) => {
      if (this.state.scope === 'house') {
        const id = this.pickRoom(e);
        if (id) this.cb.editSpace?.(id);
      }
    };
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('dblclick', this.double);
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
    this.camera.updateMatrixWorld();
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
  }
  pickRoom(e) {
    this.room.updateMatrixWorld(true);
    this.objects.updateMatrixWorld(true);
    this.point(e);
    for (const hit of this.ray.intersectObjects(
      [...this.room.children, ...this.objects.children],
      true,
    )) {
      let o = hit.object;
      while (o && !o.userData.roomId) o = o.parent;
      if (o?.userData.roomId) return o.userData.roomId;
    }
    return null;
  }
  // 화면에 담을 범위. 방 밖에 선 아바타가 있으면 그 자리까지 넓힌다.
  extent() {
    const house = this.state.scope === 'house',
      base = house ? houseLayout(this.state) : { ...this.state.room, x: 0, z: 0 },
      space = house ? avatarSpace(this.state, spaces(this.state)) : null,
      at = space ? this.state.floorplan.positions[space.roomId] : { x: 0, z: 0 },
      r =
        house && !space
          ? null
          : avatarRect(avatarLayout(space ? { ...this.state, ...space } : this.state));
    if (!r || !at) return base;
    const left = Math.min(base.x - base.w / 2, at.x + r.left),
      right = Math.max(base.x + base.w / 2, at.x + r.right),
      top = Math.min(base.z - base.d / 2, at.z + r.top),
      bottom = Math.max(base.z + base.d / 2, at.z + r.bottom);
    return {
      ...base,
      w: right - left,
      d: bottom - top,
      x: (left + right) / 2,
      z: (top + bottom) / 2,
    };
  }
  // 아바타가 방 밖으로 나가거나 들어와 담을 범위가 달라지면 시점을 다시 맞춘다. 끄는 동안과 사용자가 시점을 옮긴 뒤에는 그대로 둔다.
  fitAvatar() {
    if (this.drag) return;
    const { w, d, x, z } = this.extent(),
      sig = [this.state.scope, w, d, x, z].map((n) => (n.toFixed ? n.toFixed(2) : n)).join();
    const changed = this.fitSig !== undefined && sig !== this.fitSig;
    this.fitSig = sig;
    if (changed && !this.userMoved) this.home();
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
    for (const g of [this.room, this.overlay, this.comparison])
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
    this.renderer.shadowMap.needsUpdate = true;
    this.clear(this.room);
    this.floorGrid = null;
    if (this.state.scope === 'house') {
      this.renderer.domElement.setAttribute(
        'aria-label',
        '집 전체 3D 모형. 끌어 시점을 돌리고 공간을 두 번 누르면 방을 편집해요.',
      );
      const layout = this.extent(),
        span = Math.max(layout.w, layout.d, 4);
      this.room.add(houseStructure(this.state, { plankTexture }));
      this.roomTapes = [];
      Object.assign(this.sun.shadow.camera, {
        left: -span,
        right: span,
        top: span,
        bottom: -span,
        near: 0.5,
        far: span * 4 + 40,
      });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.position.set(
        layout.x + span * 0.5 + 2,
        Math.max(9, span),
        layout.z + span * 0.7 + 3,
      );
      this.sun.target.position.set(layout.x, 0, layout.z);
      this.ground.position.set(layout.x, -0.081, layout.z);
      this.ground.scale.setScalar(Math.max(1, span / 40));
      this.camera.far = Math.max(200, span * 20);
      this.camera.updateProjectionMatrix();
      this.dirty = true;
      return;
    }
    this.renderer.domElement.setAttribute(
      'aria-label',
      '3D 방 모형. 가구를 끌어 옮기고, 빈 곳을 끌어 시점을 돌려요.',
    );
    this.sun.target.position.set(0, 0, 0);
    this.ground.position.set(0, -0.081, 0);
    this.ground.scale.setScalar(1);
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
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
    map.userData.shared = false;
    map.repeat.set(w / 1.6, d / 1.6);
    map.needsUpdate = true;
    const top = new T.MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.82 });
    const floor = new T.Mesh(new T.BoxGeometry(w, 0.08, d), [edge, edge, top, edge, edge, edge]);
    floor.position.y = -0.04;
    floor.receiveShadow = true;
    floor.castShadow = true;
    this.room.add(floor);
    const wallMat = new T.MeshStandardMaterial({ color: wallColor, roughness: 0.96 });
    const curb = new T.MeshStandardMaterial({ color: '#e6e1d6', roughness: 1 });
    const curbCap = new T.MeshStandardMaterial({ color: '#8d877b', roughness: 1 });
    const base = new T.MeshStandardMaterial({
      color: new T.Color(wallColor).offsetHSL(0, 0, -0.08),
      roughness: 0.8,
    });
    // 다른 공간과 맞닿은 벽에는 집 전체와 같은 자리에 연결 문을 비워 둔다(위치는 초안).
    const doors = roomOpenings(spaces(this.state), this.state.floorplan, this.state.roomId);
    const windows = windowOpenings(this.state.room);
    const piece = (alongX, start, end, across, y0, y1, thick, mats, shadow = true) => {
      const len = end - start,
        m = new T.Mesh(
          new T.BoxGeometry(alongX ? len : thick, y1 - y0, alongX ? thick : len),
          mats,
        );
      m.position.set(
        alongX ? (start + end) / 2 : across,
        (y0 + y1) / 2,
        alongX ? across : (start + end) / 2,
      );
      m.castShadow = m.receiveShadow = shadow;
      this.room.add(m);
    };
    const tall = [wallMat, wallMat, cap, wallMat, wallMat, wallMat],
      low = [curb, curb, curbCap, curb, curb, curb];
    for (const [alongX, from, to, across, wall, high] of [
      [true, -w / 2 - WALL_T, w / 2, -d / 2 - WALL_T / 2, 'back', true],
      [false, -d / 2, d / 2, -w / 2 - WALL_T / 2, 'left', true],
      [false, -d / 2, d / 2 + WALL_T, w / 2 + WALL_T / 2, 'right', false],
      [true, -w / 2 - WALL_T, w / 2 + WALL_T, d / 2 + WALL_T / 2, 'front', false],
    ]) {
      const cuts = [
        ...doors
          .filter((o) => o.wall === wall)
          .map((o) => ({
            start: (o.vertical ? o.z : o.x) - o.width / 2,
            end: (o.vertical ? o.z : o.x) + o.width / 2,
            bottom: 0,
            top: DOOR_H,
          })),
        ...windows
          .filter((o) => o.wall === wall)
          .map((o) => ({
            start: (o.vertical ? o.z : o.x) - o.width / 2,
            end: (o.vertical ? o.z : o.x) + o.width / 2,
            bottom: o.sill,
            top: o.sill + o.height,
          })),
      ];
      for (const p of wallPieces(from, to, high ? h : 0.08, cuts, -0.08))
        piece(alongX, p.start, p.end, across, p.bottom, p.top, WALL_T, high ? tall : low);
    }
    for (const o of windows) this.room.add(windowModel(o));
    for (const o of doors) {
      const { hinge, along, leaf } = doorSwing(o),
        points = [new T.Vector3(hinge[0] + leaf[0] * o.width, 0.004, hinge[1] + leaf[1] * o.width)];
      points.unshift(new T.Vector3(hinge[0], 0.004, hinge[1]));
      for (let i = 12; i >= 0; i--) {
        const t = (i / 12) * (Math.PI / 2);
        points.push(
          new T.Vector3(
            hinge[0] + (Math.cos(t) * along[0] + Math.sin(t) * leaf[0]) * o.width,
            0.004,
            hinge[1] + (Math.cos(t) * along[1] + Math.sin(t) * leaf[1]) * o.width,
          ),
        );
      }
      const arc = new T.Line(
        new T.BufferGeometry().setFromPoints(points),
        // 자동으로 놓인 문은 점선, 직접 옮기거나 폭을 정한 문은 실선이다.
        new T.LineDashedMaterial({
          color: '#55524a',
          dashSize: 0.06,
          gapSize: o.custom ? 0 : 0.05,
          transparent: true,
          opacity: o.inward ? 0.8 : 0,
        }),
      );
      arc.computeLineDistances();
      arc.userData.door = true;
      this.room.add(arc);
    }
    this.floorGrid = this.makeFloorGrid(w, d);
    this.floorGrid.visible = this.state.grid;
    this.room.add(this.floorGrid);
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
  // 격자는 표시만 바뀐다. 방·창문·가구·카메라의 상태를 다시 만들 필요가 없다.
  setGridVisibility() {
    const grid = this.floorGrid;
    if (!grid || grid.visible === this.state.grid) return;
    grid.visible = this.state.grid;
    this.invalidate();
  }
  makeFloorGrid(w, d) {
    const group = new T.Group();
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
      group.add(
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
    return group;
  }
  fitDistance() {
    const { w, d, h } = this.extent();
    const { left, right, top, bottom } = this.insets;
    const W = this.width,
      H = this.height;
    const radius = Math.sqrt(w * w + d * d + h * h * 0.5) / 2 + 0.35;
    const tan = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
    const tv = tan * Math.max(0.2, (H - top - bottom) / H),
      th = tan * (W / H) * Math.max(0.2, (W - left - right) / W);
    return (radius / Math.min(tv, th)) * 1.04;
  }
  // 끌어 돌린 뒤 남은 관성을 없앤다. 그대로 두면 시점을 맞춘 뒤에도 카메라와 이름표가 계속 흘러간다.
  stopInertia() {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
  }
  home() {
    this.userMoved = false;
    this.stopInertia();
    const { h, x, z } = this.extent();
    this.controls.target.set(x, h * 0.28, z);
    const dir = new T.Vector3(...HOME_VIEW).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, this.fitDistance());
    this.controls.maxDistance = Math.max(30, this.fitDistance() * 3);
    this.controls.update();
    this.dirty = true;
  }
  top() {
    this.userMoved = true;
    this.stopInertia();
    const { x, z } = this.extent();
    this.controls.target.set(x, 0, z);
    this.camera.position.set(x, this.fitDistance() * 1.1, z + 0.001);
    this.dirty = true;
  }
  zoom(f) {
    this.userMoved = true;
    this.camera.position.sub(this.controls.target).multiplyScalar(f).add(this.controls.target);
    this.dirty = true;
  }
  sync() {
    this.renderer.shadowMap.needsUpdate = true;
    this.clear(this.objects);
    if (this.state.scope === 'house') this.objects.add(houseFurniture(this.state));
    else for (const i of this.state.items) this.objects.add(furniture(i));
    this.decorate(this.selected, this.warnings || new Set());
  }
  setAvatar() {
    this.renderer.shadowMap.needsUpdate = true;
    this.clear(this.comparison);
    this.avatarAt = null;
    const house = this.state.scope === 'house';
    const space = house && avatarSpace(this.state, spaces(this.state));
    const context = space ? { ...this.state, ...space } : this.state;
    const offset = space ? this.state.floorplan.positions[space.roomId] : { x: 0, z: 0 };
    const a = house && !space ? null : avatarLayout(context);
    if (a) {
      const model = avatarModel(context);
      model.position.x += offset.x;
      model.position.z += offset.z;
      this.comparison.add(model);
      // 이름표는 머리 위 한 점에 붙인다. 누운 자세는 몸 가운데 위에 둔다.
      const head = a.pose === 'lying' ? a.joints.hip : a.joints.head,
        rad = (a.angle * Math.PI) / 180;
      this.avatarAt = new T.Vector3(
        a.x + offset.x + head[0] * Math.cos(rad) + head[2] * Math.sin(rad),
        a.top + 0.08,
        a.z + offset.z - head[0] * Math.sin(rad) + head[2] * Math.cos(rad),
      );
    }
    this.fitAvatar();
    this.dirty = true;
  }
  moveObject(id, x, z) {
    const o = this.objects.children.find((c) => c.userData.id === id);
    if (o) {
      o.position.set(x, 0, z);
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.decorate(this.selected, this.warnings || new Set());
  }
  setGhost(item) {
    this.clear(this.ghost);
    this.ghostItem = this.state.scope === 'house' ? null : item || null;
    item = this.ghostItem;
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
    if (this.state.scope === 'house') {
      this.dirty = true;
      return;
    }
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
  project(v) {
    this.camera.updateMatrixWorld();
    const p = v.clone().project(this.camera),
      r = this.renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + ((p.x + 1) / 2) * r.width,
      y: r.top + ((1 - p.y) / 2) * r.height,
      visible: p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1,
    };
  }
  roomAnchor(id) {
    const p = this.state.floorplan.positions[id];
    return p ? this.project(new T.Vector3(p.x, 0.15, p.z)) : null;
  }
  // 이름표 자리: 화면에서 가장 아래로 내려오는 바닥 변에서 방 안쪽으로 조금 들어온 점.
  // 시점을 돌려도 이름표가 자기 공간의 바닥 위에 놓여 어느 공간의 이름인지 헷갈리지 않는다.
  tagAnchor(id) {
    const r = spaces(this.state).find((r) => r.roomId === id),
      p = this.state.floorplan.positions[id];
    if (!r || !p) return null;
    const { w, d } = r.room;
    const edges = [
      [0, d / 2],
      [0, -d / 2],
      [w / 2, 0],
      [-w / 2, 0],
    ].map(([x, z]) => ({ x, z, at: this.project(new T.Vector3(p.x + x, 0, p.z + z)) }));
    const low = edges.reduce((a, b) => (b.at.y > a.at.y ? b : a)),
      pull = (n, half) => n - Math.sign(n) * Math.min(0.5, half * 0.45);
    return {
      ...this.project(new T.Vector3(p.x + pull(low.x, w / 2), 0, p.z + pull(low.z, d / 2))),
      inside: true,
      visible: edges.some((e) => e.at.visible),
    };
  }
  // 집 전체 3D에서 고른 공간의 네 벽 바깥 바닥. + 손잡이를 여기에 둔다.
  sideAnchors() {
    if (this.state.scope !== 'house') return [];
    const r = spaces(this.state).find((r) => r.roomId === this.state.roomId),
      p = this.state.floorplan.positions[this.state.roomId];
    if (!r || !p) return [];
    const { w, d } = r.room;
    return [
      ['right', w / 2 + 0.4, 0],
      ['left', -w / 2 - 0.4, 0],
      ['back', 0, -d / 2 - 0.4],
      ['front', 0, d / 2 + 0.4],
    ].map(([side, x, z]) => {
      // 벽의 두 끝을 화면에 옮겨 벽을 따라가는 방향과 길이를 구한다.
      const a = this.project(
          new T.Vector3(p.x + x - (x ? 0 : w / 2), 0.02, p.z + z - (x ? d / 2 : 0)),
        ),
        b = this.project(new T.Vector3(p.x + x + (x ? 0 : w / 2), 0.02, p.z + z + (x ? d / 2 : 0))),
        span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        side,
        ...this.project(new T.Vector3(p.x + x, 0.02, p.z + z)),
        along: [(b.x - a.x) / span, (b.y - a.y) / span],
        span,
      };
    });
  }
  // 붙이려는 공간의 자리를 바닥에 점선 테두리로 미리 보여 준다.
  setRoomGhost(g) {
    if (this.roomGhost) {
      this.scene.remove(this.roomGhost);
      this.roomGhost.geometry.dispose();
      this.roomGhost.material.dispose();
      this.roomGhost = null;
    }
    if (g && this.state.scope === 'house') {
      const x0 = g.x - g.w / 2,
        x1 = g.x + g.w / 2,
        z0 = g.z - g.d / 2,
        z1 = g.z + g.d / 2,
        y = 0.02;
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints(
          [
            [x0, z0],
            [x1, z0],
            [x1, z1],
            [x0, z1],
            [x0, z0],
          ].map(([x, z]) => new T.Vector3(x, y, z)),
        ),
        new T.LineDashedMaterial({ color: '#2a2824', dashSize: 0.14, gapSize: 0.1 }),
      );
      line.computeLineDistances();
      this.roomGhost = line;
      this.scene.add(line);
    }
    this.dirty = true;
  }
  windowPoint(e, wall) {
    this.point(e);
    const vertical = ['left', 'right'].includes(wall),
      room = this.state.room;
    const at = vertical
      ? wall === 'left'
        ? -room.w / 2
        : room.w / 2
      : wall === 'back'
        ? -room.d / 2
        : room.d / 2;
    const plane = new T.Plane(vertical ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1), -at),
      p = new T.Vector3();
    if (!this.ray.ray.intersectPlane(plane, p)) return null;
    return { u: vertical ? p.z + room.d / 2 : p.x + room.w / 2, v: p.y };
  }
  windowFrames() {
    if (this.state.scope === 'house') return [];
    return windowOpenings(this.state.room).map((w) => {
      const point = (along, y) =>
        this.project(
          new T.Vector3(w.x + (w.vertical ? 0 : along), y, w.z + (w.vertical ? along : 0)),
        );
      const points = [
        point(-w.width / 2, w.sill),
        point(w.width / 2, w.sill),
        point(w.width / 2, w.sill + w.height),
        point(-w.width / 2, w.sill + w.height),
      ];
      return { id: w.id, points, visible: points.every((p) => p.visible) };
    });
  }
  doorAnchors() {
    if (this.state.scope === 'house') return [];
    return roomOpenings(spaces(this.state), this.state.floorplan, this.state.roomId).map((o) => ({
      roomId: o.roomId,
      ...this.project(
        new T.Vector3(
          o.x + (o.wall === 'right' ? -0.35 : o.wall === 'left' ? 0.35 : 0),
          o.wall === 'back' || o.wall === 'left' ? 1.0 : 0.05,
          o.z + (o.wall === 'front' ? -0.35 : o.wall === 'back' ? 0.35 : 0),
        ),
      ),
    }));
  }
  avatarAnchor() {
    return this.avatarAt ? this.project(this.avatarAt) : null;
  }
  invalidate() {
    this.dirty = true;
  }
  png(tags = []) {
    this.renderer.render(this.scene, this.camera);
    const canvas = this.renderer.domElement;
    if (!tags.length) return canvas.toDataURL('image/png');
    const out = document.createElement('canvas'),
      ratio = canvas.width / this.width;
    out.width = canvas.width;
    out.height = canvas.height;
    const g = out.getContext('2d');
    g.drawImage(canvas, 0, 0);
    g.scale(ratio, ratio);
    drawTags(g, tags);
    return out.toDataURL('image/png');
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
      ['dblclick', this.double],
    ])
      this.renderer.domElement.removeEventListener(e, f);
    for (const g of [this.room, this.objects, this.overlay, this.ghost, this.comparison])
      this.clear(g);
    this.envMap.dispose();
    this.renderer.dispose();
  }
}
