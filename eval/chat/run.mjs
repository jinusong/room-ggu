// 실제 앱에서 기본으로 켜지는 상담 모델(Gemma)에 문장 18개를 차례로 보내고, 턴마다
// 모델이 해석했는지·앱이 무엇을 바로잡았는지·상태가 어떻게 바뀌었는지 기록한다.
// 먼저 `npm run dev`를 띄운다. WebGPU를 쓰려고 Chrome 창이 열리며, 처음 한 번 모델을 내려받는다.
// 사용: node eval/chat/run.mjs [http://127.0.0.1:5173/] [results/name.json]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const URL = process.argv[2] || 'http://127.0.0.1:5173/';
const OUT = path.resolve(dir, process.argv[3] || 'results/gemma.json');
const PROFILE = path.join(dir, '../../.cache/photo-eval-profile');
const PROMPTS = [
  '빈 방으로 시작할래',
  '거실 가로 5m 세로 4m',
  '벽은 세이지, 바닥은 월넛',
  '벽은 좀 더 따뜻한 느낌이면 좋겠어',
  '두 명이 앉는 낮은 소파',
  '앉는 부분이 깊었으면 좋겠어',
  '네이비로 바꿔줘',
  '방에 놓아줘',
  '90도 돌려줘',
  '책 읽을 때 푹 기대 앉을 만한 거 하나 놓고 싶어',
  '책상 가로 120cm 깊이 60cm',
  '책 읽는 아담한 방으로 꾸며줘',
  '침실 하나 추가해줘',
  '공간 목록 보여줘',
  '안녕, 여기서 뭘 할 수 있어?',
  '되돌려줘',
  '겹친 가구 있으면 정리해줘',
  '배치를 파일로 저장하고 싶어',
];
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 }, args: ['--enable-unsafe-webgpu'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL);
await page.waitForFunction(() => window.__roomggu?.ready(), null, { timeout: 60000 });
if (await page.getByRole('button', { name: '새 대화' }).count()) {
  await page.getByRole('button', { name: '새 대화' }).click();
  await page.getByRole('button', { name: '대화 지우기' }).click();
}
const t0 = Date.now();
const status0 = await page.evaluate(() => window.__roomggu.app.ai.text);
await page.waitForFunction(() => ['ready', 'error', 'unsupported'].includes(window.__roomggu.app.ai.text), null, { timeout: 5 * 60e3 });
const ai = await page.evaluate(() => ({ ...window.__roomggu.app.ai }));
console.log('model', status0, '→', ai.text, ai.model, Date.now() - t0, 'ms', ai.error || '');
const results = [];
for (const prompt of PROMPTS) {
  const start = Date.now();
  await page.locator('#chat-input').fill(prompt);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.waitForFunction(() => {
    const { app } = window.__roomggu;
    const t = [...app.thread].reverse().find((x) => x.role === 'assistant');
    return !app.busy && t && t.status === 'done';
  }, null, { timeout: 60000 });
  const r = await page.evaluate(() => {
    const { app } = window.__roomggu;
    const t = [...app.thread].reverse().find((x) => x.role === 'assistant');
    const s = app.state;
    return {
      engine: t.engine, fallback: t.fallback, fixes: t.fixes, text: t.text, note: t.note,
      surfaces: t.surfaces.map((x) => x.kind), receipt: t.receipt.map((x) => `${x.label}:${x.from ? x.from + '→' : ''}${x.to}${x.tag ? ' [' + x.tag + ']' : ''}`),
      room: `${s.name} ${s.room.type} ${s.room.w}x${s.room.d}x${s.room.h} wall ${s.room.wallColor} floor ${s.room.floorColor}`,
      draft: app.draft && `${app.draft.type} ${app.draft.dims.join('/')} ${app.draft.color} [${app.draft.sources.join(' | ')}]`,
      items: s.items.length, spaces: 1 + (s.otherRooms?.length || 0), target: app.target.type,
      label: document.querySelector('.msg.assistant:last-of-type .msg-meta')?.textContent,
    };
  });
  r.prompt = prompt;
  r.ms = Date.now() - start;
  results.push(r);
  console.log(JSON.stringify(r));
}
fs.writeFileSync(OUT, JSON.stringify({ ai, results, errors }, null, 1));
console.log('errors', errors.length, errors.slice(0, 5));
await ctx.close();
