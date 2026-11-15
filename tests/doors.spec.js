import { test, expect } from '@playwright/test';

// 연결 문을 화면에서 직접 옮기고, 폭·여는 방향을 바꾸고, 막았다가 다시 내는 흐름.
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
const frames = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function openHouse(page, size) {
  if (size) await page.setViewportSize(size);
  await page.goto('/?model=off');
  await page.waitForFunction(
    () => window.__roomggu?.app.scenes.three || window.__roomggu?.app.view.webglError,
  );
  // 원룸 오른쪽에 화장실을 붙이고 집 전체 2D로 본다.
  await page.evaluate(() => window.__roomggu.store.attachBathroom());
  await page.locator('[data-view="2d"]').click();
  await page.waitForFunction(() => window.__roomggu.app.scenes.house.scale > 0);
  await frames(page);
  const s = await stored(page);
  return { studio: s.roomId, bath: s.otherRooms[0].roomId };
}
// 문 가운데의 화면 좌표. 시트 크기나 글꼴이 늦게 잡히면 도면이 한 번 더 그려지므로 자리가 멈춘 뒤의 값을 쓴다.
async function doorAnchor(page, ids) {
  const read = () => page.evaluate((ids) => window.__roomggu.app.scenes.house.doorAnchor(ids), ids);
  let last = await read();
  for (let i = 0; i < 20; i++) {
    await frames(page);
    const now = await read();
    if (JSON.stringify(now) === JSON.stringify(last)) return now;
    last = now;
  }
  return last;
}
// 집 전체 3D 모형에서 문 모형의 수와 벽을 따라 놓인 자리.
const doors3d = (page) =>
  page.evaluate(() => {
    const out = [];
    const sc = window.__roomggu.app.scenes.three;
    sc.room.updateMatrixWorld(true);
    sc.room.traverse((o) => {
      if (!o.userData.opening) return;
      const v = o.getWorldPosition(o.position.clone());
      out.push({ x: v.x, z: v.z });
    });
    return out;
  });

