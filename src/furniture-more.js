import * as T from 'three';

// 주방·욕실·반려동물·식물·아이·운동 가구의 파라메트릭 형상. furniture.js가 넘긴 도구로 그린다.
// 치수 [가로, 전체 높이, 깊이]를 그대로 따르고 앞은 +z, 벽 쪽은 -z다. 제품 도면이 아니라 크기를 가늠하는 모형이다.
export function moreFurniture(type, k) {
  const { g, w, h, d, ghost, finish, main, wood, dark, linen, box, legs, cylinder, ellipsoid } = k;
  const shadow = (mesh) => {
    mesh.castShadow = !ghost;
    g.add(mesh);
    return mesh;
  };
  const stone = finish('#e6e3dc', 0.45);
  const metal = finish('#b9bdb8', 0.3, { metalness: 0.55 });
  const glass = finish('#cfe0e4', 0.1, {
    transparent: true,
    opacity: ghost ? 0.14 : 0.3,
    depthWrite: false,
  });
  const green = finish('#5f7a52', 1);
  const deep = finish('#476241', 1);
  const soil = finish('#5a4634', 1);
  // 돌린 막대. axis가 'x'면 가로로, 'z'면 앞뒤로 눕힌다.
  function rod(r, length, x, y, z, m = dark, axis = 'y') {
    const mesh = cylinder(r, r, length, y, m, x, z);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    return mesh;
  }
  function ring(r, tube, x, y, z, m = dark, axis = 'x') {
    const mesh = shadow(new T.Mesh(new T.TorusGeometry(r, tube, 10, 36), m));
    mesh.position.set(x, y, z);
    if (axis === 'x') mesh.rotation.y = Math.PI / 2;
    if (axis === 'y') mesh.rotation.x = Math.PI / 2;
    return mesh;
  }
  // 잎 덩어리. 원뿔 모양으로 돌며 위로 올라간다.
  function foliage(n, y0, y1, rx, rz, size, m = green, [cx, cz] = [0, 0]) {
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0,
        a = i * 2.4,
        spread = 1 - t * 0.55;
      const leaf = ellipsoid(
        cx + Math.sin(a) * rx * spread,
        y0 + (y1 - y0) * t,
        cz + Math.cos(a) * rz * spread,
        size[0],
        size[1],
        size[2],
        i % 3 ? m : deep,
      );
      leaf.rotation.z = Math.sin(a) * 0.6;
      leaf.rotation.x = Math.cos(a) * 0.4;
    }
  }
  function pot(r, height, y = 0) {
    cylinder(r, r * 0.78, height, y + height / 2, main);
    cylinder(r * 0.92, r * 0.92, 0.01, y + height - 0.01, soil);
  }
  // 주방 하부장: 걸레받이, 몸통, 문짝, 위 상판.
  function baseUnit(doors, top = stone, drawer = false) {
    const plinth = Math.min(0.1, h * 0.12),
      bodyH = h - plinth - 0.03;
    box(0, plinth / 2, -0.03, w * 0.98, plinth, d - 0.06, dark, false);
    box(0, plinth + bodyH / 2, 0, w, bodyH, d, main);
    const dw = w / doors;
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      if (drawer) {
        box(x, h - 0.03 - 0.1, d / 2 + 0.006, dw - 0.012, 0.16, 0.012, main);
        box(x, plinth + (bodyH - 0.2) / 2, d / 2 + 0.006, dw - 0.012, bodyH - 0.22, 0.012, main);
      } else box(x, plinth + bodyH / 2, d / 2 + 0.006, dw - 0.012, bodyH - 0.02, 0.012, main);
      box(x, h - 0.08, d / 2 + 0.02, Math.min(0.14, dw * 0.4), 0.012, 0.015, dark, false);
    }
    box(0, h - 0.015, 0.01, w + 0.01, 0.03, d + 0.02, top);
  }
  // 문짝이 달린 키 큰 몸통. glassFrom 위로는 유리문과 선반이다.
  function tallBody(doors, glassFrom = null) {
    const split = glassFrom ?? h,
      dw = w / doors;
    box(0, split / 2, 0, w, split, d, main);
    // 유리문 칸은 속이 보이도록 뒤판·옆판·윗판만 세우고 안쪽은 어둡게 칠한다.
    if (glassFrom !== null) {
      box(0, (split + h) / 2, -d / 2 + 0.01, w, h - split, 0.02, finish('#4a4743', 0.7), false);
      for (const x of [-1, 1])
        box(x * (w / 2 - 0.01), (split + h) / 2, 0, 0.02, h - split, d, main);
      box(0, h - 0.01, 0, w, 0.02, d, main);
    }
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      box(x, split / 2, d / 2 + 0.006, dw - 0.012, split - 0.04, 0.012, main);
      box(
        x + (i % 2 ? -1 : 1) * dw * 0.38,
        split * 0.55,
        d / 2 + 0.02,
        0.012,
        0.16,
        0.015,
        dark,
        false,
      );
      if (glassFrom !== null)
        box(x, (split + h) / 2, d / 2 + 0.006, dw - 0.02, h - split - 0.04, 0.008, glass, false);
    }
    if (glassFrom !== null)
      for (let y = split + 0.02; y < h - 0.1; y += (h - split) / 3)
        box(0, y, 0, w - 0.04, 0.015, d - 0.04, linen, false);
  }
  function screen(x, y, z, a, b, m = finish('#2c3236', 0.25, { metalness: 0.2 })) {
    box(x, y, z, a, b, 0.008, m, false);
  }
  switch (type) {
    // 욕실
    case 'bathtub': {
      // 테두리 네 면과 안쪽 물. 위에서 보면 속이 비어 있다.
      const rim = 0.07;
      box(0, 0.06, 0, w, 0.12, d, main);
      for (const z of [-1, 1]) box(0, h / 2, z * (d / 2 - rim / 2), w, h, rim, main);
      for (const x of [-1, 1]) box(x * (w / 2 - rim / 2), h / 2, 0, rim, h, d - rim * 2, main);
      box(0, h * 0.6, 0, w - rim * 2, 0.01, d - rim * 2, finish('#a9cdd3', 0.1), false);
      box(-w / 2 + 0.1, h + 0.05, 0, 0.03, 0.1, 0.03, metal, false);
      box(-w / 2 + 0.14, h + 0.1, 0, 0.1, 0.025, 0.025, metal, false);
      break;
    }
    case 'laundry_basket': {
      const two = w > d * 1.4;
      for (const x of two ? [-w / 4, w / 4] : [0]) {
        const bw = two ? w / 2 - 0.01 : w;
        box(x, h / 2, 0, bw, h, d, main);
        box(x, h - 0.004, 0, bw - 0.03, 0.008, d - 0.03, dark, false);
      }
      box(0, h * 0.55, d / 2 + 0.004, w * 0.3, 0.04, 0.008, linen, false);
      break;
    }
    // 주방
    case 'sink': {
      baseUnit(w > 1.2 ? 3 : 2);
      const bowls = w > 1.2 ? [-w * 0.18, w * 0.18] : [0];
      for (const x of bowls)
        box(
          x,
          h + 0.002,
          0.03,
          Math.min(0.42, w * 0.3),
          0.006,
          d * 0.6,
          finish('#8f9592', 0.25, { metalness: 0.6 }),
          false,
        );
      box(0, h + 0.1, -d / 2 + 0.07, 0.03, 0.2, 0.03, metal, false);
      box(0, h + 0.19, -d / 2 + 0.14, 0.03, 0.03, 0.16, metal, false);
      break;
    }
    case 'counter':
      baseUnit(Math.max(1, Math.round(w / 0.45)), stone, true);
      break;
    case 'cooktop': {
      baseUnit(Math.max(1, Math.round(w / 0.45)), stone, true);
      const hob = finish('#24272a', 0.15, { metalness: 0.2 });
      box(0, h + 0.004, 0, w * 0.86, 0.008, d * 0.85, hob, false);
      const n = w > 0.85 ? 4 : w > 0.7 ? 3 : 2;
      const spots =
        n === 4
          ? [
              [-1, -1],
              [1, -1],
              [-1, 1],
              [1, 1],
            ]
          : n === 3
            ? [
                [-1, -1],
                [1, -1],
                [0, 1],
              ]
            : [
                [-1, 0],
                [1, 0],
              ];
      for (const [sx, sz] of spots)
        ring(Math.min(w, d) * 0.12, 0.006, sx * w * 0.22, h + 0.01, sz * d * 0.2, metal, 'y');
      break;
    }
    case 'island': {
      const body = d - 0.25;
      box(0, 0.05, -0.1, w - 0.04, 0.1, body - 0.06, dark, false);
      box(0, (h - 0.03) / 2 + 0.05, -0.1, w, h - 0.13, body, main);
      for (let i = 0; i < Math.round(w / 0.5); i++) {
        const n = Math.round(w / 0.5),
          dw = w / n;
        box(
          -w / 2 + dw * (i + 0.5),
          h / 2,
          -0.1 - body / 2 - 0.006,
          dw - 0.012,
          h - 0.16,
          0.012,
          main,
        );
      }
      box(0, h - 0.02, 0, w + 0.02, 0.04, d, stone);
      break;
    }
    case 'tall_cabinet':
      tallBody(w > 0.7 ? 2 : 1);
      box(0, h * 0.55, d / 2 + 0.014, w * 0.96, 0.006, 0.004, dark, false);
      break;
    case 'cupboard':
      tallBody(w > 0.7 ? 2 : 1, h * 0.48);
      box(0, h * 0.48, 0.02, w + 0.02, 0.03, d + 0.04, wood);
      break;
    case 'microwave_stand': {
      for (const x of [-1, 1]) box(x * (w / 2 - 0.015), h / 2, 0, 0.03, h, d, main);
      box(0, h / 2, -d / 2 + 0.008, w, h, 0.016, main, false);
      const levels =
        h > 1.4 ? [0.02, 0.4, 0.75, 1.1, h - 0.015] : [0.02, h * 0.45, h * 0.75, h - 0.015];
      for (const y of levels) box(0, y, 0, w - 0.06, 0.03, d, wood);
      box(0, h * 0.225, d / 2 + 0.006, w - 0.07, h * 0.4, 0.012, main);
      const mw = Math.min(w - 0.12, 0.5);
      box(0, h * 0.45 + 0.15, 0, mw, 0.27, d * 0.8, linen);
      screen(-mw * 0.12, h * 0.45 + 0.15, d * 0.4 + 0.004, mw * 0.6, 0.2);
      box(0, h - 0.015 + 0.06, 0.02, 0.3, 0.12, 0.25, finish('#d9d6cf', 0.4));
      break;
    }
    case 'dishwasher': {
      box(0, h / 2, 0, w, h, d, main);
      box(0, h * 0.45, d / 2 + 0.006, w * 0.96, h * 0.82, 0.012, main);
      box(0, h * 0.93, d / 2 + 0.008, w * 0.96, h * 0.08, 0.014, dark, false);
      box(0, h * 0.84, d / 2 + 0.02, w * 0.5, 0.015, 0.015, metal, false);
      break;
    }
    case 'kimchi_fridge': {
      box(0, h / 2, 0, w, h, d, main);
      if (h < 1.2) {
        for (const x of [-w / 4, w / 4])
          box(x, h + 0.005, 0, w / 2 - 0.02, 0.012, d - 0.04, linen, false);
        box(0, h * 0.4, d / 2 + 0.008, w * 0.96, h * 0.7, 0.014, main);
        screen(0, h * 0.85, d / 2 + 0.006, w * 0.4, 0.05);
      } else
        for (const [y, hh] of [
          [h * 0.78, h * 0.4],
          [h * 0.4, h * 0.3],
          [h * 0.13, h * 0.22],
        ]) {
          box(0, y, d / 2 + 0.008, w * 0.97, hh - 0.015, 0.016, main);
          box(0, y + hh / 2 - 0.05, d / 2 + 0.025, w * 0.6, 0.015, 0.015, dark, false);
        }
      break;
    }
    case 'wine_cellar': {
      box(0, h / 2, 0, w, h, d, finish('#2f3133', 0.4));
      box(0, h / 2 + 0.02, d / 2 + 0.006, w * 0.9, h - 0.1, 0.01, glass, false);
      const bottle = finish('#5b2a2e', 0.3);
      for (let y = 0.14; y < h - 0.1; y += 0.13)
        for (let x = -w / 2 + 0.08; x < w / 2 - 0.05; x += 0.1)
          rod(0.035, 0.06, x, y, d / 2 - 0.02, bottle, 'z');
      box(-w * 0.4, h / 2, d / 2 + 0.025, 0.015, h * 0.4, 0.015, metal, false);
      break;
    }
    case 'trash_bin': {
      const n = w > 0.75 ? 3 : w > 0.45 ? 2 : 1,
        bw = w / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + bw * (i + 0.5),
          lid = [main, finish('#8495a5', 0.6), finish('#83917d', 0.6)][i];
        box(x, (h - 0.04) / 2, 0, bw - 0.012, h - 0.04, d, linen);
        box(x, h - 0.02, 0, bw - 0.012, 0.04, d, lid);
      }
      break;
    }
    case 'bar_table':
      box(0, h - 0.02, 0, w, 0.04, d);
      legs(h - 0.04, 0.04, dark);
      box(0, 0.25, 0, w - 0.1, 0.025, 0.025, dark, false);
      break;
    case 'bar_stool': {
      cylinder(w * 0.5, w * 0.46, 0.06, h - 0.03, main);
      cylinder(0.025, 0.025, h - 0.06, (h - 0.06) / 2, metal);
      cylinder(w * 0.36, w * 0.4, 0.02, 0.01, metal);
      ring(w * 0.3, 0.008, 0, h * 0.35, 0, metal, 'y');
      break;
    }
    // 식물
    case 'leafy_plant': {
      const ph = Math.min(0.35, h * 0.3);
      pot(w * 0.28, ph);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4,
          y = ph + (h - ph) * (0.35 + (i % 4) * 0.17),
          r = w * (0.22 + (i % 3) * 0.06);
        rod(0.008, y - ph, Math.sin(a) * r * 0.5, (ph + y) / 2, Math.cos(a) * r * 0.5, green);
        const leaf = ellipsoid(
          Math.sin(a) * r,
          y,
          Math.cos(a) * r,
          w * 0.34,
          0.025,
          d * 0.26,
          i % 2 ? green : deep,
        );
        leaf.rotation.y = a;
        leaf.rotation.x = 0.35;
      }
      break;
    }
    case 'tree_plant': {
      const ph = Math.min(0.4, h * 0.2);
      pot(w * 0.3, ph);
      rod(0.022, h * 0.6, 0, ph + h * 0.3, 0, wood);
      foliage(26, h * 0.42, h * 0.95, w * 0.42, d * 0.42, [w * 0.42, h * 0.1, d * 0.32]);
      break;
    }
    case 'succulent': {
      const ph = Math.min(0.25, h * 0.4);
      pot(w * 0.42, ph);
      if (h > 0.6) {
        rod(w * 0.2, h - ph, 0, ph + (h - ph) / 2, 0, green);
        rod(w * 0.1, h * 0.25, w * 0.24, ph + h * 0.3, 0, green);
        rod(w * 0.1, h * 0.18, -w * 0.22, ph + h * 0.22, 0.02, green);
      } else if (h > 0.3)
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4,
            r = i ? w * 0.18 : 0;
          const leaf = rod(
            w * 0.06,
            (h - ph) * (0.7 + (i % 3) * 0.15),
            Math.sin(a) * r,
            ph + (h - ph) * 0.42,
            Math.cos(a) * r,
            green,
          );
          leaf.rotation.z = Math.sin(a) * 0.1;
        }
      else foliage(10, ph + 0.01, h - 0.01, w * 0.2, d * 0.2, [w * 0.3, 0.04, d * 0.14], green);
      break;
    }
    case 'trailing_plant': {
      const top = h * 0.72;
      cylinder(w * 0.35, w * 0.35, 0.025, top - 0.0125, wood);
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        rod(0.012, top, Math.sin(a) * w * 0.28, top / 2, Math.cos(a) * d * 0.28, wood);
      }
      pot(w * 0.3, h * 0.14, top);
      foliage(8, top + h * 0.14, h - 0.02, w * 0.25, d * 0.25, [w * 0.3, 0.06, d * 0.22]);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05,
          vine = ellipsoid(
            Math.sin(a) * w * 0.38,
            top - h * 0.15,
            Math.cos(a) * d * 0.38,
            0.05,
            h * 0.4,
            0.05,
            i % 2 ? green : deep,
          );
        vine.rotation.z = Math.sin(a) * 0.15;
      }
      break;
    }
    case 'plant_stand': {
      const tiers = h > 1.05 ? 4 : h > 0.75 ? 3 : 2;
      for (const x of [-1, 1]) {
        box(x * (w / 2 - 0.015), h / 2, 0, 0.025, h, 0.025, wood, false);
      }
      for (let i = 0; i < tiers; i++) {
        const y = 0.12 + ((h - 0.16) * i) / (tiers - 1),
          z = (tiers - 1 - i) * 0.02 - 0.02;
        box(0, y, z, w, 0.02, d - 0.04, wood);
        for (const x of w > 0.5 ? [-w * 0.25, w * 0.25] : [0]) {
          cylinder(0.06, 0.05, 0.1, y + 0.06, main, x, z);
          foliage(4, y + 0.13, y + 0.18, 0.04, 0.04, [0.09, 0.05, 0.07], green, [x, z]);
        }
      }
      break;
    }
    // 거실·침실·작업
    case 'beanbag': {
      ellipsoid(0, h * 0.38, 0.02, w, h * 0.76, d * 0.95);
      ellipsoid(0, h * 0.68, -d * 0.24, w * 0.85, h * 0.6, d * 0.42);
      break;
    }
    case 'ottoman':
      box(0, (h + 0.06) / 2, 0, w, h - 0.06, d);
      legs(0.06, 0.03, wood);
      break;
    case 'console':
      box(0, h - 0.02, 0, w, 0.04, d);
      legs(h - 0.04, 0.03, dark);
      box(0, 0.18, 0, w - 0.06, 0.025, d - 0.04, wood);
      box(0, h - 0.08, d / 2 - 0.01, w - 0.08, 0.07, 0.02, main, false);
      break;
    case 'display_cabinet':
      tallBody(w > 1 ? 3 : 2, h * 0.3);
      for (let y = h * 0.34; y < h - 0.2; y += (h * 0.7) / 3) {
        cylinder(0.04, 0.04, 0.14, y + 0.08, finish('#c5cec5', 0.3), -w * 0.2, 0);
        box(w * 0.18, y + 0.06, 0, 0.12, 0.1, 0.08, finish('#bc8065', 0.6), false);
      }
      break;
    case 'massage_chair': {
      box(0, h * 0.2, 0, w, h * 0.3, d * 0.55, dark);
      box(0, h * 0.42, 0.02, w * 0.7, h * 0.12, d * 0.5);
      const back = box(0, h * 0.68, -d * 0.3, w * 0.72, h * 0.62, 0.22);
      back.rotation.x = -0.25;
      for (const x of [-1, 1]) box(x * (w / 2 - 0.08), h * 0.45, 0, 0.16, h * 0.32, d * 0.55);
      const rest = box(0, h * 0.2, d * 0.36, w * 0.45, 0.1, d * 0.34);
      rest.rotation.x = 0.75;
      break;
    }
    case 'partition': {
      const n = w > 1.4 ? 5 : w > 1 ? 4 : 3,
        pw = w / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + pw * (i + 0.5),
          z = (i % 2 ? 1 : -1) * d * 0.25;
        const panel = box(x, h / 2 + 0.03, z, pw * 1.02, h - 0.06, 0.025, linen, false);
        panel.rotation.y = (i % 2 ? 1 : -1) * 0.45;
        box(x, h / 2 + 0.03, z, 0.02, h - 0.06, 0.03, wood, false);
      }
      break;
    }
    case 'piano': {
      const black = finish('#1d1d1f', 0.25);
      if (d > 1.2) {
        // 그랜드: 둥근 몸통, 열린 뚜껑, 다리 셋.
        const body = ellipsoid(0, h * 0.7, 0, w, h * 0.3, d, black);
        body.scale.y = h * 0.12;
        box(0, h * 0.78, -d / 2 + 0.2, w * 0.96, 0.02, 0.3, linen, false);
        box(0, h * 0.72, -d / 2 + 0.04, w * 0.96, 0.05, 0.08, black, false);
        for (const [x, z] of [
          [-w * 0.4, -d * 0.3],
          [w * 0.4, -d * 0.3],
          [0, d * 0.35],
        ])
          box(x, h * 0.32, z, 0.06, h * 0.64, 0.06, black, false);
        const lid = box(w * 0.05, h * 1.05, 0.05, w * 0.85, 0.015, d * 0.75, black, false);
        lid.rotation.z = 0.5;
      } else if (h < 0.95) {
        box(0, h - 0.07, 0, w, 0.12, d, black);
        box(0, h - 0.01, d * 0.18, w * 0.94, 0.012, d * 0.5, linen, false);
        for (const x of [-1, 1])
          box(x * (w / 2 - 0.03), (h - 0.13) / 2, 0, 0.03, h - 0.13, d * 0.8, black, false);
      } else {
        box(0, h / 2, -d * 0.2, w, h, d * 0.6, black);
        box(0, h * 0.58, d * 0.15, w, 0.06, d * 0.3, black);
        box(0, h * 0.62, d * 0.18, w * 0.92, 0.012, d * 0.22, linen, false);
        for (const x of [-1, 1])
          box(x * (w / 2 - 0.04), h * 0.27, d * 0.25, 0.05, h * 0.54, 0.05, black, false);
      }
      break;
    }
    case 'vanity': {
      const top = Math.min(h, 0.75);
      box(0, top - 0.02, 0, w, 0.04, d);
      box(w * 0.2, top - 0.11, 0, w * 0.5, 0.14, d * 0.9);
      legs(top - 0.04, 0.035, wood);
      if (h > 1.1) {
        box(0, (top + h) / 2, -d / 2 + 0.03, w * 0.6, h - top - 0.02, 0.03, wood);
        box(
          0,
          (top + h) / 2,
          -d / 2 + 0.05,
          w * 0.52,
          h - top - 0.07,
          0.006,
          finish('#dfe7ea', 0.05, { metalness: 0.6 }),
          false,
        );
      }
      break;
    }
    case 'hanger': {
      box(0, 0.02, 0, w, 0.04, d, dark, false);
      for (const x of [-1, 1]) rod(0.015, h, x * (w / 2 - 0.02), h / 2, 0, metal);
      rod(0.012, w, 0, h - 0.03, 0, metal, 'x');
      const bars = h > 1.7 ? [h - 0.03, h * 0.5] : [h - 0.03];
      if (bars.length > 1) rod(0.012, w, 0, bars[1], 0, metal, 'x');
      const cloth = [main, linen, finish('#8495a5', 0.9), finish('#83917d', 0.9)];
      for (const bar of bars)
        for (let i = 0, n = Math.floor((w - 0.1) / 0.09); i < n; i++)
          box(-w / 2 + 0.08 + i * 0.09, bar - 0.4, 0, 0.025, 0.7, d * 0.75, cloth[i % 4], false);
      break;
    }
    case 'mirror': {
      const frame = box(0, h / 2, 0, w, h - 0.02, 0.03, wood);
      frame.rotation.x = -0.12;
      const glassy = box(
        0,
        h / 2,
        0.018,
        w - 0.06,
        h - 0.08,
        0.006,
        finish('#dfe7ea', 0.05, { metalness: 0.7 }),
        false,
      );
      glassy.rotation.x = -0.12;
      box(0, 0.015, -d * 0.2, w * 0.8, 0.03, d * 0.5, wood, false);
      break;
    }
    case 'bunk_bed': {
      const post = 0.06;
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(x * (w / 2 - post / 2), h / 2, z * (d / 2 - post / 2), post, h, post, wood, false);
      for (const y of [0.25, h * 0.62]) {
        box(0, y, 0, w, 0.1, d, wood);
        box(0, y + 0.1, 0, w - 0.1, 0.12, d - 0.1, linen);
        box(0, y + 0.17, -d * 0.36, w * 0.6, 0.08, d * 0.12, linen);
      }
      box(0, h - 0.08, d / 2 - post / 2, w - 0.1, 0.04, 0.03, wood, false);
      for (const x of [-1, 1])
        box(w * 0.3 + x * 0.17, h * 0.4, d / 2 + 0.02, 0.04, h * 0.8, 0.04, wood, false);
      for (let y = 0.35; y < h * 0.7; y += 0.25)
        box(w * 0.3, y, d / 2 + 0.02, 0.34, 0.03, 0.03, wood, false);
      break;
    }
    case 'office_chair': {
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5,
          r = w * 0.25;
        const spoke = box(Math.sin(a) * r, 0.06, Math.cos(a) * r, 0.04, 0.03, w * 0.5, dark, false);
        spoke.rotation.y = a;
        ellipsoid(Math.sin(a) * w * 0.46, 0.025, Math.cos(a) * w * 0.46, 0.05, 0.05, 0.05, dark);
      }
      rod(0.025, 0.36, 0, 0.24, 0, metal);
      box(0, 0.47, 0.02, w * 0.8, 0.08, d * 0.75);
      const back = box(0, (0.55 + h) / 2, -d * 0.4, w * 0.72, h - 0.6, 0.07);
      back.rotation.x = -0.1;
      for (const x of [-1, 1]) {
        box(x * w * 0.42, 0.6, 0, 0.04, 0.18, 0.04, dark, false);
        box(x * w * 0.42, 0.69, 0, 0.06, 0.03, d * 0.4, dark, false);
      }
      if (h > 1.2) box(0, h - 0.12, -d * 0.36, w * 0.4, 0.12, 0.1, linen);
      break;
    }
    case 'standing_desk':
      box(0, h - 0.02, 0, w, 0.04, d);
      for (const x of [-1, 1]) {
        box(x * (w / 2 - 0.12), (h - 0.04) / 2, 0, 0.07, h - 0.04, 0.05, dark, false);
        box(x * (w / 2 - 0.12), 0.015, 0, 0.07, 0.03, d * 0.85, dark, false);
      }
      box(0, h - 0.07, 0, w - 0.3, 0.05, 0.06, dark, false);
      box(w * 0.38, h - 0.06, d / 2 - 0.02, 0.08, 0.02, 0.04, screenMat(), false);
      break;
    case 'drawer_unit':
    case 'file_cabinet': {
      const body = type === 'file_cabinet' ? metalBody() : main,
        foot = type === 'drawer_unit' ? 0.05 : 0;
      box(0, foot + (h - foot) / 2, 0, w, h - foot, d, body);
      const rows = type === 'file_cabinet' ? Math.max(2, Math.round(h / 0.33)) : 3;
      for (let i = 0; i < rows; i++) {
        const rh = (h - foot - 0.02) / rows,
          y = foot + 0.01 + rh * (i + 0.5);
        box(0, y, d / 2 + 0.006, w * 0.94, rh - 0.012, 0.012, body);
        box(0, y + rh * 0.25, d / 2 + 0.02, w * 0.4, 0.015, 0.015, dark, false);
      }
      if (foot)
        for (const x of [-1, 1])
          for (const z of [-1, 1])
            ellipsoid(x * w * 0.4, 0.025, z * d * 0.4, 0.045, 0.045, 0.045, dark);
      break;
    }
    // 가전
    case 'dryer': {
      box(0, h / 2, 0, w, h, d, linen);
      box(0, h * 0.9, d / 2 + 0.006, w * 0.96, h * 0.13, 0.012, main);
      ring(Math.min(w, h) * 0.28, 0.025, 0, h * 0.45, d / 2 + 0.015, dark, 'z');
      const door = new T.Mesh(
        new T.CircleGeometry(Math.min(w, h) * 0.26, 40),
        finish('#5a6266', 0.3),
      );
      door.position.set(0, h * 0.45, d / 2 + 0.012);
      g.add(door);
      box(0, h * 0.12, d / 2 + 0.006, w * 0.6, 0.04, 0.012, dark, false);
      break;
    }
    case 'styler': {
      box(0, h / 2, 0, w, h, d, main);
      box(
        0,
        h / 2,
        d / 2 + 0.008,
        w * 0.96,
        h * 0.97,
        0.016,
        finish('#3a3d40', 0.15, { metalness: 0.2 }),
      );
      box(-w * 0.4, h * 0.55, d / 2 + 0.03, 0.015, h * 0.25, 0.015, metal, false);
      screen(0, h * 0.85, d / 2 + 0.018, w * 0.3, 0.05, finish('#6a7a80', 0.2));
      break;
    }
    case 'aircon': {
      box(0, h / 2, 0, w, h, d, main);
      box(0, h * 0.78, d / 2 + 0.004, w * 0.8, h * 0.28, 0.008, dark, false);
      for (let y = h * 0.66; y < h * 0.92; y += 0.03)
        box(0, y, d / 2 + 0.01, w * 0.75, 0.006, 0.006, metal, false);
      ring(w * 0.3, 0.008, 0, h * 0.45, d / 2 + 0.006, metal, 'z');
      screen(0, h * 0.58, d / 2 + 0.006, w * 0.3, 0.04, finish('#6a7a80', 0.2));
      break;
    }
    case 'air_purifier':
    case 'dehumidifier': {
      box(0, h / 2, 0, w, h, d, main);
      cylinder(Math.min(w, d) * 0.4, Math.min(w, d) * 0.4, 0.01, h + 0.005, dark);
      for (let y = 0.08; y < h * 0.7; y += 0.03)
        box(0, y, d / 2 + 0.004, w * 0.8, 0.006, 0.006, dark, false);
      if (type === 'dehumidifier') {
        box(0, h * 0.3, d / 2 + 0.008, w * 0.9, h * 0.4, 0.014, glass, false);
        box(0, h + 0.03, 0, w * 0.5, 0.025, 0.025, dark, false);
      }
      break;
    }
    case 'humidifier': {
      cylinder(w * 0.5, w * 0.48, h * 0.7, h * 0.35, main);
      cylinder(w * 0.44, w * 0.44, h * 0.22, h * 0.81, glass);
      cylinder(w * 0.15, w * 0.2, h * 0.08, h * 0.96, dark);
      break;
    }
    case 'fan': {
      const tower = w < 0.35 && h > 0.6;
      if (tower) {
        cylinder(w * 0.5, w * 0.5, 0.03, 0.015, dark);
        box(0, h / 2 + 0.02, 0, w * 0.6, h - 0.04, d * 0.6, main);
        box(0, h / 2, d * 0.3 + 0.004, w * 0.2, h * 0.75, 0.008, dark, false);
        break;
      }
      const r = Math.min(w, h) * (h > 0.6 ? 0.45 : 0.42),
        cy = h - r - 0.01;
      cylinder(w * 0.45, w * 0.48, 0.03, 0.015, main);
      rod(0.015, cy, 0, cy / 2, 0, h > 0.6 ? metal : main);
      ring(r, 0.012, 0, cy, 0, main, 'z');
      cylinder(r * 0.25, r * 0.25, 0.08, cy, main).rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const blade = box(0, cy, 0.02, r * 0.4, r * 0.85, 0.006, linen, false);
        blade.rotation.z = (i * Math.PI * 2) / 3;
      }
      break;
    }
    case 'robot_station': {
      box(0, h / 2, -d * 0.2, w, h, d * 0.6, main);
      box(0, h * 0.3, d * 0.1 + 0.004, w * 0.6, h * 0.4, 0.008, dark, false);
      cylinder(w * 0.45, w * 0.45, 0.09, 0.045, linen, 0, d * 0.15);
      cylinder(w * 0.12, w * 0.12, 0.02, 0.1, dark, 0, d * 0.15);
      break;
    }
    case 'drying_rack': {
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          const leg = box(x * (w * 0.3), h / 2, z * d * 0.25, 0.02, h * 1.02, 0.02, metal, false);
          leg.rotation.x = z * 0.25;
        }
      for (let i = 0; i < 8; i++) rod(0.006, w, 0, h - 0.01, -d / 2 + (d * i) / 7, metal, 'x');
      for (const x of [-1, 1]) {
        const wing = box(x * (w / 2 - w * 0.1), h * 0.85, 0, w * 0.2, 0.01, d, metal, false);
        wing.rotation.z = x * -0.4;
      }
      box(-w * 0.1, h - 0.25, 0, 0.4, 0.45, 0.01, linen, false);
      break;
    }
    // 반려동물
    case 'cat_tower': {
      const sisal = finish('#c9b48d', 1),
        plush = main;
      box(0, 0.02, 0, w, 0.04, d, plush);
      const levels = Math.max(2, Math.round(h / 0.45));
      for (let i = 1; i <= levels; i++) {
        const y = Math.min(h - 0.03, (h * i) / levels),
          x = (i % 2 ? 1 : -1) * w * 0.18;
        box(x, y, (i % 2 ? -1 : 1) * d * 0.12, w * 0.62, 0.03, d * 0.62, plush);
      }
      rod(0.05, h, -w * 0.2, h / 2, d * 0.15, sisal);
      rod(0.05, h * 0.75, w * 0.22, h * 0.375, -d * 0.18, sisal);
      box(w * 0.12, 0.2, d * 0.1, w * 0.5, 0.32, d * 0.55, plush);
      ellipsoid(w * 0.12, 0.19, d * 0.1 + d * 0.275, 0.16, 0.18, 0.02, dark);
      if (h > 2) box(0, h - 0.02, 0, 0.2, 0.04, 0.2, dark, false);
      break;
    }
    case 'litter_box': {
      const tray = Math.min(h, 0.15);
      box(0, tray / 2, 0, w, tray, d, main);
      if (h > 0.2) {
        box(0, tray + (h - tray) / 2, 0, w * 0.98, h - tray, d * 0.98, main);
        ellipsoid(0, tray + (h - tray) * 0.4, d / 2, w * 0.4, (h - tray) * 0.6, 0.02, dark);
      } else box(0, tray - 0.01, 0, w - 0.04, 0.01, d - 0.04, finish('#d9ccb4', 1), false);
      break;
    }
    case 'scratcher': {
      if (h < 0.2) {
        box(0, h / 2, 0, w, h, d, finish('#c9a978', 0.95));
        for (let x = -w / 2 + 0.03; x < w / 2; x += 0.03)
          box(x, h + 0.001, 0, 0.004, 0.002, d * 0.96, dark, false);
      } else {
        box(0, 0.02, 0, w, 0.04, d, main);
        rod(0.06, h - 0.07, 0, (h - 0.07) / 2 + 0.04, 0, finish('#c9b48d', 1));
        box(0, h - 0.015, 0, w * 0.6, 0.03, d * 0.6, main);
      }
      break;
    }
    case 'dog_house': {
      const wallH = h * 0.6;
      box(0, wallH / 2, 0, w, wallH, d, main);
      for (const s of [-1, 1]) {
        const roof = box(s * w * 0.26, wallH + h * 0.18, 0, w * 0.62, 0.03, d * 1.08, wood);
        roof.rotation.z = s * -0.7;
      }
      box(0, wallH + (h - wallH) / 2, d / 2 - 0.01, w * 0.5, h - wallH, 0.02, main, false);
      ellipsoid(0, wallH * 0.45, d / 2 + 0.003, w * 0.42, wallH * 0.75, 0.01, dark);
      break;
    }
    case 'pet_bed': {
      ring(Math.min(w, d) * 0.4, h * 0.45, 0, h * 0.45, 0, main, 'y').scale.set(
        w / Math.min(w, d),
        d / Math.min(w, d),
        1,
      );
      ellipsoid(0, h * 0.25, 0, w * 0.8, h * 0.4, d * 0.8, linen);
      break;
    }
    case 'kennel': {
      box(0, h / 2, 0, w, h, d, main);
      box(0, h * 0.45, d / 2 + 0.004, w * 0.55, h * 0.7, 0.008, dark, false);
      for (let x = -w * 0.25; x <= w * 0.25; x += 0.04)
        box(x, h * 0.45, d / 2 + 0.01, 0.006, h * 0.66, 0.008, metal, false);
      box(0, h + 0.03, 0, w * 0.3, 0.03, 0.04, dark, false);
      for (const x of [-1, 1]) box((x * w) / 2, h * 0.5, 0, 0.006, h * 0.2, d * 0.5, dark, false);
      break;
    }
    case 'pet_fence': {
      const step = 0.08;
      for (const [len, along, at] of [
        [w, 'x', -d / 2],
        [w, 'x', d / 2],
        [d, 'z', -w / 2],
        [d, 'z', w / 2],
      ]) {
        for (let t = -len / 2; t <= len / 2 + 0.001; t += step)
          along === 'x' ? rod(0.006, h, t, h / 2, at, main) : rod(0.006, h, at, h / 2, t, main);
        for (const y of [0.02, h - 0.01])
          along === 'x' ? rod(0.01, len, 0, y, at, main, 'x') : rod(0.01, len, at, y, 0, main, 'z');
      }
      break;
    }
    case 'feeder': {
      box(0, h / 2, 0, w, h, d, main);
      const n = w > 0.5 ? 2 : w > 0.35 ? 2 : 1,
        r = Math.min(w / n, d) * 0.36;
      for (let i = 0; i < n; i++)
        cylinder(r, r * 0.8, 0.05, h + 0.02, metal, -w / 2 + (w / n) * (i + 0.5), 0);
      break;
    }
    case 'aquarium': {
      const stand = h * 0.6,
        tank = h - stand - 0.02;
      box(0, stand / 2, 0, w, stand, d, main);
      box(0, stand / 2, d / 2 + 0.006, w * 0.94, stand - 0.06, 0.012, main);
      box(0, stand + tank / 2, 0, w, tank, d, glass, false);
      box(
        0,
        stand + tank * 0.42,
        0,
        w - 0.02,
        tank * 0.82,
        d - 0.02,
        finish('#7fb2c0', 0.1, {
          transparent: true,
          opacity: ghost ? 0.1 : 0.35,
          depthWrite: false,
        }),
        false,
      );
      box(0, stand + 0.02, 0, w - 0.02, 0.03, d - 0.02, finish('#d9ccb4', 1), false);
      box(0, h - 0.01, 0, w, 0.02, d, dark);
      foliage(4, stand + 0.06, stand + tank * 0.5, w * 0.3, d * 0.2, [0.03, tank * 0.4, 0.03]);
      break;
    }
    case 'bird_cage': {
      const standH = h > 1.2 ? h * 0.5 : 0,
        cageH = h - standH,
        r = Math.min(w, d) * 0.45;
      if (standH) {
        cylinder(w * 0.4, w * 0.45, 0.03, 0.015, dark);
        rod(0.015, standH, 0, standH / 2, 0, dark);
      }
      cylinder(r, r, 0.04, standH + 0.02, main);
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI * 2) / 16;
        rod(
          0.004,
          cageH * 0.75,
          Math.sin(a) * r * 0.95,
          standH + cageH * 0.4,
          Math.cos(a) * r * 0.95,
          metal,
        );
      }
      const dome = shadow(
        new T.Mesh(new T.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass),
      );
      dome.position.set(0, standH + cageH * 0.77, 0);
      dome.scale.y = (cageH * 0.23) / r;
      ring(r * 0.95, 0.006, 0, standH + cageH * 0.77, 0, metal, 'y');
      ring(0.03, 0.005, 0, h - 0.02, 0, metal, 'z');
      break;
    }
    case 'small_pet_cage': {
      const tray = Math.min(0.12, h * 0.35);
      box(0, tray / 2, 0, w, tray, d, main);
      box(0, tray + (h - tray) / 2, 0, w, h - tray, d, glass);
      for (let x = -w / 2; x <= w / 2 + 0.001; x += 0.03)
        box(x, tray + (h - tray) / 2, d / 2, 0.003, h - tray, 0.003, metal, false);
      box(0, tray - 0.01, 0, w - 0.03, 0.02, d - 0.03, finish('#e3d6b8', 1), false);
      break;
    }
    // 아이
    case 'crib': {
      const bed = h * 0.45;
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(x * (w / 2 - 0.025), h / 2, z * (d / 2 - 0.025), 0.05, h, 0.05, wood, false);
      box(0, bed, 0, w - 0.06, 0.05, d - 0.06, wood);
      box(0, bed + 0.06, 0, w - 0.08, 0.08, d - 0.08, linen);
      for (const z of [-1, 1])
        box(0, h - 0.02, z * (d / 2 - 0.025), w - 0.05, 0.04, 0.04, wood, false);
      for (const x of [-1, 1])
        box(x * (w / 2 - 0.025), h - 0.02, 0, 0.04, 0.04, d - 0.05, wood, false);
      for (let z = -d / 2 + 0.08; z < d / 2 - 0.05; z += 0.07)
        for (const x of [-1, 1])
          box(x * (w / 2 - 0.025), (bed + h) / 2, z, 0.02, h - bed, 0.02, wood, false);
      for (let x = -w / 2 + 0.08; x < w / 2 - 0.05; x += 0.07)
        for (const z of [-1, 1])
          box(x, (bed + h) / 2, z * (d / 2 - 0.025), 0.02, h - bed, 0.02, wood, false);
      break;
    }
    case 'bumper_bed': {
      const mat = h * 0.35,
        t = 0.12;
      box(0, mat / 2, 0, w, mat, d, linen);
      box(0, h / 2, -d / 2 + t / 2, w, h, t);
      for (const x of [-1, 1]) box(x * (w / 2 - t / 2), h / 2, t / 2, t, h, d - t);
      box(0, mat + 0.04, -d * 0.36, w * 0.4, 0.08, d * 0.12, linen);
      break;
    }
    case 'changing_table': {
      box(0, (h - 0.12) / 2, 0, w, h - 0.12, d, wood);
      for (let i = 0; i < 3; i++) {
        const y = 0.06 + ((h - 0.2) * (i + 0.5)) / 3;
        box(0, y, d / 2 + 0.006, w * 0.94, (h - 0.2) / 3 - 0.014, 0.012, main);
        box(0, y, d / 2 + 0.02, w * 0.2, 0.014, 0.014, dark, false);
      }
      box(0, h - 0.09, 0, w * 0.9, 0.06, d * 0.85, linen);
      box(0, h - 0.05, -d / 2 + 0.02, w, 0.1, 0.03, wood, false);
      for (const x of [-1, 1]) box(x * (w / 2 - 0.015), h - 0.05, 0, 0.03, 0.1, d, wood, false);
      break;
    }
    case 'kids_desk':
      box(0, h - 0.02, 0, w, 0.04, d);
      legs(h - 0.04, 0.04, wood);
      box(0, h + 0.08, -d / 2 + 0.02, w, 0.16, 0.03, main, false);
      break;
    case 'toy_storage': {
      for (const x of [-1, 1]) box(x * (w / 2 - 0.015), h / 2, 0, 0.03, h, d, wood);
      const rows = h > 0.7 ? 3 : 2,
        cols = Math.max(2, Math.round(w / 0.3)),
        colors = [main, finish('#c99a3c', 0.8), finish('#8495a5', 0.8), finish('#bc8065', 0.8)];
      for (let r = 0; r <= rows; r++)
        box(0, 0.015 + ((h - 0.03) * r) / rows, 0, w - 0.06, 0.03, d, wood);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const bw = (w - 0.06) / cols,
            bh = (h - 0.03) / rows;
          box(
            -w / 2 + 0.03 + bw * (c + 0.5),
            0.03 + bh * r + bh * 0.4,
            0.02,
            bw - 0.03,
            bh * 0.75,
            d - 0.06,
            colors[(r + c) % 4],
          );
        }
      break;
    }
    case 'high_chair': {
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          const leg = box(x * w * 0.36, h * 0.3, z * d * 0.34, 0.03, h * 0.62, 0.03, wood, false);
          leg.rotation.z = x * 0.12;
          leg.rotation.x = -z * 0.12;
        }
      box(0, h * 0.58, 0, w * 0.6, 0.04, d * 0.5);
      box(0, h * 0.8, -d * 0.24, w * 0.6, h * 0.4, 0.04);
      for (const x of [-1, 1]) box(x * w * 0.3, h * 0.68, 0, 0.03, h * 0.2, d * 0.45, main, false);
      box(0, h * 0.72, d * 0.3, w * 0.75, 0.03, d * 0.3, linen);
      box(0, h * 0.25, d * 0.28, w * 0.55, 0.025, 0.06, wood, false);
      break;
    }
    // 운동·취미
    case 'treadmill': {
      const deck = 0.2;
      box(0, deck / 2, d * 0.05, w, deck, d * 0.9, dark);
      box(0, deck + 0.003, d * 0.05, w * 0.7, 0.006, d * 0.82, finish('#2a2c2e', 0.9), false);
      for (const x of [-1, 1]) {
        const post = box(x * (w / 2 - 0.04), h * 0.55, -d * 0.38, 0.05, h * 0.9, 0.06, main, false);
        post.rotation.x = 0.12;
        box(x * (w / 2 - 0.04), h * 0.82, -d * 0.22, 0.04, 0.04, d * 0.3, main, false);
      }
      const panel = box(0, h - 0.06, -d * 0.43, w * 0.8, 0.12, 0.25, main);
      panel.rotation.x = 0.5;
      break;
    }
    case 'exercise_bike': {
      box(0, 0.025, 0, w, 0.05, 0.06, dark, false);
      box(0, 0.025, 0, 0.06, 0.05, d, dark, false);
      const fly = cylinder(h * 0.2, h * 0.2, 0.05, h * 0.25, main, 0, d * 0.28);
      fly.rotation.z = Math.PI / 2;
      const frame = box(0, h * 0.4, 0, 0.06, h * 0.7, 0.06, main, false);
      frame.rotation.x = -0.35;
      box(0, h * 0.68, -d * 0.18, w * 0.4, 0.07, 0.25, dark);
      const bar = box(0, h * 0.62, d * 0.32, 0.05, h * 0.55, 0.05, main, false);
      bar.rotation.x = 0.2;
      rod(0.02, w * 0.75, 0, h * 0.9, d * 0.38, dark, 'x');
      break;
    }
    case 'rowing': {
      box(0, h * 0.35, 0, 0.1, 0.05, d * 0.85, metal);
      for (const z of [-1, 1]) box(0, h * 0.17, z * d * 0.4, w, 0.04, 0.06, dark, false);
      for (const z of [-1, 1]) box(0, h * 0.18, z * d * 0.4, 0.06, h * 0.35, 0.06, dark, false);
      box(0, h * 0.42, -d * 0.05, w * 0.6, 0.06, 0.3, main);
      const fly = cylinder(h * 0.4, h * 0.4, 0.12, h * 0.45, main, 0, d * 0.4);
      fly.rotation.x = Math.PI / 2;
      for (const x of [-1, 1]) {
        const foot = box(x * 0.1, h * 0.38, d * 0.25, 0.12, 0.03, 0.26, dark, false);
        foot.rotation.x = -0.8;
      }
      rod(0.015, w * 0.8, 0, h * 0.7, d * 0.32, dark, 'x');
      break;
    }
    case 'dumbbell_rack': {
      for (const x of [-1, 1]) {
        const side = box(x * (w / 2 - 0.02), h / 2, 0, 0.04, h, 0.04, dark, false);
        side.rotation.x = 0.15;
        box(x * (w / 2 - 0.02), 0.02, 0, 0.04, 0.04, d, dark, false);
      }
      for (const [y, z] of [
        [h * 0.45, d * 0.15],
        [h * 0.85, -d * 0.1],
      ]) {
        box(0, y, z, w - 0.04, 0.025, d * 0.45, dark, false);
        for (let x = -w / 2 + 0.1; x < w / 2 - 0.05; x += 0.14) {
          rod(0.012, d * 0.3, x, y + 0.04, z, metal, 'z');
          for (const s of [-1, 1]) rod(0.035, 0.04, x, y + 0.04, z + s * d * 0.12, main, 'z');
        }
      }
      break;
    }
    case 'pull_up': {
      for (const x of [-1, 1]) {
        box(x * (w / 2 - 0.03), h / 2, 0, 0.05, h, 0.05, main, false);
        box(x * (w / 2 - 0.03), 0.02, 0, 0.06, 0.04, d, main, false);
        const brace = box(x * (w / 2 - 0.03), h * 0.25, d * 0.25, 0.04, h * 0.5, 0.04, main, false);
        brace.rotation.x = 0.5;
      }
      rod(0.016, w, 0, h - 0.03, -0.1, dark, 'x');
      for (const x of [-1, 1])
        box(x * (w / 2 - 0.12), h * 0.45, 0.15, 0.18, 0.03, 0.2, dark, false);
      break;
    }
    case 'bicycle': {
      const r = h * 0.33,
        wz = d / 2 - r,
        tire = finish('#2a2c2e', 0.9);
      for (const z of [-wz, wz]) {
        ring(r, 0.02, 0, r, z, tire, 'x');
        rod(0.004, r * 2, 0, r, z, metal, 'z');
      }
      const frame = (y1, z1, y2, z2) => {
        const len = Math.hypot(y2 - y1, z2 - z1),
          bar = box(0, (y1 + y2) / 2, (z1 + z2) / 2, 0.03, len, 0.03, main, false);
        bar.rotation.x = Math.atan2(z2 - z1, y2 - y1);
      };
      frame(r, -wz * 0.1, h * 0.72, -wz * 0.3);
      frame(r, -wz * 0.1, h * 0.7, wz * 0.55);
      frame(h * 0.72, -wz * 0.3, h * 0.72, wz * 0.55);
      frame(r, -wz, h * 0.72, -wz * 0.3);
      frame(r, wz, h * 0.9, wz * 0.6);
      box(0, h * 0.78, -wz * 0.35, 0.08, 0.04, 0.2, dark, false);
      rod(0.012, w, 0, h * 0.92, wz * 0.62, dark, 'x');
      break;
    }
  }
  function screenMat() {
    return finish('#2c3236', 0.25);
  }
  function metalBody() {
    return finish(k.item.color, 0.4, { metalness: 0.3 });
  }
}
