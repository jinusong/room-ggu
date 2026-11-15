import * as T from 'three';
import { avatarLayout, LIMBS, BODY } from './avatar.js';

// 건축 모형에 세우는 축척 인형처럼 단순한 관절 모형. 관절 좌표는 avatar.js가 정한다.
const UP = new T.Vector3(0, 1, 0);
export function avatarModel(state) {
  const a = avatarLayout(state),
    group = new T.Group();
  if (!a) return group;
  const mat = new T.MeshStandardMaterial({ color: '#667669', roughness: 0.85 });
  const add = (mesh) => {
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const ball = (p, x, y = x, z = x) => {
    const mesh = add(new T.Mesh(new T.SphereGeometry(1, 18, 12), mat));
    mesh.scale.set(x, y, z);
    mesh.position.fromArray(p);
    return mesh;
  };
  const bone = (from, to, r1, r2 = r1, flat = 1) => {
    const start = new T.Vector3(...from),
      delta = new T.Vector3(...to).sub(start),
      mesh = add(new T.Mesh(new T.CylinderGeometry(r2, r1, delta.length(), 16), mat));
    mesh.position.copy(start).addScaledVector(delta, 0.5);
    if (flat === 1) mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
    else {
      // 몸통은 좌우로 넓고 앞뒤로 얇다. 척추는 항상 몸의 y–z 평면 안에 있다.
      mesh.scale.z = flat;
      mesh.rotation.x = Math.atan2(delta.z, delta.y);
    }
    return mesh;
  };
  const j = a.joints,
    h = a.h,
    B = BODY;
  ball(j.head, h * B.headRadius * 0.88, h * B.headRadius, h * B.headRadius * 0.95);
  bone(j.shoulder, j.head, h * 0.028);
  bone(j.hip, j.shoulder, h * 0.1, h * 0.135, 0.56);
  const hips = ball(j.hip, h * 0.108, h * 0.07, h * 0.068);
  const chest = ball(j.shoulder, h * 0.135, h * 0.05, h * 0.075);
  hips.rotation.x = chest.rotation.x = Math.atan2(
    j.shoulder[2] - j.hip[2],
    j.shoulder[1] - j.hip[1],
  );
  for (const [from, to] of LIMBS) {
    const leg = from.includes('Hip') || from.includes('Knee');
    const r1 =
      h * (from.includes('Hip') ? 0.042 : leg ? 0.034 : from.includes('Shoulder') ? 0.027 : 0.022);
    bone(j[from], j[to], r1, r1 * 0.82);
    ball(j[from], r1);
    if (!leg && to.includes('Hand')) ball(j[to], h * 0.024);
  }
  for (const side of ['left', 'right']) {
    const foot = j[side + 'Foot'];
    ball(foot, h * 0.03);
    bone(foot, j[side + 'Toe'], h * 0.03, h * 0.022);
    ball(j[side + 'Toe'], h * 0.022);
  }
  group.position.set(a.x, 0, a.z);
  group.rotation.y = (a.angle * Math.PI) / 180;
  group.userData.avatar = true;
  return group;
}
