// 모델은 이 목록의 UI만 선택할 수 있다. 값과 동작은 앱의 검증된 상태에 연결한다.
export const UI_SURFACES = {
  room: ['dimensions', 'types', 'finishes'],
  furniture: ['dimensions', 'sizes', 'colors'],
};
export function chooseSurface(text, scope) {
  if (scope === 'room') {
    if (/벽|바닥|마감|색상|색깔/.test(text)) return 'finishes';
    if (/가로|세로|천장|높이|평|m²|제곱|치수/.test(text)) return 'dimensions';
    return 'types';
  }
  if (/색상|색깔|색을|컬러/.test(text)) return 'colors';
  if (/가로|세로|깊이|높이|너비|치수|\d\s*(?:cm|mm|m)/i.test(text)) return 'dimensions';
  return 'sizes';
}
export function validateSurface(value, scope, fallback = 'dimensions') {
  const allowed = Object.hasOwn(UI_SURFACES, scope) ? UI_SURFACES[scope] : [];
  return allowed.includes(value) ? value : allowed.includes(fallback) ? fallback : 'dimensions';
}
