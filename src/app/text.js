// 한국어 조사와 숫자 표기. 이름 끝 글자의 받침 유무로 을/를, 이/가, 은/는, 과/와, (으)로를 고른다.
const hasBatchim = (word) => {
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return /[0-9lmnr]$/i.test(ch) && !/[2459]$/.test(ch);
  return code % 28 !== 0;
};
const rieul = (word) => {
  const code = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 8;
};
export function josa(word, pair) {
  const [a, b] = pair.split('/');
  if (pair === '으로/로') return `${word}${hasBatchim(word) && !rieul(word) ? '으로' : '로'}`;
  return `${word}${hasBatchim(word) ? a : b}`;
}
export const area = (w, d) => `${(w * d).toFixed(1)}m²`;
export const pyeongText = (w, d) => `${((w * d) / 3.3058).toFixed(1)}평`;
export const dimsText = (dims) => `${dims[0]} × ${dims[2]} × ${dims[1]}`;
