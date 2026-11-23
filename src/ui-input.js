// 조합 확정 Enter와 실제 전송 Enter를 구별한다. Safari의 229 코드도 포함한다.
export const isComposingKey = (event) => event.isComposing || event.keyCode === 229;

export function parseStepperValue(text, min, max) {
  const raw = String(text).trim();
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
