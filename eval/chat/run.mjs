// 실제 앱에서 기본으로 켜지는 상담 모델(Gemma)에 문장 18개를 차례로 보내고, 턴마다
// 모델이 해석했는지·앱이 무엇을 바로잡았는지·상태가 어떻게 바뀌었는지 기록한다.
// 먼저 `npm run dev`를 띄운다. 처음 한 번 모델을 내려받는다(Gemma 3 1B 약 570MB, Gemma 4 E2B 약 2.7GB).
// 사용: [MODEL=light|large] [HEADLESS=1] node eval/chat/run.mjs [http://127.0.0.1:5173/] [results/name.json]
// MODEL은 앱의 상담 모델 선택(light: Gemma 3 1B, large: Gemma 4 E2B)이다. HEADLESS=1이면 창을 띄우지 않는다.
// F16=off이면 Worker 스크립트의 shader-f16 확인을 거짓으로 바꿔, f16이 없는 GPU에서 고르는 f32 모델 경로를 실행한다.
// SCENARIO=repair이면 화장실 하나만 있는 집에서 시작해, 실제 대화에서 틀렸던 문장들(자리를 가리킨 공간 이름,
// 따지는 말, 한 문장의 방·가구 여럿, 겹침, 방 돌리기)을 차례로 보낸다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.argv[2] || 'http://127.0.0.1:5173/';
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
// 2026-11-16의 실제 대화를 그대로 옮긴 문장들과 그 변형.
const REPAIR_PROMPTS = [
  '화장실 옆에 방하나 추가하자. 거기는 거실임',
  '왜 화장실로 생성하는거야',
  '거실이라고 그리고 거기에 소파랑 밥먹을 수 있는 식탁이 있었으면 좋겠어. 거실 평수는 대략 6평정도야',
  '둘 다 놓아줘',
  '아니 거실이라니까 왜 자꾸 화장실로 고정하냐고!!!!',
  '거실로 바꿨는데 겹치잖아...',
  '이 방 90도 돌려줘',
  '거실 말고 침실로 바꿔줘',
  '침실 옆에 서재 하나 붙여줘',
  '책상이랑 의자 놓고 싶어',
  '방 하나 더 만들어줘',
  '아니 그게 아니라',
  '방 초기화할래',
];
const SCENARIO = process.env.SCENARIO === 'repair' ? 'repair' : 'basic';
const BATHROOM_HOME = {
  version: 5,
  roomId: 'bath',
  roomOrder: ['bath'],
  otherRooms: [],
  name: '나의 화장실',
  room: { type: 'bathroom', w: 1.8, d: 2.2, h: 2.4, wallColor: '#faf9f5', floorColor: '#dce1dc' },
  items: [],
  scope: 'house',
  view: '3d',
  floorplan: { positions: { bath: { x: 0, z: 0 } } },
};
const MODEL = process.env.MODEL === 'light' ? 'light' : 'large';
// 모델이 켜진 상태에서도 앱이 직접 처리하는 키·자세·집 전체 명령. 18문장 뒤에 이어서 보낸다.
const APP_PROMPTS = [
  '예시 방 불러와줘',
  '내 키 175cm로 침대에 눕혀줘',
  '의자에 앉혀줘',
  '일으켜줘',
  '집 전체를 3D로 보여줘',
  '아바타 숨겨줘',
];
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: process.env.HEADLESS === '1', viewport: { width: 1440, height: 900 }, args: ['--enable-unsafe-webgpu'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
// F32_MODEL을 주면 가벼운 모델의 f32 후보(Qwen3 0.6B) 자리에 다른 WebLLM 모델 id를 넣어 같은 문장으로 견준다.
const F32_DEFAULT = 'Qwen3-0.6B-q4f32_1-MLC';
if (process.env.F16 === 'off')
  await ctx.route(/(ai-worker|index)[^/]*\.js(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const text = await res.text();
    let body = text.replace(/features\.has\((["'])shader-f16\1\)/g, 'features.has("shader-f16-off")');
    if (process.env.F32_MODEL) body = body.replaceAll(F32_DEFAULT, process.env.F32_MODEL);
    if (body !== text) console.log('f16 off: patched', route.request().url().split('/').pop());
    await route.fulfill({ response: res, body });
  });
// 모델마다 같은 예시 방에서 시작하도록 처음 한 번 저장된 배치와 대화를 지운다.
await page.addInitScript(
  ([choice, seed]) => {
    try {
      localStorage.setItem('room-ggu-model-choice', choice);
      localStorage.removeItem('room-ggu-model');
      if (!sessionStorage.getItem('eval-reset')) {
        if (seed) localStorage.setItem('room-ggu-v2', JSON.stringify(seed));
        else localStorage.removeItem('room-ggu-v2');
        localStorage.removeItem('room-ggu-thread-v1');
        sessionStorage.setItem('eval-reset', '1');
      }
    } catch {}
  },
  [MODEL, SCENARIO === 'repair' ? BATHROOM_HOME : null],
);
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(BASE);
await page.waitForFunction(() => window.__roomggu?.ready(), null, { timeout: 60000 });
if (await page.getByRole('button', { name: '새 대화' }).count()) {
  await page.getByRole('button', { name: '새 대화' }).click();
  await page.getByRole('button', { name: '대화 지우기' }).click();
}
const t0 = Date.now();
const status0 = await page.evaluate(() => window.__roomggu.app.ai.text);
// 모델을 받거나 준비하는 동안 위쪽 아일랜드가 뜬다. 처음 받을 때는 펼쳐진 채 나타난다. 화면을 남긴다.
const island = page.locator('#model-island');
const seen = await island.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
if (seen) {
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({ ...window.__roomggu.app.ai.download, open: window.__roomggu.app.view.downloadOpen }));
  console.log('island', JSON.stringify(info));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
}
// 준비가 끝나거나 실패할 때까지 기다린다. 받은 양이 3분 넘게 늘지 않으면 멈춘 것으로 본다.
let lastMb = null,
  lastAt = Date.now(),
  logged = 0;
for (;;) {
  const s = await page.evaluate(() => ({ text: window.__roomggu?.app.ai.text, mb: window.__roomggu?.app.ai.download?.mb ?? null }));
  if (['ready', 'error', 'unsupported', 'off'].includes(s.text)) break;
  if (s.mb !== lastMb) {
    lastMb = s.mb;
    lastAt = Date.now();
    if (s.mb !== null && s.mb - logged >= 300) console.log('downloaded', (logged = s.mb), 'MB');
  } else if (Date.now() - lastAt > 180e3) throw Error(`모델 준비가 멈췄어요 (${s.mb}MB에서 3분간 변화 없음)`);
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(500);
console.log('island after ready', await island.count() ? await page.locator('#island-toggle').textContent() : 'gone');
const ai = await page.evaluate(() => ({ ...window.__roomggu.app.ai }));
console.log('model', status0, '→', ai.text, ai.model, Date.now() - t0, 'ms', ai.error || '');
const results = [];
const only = process.env.ONLY === 'app' ? [] : PROMPTS;
for (const prompt of SCENARIO === 'repair' ? REPAIR_PROMPTS : [...only, ...APP_PROMPTS]) {
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
      house: [{ name: s.name, room: s.room }, ...(s.otherRooms || [])].map((r) => `${r.name}[${r.room.type} ${r.room.w}x${r.room.d}]`).join(' | '),
      queue: (app.queue || []).map((q) => q.type).join(','),
      avatar: s.avatar.enabled ? `${s.avatar.height}cm ${s.avatar.pose}` : 'off', scope: `${s.scope} ${s.view}`,
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
