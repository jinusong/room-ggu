import * as T from 'three';
import { TYPES, makeItem } from './data.js';
import { furniture, disposeGroup } from './furniture.js';
let previews;
export function furniturePreviews() {
  if (previews) return previews;
  previews = new Map();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(280, 210);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  try {
    const scene = new T.Scene();
    scene.background = new T.Color('#f0f2ea');
    scene.add(new T.HemisphereLight('#ffffff', '#acb49a', 2));
    const light = new T.DirectionalLight('#fff4de', 3);
    light.position.set(3, 5, 4);
    scene.add(light);
    const camera = new T.PerspectiveCamera(34, 4 / 3, 0.01, 50);
    for (const [type, definition] of Object.entries(TYPES)) {
      const item = makeItem(type);
      item.color = {
        living: '#a5af8e',
        bedroom: '#b8a48b',
        work: '#a6ac95',
        dining: '#b5a084',
        storage: '#aaa184',
        decor: '#a3b084',
        appliance: '#bbc2bd',
      }[definition.category];
      const mesh = furniture(item);
      scene.add(mesh);
      const size = new T.Vector3(),
        center = new T.Vector3();
      new T.Box3().setFromObject(mesh).getSize(size);
      new T.Box3().setFromObject(mesh).getCenter(center);
      const span = Math.max(size.x, size.y, size.z),
        distance = span * 2.5;
      camera.position
        .copy(center)
        .add(new T.Vector3(1, 0.75, 1.15).normalize().multiplyScalar(distance));
      camera.lookAt(center);
      renderer.render(scene, camera);
      previews.set(type, renderer.domElement.toDataURL('image/webp', 0.85));
      scene.remove(mesh);
      disposeGroup(mesh);
    }
    return previews;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
