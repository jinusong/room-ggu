import * as T from 'three';

// 낮춘 벽에서도 창의 실제 높이는 프레임으로 남긴다. 채광 계산은 하지 않는다.
export function windowModel(o) {
  const g = new T.Group();
  g.position.set(o.x, o.sill, o.z);
  if (o.vertical) g.rotation.y = Math.PI / 2;
  const frame = new T.MeshStandardMaterial({ color: '#f3f0e8', roughness: 0.65 });
  const glass = new T.MeshStandardMaterial({
    color: '#b6ced2',
    transparent: true,
    opacity: 0.34,
    roughness: 0.15,
    depthWrite: false,
    side: T.DoubleSide,
  });
  const add = (w, h, d, x, y, z, mat) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  add(o.width - 0.04, o.height - 0.04, 0.014, 0, o.height / 2, 0, glass);
  for (const x of [-o.width / 2 + 0.02, 0, o.width / 2 - 0.02])
    add(0.04, o.height, 0.11, x, o.height / 2, 0, frame);
  for (const y of [0.02, o.height - 0.02]) add(o.width, 0.04, 0.11, 0, y, 0, frame);
  g.userData.window = o.id;
  return g;
}
