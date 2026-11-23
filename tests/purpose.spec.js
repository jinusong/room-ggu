import { test, expect } from '@playwright/test';

const ask = async (page, text) => {
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-input').press('Enter');
};
const state = (page) =>
  page.evaluate(() => {
    const { state, draft, queue } = window.__roomggu.app;
    return { items: state.items, draft, queue };
  });
const options = (page) => page.getByRole('group', { name: '추천 가구' }).last();

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [900, 700],
  [390, 844],
  [320, 640],
]) {
  test(width + 'px 후보와 입력창·키보드 선택·치수·배치·되돌리기', async ({ page, browserName }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?model=off');
    await page.waitForFunction(() => window.__roomggu?.ready());
    const before = await state(page);
    await ask(page, '혼자 독서할 가구가 필요해. 폭 920mm, 네이비로');
    const pick = options(page).locator('[data-choice=armchair]');
    await expect(pick).toBeVisible();
    await expect(options(page).getByRole('button')).toHaveCount(2);
    expect(await state(page)).toEqual(before);
    await pick.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await pick.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const input = await page.locator('#chat-input').boundingBox();
    expect(input.y + input.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 390 || width === 1440) {
      await expect(options(page).locator('img')).toHaveCount(2);
      await page.screenshot({ path: 'test-results/purpose-' + browserName + '-' + width + '.png' });
    }
    await pick.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).draft?.type).toBe('armchair');
    const { draft, items } = await state(page);
    expect([draft.dims[0], draft.color, draft.sources[0]]).toEqual([92, '#3f4d63', '사용자 설정']);
    expect(items).toEqual(before.items);
    const place = page.getByRole('button', { name: '방에 놓기', exact: true }).last();
    await expect(place).toBeFocused();
    await place.press('Enter');
    expect((await state(page)).items.length).toBe(before.items.length + 1);
    await page.evaluate(() => window.__roomggu.store.undo());
    expect((await state(page)).items).toEqual(before.items);
  });
}

test('다시 열어도 원문을 유지하고 번호가 틀리면 후보를 다시 보여준다', async ({ page }) => {
  await page.goto('/?model=off');
  await ask(page, '외투를 걸 가구가 필요해. 폭 99cm');
  await expect(options(page).locator('button')).toHaveCount(2);
  await page.reload();
  await expect(options(page).locator('[data-choice=wardrobe]')).toBeEnabled();
  await ask(page, '3번');
  await expect(page.getByText('후보가 2개예요.', { exact: false })).toBeVisible();
  const type = await options(page).locator('button').nth(1).getAttribute('data-choice');
  await ask(page, '두 번째');
  expect((await state(page)).draft).toMatchObject({
    type,
    dims: [99, expect.any(Number), expect.any(Number)],
  });
});

test('다른 턴이나 공간으로 넘어간 이전 후보는 현재 가구를 바꾸지 않는다', async ({ page }) => {
  await page.goto('/?model=off');
  await ask(page, '독서할 가구를 추천해줘');
  const id = await page.locator('[data-surface=recommendations]').getAttribute('data-a2ui-surface');
  await ask(page, '책상 폭 90cm');
  const before = await state(page);
  await page.evaluate(
    (id) => window.__roomggu.store.chooseRecommendation(id.slice('tool-'.length), 'sofa'),
    id,
  );
  expect(await state(page)).toEqual(before);
  await page.locator('[data-surface-chip=recommendations]').click();
  await expect(options(page).locator('[data-choice=sofa]')).toBeDisabled();
});

test('카탈로그는 용도를 검색하고 분류와 빈 결과에서 복구한다', async ({ page }) => {
  await page.goto('/?model=off');
  await page.locator('[data-starter=catalog]').click();
  const input = page.getByRole('textbox', { name: '가구 검색' });
  await input.fill('독서');
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  await expect(page.locator('.catalog-card[data-type=armchair]')).toContainText('기본 폭');
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(input).toBeFocused();
  await expect(page.locator('.catalog-card')).toHaveCount(40);
  await input.fill('검색결과없는단어');
  await expect(page.locator('.catalog-card')).toHaveCount(0);
  await page.getByRole('button', { name: '검색·분류 초기화' }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(40);
});

test('용도 근거가 약한 모델 응답은 사용자가 확인한 뒤에만 초안을 만든다', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage(job) {
        if (job.task === 'interpret')
          queueMicrotask(() =>
            this.onmessage({
              data: {
                id: job.id,
                result: JSON.stringify({
                  activity: '책상에서 공부하거나 일하기',
                  first: 'desk',
                  second: 'none',
                  third: 'none',
                }),
              },
            }),
          );
      }
      terminate() {}
    };
  });
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.evaluate(() => {
    window.__roomggu.app.ai.text = 'ready';
  });
  await ask(page, '교정지를 쫙 펴놓을 가구가 필요해. 폭 99cm');
  const yes = page.getByRole('button', { name: '책상에서 공부하거나 일하기 용도예요' });
  await expect(yes).toBeVisible();
  expect((await state(page)).draft).toBeNull();
  await page.reload();
  await yes.click();
  await expect.poll(async () => (await state(page)).draft?.type).toBe('desk');
  expect((await state(page)).draft.dims[0]).toBe(99);
});
