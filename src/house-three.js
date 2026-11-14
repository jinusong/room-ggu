import * as T from 'three';
import { houseLayout, bathroomFixtures } from './house-geometry.js';
import { furniture } from './furniture.js';

const material = (color) => new T.MeshStandardMaterial({ color, roughness: 0.85 });
function box(group, w, h, d, x, y, z, mat) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return m;
}
function ellipsoid(group, x, y, z, w, h, d, mat) {
  const m = new T.Mesh(new T.SphereGeometry(1, 20, 12), mat);
  m.position.set(x, y, z);
  m.scale.set(w / 2, h / 2, d / 2);
  m.castShadow = true;
  group.add(m);
  return m;
}
export function bathroomModel(room) {
  const root = new T.Group(),
    ceramic = new T.MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.28 }),
    metal = material('#a6aaa5');
  for (const f of bathroomFixtures(room)) {
    const g = new T.Group();
    g.position.set(f.x, 0, f.z);
    g.userData.fixture = f.type;
    g.userData.draft = true;
    if (f.type === 'toilet') {
      ellipsoid(g, 0, 0.22, 0.05, f.w * 0.7, 0.4, f.d * 0.6, ceramic);
      ellipsoid(g, 0, 0.4, 0.06, f.w, 0.24, f.d * 0.78, ceramic);
      ellipsoid(g, 0, 0.515, 0.07, f.w * 0.65, 0.015, f.d * 0.48, material('#c5cec5'));
      box(g, f.w * 0.9, 0.5, 0.15, 0, 0.5, -f.d / 2 + 0.08, ceramic);
      box(g, 0.07, 0.015, 0.04, 0.08, 0.758, -f.d / 2 + 0.08, metal);
    } else if (f.type === 'basin') {
      box(g, 0.15, 0.7, 0.16, 0, 0.35, 0, ceramic);
      ellipsoid(g, 0, 0.76, 0, f.w, 0.16, f.d, ceramic);
      ellipsoid(g, 0, 0.837, 0.015, f.w * 0.72, 0.016, f.d * 0.62, material('#c5cec5'));
      box(g, 0.025, 0.15, 0.025, 0, 0.86, -f.d * 0.32, metal);
      box(g, 0.025, 0.025, 0.1, 0, 0.93, -f.d * 0.2, metal);
    } else {
      box(g, f.w, 0.06, f.d, 0, 0.03, 0, ceramic);
      box(g, f.w * 0.8, 0.005, f.d * 0.8, 0, 0.063, 0, material('#d6ded6'));
      const glass = new T.MeshStandardMaterial({
        color: '#cadbd2',
        transparent: true,
        opacity: 0.2,
        roughness: 0.12,
        depthWrite: false,
        side: T.DoubleSide,
      });
      box(g, 0.012, 1.25, f.d, -f.w / 2, 0.685, 0, glass);
      box(g, 0.025, 1.1, 0.025, f.w / 2 - 0.04, 1.1, -f.d / 2 + 0.04, metal);
      box(g, 0.025, 0.025, 0.2, f.w / 2 - 0.04, 1.65, -f.d / 2 + 0.12, metal);
      box(g, 0.12, 0.02, 0.12, f.w / 2 - 0.04, 1.64, -f.d / 2 + 0.23, metal);
    }
    root.add(g);
  }
  return root;
}

export function houseStructure(state, { tapeSprite, plankTexture, height = 800 } = {}) {
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
    } else top = material(r.room.type === 'bathroom' ? '#dce1dc' : r.room.floorColor);
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
    if (r.room.type === 'bathroom') g.add(bathroomModel(r.room));
    if (r.roomId === state.roomId) {
      const line = new T.LineLoop(
        new T.BufferGeometry().setFromPoints(
          [
            [-r.room.w / 2 + 0.04, 0.012, -r.room.d / 2 + 0.04],
            [r.room.w / 2 - 0.04, 0.012, -r.room.d / 2 + 0.04],
            [r.room.w / 2 - 0.04, 0.012, r.room.d / 2 - 0.04],
            [-r.room.w / 2 + 0.04, 0.012, r.room.d / 2 - 0.04],
          ].map((p) => new T.Vector3(...p)),
        ),
        new T.LineBasicMaterial({ color: '#667669' }),
      );
      g.add(line);
    }
    if (tapeSprite) {
      const label = tapeSprite(r.name, { fill: '#fbfaf7' }, height);
      label.position.set(0, 0.15, -r.room.d / 2 + 0.35);
      g.add(label);
      if (state.dimensions) {
        const dims = tapeSprite(`${r.room.w} × ${r.room.d}m`, { fill: '#fbfaf7' }, height);
        dims.position.set(0, 0.15, r.room.d / 2 - 0.18);
        g.add(dims);
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
      w.h / 2,
      w.axis === 'x' ? (w.start + w.end) / 2 : w.at,
      [mat, mat, cap, mat, mat, mat],
    );
    m.userData.roomId = w.roomId;
    m.userData.wall = true;
    m.userData.shared = w.shared;
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
    door.rotation.y = Math.PI / 2;
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
