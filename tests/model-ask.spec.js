import { test, expect } from '@playwright/test';

// 휴대 기기에서는 상담 모델(약 2.8GB)을 받기 전에 먼저 묻는다. 누르기 전에는 모델 파일을 요청하지 않는다.
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const MODEL_HOSTS = /huggingface\.co|hf\.co|xethub|raw\.githubusercontent\.com/;
// WebGPU가 있는 기기처럼 보이게 한다. 실제 모델 파일은 아래에서 막는다.
const gpu = () =>
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) },
    configurable: true,
  });
const ready = (page) => page.waitForFunction(() => window.__roomggu?.ready());
const ai = (page) =>
  page.evaluate(() => {
    const { app } = window.__roomggu;
    return { text: app.ai.text, why: app.ai.why, vision: app.ai.vision };
  });
const pref = (page) => page.evaluate(() => localStorage.getItem('room-ggu-model'));
async function start(page, context) {
  const requested = [];
  await context.route(MODEL_HOSTS, (route) => {
    requested.push(route.request().url());
    route.abort();
  });
  await page.addInitScript(gpu);
  await page.goto('/');
  await ready(page);
  return requested;
}

test.describe('휴대 기기', () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: PHONE, hasTouch: true });

  test('처음 방문하면 받을지 묻고, 나중에를 고르면 받지 않은 채 규칙으로 답한다', async ({
    page,
    context,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const requested = await start(page, context);
    const ask = page.getByRole('dialog', { name: '상담 모델을 먼저 받아야 해요' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('Gemma 4 E2B');
    await expect(ask).toContainText('약 2.8GB');
    await expect(ask).toContainText('이 기기에서 해석해요');
    expect(await ai(page)).toMatchObject({ text: 'off', why: 'ask' });
    // 팝업은 화면 안에 들어오고, 누를 자리는 44px 이상이다. 나타나는 움직임이 끝난 뒤에 잰다.
    await page.waitForTimeout(450);
    const box = await ask.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 8);
    expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);
    for (const id of ['#ask-later', '#ask-go'])
      expect((await page.locator(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
    // 초점은 팝업 안에서만 돈다. 팝업 자체에 있어 Enter 한 번으로 받기 시작하지 않는다.
    expect(await page.evaluate(() => document.activeElement.id)).toBe('model-ask');
    await page.keyboard.press('Enter');
    await expect(ask).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('ask-model-select');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('ask-later');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('ask-go');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('ask-model-select');
    expect(requested).toEqual([]);

    await page.locator('#ask-later').click();
    await expect(ask).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('모델 없이 시작해요');
    await expect(page.locator('.status-line')).toContainText('모델을 아직 받지 않음');
    expect(await pref(page)).toBe('later');
    // 받지 않아도 규칙으로 상담한다.
    await page.locator('#chat-input').fill('두 명이 앉는 소파');
    await page.getByRole('button', { name: '설명 보내기' }).click();
    await expect(page.locator('[data-surface=furniture-size]').first()).toBeVisible();
    // 사진을 보내도 사진 모델을 저절로 받지 않고, 크기를 적어 둔 단추를 보여 준다.
    await page.locator('#photo-file').setInputFiles({
      name: 'chair.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.locator('.photo-tray img')).toBeVisible();
    await page.getByRole('button', { name: '설명 보내기' }).click();
    await expect(page.locator('[data-surface=photo]')).toContainText('약 150MB');
    await expect(page.getByRole('button', { name: '사진으로 종류 확인' })).toBeVisible();
    expect((await ai(page)).vision).not.toBe('loading');
    expect(requested).toEqual([]);

    // 다시 와도 묻지 않는다. 대화 위쪽의 '모델 받기'로 다시 물을 수 있다.
    await page.reload();
    await ready(page);
    await page.waitForTimeout(600);
    await expect(ask).toHaveCount(0);
    expect(await ai(page)).toMatchObject({ text: 'off', why: 'later' });
    await page.getByRole('button', { name: '모델 받기', exact: true }).click();
    await expect(ask).toBeVisible();
    // 바깥을 누르거나 Esc를 누르면 받지 않고 닫는다.
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    expect(requested).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('받기를 누르면 그때부터 받기 시작하고 같은 자리에서 진행 상황으로 이어진다', async ({
    page,
    context,
  }) => {
    const requested = await start(page, context);
    const ask = page.getByRole('dialog', { name: '상담 모델을 먼저 받아야 해요' });
    await expect(ask).toBeVisible();
    await page.waitForTimeout(450);
    const asked = await ask.boundingBox();
    expect(requested).toEqual([]);
    await page.locator('#ask-go').click();
    await expect(ask).toHaveCount(0);
    const island = page.locator('#model-island');
    await expect(island).toBeVisible();
    // 실제 파일은 막아 두었으므로 받는 중이거나, 이유와 다시 시도를 알리는 상태다.
    await expect(island).toHaveAttribute('data-phase', /connect|fetch|init|error/);
    // 나타나는 움직임이 끝난 뒤의 자리를 잰다.
    await page.waitForTimeout(450);
    const now = await island.boundingBox();
    expect(Math.abs(now.x + now.width / 2 - (asked.x + asked.width / 2))).toBeLessThan(2);
    expect(Math.abs(now.y - asked.y)).toBeLessThan(2);
    expect(await pref(page)).toBe(null);
    expect((await ai(page)).why).toBe('');
    // 화면을 가리던 막은 사라지고 상담은 계속할 수 있다.
    await expect(page.locator('.island-scrim')).toHaveCount(0);
    await expect(page.locator('#chat-input')).toBeInViewport();
  });

  test('3D·저장소·캐시가 막혀도 묻고, 나중에를 고르면 규칙 상담과 방 밖 아바타를 쓴다', async ({
    page,
    context,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/.test(kind) ? null : original.call(this, kind, ...args);
      };
      for (const name of ['localStorage', 'caches'])
        Object.defineProperty(window, name, {
          get() {
            throw Error('blocked');
          },
        });
    });
    const requested = await start(page, context);
    const ask = page.getByRole('dialog', { name: '상담 모델을 먼저 받아야 해요' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('약 2.8GB');
    await page.locator('#ask-later').click();
    await expect(ask).toHaveCount(0);
    await expect(page.locator('.status-line')).toContainText('모델을 아직 받지 않음');
    await page.locator('#chat-input').fill('두 명이 앉는 소파');
    await page.getByRole('button', { name: '설명 보내기' }).click();
    await expect(page.locator('[data-surface=furniture-size]').first()).toBeVisible();
    // 3D가 없어도 아바타는 2D 도면의 방 밖에 선다.
    await page.locator('#avatar-toggle').click();
    await expect(page.locator('#viewport-house canvas')).toBeVisible();
    expect(await page.evaluate(() => window.__roomggu.store.avatarHere().outside)).toBe(true);
    await expect(page.locator('[data-avatar-tag]')).toBeInViewport();
    expect(requested).toEqual([]);
    // 고른 것을 기억할 곳이 없으므로 다음 방문에 다시 묻는다.
    await page.reload();
    await ready(page);
    await expect(ask).toBeVisible();
    expect(requested).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('모델을 꺼 둔 방문에서는 묻지 않는다', async ({ page, context }) => {
    const requested = [];
    await context.route(MODEL_HOSTS, (route) => {
      requested.push(route.request().url());
      route.abort();
    });
    await page.addInitScript(gpu);
    await page.goto('/?model=off');
    await ready(page);
    await page.waitForTimeout(600);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await ai(page)).toMatchObject({ text: 'off', why: 'url' });
    expect(requested).toEqual([]);
  });
});

test('컴퓨터에서는 묻지 않고 바로 준비를 시작한다', async ({ page, context }) => {
  await start(page, context);
  await page.waitForFunction(() => window.__roomggu.app.ai.text !== 'off');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await ai(page);
  expect(state.why).toBe('');
  expect(['loading', 'ready', 'error', 'unsupported']).toContain(state.text);
});

test('휴대 기기 첫 다운로드 안내에서 Qwen3로 바꿔도 동의 전에는 모델 파일을 받지 않는다', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Mobile',
      configurable: true,
    }),
  );
  const requested = await start(page, context),
    ask = page.getByRole('dialog', { name: '상담 모델을 먼저 받아야 해요' });
  await expect(ask).toBeVisible();
  await page.getByRole('combobox', { name: '받을 상담 모델' }).selectOption('qwen');
  await expect(ask.locator('.ask-facts')).toContainText('Qwen3 0.6B');
  await expect(ask.locator('.ask-capabilities')).toContainText('앱이 답문 작성');
  await expect(ask.locator('.ask-capabilities')).toContainText('가구, 방, 복수 요청 4/4');
  await expect(page.locator('#ask-go')).toContainText('350MB');
  expect(requested).toEqual([]);
  await expect(page.locator('#ask-later')).toBeInViewport();
  await expect(page.locator('#ask-go')).toBeInViewport();
  await page.locator('#ask-later').click();
  expect(requested).toEqual([]);
});
