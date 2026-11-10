import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
export function furniture(item) {
  const g = new T.Group(),
    [w, h, d] = item.dims.map((n) => n / 100);
  g.userData.id = item.id;
  const main = new T.MeshStandardMaterial({ color: item.color, roughness: 0.78 });
  const wood = new T.MeshStandardMaterial({ color: '#b18b65', roughness: 0.8 });
  const dark = new T.MeshStandardMaterial({ color: '#50564f', roughness: 0.7 });
  const linen = new T.MeshStandardMaterial({ color: '#f1ede3', roughness: 1 });
  function box(x, y, z, a, b, c, m = main) {
    const radius = Math.min(0.025, a * 0.04, b * 0.06, c * 0.04);
    const mesh = new T.Mesh(new RoundedBoxGeometry(a, b, c, 2, radius), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  function legs(top, th = 0.045) {
    for (const x of [-1, 1])
      for (const z of [-1, 1]) box(x * (w / 2 - th), top / 2, z * (d / 2 - th), th, top, th, wood);
  }
  switch (item.type) {
    case 'desk':
    case 'dining':
    case 'coffee':
      box(0, h - 0.025, 0, w, 0.05, d);
      legs(Math.max(0.02, h - 0.05));
      break;
    case 'bed':
      box(0, h * 0.22, 0, w, h * 0.36, d, wood);
      box(0, h * 0.65, 0, w * 0.98, h * 0.45, d * 0.97, linen);
      box(0, h * 0.89, -d * 0.31, w * 0.68, h * 0.22, d * 0.2, linen);
      box(0, h * 0.88, d * 0.2, w * 0.99, h * 0.08, d * 0.53);
      box(0, h * 0.51, -d * 0.48, w, h * 0.98, d * 0.04, wood);
      break;
    case 'chair':
      legs(h * 0.48, 0.035);
      box(0, h * 0.49, 0, w, h * 0.09, d);
      box(0, h * 0.77, -d * 0.45, w, h * 0.46, d * 0.1);
      break;
    case 'sofa':
    case 'armchair':
      box(0, h * 0.18, 0, w * 0.9, h * 0.25, d * 0.85, dark);
      box(0, h * 0.46, d * 0.07, w * 0.83, h * 0.3, d * 0.78);
      box(0, h * 0.75, -d * 0.37, w, h * 0.5, d * 0.22);
      for (const x of [-1, 1]) box(x * w * 0.455, h * 0.57, 0, w * 0.09, h * 0.64, d);
      for (const x of [-1, 1])
        box(x * w * 0.21, h * 0.64, d * 0.07, w * 0.405, h * 0.08, d * 0.7, linen);
      break;
    case 'wardrobe':
    case 'cabinet':
    case 'side':
    case 'tvstand':
    case 'shoe_cabinet':
      box(0, h / 2, 0, w, h, d);
      for (const x of [-1, 1]) {
        box(x * w * 0.249, h / 2, d * 0.506, w * 0.486, h * 0.97, 0.012, linen);
        box(x * w * 0.045, h * 0.53, d * 0.53, 0.016, h * 0.12, 0.022, dark);
      }
      break;
    case 'dresser':
      box(0, h / 2, 0, w, h, d, wood);
      for (let i = 0; i < 4; i++) {
        box(0, (h * (i + 0.5)) / 4, d * 0.505, w * 0.96, h * 0.235, 0.02);
        box(0, (h * (i + 0.5)) / 4, d * 0.53, w * 0.22, 0.015, 0.025, dark);
      }
      break;
    case 'bench':
      box(0, h - 0.035, 0, w, 0.07, d);
      legs(h - 0.07);
      break;
    case 'rug':
      box(0, h / 2, 0, w, h, d);
      for (const x of [-1, 1]) box(x * w * 0.46, h + 0.001, 0, w * 0.015, 0.002, d * 0.9, linen);
      break;
    case 'lamp': {
      const cylinder = (r1, r2, height, y, m) => {
        const mesh = new T.Mesh(new T.CylinderGeometry(r1, r2, height, 32), m);
        mesh.position.y = y;
        mesh.castShadow = true;
        g.add(mesh);
      };
      cylinder(w * 0.32, w * 0.38, h * 0.025, h * 0.0125, dark);
      cylinder(w * 0.025, w * 0.025, h * 0.76, h * 0.4, dark);
      cylinder(w * 0.28, w * 0.5, h * 0.27, h * 0.865, main);
      break;
    }
    case 'plant': {
      const pot = new T.Mesh(new T.CylinderGeometry(w * 0.33, w * 0.24, h * 0.32, 24), main);
      pot.position.y = h * 0.16;
      g.add(pot);
      box(0, h * 0.5, 0, w * 0.035, h * 0.55, w * 0.035, wood);
      const green = new T.MeshStandardMaterial({ color: '#6c865c', roughness: 1 });
      for (let i = 0; i < 9; i++) {
        const r = i * 2.4,
          leaf = new T.Mesh(new T.SphereGeometry(1, 12, 8), green);
        leaf.scale.set(w * 0.24, h * 0.18, d * 0.12);
        leaf.position.set(Math.sin(r) * w * 0.22, h * (0.46 + i * 0.045), Math.cos(r) * d * 0.22);
        leaf.rotation.z = Math.sin(r) * 0.55;
        leaf.castShadow = true;
        g.add(leaf);
      }
      break;
    }
    case 'fridge':
      box(0, h / 2, 0, w, h, d, main);
      box(0, h * 0.73, d * 0.503, w * 0.97, h * 0.51, 0.025, linen);
      box(0, h * 0.22, d * 0.503, w * 0.97, h * 0.43, 0.025, linen);
      box(-w * 0.36, h * 0.6, d * 0.53, 0.025, h * 0.18, 0.025, dark);
      box(-w * 0.36, h * 0.28, d * 0.53, 0.025, h * 0.16, 0.025, dark);
      break;
    case 'washer': {
      box(0, h / 2, 0, w, h, d, linen);
      box(0, h * 0.9, d * 0.505, w * 0.96, h * 0.13, 0.025, main);
      const glass = new T.MeshStandardMaterial({
        color: '#3c5058',
        roughness: 0.2,
        metalness: 0.25,
      });
      const door = new T.Mesh(
        new T.CylinderGeometry(Math.min(w, h) * 0.31, Math.min(w, h) * 0.31, 0.04, 32),
        dark,
      );
      door.rotation.x = Math.PI / 2;
      door.position.set(0, h * 0.46, d * 0.52);
      g.add(door);
      const window = new T.Mesh(new T.CircleGeometry(Math.min(w, h) * 0.25, 32), glass);
      window.position.set(0, h * 0.46, d * 0.55);
      g.add(window);
      break;
    }
    case 'shelf':
      for (const x of [-1, 1]) box(x * (w / 2 - 0.02), h / 2, 0, 0.04, h, d);
      box(0, h / 2, -d / 2 + 0.01, w, h, 0.02);
      for (let i = 0; i < 5; i++) box(0, 0.025 + ((h - 0.05) * i) / 4, 0, w, 0.04, d, wood);
      break;
  }
  g.position.set(item.x, 0, item.z);
  g.rotation.y = (item.angle * Math.PI) / 180;
  return g;
}
export function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.map?.dispose();
        m.dispose();
      }
    }
  });
}
