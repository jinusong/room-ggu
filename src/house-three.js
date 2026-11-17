import { windowModel } from './window-three.js';
import * as T from 'three';
import { houseLayout } from './house-geometry.js';
import { furniture } from './furniture.js';

const material = (color) => new T.MeshStandardMaterial({ color, roughness: 0.85 });
function box(group, w, h, d, x, y, z, mat) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return m;
}
export function houseStructure(state, { plankTexture } = {}) {
  const layout = houseLayout(state),
    root = new T.Group(),
    cap = material('#2a2824'),
    edge = material('#d8d2c5');
  root.userData.house = true;
  for (const r of layout.rooms) {
    const g = new T.Group();
    g.position.set(r.position.x, 0, r.position.z);
    g.userData.roomId = r.roomId;
    let top;
    if (r.room.type !== 'bathroom' && plankTexture) {
      const map = plankTexture(r.room.floorColor).clone();
      map.userData.shared = false;
      map.repeat.set(r.room.w / 1.6, r.room.d / 1.6);
      map.needsUpdate = true;
      top = new T.MeshStandardMaterial({ map, roughness: 0.82 });
    } else top = material(r.room.floorColor);
    box(g, r.room.w, 0.08, r.room.d, 0, -0.04, 0, [edge, edge, top, edge, edge, edge]);
    if (state.grid || r.room.type === 'bathroom') {
      const points = [],
        step = r.room.type === 'bathroom' ? 0.3 : 0.5;
      for (let x = -r.room.w / 2 + step; x < r.room.w / 2; x += step)
        points.push(x, 0.003, -r.room.d / 2, x, 0.003, r.room.d / 2);
      for (let z = -r.room.d / 2 + step; z < r.room.d / 2; z += step)
        points.push(-r.room.w / 2, 0.003, z, r.room.w / 2, 0.003, z);
      g.add(
        new T.LineSegments(
          new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(points, 3)),
          new T.LineBasicMaterial({ color: '#727565', transparent: true, opacity: 0.16 }),
        ),
      );
    }
    if (r.roomId === state.roomId) {
      // 고른 공간은 바닥 가장자리에 줄자 노랑 띠를 두른다.
      const mark = new T.MeshBasicMaterial({ color: '#e2ae2a', transparent: true, opacity: 0.95 }),
        t = 0.05,
        iw = r.room.w - 0.12,
        id = r.room.d - 0.12;
      for (const [w, d, x, z] of [
        [iw, t, 0, -id / 2 + t / 2],
        [iw, t, 0, id / 2 - t / 2],
        [t, id - t * 2, -iw / 2 + t / 2, 0],
        [t, id - t * 2, iw / 2 - t / 2, 0],
      ]) {
        const bar = new T.Mesh(new T.BoxGeometry(w, 0.006, d), mark);
        bar.position.set(x, 0.006, z);
        bar.userData.selection = true;
        g.add(bar);
      }
    }
    root.add(g);
  }
  for (const w of layout.walls) {
    const r = layout.rooms.find((r) => r.roomId === w.roomId),
      mat = material(r.room.wallColor),
      len = w.end - w.start;
    const m = box(
      root,
      w.axis === 'x' ? 0.08 : len,
      w.h,
      w.axis === 'x' ? len : 0.08,
      w.axis === 'x' ? w.at : (w.start + w.end) / 2,
      (w.bottom || 0) + w.h / 2,
      w.axis === 'x' ? (w.start + w.end) / 2 : w.at,
      [mat, mat, cap, mat, mat, mat],
    );
    m.userData.roomId = w.roomId;
    m.userData.wall = true;
    m.userData.shared = w.shared;
  }
  for (const o of layout.windows || []) {
    const model = windowModel(o);
    model.userData.roomId = o.roomId;
    root.add(model);
  }
  for (const o of layout.openings) {
    const g = new T.Group();
    g.position.set(o.x, 0, o.z);
    if (o.vertical) g.rotation.y = Math.PI / 2;
    g.userData.roomId = o.roomIds[0];
    g.userData.opening = true;
    g.userData.draft = true;
    for (const x of [-o.width / 2, o.width / 2]) box(g, 0.045, 0.85, 0.11, x, 0.425, 0, edge);
    const door = new T.Group();
    door.position.x = -o.width / 2;
    door.rotation.y = (-o.side * Math.PI) / 2;
    box(door, o.width - 0.06, 0.75, 0.025, (o.width - 0.06) / 2, 0.375, 0, material('#c6bca7'));
    g.add(door);
    root.add(g);
  }
  return root;
}

export function houseFurniture(state) {
  const root = new T.Group();
  for (const r of houseLayout(state).rooms) {
    const g = new T.Group();
    g.userData.roomId = r.roomId;
    g.position.set(r.position.x, 0, r.position.z);
    for (const item of r.items) g.add(furniture(item));
    root.add(g);
  }
  return root;
}
