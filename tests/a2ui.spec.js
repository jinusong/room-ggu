import { test, expect } from '@playwright/test';
import { TOOL_COMPONENTS } from '../src/a2ui-catalog.js';

async function start(page) {
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
}
const say = async (page, text) => {
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await page.waitForFunction(() => !window.__roomggu.app.busy);
};

test('공개 카탈로그의 19개 도구가 실제 A2UI 경로에서 렌더링된다', async ({ page, request }) => {
  const response = await request.get('/a2ui/catalog.json');
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  expect(catalog.protocolVersion).toBe('1.0');
  expect(Object.keys(catalog.components).sort()).toEqual(Object.values(TOOL_COMPONENTS).sort());
  await start(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await say(page, '100평 집 전체를 재팬디로 꾸며줘');
  await expect(page.locator('[data-a2ui-component=RoomGguDesign]')).toBeVisible();
  for (const [kind, component] of Object.entries(TOOL_COMPONENTS)) {
    if (kind === 'design') continue;
    await page.evaluate((kind) => {
      const { app, store } = window.__roomggu;
      store.select(app.state.items[0].id);
      store.openTool(kind);
    }, kind);
    const tool = page.locator(`[data-surface="${kind}"]`).last();
    await expect(tool).toBeVisible();
    await expect(tool).toHaveAttribute('data-a2ui-component', component);
    await expect(tool).toHaveAttribute('data-a2ui-version', '1.0');
  }
  expect(errors).toEqual([]);
  await expect(page.getByRole('alert', { name: '도구 오류' })).toHaveCount(0);
});

test('잘못된 카드 하나는 오류·복구를 제공하고 입력·배치·다른 도구를 보존한다', async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__roomggu.store.openTool('room-size'));
  const before = await page.evaluate(() => JSON.stringify(window.__roomggu.app.state));
  await page.locator('#chat-input').fill('아직 보내지 않은 설명');
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    app.thread.at(-1).surfaces[0].kind = 'iframe';
    store.emit();
  });
  await expect(page.getByRole('alert', { name: '도구 오류' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#chat-input')).toHaveValue('아직 보내지 않은 설명');
  expect(await page.evaluate(() => JSON.stringify(window.__roomggu.app.state))).toBe(before);
  await page.evaluate(() => {
    window.__roomggu.app.thread.at(-1).surfaces[0].kind = 'room-size';
  });
  await page.getByRole('button', { name: '도구 다시 열기', exact: true }).click();
  await expect(page.locator('[data-a2ui-component=RoomGguRoomSize]')).toBeVisible();
  await expect(page.getByRole('alert', { name: '도구 오류' })).toHaveCount(0);
});

for (const width of [1440, 390, 320])
  test(`${width}px: A2UI 카드 재열기·직접 치수 수정·기록 복원·대화 비우기`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await start(page);
    await page.evaluate(() => window.__roomggu.store.openTool('room-size'));
    await page.evaluate(() => window.__roomggu.store.openTool('help'));
    const folded = page.locator('[data-surface-chip=room-size]');
    await expect(folded).toHaveAttribute('data-a2ui-component', 'RoomGguRoomSize');
    // 이 클릭은 SDK가 해석한 action closure를 거쳐 현재 카드를 연다.
    await folded.click();
    const panel = page.locator('[data-surface=room-size]');
    await expect(panel).toBeVisible();
    const input = panel.getByRole('textbox', { name: '방 가로', exact: true });
    await input.fill('6');
    await input.blur();
    expect(await page.evaluate(() => window.__roomggu.app.state.room.w)).toBe(6);
    await page.reload();
    await page.waitForFunction(() => window.__roomggu?.ready());
    expect(await page.evaluate(() => window.__roomggu.app.state.room.w)).toBe(6);
    await expect(page.locator('[data-a2ui-component=RoomGguRoomSize]')).toHaveCount(1);
    await expect(page.locator('[data-a2ui-component=RoomGguHelp]')).toHaveCount(1);
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '새 대화', exact: true }).click();
    await page.getByRole('button', { name: '대화 지우기', exact: true }).click();
    await expect(page.locator('[data-a2ui-surface]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__roomggu.app.state.room.w)).toBe(6);
  });