test('문을 끌어 옮기고 폭·여는 방향을 바꾸면 2D·3D·방 편집 화면이 함께 바뀐다', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { studio, bath } = await openHouse(page);
  const ids = [studio, bath];
  expect((await stored(page)).floorplan.doors).toBeUndefined();
  const scale = await page.evaluate(() => window.__roomggu.app.scenes.house.scale);
  let p = await doorAnchor(page, ids);
  // 문 위에서는 벽을 따라 움직인다는 커서가 된다.
  await page.mouse.move(p.x, p.y);
  expect(
    await page.evaluate(() => document.querySelector('#viewport-house canvas').style.cursor),
  ).toBe('ns-resize');
  // 누르면 문 막대가 뜬다. 폭 80cm는 가정값이라 점선 칩이다.
  await page.mouse.click(p.x, p.y);
  const bar = page.locator('[data-door-bar]');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-door-width]')).toHaveText('문 80cm');
  await expect(bar.locator('[data-door-width]')).toHaveClass(/is-draft/);
  // 막대는 문을 가리지 않는다.
  const box = await bar.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(p.y - p.half);
  // 벽을 따라 아래로 50cm 끈다. 벽 끝에서 5cm 단위로 맞는다.
  p = await doorAnchor(page, ids);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y + 0.25 * scale, { steps: 4 });
  await page.mouse.move(p.x + 2, p.y + 0.5 * scale, { steps: 4 });
  await page.mouse.up();
  let s = await stored(page);
  expect(s.floorplan.doors).toHaveLength(1);
  expect(s.floorplan.doors[0].offset).toBeCloseTo(0.5, 1);
  expect(Math.round(s.floorplan.doors[0].offset * 100) % 5).toBe(0);
  const offset = s.floorplan.doors[0].offset;
  const moved = await doorAnchor(page, ids);
  expect(moved.y - p.y).toBeCloseTo(offset * scale, 0);
  // 폭을 두 번 늘리면 직접 정한 값이 되어 노란 줄자 칩으로 바뀐다.
  await page.getByRole('button', { name: '문 폭 5cm 늘리기' }).click();
  await page.getByRole('button', { name: '문 폭 5cm 늘리기' }).click();
  await expect(bar.locator('[data-door-width]')).toHaveText('문 90cm');
  await expect(bar.locator('[data-door-width]')).toHaveClass(/is-set/);
  await page.getByRole('button', { name: '문 여는 방향 바꾸기' }).click();
  s = await stored(page);
  expect(s.floorplan.doors[0]).toMatchObject({ width: 0.9, flip: true });
  // 3D 집 모형의 문도 같은 자리에 있다.
  await page.locator('[data-view="3d"]').click();
  await frames(page);
  const wallMid = s.floorplan.positions[bath].z;
  let model = await doors3d(page);
  expect(model).toHaveLength(1);
  expect(model[0].z).toBeCloseTo(wallMid + s.floorplan.doors[0].offset, 1);
  // 원룸 방 편집 2D에서도 같은 자리에 문이 비어 있고, 거기서도 끌어 옮길 수 있다.
  await page.locator('[data-view="2d"]').click();
  await page.locator(`[data-room-tag="${studio}"] .tag-main`).dblclick();
  await frames(page);
  const local = await page.evaluate((ids) => window.__roomggu.app.scenes.plan.doorAnchor(ids), ids);
  const roomScale = await page.evaluate(() => window.__roomggu.app.scenes.plan.scale);
  await expect(page.locator('.stage-hint')).toContainText('문을 끌어');
  await page.mouse.move(local.x + 2, local.y - 0.3 * roomScale);
  expect(
    await page.evaluate(() => document.querySelector('#viewport-2d canvas').style.cursor),
  ).toBe('ns-resize');
  await page.mouse.down();
  await page.mouse.move(local.x + 2, local.y - 0.7 * roomScale, { steps: 4 });
  await page.mouse.move(local.x + 2, local.y - 1.0 * roomScale, { steps: 4 });
  await page.mouse.up();
  s = await stored(page);
  // 위로 70cm 끌었으므로 벽 가운데에서 아래 50cm에 있던 문이 위 20cm로 간다.
  expect(s.floorplan.doors[0].offset).toBeCloseTo(offset - 0.7, 1);
  expect(s.floorplan.doors[0].width).toBe(0.9);
  // 방 편집 3D의 문 호도 하나다.
  await page.locator('[data-view="3d"]').click();
  await frames(page);
  expect(
    await page.evaluate(() => {
      let n = 0;
      window.__roomggu.app.scenes.three.room.traverse((o) => o.userData.door && n++);
      return n;
    }),
  ).toBe(1);
  // 새로고침해도 문 설정이 남는다.
  const before = s.floorplan.doors;
  await page.reload();
  await page.waitForFunction(
    () => window.__roomggu?.app.scenes.three || window.__roomggu?.app.view.webglError,
  );
  expect((await stored(page)).floorplan.doors).toEqual(before);
  expect(errors).toEqual([]);
});

