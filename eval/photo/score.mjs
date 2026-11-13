// 사진 판별 결과를 앱과 같은 기준(photoCandidates + PHOTO_CONFIDENT)으로 채점한다.
// 사용: node eval/photo/score.mjs results/siglip-gpu.json [--split test] [--errors]
import fs from 'node:fs';
import path from 'node:path';
import { photoCandidates, PHOTO_CONFIDENT } from '../../src/app/photo.js';

const dir = path.dirname(new URL(import.meta.url).pathname);
const file = process.argv[2] || 'results/siglip-gpu.json';
const i = process.argv.indexOf('--split');
const split = i > 0 ? process.argv[i + 1] : '';
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).filter(
  (r) => !split || r.split === split,
);
const res = JSON.parse(fs.readFileSync(path.resolve(dir, file), 'utf8'));
const out = rows
  .filter((r) => res[r.file]?.raw?.scores)
  .map((r) => {
    const c = photoCandidates(res[r.file].raw.scores);
    const sure = c[0].p >= PHOTO_CONFIDENT;
    const top1 = c[0].type === r.label;
    const top3 = c.some((x) => x.type === r.label);
    return {
      ...r,
      c,
      top1,
      top3,
      outcome: sure ? (top1 ? '초안 맞음' : '초안 틀림') : top3 ? '후보에서 고름' : '후보에 없음',
      ms: res[r.file].ms,
    };
  });
const n = out.length;
const pct = (k) => `${k}/${n} (${Math.round((k / n) * 1000) / 10}%)`;
console.log(`n=${n}${split ? ` · ${split}` : ''}`);
console.log(`1순위 정답 ${pct(out.filter((x) => x.top1).length)} · 상위 3개 안 ${pct(out.filter((x) => x.top3).length)}`);
for (const o of ['초안 맞음', '초안 틀림', '후보에서 고름', '후보에 없음'])
  console.log(`  ${o} ${pct(out.filter((x) => x.outcome === o).length)}`);
const ms = out.map((x) => x.ms).sort((a, b) => a - b);
console.log(`사진 1장 중앙값 ${ms[Math.floor(n / 2)]}ms`);
if (process.argv.includes('--errors'))
  for (const x of out.filter((x) => x.outcome !== '초안 맞음'))
    console.log(`${x.outcome} ${x.file} → ${x.c.map((c) => `${c.type} ${Math.round(c.p * 100)}%`).join(', ')}`);
