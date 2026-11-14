import { test, expect } from '@playwright/test';
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
async function say(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기' }).click();
}
async function ready(page) {
  await page.waitForFunction(
    () => window.__roomggu?.app.scenes.three || window.__roomggu?.app.view.webglError,
  );
}

test('3D와 자동 저장이 막혀도 키 비교·집 도면·대화가 동작한다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return /webgl/.test(kind) ? null : original.call(this, kind, ...args);
    };
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw Error('blocked');
      },
    });
  });
  await page.goto('/?model=off');
  await ready(page);
  await expect(page.locator('#viewport-2d canvas')).toBeVisible();
  await say(page, '내 키 175cm');
  await page.getByRole('button', { name: '눕기', exact: true }).click();
  await expect(page.locator('[data-surface=avatar]')).toContainText('175cm');
  await say(page, '집 전체 평면도');
  await page.locator('[data-view="2d"]').click();
  await page.getByRole('button', { name: '이 방 옆에 화장실 붙이기' }).click();
  await expect(page.locator('#viewport-house canvas')).toBeVisible();
  await expect(page.locator('.save-state')).toContainText('자동 저장 불가');
  expect(errors).toEqual([]);
});

test('새 도구를 1440·390·320px에서 조작해 화면을 기록한다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?model=off');
  await ready(page);
  await say(page, '내 키 178cm');
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/height-comparison.png' });
  await page.getByRole('button', { name: '눕기', exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/avatar-lying.png' });
  await say(page, '집 전체 평면도');
  await page.locator('[data-view="2d"]').click();
  await page.getByRole('button', { name: '이 방 옆에 화장실 붙이기' }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/whole-house.png' });
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(350);
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/whole-house-${size.width}.png` });
  }
  expect(errors).toEqual([]);
});

test('내 키를 말해 아바타를 띄우고 앉기·눕기·저장·되돌리기를 쓴다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);
  const before = await stored(page);
  await say(page, '내 키는 175cm야');
  await expect(page.locator('[data-surface=avatar]')).toBeVisible();
  expect((await stored(page)).avatar.height).toBe(175);
  expect((await stored(page)).items).toEqual(before.items);
  expect(
    await page.evaluate(() =>
      window.__roomggu.app.scenes.three.comparison.children.some((o) => o.userData.avatar),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '앉기', exact: true }).click();
  expect((await stored(page)).avatar.pose).toBe('sitting');
  await page.getByRole('button', { name: '눕기', exact: true }).click();
  expect((await stored(page)).avatar.pose).toBe('lying');
  await page.locator('#undo').click();
  expect((await stored(page)).avatar.pose).toBe('sitting');
  await page.locator('#redo').click();
  expect((await stored(page)).avatar.pose).toBe('lying');
  await page.reload();
  await ready(page);
  expect((await stored(page)).avatar).toMatchObject({ height: 175, pose: 'lying', enabled: true });
  await say(page, '아바타 숨겨줘');
  expect((await stored(page)).avatar.enabled).toBe(false);
  await say(page, '내 키 999cm');
  await expect(page.locator('.thread')).toContainText('80~230cm');
  expect((await stored(page)).avatar.height).toBe(175);
});

test('서 있는 아바타를 3D·2D에서 실제로 끌어 옮긴다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);
  await say(page, '내 키 175cm');
  const before = (await stored(page)).avatar;
  const p = await page.evaluate(() => {
    const sc = window.__roomggu.app.scenes.three,
      model = sc.comparison.children.find((o) => o.userData.avatar);
    model.updateMatrixWorld(true);
    const v = model.children[1].getWorldPosition(model.position.clone()).project(sc.camera);
    const r = sc.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 35, p.y + 15, { steps: 6 });
  await page.mouse.up();
  const moved = (await stored(page)).avatar;
  expect(Math.abs(moved.x - before.x) + Math.abs(moved.z - before.z)).toBeGreaterThan(0.05);
  await page.locator('[data-view="2d"]').click();
  await page.waitForFunction(() => Number.isFinite(window.__roomggu.app.scenes.plan.scale));
  const q = await page.evaluate(() => {
    const { app } = window.__roomggu,
      sc = app.scenes.plan,
      r = sc.canvas.getBoundingClientRect();
    return {
      x: r.left + sc.ox + app.state.avatar.x * sc.scale,
      y: r.top + sc.oy + app.state.avatar.z * sc.scale,
    };
  });
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x + 25, q.y + 20, { steps: 6 });
  await page.mouse.up();
  const next = (await stored(page)).avatar;
  expect(Math.abs(next.x - moved.x) + Math.abs(next.z - moved.z)).toBeGreaterThan(0.05);
});

test('집 전체에 화장실을 붙이고 실제 드래그·편집·파일 왕복으로 보존한다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);
  const before = await stored(page);
  await say(page, '집 전체 평면도 보여줘');
  await page.locator('[data-view="2d"]').click();
  await expect(page.locator('#viewport-house canvas')).toBeVisible();
  await page.getByRole('button', { name: '이 방 옆에 화장실 붙이기' }).click();
  let s = await stored(page);
  expect(s.items).toEqual(before.items);
  expect(s.otherRooms[0].room.type).toBe('bathroom');
  const id = s.otherRooms[0].roomId,
    pos = s.floorplan.positions[id];
  const p = await page.evaluate((id) => window.__roomggu.app.scenes.house.anchor(id), id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 60, p.y + 30, { steps: 8 });
  await page.mouse.up();
  s = await stored(page);
  expect(s.floorplan.positions[id]).not.toEqual(pos);
  const current = structuredClone(s);
  await page.reload();
  await ready(page);
  expect(await stored(page)).toEqual(current);
  await page.locator('#layout-file').setInputFiles({
    name: 'house.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(current)),
  });
  expect(await stored(page)).toEqual(current);
  await page.getByRole('button', { name: '선택한 방 편집' }).click();
  await page.locator('[data-view="3d"]').click();
  await expect(page.locator('#viewport-3d canvas')).toBeVisible();
  expect((await stored(page)).room.type).toBe('bathroom');
});

for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`키 비교와 집 전체 도면에서 입력창 유지 ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?model=off');
    await ready(page);
    await say(page, '내 키 180cm로 아바타 띄워줘');
    await expect(page.locator('[data-surface=avatar]')).toBeVisible();
    await page.getByRole('button', { name: '눕기', exact: true }).click();
    await say(page, '집 전체 평면도');
    await page.locator('[data-view="2d"]').click();
    await page.getByRole('button', { name: '이 방 옆에 화장실 붙이기' }).click();
    await expect(page.locator('#viewport-house canvas')).toBeVisible();
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
}