test('문을 막으면 벽이 이어지고 집 전체 도구에서 다시 내거나 숫자로 맞춘다', async ({ page }) => {
  const { studio, bath } = await openHouse(page);
  const ids = [studio, bath];
  const p = await doorAnchor(page, ids);
  await page.mouse.click(p.x, p.y);
  await page.locator('[data-door-bar] [data-door-close]').click();
  await expect(page.locator('[data-door-bar]')).toHaveCount(0);
  let s = await stored(page);
  expect(s.floorplan.doors[0].closed).toBe(true);
  expect(await doorAnchor(page, ids)).toBeNull();
  await expect(page.locator('.event').last()).toContainText('문을 막았어요');
  // 3D에도 문이 없다.
  await page.locator('[data-view="3d"]').click();
  await frames(page);
  expect(await doors3d(page)).toHaveLength(0);
  await page.locator('[data-view="2d"]').click();
  // 실행 취소로 되돌아오고, 다시 실행하면 막힌다.
  await page.locator('#undo').click();
  expect((await stored(page)).floorplan.doors).toBeUndefined();
  await page.locator('#redo').click();
  expect((await stored(page)).floorplan.doors[0].closed).toBe(true);
  // 집 전체 도구의 문 목록에서 다시 낸다.
  await page.getByRole('button', { name: '도구 열기' }).click();
  await page.locator('[data-tool=floorplan]').click();
  const list = page.locator('.house-doors').last();
  await expect(list.locator('summary')).toContainText('문 0개 · 막은 벽 1곳');
  // 문을 막은 뒤에는 다시 낼 수 있게 문 목록이 펼쳐져 있다.
  await expect(list).toHaveAttribute('open', '');
  await list.locator('[data-door-open]').click();
  await expect(list.locator('summary')).toContainText('문 1개');
  s = await stored(page);
  expect(s.floorplan.doors).toBeUndefined();
  // 위치를 숫자로 넣으면 그대로 반영하고(5cm에 맞추지 않는다) 직접 정한 값으로 표시한다.
  const position = list.getByRole('textbox', { name: /문 위치/ });
  await expect(position).toHaveValue('70');
  await position.fill('23');
  await position.blur();
  s = await stored(page);
  // 맞닿은 벽 220cm의 가운데(110cm)에서 문 가운데(23 + 40cm)까지.
  expect(s.floorplan.doors[0].offset).toBeCloseTo(-0.47, 2);
  await expect(list.locator('.stepper').first().locator('.tape')).toHaveText('직접 정한 값');
  // 벽보다 넓은 문은 받지 않고 이유를 알린다.
  const width = list.getByRole('textbox', { name: /문 폭$/ });
  await expect(list.locator('.stepper').nth(1).locator('.tape')).toHaveText('가정값');
  await width.fill('300');
  await width.blur();
  await expect(list.locator('.field-error')).toContainText('60~120cm');
  expect((await stored(page)).floorplan.doors[0].width).toBeUndefined();
  await width.fill('70');
  await width.blur();
  s = await stored(page);
  expect(s.floorplan.doors[0].width).toBe(0.7);
  await expect(list.locator('.stepper').nth(1).locator('.tape')).toHaveText('직접 정한 값');
  // 폭을 줄여도 벽 끝에서의 거리는 그대로다.
  await expect(position).toHaveValue('23');
  // 자동으로 되돌리면 설정이 사라진다.
  await list.getByRole('button', { name: '자동으로 되돌리기' }).click();
  expect((await stored(page)).floorplan.doors).toBeUndefined();
  await expect(position).toHaveValue('70');
});

for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test.describe(`모바일 ${size.width}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: size });
    // 손가락 입력은 Chrome의 개발자 도구 프로토콜로 보낸다. 다른 엔진에서는 건너뛴다.
    test.skip(({ browserName }) => browserName !== 'chromium', 'Chrome 전용 터치 입력');
    test('손가락으로 문을 눌러 막대를 띄우고 끌어 옮긴다', async ({ page }) => {
      const { studio, bath } = await openHouse(page);
      const ids = [studio, bath];
      const p = await doorAnchor(page, ids);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
        });
      // 손가락은 문 가운데를 정확히 누르지 못한다.
      await touch('touchStart', p.x + 8, p.y + 6);
      await touch('touchEnd');
      const bar = page.locator('[data-door-bar]');
      await expect(bar).toBeVisible();
      const box = await bar.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      // 막대와 밀려난 이름표가 문을 덮지 않아 바로 끌 수 있다.
      expect(box.y + box.height).toBeLessThanOrEqual(p.y - p.half);
      await touch('touchStart', p.x + 6, p.y);
      for (let i = 1; i <= 8; i++) await touch('touchMove', p.x + 6, p.y + i * 5);
      await touch('touchEnd');
      const s = await stored(page);
      expect(s.floorplan.doors[0].offset).toBeGreaterThan(0.2);
      await expect(bar).toBeVisible();
    });
  });
}
