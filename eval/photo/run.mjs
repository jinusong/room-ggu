// 앱의 사진 경로(imageData → Worker의 SigLIP 분류)를 평가 사진마다 실행하고 점수를 저장한다.
// 먼저 `npm run dev`를 띄우고 fetch-images.mjs로 사진을 받는다. WebGPU를 쓰려면 Chrome 창이 열린다.
// 사용: node eval/photo/run.mjs [--device webgpu|wasm] [--url http://127.0.0.1:5173/] [--out results/name.json] [--only test]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const device = arg('device', 'webgpu');
const url = arg('url', 'http://127.0.0.1:5173/');
const only = arg('only', '');
const out = path.resolve(dir, arg('out', `results/siglip-${device === 'wasm' ? 'cpu' : 'gpu'}.json`));
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).filter(
  (r) => !only || r.split === only || r.label === only,
);
const done = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};

// 모델 캐시를 유지하려고 고정된 프로필을 쓴다(.cache/는 .gitignore).
const ctx = await chromium.launchPersistentContext(path.join(dir, '../../.cache/photo-eval-profile'), {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1200, height: 800 },
  args: ['--enable-unsafe-webgpu'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
// 상담 모델 자동 준비를 끄고 사진 모델만 잰다.
await page.goto(new URL('?model=off', url).href);
await page.waitForFunction(() => window.__roomggu?.ready(), null, { timeout: 60000 });

const once = (b64) =>
  page.evaluate(
    async ({ b64, device }) => {
      const { runAI, imageData } = await import('/src/ai.js');
      const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob();
      const data = await imageData(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      const t0 = performance.now();
      const raw = await runAI('classify', { image: data, device });
      return { raw, ms: Math.round(performance.now() - t0) };
    },
    { b64, device },
  );
// 개발 서버가 Worker 의존성을 처음 묶을 때 페이지를 한 번 새로 고칠 수 있다.
async function run(file) {
  const b64 = fs.readFileSync(path.join(dir, 'images', file)).toString('base64');
  for (let i = 0; ; i++) {
    try {
      return await once(b64);
    } catch (e) {
      if (i >= 3 || !/context was destroyed|navigation/i.test(e.message)) throw e;
      await page.waitForLoadState('load');
      await page.waitForFunction(() => window.__roomggu?.ready(), null, { timeout: 60000 });
    }
  }
}

const warm = await run(rows[0].file);
console.log(`모델 준비 포함 첫 실행 ${warm.ms}ms`);
for (const r of rows) {
  if (done[r.file]) continue;
  try {
    done[r.file] = await run(r.file);
  } catch (e) {
    done[r.file] = { error: String(e.message || e).slice(0, 300) };
  }
  const top = done[r.file].raw?.scores?.slice().sort((a, b) => b.score - a.score)[0];
  console.log(r.file, done[r.file].ms ?? '', top ? top.type : done[r.file].error);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(done, null, 1) + '\n');
}
await ctx.close();
