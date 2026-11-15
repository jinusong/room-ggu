// 앉거나 눕는 기준면. furniture.js가 그리는 형상과 같은 비율이며 단위는 m다.
// 가구 로컬 좌표는 앞이 +z, 등받이·헤드보드가 -z 쪽이다. 실제 제품의 좌석 높이·깊이를 잰 값이 아니다.
export const SEATS = new Set(['chair', 'sofa', 'armchair', 'bench']);

export function seatSurface(item) {
  if (!item || !SEATS.has(item.type)) return null;
  const [w, h, d] = item.dims.map((n) => n / 100);
  if (item.type === 'chair') return { y: h * 0.55, back: -d * 0.41, front: d / 2, width: w };
  if (item.type === 'bench') return { y: h, back: null, front: d / 2, width: w };
  const arm = Math.min(0.16, w * 0.12);
  return { y: h * 0.52, back: -d * 0.3, front: d / 2, width: w - arm * 2 };
}

export function lyingSurface(item) {
  if (!item || item.type !== 'bed') return null;
  const [w, h, d] = item.dims.map((n) => n / 100);
  return {
    y: h * 0.895,
    pillowY: h * 0.98,
    pillow: [-d * 0.435, -d * 0.285],
    head: -d / 2 + 0.05,
    length: d - 0.05,
    width: w * 0.97,
  };
}
