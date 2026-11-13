// 사진 속 가구 종류는 SigLIP이 사진과 20가지 가구 이름을 비교해 고른다.
// 앱은 모델 점수를 확률로 바꾸고, 확신이 낮으면 초안을 만들지 않고 후보만 보여준다.
import { TYPES } from '../catalog.js';

export const PHOTO_MODEL = 'Xenova/siglip-base-patch16-224';
export const PHOTO_LABELS = [
  ['sofa', 'a sofa'],
  ['armchair', 'an armchair'],
  ['bed', 'a bed'],
  ['desk', 'a desk'],
  ['dining', 'a dining table'],
  ['chair', 'a chair'],
  ['coffee', 'a coffee table'],
  ['side', 'a nightstand'],
  ['tvstand', 'a TV stand'],
  ['wardrobe', 'a wardrobe'],
  ['dresser', 'a chest of drawers'],
  ['cabinet', 'a cabinet'],
  ['shelf', 'a bookshelf'],
  ['shoe_cabinet', 'a shoe rack'],
  ['bench', 'a bench'],
  ['rug', 'a rug'],
  ['lamp', 'a lamp'],
  ['plant', 'a potted plant'],
  ['fridge', 'a refrigerator'],
  ['washer', 'a washing machine'],
];
// dev 사진 60장에서 정한 값. 이 이상이면 1순위로 초안을 만들고, 아래면 후보만 보여준다.
export const PHOTO_CONFIDENT = 0.7;

// SigLIP은 이름마다 따로 시그모이드 점수를 낸다. 서로 비교할 수 있게 로짓으로 되돌려 softmax한다.
export function photoCandidates(raw) {
  const rows = (Array.isArray(raw) ? raw : []).filter(
    (r) => r && Object.hasOwn(TYPES, r.type) && Number.isFinite(r.score),
  );
  if (!rows.length) return [];
  const logits = rows.map((r) => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, r.score));
    return Math.log(p / (1 - p));
  });
  const top = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - top));
  const sum = ex.reduce((a, b) => a + b, 0);
  return rows
    .map((r, i) => ({ type: r.type, p: ex[i] / sum }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 3);
}
