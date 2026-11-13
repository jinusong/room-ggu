// 평가 사진을 manifest.json의 원본 주소에서 내려받는다. 사진은 저장소에 넣지 않는다(images/는 .gitignore).
// 사용: node eval/photo/fetch-images.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
let ok = 0;
for (const r of rows) {
  const file = path.join(dir, 'images', r.file);
  if (fs.existsSync(file)) {
    ok++;
    continue;
  }
  try {
    const res = await fetch(r.source, { headers: { 'User-Agent': 'furniture-photo-eval/1.0' } });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    ok++;
  } catch (e) {
    console.log('실패', r.file, e.message, r.page);
  }
  await new Promise((done) => setTimeout(done, 800));
}
console.log(`${ok}/${rows.length}장 준비`);
