import { test, expect } from '@playwright/test';

const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
async function openWindows(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.locator('#chat-input').fill('창문을 설정하고 싶어');
  await page.getByRole('button', { name: '설명 보내기' }).click();
  await expect(page.locator('[data-surface=windows]')).toBeVisible();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`${viewport.width}px 창문 편집·오류 복구·되돌리기·저장 복원`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openWindows(page, viewport);
    await page.getByRole('button', { name: '창문 추가', exact: true }).click();
    const editor = page.locator('[data-window]').first();
    await expect(editor).toBeVisible();
    await editor.getByRole('spinbutton', { name: '창문 1 폭', exact: true }).fill('150');
    await editor.getByRole('spinbutton', { name: '창문 1 벽 끝에서', exact: true }).fill('100');
    await editor.getByRole('button', { name: '창문 변경 적용' }).click();
    expect((await state(page)).room.windows[0].width).toBe(1.5);
    await editor.getByRole('spinbutton', { name: '창문 1 폭', exact: true }).fill('1000');
    await editor.getByRole('button', { name: '창문 변경 적용' }).click();
    await expect(editor.locator('[role=alert]')).toContainText('벽을 벗어나');
    await expect(editor.getByRole('spinbutton', { name: '창문 1 폭', exact: true })).toHaveValue(
      '1000',
    );
    expect((await state(page)).room.windows[0].width).toBe(1.5);
    await editor.getByRole('spinbutton', { name: '창문 1 폭', exact: true }).fill('160');
    await editor.getByRole('button', { name: '창문 변경 적용' }).click();
    expect((await state(page)).room.windows[0].width).toBe(1.6);
    await page.locator('#chat-input').fill('되돌려줘');
    await page.getByRole('button', { name: '설명 보내기' }).click();
    expect((await state(page)).room.windows[0].width).toBe(1.5);
    await page.reload();
    await page.waitForFunction(() => window.__roomggu?.ready());
    expect((await state(page)).room.windows[0].width).toBe(1.5);
    const input = await page.locator('#chat-input').boundingBox();
    expect(input.y + input.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(errors).toEqual([]);
  });
}

test('가구 별칭 검색과 빈 결과 초기화·새 가구 배치', async ({ page }) => {
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.locator('[data-starter=catalog]').click();
  const input = page.getByRole('textbox', { name: '가구 검색' });
  await input.fill('식세기');
  await expect(page.locator('[data-type=dishwasher]')).toBeVisible();
  await input.fill('없는가구');
  await expect(page.getByRole('button', { name: '검색·분류 초기화' })).toBeVisible();
  await page.getByRole('button', { name: '검색·분류 초기화' }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(40);
  await input.fill('옷걸이');
  await page.locator('[data-type=hanger]').click();
  await expect(page.locator('[data-surface=furniture-size]')).toBeVisible();
  await page
    .locator('[data-surface=furniture-size]')
    .getByRole('button', { name: '방에 놓기', exact: true })
    .click();
  expect((await state(page)).items.some((i) => i.type === 'hanger')).toBe(true);
});
