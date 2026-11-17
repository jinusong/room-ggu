// 실제 Qwen3로 확장 가구 어휘를 확인한다. 규칙 대체는 모델 성공으로 세지 않는다.
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.argv[2] || 'http://127.0.0.1:4173/';
const output = 'eval/chat/results/review-v5.10-qwen.json';
const ctx = await chromium.launchPersistentContext('.cache/review-model', {
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu'],
  viewport: { width: 1440, height: 900 },
});
const result = { at: new Date().toISOString(), base, model: 'qwen', results: [], errors: [] };
const page = ctx.pages()[0] || (await ctx.newPage());
page.on('pageerror', (e) => result.errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('room-ggu-model-choice', 'qwen');
  localStorage.removeItem('room-ggu-model');
  localStorage.removeItem('room-ggu-v2');
  localStorage.removeItem('room-ggu-thread-v1');
});
try {
  await page.goto(base);
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.waitForFunction(
    () => ['ready', 'error', 'unsupported'].includes(window.__roomggu.app.ai.text),
    null,
    { timeout: 240000 },
  );
  result.ai = await page.evaluate(() => {
    const a = window.__roomggu.app.ai;
    return { text: a.text, model: a.model, error: a.error };
  });
  if (result.ai.text === 'ready')
    for (const [text, type] of [
      ['사무용 의자 하나 놓고 싶어', 'office_chair'],
      ['아일랜드 식탁 하나 놓아줘', 'island'],
      ['건조기 하나 놓아줘', 'dryer'],
      ['화장대 하나 놓아줘', 'vanity'],
      ['행거 하나 놓아줘', 'hanger'],
      ['디지털 피아노 하나 놓아줘', 'piano'],
    ]) {
      await page.evaluate(() => window.__roomggu.store.setTarget({ type: 'room' }));
      await page.locator('#chat-input').fill(text);
      await page.getByRole('button', { name: '설명 보내기' }).click();
      await page.waitForFunction(() => !window.__roomggu.app.busy, null, { timeout: 60000 });
      const row = await page.evaluate(() => {
        const a = window.__roomggu.app,
          t = a.thread.filter((t) => t.role === 'assistant').at(-1);
        return {
          engine: t.engine,
          fallback: t.fallback,
          fixes: t.fixes,
          draft: a.draft?.type,
          reply: t.text,
        };
      });
      result.results.push({
        text,
        expected: type,
        ...row,
        pass: row.engine === 'qwen' && row.draft === type,
      });
      console.log(JSON.stringify(result.results.at(-1)));
    }
} catch (e) {
  result.errors.push(e.message);
} finally {
  mkdirSync('eval/chat/results', { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  await ctx.close();
}
console.log(
  output,
  result.ai?.text,
  `${result.results.filter((r) => r.pass).length}/${result.results.length}`,
);
if (
  result.ai?.text !== 'ready' ||
  !result.results.length ||
  result.results.some((r) => !r.pass) ||
  result.errors.length
)
  process.exitCode = 1;
