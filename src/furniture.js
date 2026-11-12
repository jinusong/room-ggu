import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// 치수 [가로, 전체 높이, 깊이] cm를 그대로 반영하는 파라메트릭 형상.
// 모형처럼 읽히도록 상자마다 얇은 외곽선을 붙이고, 재질은 천·나무·도장·금속으로 나눈다.
const hasDOM = typeof document !== 'undefined';
let grain = null;
function woodGrain() {
  if (!hasDOM || grain) return grain;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) {
    const y = (i * 256) / 46 + Math.sin(i * 1.7) * 3;
    g.strokeStyle = `rgba(80,52,28,${0.05 + (i % 5) * 0.018})`;
    g.lineWidth = 1 + (i % 3) * 0.6;
    g.beginPath();
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x / 38 + i) * 2.4);
    g.stroke();
  }
  grain = new T.CanvasTexture(c);
  grain.colorSpace = T.SRGBColorSpace;
  grain.wrapS = grain.wrapT = T.RepeatWrapping;
  grain.userData.shared = true;
  return grain;
}
const FABRIC = new Set(['sofa', 'armchair', 'bed', 'rug', 'bench', 'chair']);
const APPLIANCE = new Set(['fridge', 'washer']);

export function furniture(item, { ghost = false } = {}) {
  const g = new T.Group(),
    [w, h, d] = item.dims.map((n) => n / 100);
  g.userData.id = item.id;
  const finish = (color, roughness, extra = {}) =>
    new T.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0,
      ...extra,
      ...(ghost ? { transparent: true, opacity: 0.42, depthWrite: false } : {}),
    });
  const main = finish(
    item.color,
    FABRIC.has(item.type) ? 0.92 : APPLIANCE.has(item.type) ? 0.35 : 0.62,
  );
  const wood = finish('#c09a72', 0.7, { map: woodGrain() });
  const dark = finish('#3d3b37', 0.45, { metalness: 0.35 });
  const linen = finish('#f3f0e8', 0.95);
  const edge = new T.LineBasicMaterial({
    color: '#26241f',
    transparent: true,
    opacity: ghost ? 0.5 : 0.16,
    depthWrite: false,
  });
  function box(x, y, z, a, b, c, m = main, outline = true) {
    const radius = Math.min(0.02, a * 0.04, b * 0.06, c * 0.04);
    const mesh = new T.Mesh(new RoundedBoxGeometry(a, b, c, 2, radius), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = !ghost;
    mesh.receiveShadow = !ghost;
    g.add(mesh);
    if (outline && a > 0.03 && b > 0.008 && c > 0.03) {
      const lines = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(a, b, c)), edge);
      lines.position.copy(mesh.position);
      lines.userData.outline = true;
      g.add(lines);
    }
    return mesh;
  }
  function legs(top, th = 0.04, m = wood) {
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        box(x * (w / 2 - th), top / 2, z * (d / 2 - th), th, top, th, m, false);
  }
  function cylinder(r1, r2, height, y, m, x = 0, z = 0) {
    const mesh = new T.Mesh(new T.CylinderGeometry(r1, r2, height, 32), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = !ghost;
    g.add(mesh);
    return mesh;
  }
  switch (item.type) {
    case 'desk':
      box(0, h - 0.02, 0, w, 0.04, d);
      for (const x of [-1, 1])
        box(x * (w / 2 - 0.02), (h - 0.04) / 2, 0, 0.03, h - 0.04, d * 0.9, dark, false);
      box(0, h * 0.62, -d * 0.42, w * 0.94, h * 0.16, 0.015, dark, false);
      break;
    case 'dining':
    case 'coffee':
      box(0, h - 0.02, 0, w, 0.04, d);
      legs(Math.max(0.02, h - 0.04), 0.045);
      break;
    case 'bed':
      box(0, h * 0.2, 0.025, w, h * 0.34, d - 0.05, wood);
      box(0, h * 0.6, 0.03, w * 0.97, h * 0.42, d * 0.94, linen);
      for (const x of w > 1.2 ? [-1, 1] : [0])
        box(
          x * w * 0.23,
          h * 0.88,
          -d * 0.36,
          w > 1.2 ? w * 0.4 : w * 0.7,
          h * 0.2,
          d * 0.15,
          linen,
        );
      box(0, h * 0.86, d * 0.2, w * 0.99, h * 0.07, d * 0.55);
      box(0, h / 2, -d / 2 + 0.025, w, h, 0.05, wood);
      break;
    case 'chair':
      legs(h * 0.5, 0.03, dark);
      box(0, h * 0.52, 0, w, h * 0.06, d);
      box(0, h * 0.78, -d * 0.45, w * 0.94, h * 0.42, d * 0.08);
      break;
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(0.16, w * 0.12);
      for (const x of [-1, 1]) box(x * (w / 2 - 0.05), 0.04, 0, 0.035, 0.08, d * 0.86, dark, false);
      box(0, h * 0.25, 0, w, h * 0.22, d, main);
      box(0, h * 0.65, -d * 0.4, w - arm * 2, h * 0.62, d * 0.2);
      for (const x of [-1, 1]) box(x * (w / 2 - arm / 2), h * 0.45, 0, arm, h * 0.6, d);
      const seats =
        item.type === 'armchair' ? 1 : Math.max(1, Math.min(4, Math.round((w - arm * 2) / 0.6)));
      const sw = (w - arm * 2) / seats;
      for (let i = 0; i < seats; i++)
        box(-w / 2 + arm + sw * (i + 0.5), h * 0.44, d * 0.08, sw - 0.02, h * 0.16, d * 0.72);
      break;
    }
    case 'wardrobe':
    case 'cabinet':
    case 'side':
    case 'tvstand':
    case 'shoe_cabinet': {
      box(0, h / 2 + 0.03, 0, w, h - 0.06, d);
      box(0, 0.015, 0, w * 0.96, 0.03, d * 0.9, dark, false);
      const doors = w > 1.3 ? 3 : w > 0.5 ? 2 : 1;
      for (let i = 0; i < doors; i++) {
        const x = -w / 2 + (w / doors) * (i + 0.5);
        box(x, h / 2 + 0.03, d / 2 + 0.006, w / doors - 0.012, h - 0.09, 0.012, main);
        box(
          x + (i % 2 ? -1 : 1) * (w / doors) * 0.38,
          h * 0.55,
          d / 2 + 0.02,
          0.012,
          Math.min(0.18, h * 0.2),
          0.015,
          dark,
          false,
        );
      }
      break;
    }
    case 'dresser': {
      box(0, h / 2, 0, w, h, d, wood);
      const rows = h > 0.9 ? 4 : 3;
      for (let i = 0; i < rows; i++) {
        const y = 0.04 + ((h - 0.06) * (i + 0.5)) / rows;
        box(0, y, d / 2 + 0.006, w * 0.94, (h - 0.06) / rows - 0.014, 0.014, main);
        box(0, y, d / 2 + 0.02, w * 0.2, 0.014, 0.014, dark, false);
      }
      break;
    }
    case 'bench':
      box(0, h - 0.03, 0, w, 0.06, d);
      legs(h - 0.06, 0.04, wood);
      break;
    case 'rug':
      box(0, h / 2, 0, w, h, d, main, false);
      box(
        0,
        h + 0.0006,
        0,
        w * 0.88,
        0.0012,
        d * 0.88,
        finish('#ffffff', 1, { transparent: true, opacity: ghost ? 0.15 : 0.22 }),
        false,
      );
      break;
    case 'lamp':
      cylinder(w * 0.34, w * 0.38, 0.025, 0.0125, dark);
      cylinder(0.012, 0.012, h * 0.76, h * 0.39, dark);
      cylinder(
        w * 0.3,
        w * 0.5,
        h * 0.24,
        h * 0.86,
        finish(item.color, 0.9, { emissive: '#f6e7c8', emissiveIntensity: ghost ? 0 : 0.25 }),
      );
      break;
    case 'plant': {
      cylinder(w * 0.34, w * 0.26, h * 0.32, h * 0.16, main);
      box(0, h * 0.5, 0, 0.02, h * 0.42, 0.02, wood, false);
      const green = finish('#5f7a52', 1);
      for (let i = 0; i < 11; i++) {
        const r = i * 2.4,
          leaf = new T.Mesh(new T.SphereGeometry(1, 14, 10), green);
        leaf.scale.set(w * 0.22, h * 0.14, d * 0.12);
        leaf.position.set(Math.sin(r) * w * 0.22, h * (0.44 + i * 0.045), Math.cos(r) * d * 0.22);
        leaf.rotation.z = Math.sin(r) * 0.55;
        leaf.castShadow = !ghost;
        g.add(leaf);
      }
      break;
    }
    case 'fridge':
      box(0, h / 2, 0, w, h, d, main);
      box(0, h * 0.73, d / 2 + 0.008, w * 0.97, h * 0.51, 0.016, main);
      box(0, h * 0.235, d / 2 + 0.008, w * 0.97, h * 0.44, 0.016, main);
      box(-w * 0.38, h * 0.62, d / 2 + 0.03, 0.02, h * 0.18, 0.02, dark, false);
      box(-w * 0.38, h * 0.3, d / 2 + 0.03, 0.02, h * 0.14, 0.02, dark, false);
      break;
    case 'washer': {
      box(0, h / 2, 0, w, h, d, linen);
      box(0, h * 0.9, d / 2 + 0.006, w * 0.96, h * 0.13, 0.012, main);
      const glass = finish('#3c5058', 0.15, { metalness: 0.3 });
      const ring = new T.Mesh(new T.TorusGeometry(Math.min(w, h) * 0.28, 0.025, 12, 40), dark);
      ring.position.set(0, h * 0.45, d / 2 + 0.015);
      g.add(ring);
      const window = new T.Mesh(new T.CircleGeometry(Math.min(w, h) * 0.26, 40), glass);
      window.position.set(0, h * 0.45, d / 2 + 0.012);
      g.add(window);
      break;
    }
    case 'shelf':
      for (const x of [-1, 1]) box(x * (w / 2 - 0.015), h / 2, 0, 0.03, h, d, wood);
      box(0, h / 2, -d / 2 + 0.008, w, h, 0.016, main, false);
      for (let i = 0; i < 5; i++) box(0, 0.015 + ((h - 0.03) * i) / 4, 0, w - 0.06, 0.03, d, wood);
      break;
  }
  if (ghost)
    g.traverse((o) => {
      o.renderOrder = 2;
    });
  g.position.set(item.x, 0, item.z);
  g.rotation.y = (item.angle * Math.PI) / 180;
  return g;
}
export function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map && !m.map.userData?.shared) m.map.dispose();
        m.dispose();
      }
    }
  });
}
