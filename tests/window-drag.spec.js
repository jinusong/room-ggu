import { test, expect } from '@playwright/test';
const read = (page) =>
  page.evaluate(() => ({
    room: window.__roomggu.app.state.room,
    history: window.__roomggu.app.history.length,
  }));
async function setup(page, view = '3d', size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.evaluate((view) => {
    const { app, store } = window.__roomggu;
    store.addWindow('back');
    store.setWindow(app.state.room.windows[0].id, {
      offset: 1,
      width: 1.2,
      height: 0.9,
      sill: 0.9,
    });
    store.setView(view);
  }, view);
  await expect(page.locator('[data-window-pane]')).toBeVisible();
}
async function center(page) {
  return page.evaluate(() => {
    const { app } = window.__roomggu;
    const f = (app.state.view === '2d' ? app.scenes.plan : app.scenes.three).windowFrames()[0];
    return {
      x: f.points.reduce((n, p) => n + p.x, 0) / 4,
      y: f.points.reduce((n, p) => n + p.y, 0) / 4,
    };
  });
}
for (const view of ['2d', '3d'])
  for (const width of [1440, 390, 320])
    test(`${view} ${width}px 창문 직접 이동·크기 조절·실행 취소`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await setup(page, view, { width, height: width === 1440 ? 900 : 844 });
      const before = await read(page),
        p = await center(page);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 24, p.y - 8, { steps: 8 });
      await page.mouse.up();
      const moved = await read(page);
      expect(moved.room.windows[0]).not.toEqual(before.room.windows[0]);
      expect(moved.history).toBe(before.history + 1);
      await expect(page.locator('[data-window-toolbar]')).toBeVisible();
      const handle = page.locator(`[data-window-handle="${view === '2d' ? 'br' : 'tr'}"]`);
      const h = await handle.boundingBox();
      await page.mouse.move(h.x + 22, h.y + 22);
      await page.mouse.down();
      await page.mouse.move(h.x + 44, h.y + 8, { steps: 8 });
      await page.mouse.up();
      const resized = await read(page);
      expect(resized.room.windows[0].width).not.toBe(moved.room.windows[0].width);
      expect(resized.history).toBe(moved.history + 1);
      await page.evaluate(() => window.__roomggu.store.undo());
      expect((await read(page)).room.windows[0]).toEqual(moved.room.windows[0]);
      await page.evaluate(() => window.__roomggu.store.undo());
      expect((await read(page)).room.windows[0]).toEqual(before.room.windows[0]);
      expect(errors).toEqual([]);
    });
test('창문 이동 취소·키보드 이동·뷰 전환 취소는 배치와 기록을 보존', async ({ page }) => {
  await setup(page);
  const before = await read(page),
    p = await center(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 25, p.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read(page)).toEqual(before);
  const pane = page.locator('[data-window-pane]');
  await pane.focus();
  await page.keyboard.press('ArrowRight');
  expect((await read(page)).room.windows[0].offset).toBeCloseTo(1.05);
  const at = await center(page),
    moved = await read(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 30, at.y, { steps: 4 });
  await page.evaluate(() => window.__roomggu.store.setView('2d'));
  await page.mouse.up();
  expect((await read(page)).room.windows[0]).toEqual(moved.room.windows[0]);
  expect((await read(page)).history).toBe(moved.history);
});

test('모바일 터치로 창문을 끌고, 포인터 취소는 원래 배치로 되돌린다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chrome CDP 터치 입력 검사');
  await setup(page, '2d', { width: 390, height: 844 });
  const before = await read(page),
    p = await center(page),
    cdp = await page.context().newCDPSession(page);
  const send = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })),
    });
  await send('touchStart', [[p.x, p.y]]);
  await send('touchMove', [[p.x + 25, p.y]]);
  await send('touchEnd', []);
  expect((await read(page)).room.windows[0].offset).not.toBe(before.room.windows[0].offset);
  const after = await read(page),
    at = await center(page);
  await send('touchStart', [[at.x, at.y]]);
  await send('touchMove', [[at.x - 25, at.y]]);
  await send('touchCancel', []);
  expect(await read(page)).toEqual(after);
  await cdp.detach();
});

test('네 벽의 창문을 2D·3D에서 잡아 이동하고 옆벽은 위아래 키로 조절한다', async ({ page }) => {
  // 소프트웨어 렌더링인 CI에서도 8회 드래그와 보기 전환을 끝낼 시간을 둔다.
  test.setTimeout(90_000);
  await setup(page);
  for (const view of ['2d', '3d'])
    for (const wall of ['back', 'left', 'right', 'front']) {
      await page.evaluate(
        ({ view, wall }) => {
          const { app, store } = window.__roomggu;
          store.setWindow(app.state.room.windows[0].id, {
            wall,
            offset: 1,
            width: 1.2,
            height: 0.9,
            sill: 0.9,
          });
          store.setView(view);
        },
        { view, wall },
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const p = await center(page),
        before = await read(page);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 22, p.y + 10, { steps: 5 });
      await page.mouse.up();
      expect((await read(page)).room.windows[0]).not.toEqual(before.room.windows[0]);
    }
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    store.setWindow(app.state.room.windows[0].id, { wall: 'left', offset: 1 });
    store.setView('2d');
  });
  await page.locator('[data-window-pane]').focus();
  await page.keyboard.press('ArrowUp');
  expect((await read(page)).room.windows[0].offset).toBeCloseTo(0.95);
});
