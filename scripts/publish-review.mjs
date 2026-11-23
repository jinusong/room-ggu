// am CLI가 만든 설명 페이지에서 로컬 작성용 도구만 걷어 낸다.
// 표 필터·도식 확대·출처와 라이선스 표시는 그대로 공개한다.
import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../public/review/index.html', import.meta.url);
let html = readFileSync(file, 'utf8');
for (const cls of ['am-toolbar', 'am-update']) {
  const start = html.search(new RegExp(`<div\\b[^>]*class="${cls}(?:[ "])[^>]*>`));
  if (start < 0) continue;
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m; (m = tags.exec(html)); ) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      html = html.slice(0, start) + html.slice(tags.lastIndex);
      break;
    }
  }
}
html = html.replace(/<button\b[^>]*class="[^"]*\bam-comment-btn\b[^"]*"[^>]*>[\s\S]*?<\/button>/g, '');
writeFileSync(file, html);
console.log('공개 보고서: 작성 도구 제거, 표·도식·출처 유지');
