// 줄자 라벨. 3D 장면과 2D 도면, UI가 같은 모양을 쓴다. three에 의존하지 않는다.
export const PAPER = '#efede7';
const TAPE = '#f2c94c';
const tapes = new Map();
export function tapeCanvas(text, { fill = TAPE, ink = '#2b2306', dashed = false } = {}) {
  const key = `${text}|${fill}|${dashed}`;
  if (tapes.has(key)) return tapes.get(key);
  const c = document.createElement('canvas'),
    g = c.getContext('2d'),
    font = '500 30px "JetBrains Mono", ui-monospace, monospace';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w;
  c.height = 52;
  g.font = font;
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(2, 2, w - 4, 48, 8);
  g.fill();
  if (dashed) {
    g.setLineDash([6, 5]);
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.stroke();
  }
  g.fillStyle = 'rgba(43,35,6,0.35)';
  for (let x = 10; x < w - 8; x += 12) g.fillRect(x, 4, 1.5, x % 60 === 10 ? 10 : 6);
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, 30);
  const out = { canvas: c, aspect: w / 52 };
  tapes.set(key, out);
  return out;
}
export function clearTapes() {
  tapes.clear();
}
