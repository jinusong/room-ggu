import * as T from 'three';
import { avatarLayout, LIMBS } from './avatar.js';

export function avatarModel(state) {
  const a = avatarLayout(state),
    group = new T.Group();
  if (!a) return group;
  const mat = new T.MeshStandardMaterial({ color: '#667669', roughness: 0.85 });
  const sphere = (p, sx, sy = sx, sz = sx) => {
    const mesh = new T.Mesh(new T.SphereGeometry(1, 16, 12), mat);
    mesh.scale.set(sx, sy, sz);
    mesh.position.fromArray(p);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const bone = (from, to, radius) => {
    const start = new T.Vector3(...from),
      end = new T.Vector3(...to),
      delta = end.clone().sub(start);
    const mesh = new T.Mesh(new T.CylinderGeometry(radius * 0.82, radius, delta.length(), 12), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true;
    group.add(mesh);
  };
  const j = a.joints,
    h = a.h;
  sphere(j.head, h * 0.06, h * 0.06, h * 0.055);
  const mid = j.hip.map((v, i) => (v + j.shoulder[i]) / 2);
  const torso = sphere(mid, h * 0.13, h * 0.17, h * 0.075);
  if (a.pose === 'lying') torso.rotation.x = -Math.PI / 2;
  bone(j.shoulder, j.head, h * 0.035);
  for (const [from, to] of LIMBS) {
    const rad = h * (from.includes('Hip') || from.includes('Knee') ? 0.035 : 0.024);
    bone(j[from], j[to], rad);
    sphere(j[to], rad);
  }
  group.position.set(a.x, 0, a.z);
  group.rotation.y = (a.angle * Math.PI) / 180;
  group.userData.avatar = true;
  return group;
}
