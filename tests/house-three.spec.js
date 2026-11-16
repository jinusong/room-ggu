import { test, expect } from '@playwright/test';
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
async function start(page, { avatar = false } = {}) {
  await page.goto('/?model=off');
  await page.waitForFunction(
    () => window.__roomggu?.app.scenes.three || window.__roomggu?.app.view.webglError,
  );
  if (avatar) {
    await page.locator('#chat-input').fill('내 키 175cm');
    await page.getByRole('button', { name: '설명 보내기' }).click();
  }
  await page.locator('#chat-input').fill('집 전체를 3D로 보여줘');
  await page.getByRole('button', { name: '설명 보내기' }).click();
  await page.getByRole('button', { name: '이 방 옆에 화장실 붙이기' }).click();
}
test('화장실 포함 집 전체 3D: 회전·선택·편집·복원·PNG', async ({ page }) => {
  // 소프트웨어 렌더링인 CI에서는 집 전체 3D를 여러 번 다시 그리는 이 흐름이 30초 가까이 걸린다.
  test.slow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page, { avatar: true });
  await expect(page.locator('#viewport-3d canvas')).toBeVisible();
  await expect(page.locator('[data-view="3d"]')).toHaveAttribute('aria-pressed', 'true');
  const initial = await stored(page),
    bath = initial.otherRooms[0].roomId;
  const geometry = await page.evaluate(() => {
    const sc = window.__roomggu.app.scenes.three;
    let fixtures = 0;
    // 화장실 설비는 가구라서 구조(room)가 아니라 가구 묶음(objects)에 있다.
    sc.objects.traverse((o) => {
      if (o.userData.fixture) fixtures++;
    });
    return { fixtures, rooms: sc.objects.children[0].children.length, extent: sc.extent() };
  });
  expect(geometry.fixtures).toBe(3);
  expect(geometry.rooms).toBe(2);
  // 집은 가로 5.8m이고, 방 밖 왼쪽에 선 아바타까지 화면에 담는다.
  const avatar = initial.avatar;
  expect(avatar.x).toBeLessThan(-2);
  expect(geometry.extent.w).toBeGreaterThan(5.8 + (-2 - avatar.x));
  expect(geometry.extent.w).toBeLessThan(5.8 + 1.2);
  const camera = await page.evaluate(() =>
    window.__roomggu.app.scenes.three.camera.position.toArray(),
  );
  await page.mouse.move(1350, 180);
  await page.mouse.down();
  await page.mouse.move(1290, 220, { steps: 8 });
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.__roomggu.app.scenes.three.camera.position.toArray()),
  ).not.toEqual(camera);
  expect((await stored(page)).items).toEqual(initial.items);
  await page.locator('#home').click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  // 화면 맞춤은 끌어 돌린 관성을 멈춘다. 몇 프레임 뒤에도 카메라가 같은 자리에 있어야 한다.
  const settled = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const camera = window.__roomggu.app.scenes.three.camera,
          before = camera.position.toArray();
        let frames = 0;
        const step = () =>
          ++frames < 6
            ? requestAnimationFrame(step)
            : resolve(camera.position.toArray().every((n, i) => Math.abs(n - before[i]) < 1e-6));
        requestAnimationFrame(step);
      }),
  );
  expect(settled).toBe(true);
  const point = await page.evaluate((id) => window.__roomggu.app.scenes.three.roomAnchor(id), bath);
  await page.mouse.click(point.x, point.y);
  expect((await stored(page)).roomId).toBe(bath);
  expect(
    await page.evaluate(() =>
      window.__roomggu.app.scenes.three.comparison.children.some((o) => o.userData.avatar),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '선택한 방 편집', exact: true }).click();
  expect((await stored(page)).scope).toBe('room');
  expect((await stored(page)).room.type).toBe('bathroom');
  await page.getByRole('button', { name: '3D 모형', exact: true }).click();
  expect((await stored(page)).scope).toBe('house');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const editPoint = await page.evaluate(
    (id) => window.__roomggu.app.scenes.three.roomAnchor(id),
    bath,
  );
  await page.mouse.dblclick(editPoint.x, editPoint.y);
  expect((await stored(page)).scope).toBe('room');
  await page.getByRole('button', { name: '3D 모형', exact: true }).click();
  await page.evaluate(() => {
    const sc = window.__roomggu.app.scenes.three,
      original = sc.png.bind(sc);
    sc.png = () => {
      window.__housePNG = true;
      return original();
    };
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일과 설정' }).click();
  await page.locator('#png').click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  expect(await page.evaluate(() => window.__housePNG)).toBe(true);
  const state = await stored(page);
  await page.reload();
  await page.locator('#viewport-3d canvas').waitFor({ state: 'visible' });
  expect(await stored(page)).toEqual(state);
  expect(errors).toEqual([]);
});
test('집 전체 3D를 2D와 전환하고 작은 화면에서도 입력·모형을 유지한다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page);
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/whole-house-3d.png' });
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(350);
    await expect(page.locator('#chat-input')).toBeInViewport();
    await expect(page.locator('#viewport-3d canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/whole-house-3d-${size.width}.png` });
    await page.locator('[data-view="2d"]').click();
    await expect(page.locator('#viewport-house canvas')).toBeVisible();
    await page.locator('[data-view="3d"]').click();
    await expect(page.locator('#viewport-3d canvas')).toBeVisible();
  }
});
test('WebGL이 없으면 집 전체 2D를 유지하고 3D 요청을 안내한다', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return /webgl/.test(kind) ? null : get.call(this, kind, ...args);
    };
  });
  await start(page);
  await expect(page.locator('#viewport-house canvas')).toBeVisible();
  await page.locator('[data-view="3d"]').click();
  await expect(page.locator('#toast')).toContainText('2D 평면');
  expect(await stored(page)).toMatchObject({ scope: 'house', view: '2d' });
});
