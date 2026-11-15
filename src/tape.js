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

// 화면 위 이름표(방 이름·키)를 저장하는 이미지에도 같은 자리에 그린다.
const TAG_STYLE = {
  room: { fill: '#fbfaf7', ink: '#1f1d19', line: 'rgba(31,29,25,0.2)' },
  selected: { fill: '#1f1d19', ink: '#fbfaf7' },
  set: { fill: TAPE, ink: '#3b2f05' },
  draft: { fill: '#fbfaf7', ink: '#545049', line: '#716d64', dashed: true },
};
export function drawTags(g, tags = []) {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const t of tags) {
    const style = TAG_STYLE[t.kind] || TAG_STYLE.room;
    g.beginPath();
    g.roundRect(t.x, t.y, t.w, t.h, Math.min(8, t.h / 2));
    g.fillStyle = style.fill;
    g.fill();
    if (style.line) {
      g.setLineDash(style.dashed ? [4, 3] : []);
      g.strokeStyle = style.line;
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = style.ink;
    g.font = `500 ${t.size || 12}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
    g.fillText(t.text, t.x + t.w / 2, t.y + t.h / 2 + 0.5, t.w - 8);
  }
  g.restore();
}
