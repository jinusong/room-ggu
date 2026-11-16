import { test, expect } from '@playwright/test';

// 아바타는 방 밖에 서서 시작하고, 끌어서 방 안팎으로 옮긴다.
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
const frames = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function open(page, size) {
  if (size) await page.setViewportSize(size);
  await page.goto('/?model=off');
  await page.waitForFunction(
    () => window.__roomggu?.app.scenes.three || window.__roomggu?.app.view.webglError,
  );
}
async function say(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기' }).click();
}
// 2D 도면에서 방 좌표(m)를 화면 좌표로 바꾼다.
const planPoint = (page, x, z) =>
  page.evaluate(
    ([x, z]) => {
      const sc = window.__roomggu.app.scenes.plan,
        r = sc.canvas.getBoundingClientRect();
      return { x: r.left + sc.ox + x * sc.scale, y: r.top + sc.oy + z * sc.scale, s: sc.scale };
    },
    [x, z],
  );
const layout = (page) =>
  page.evaluate(() => {
    const a = window.__roomggu.store.avatarHere();
    return a && { x: a.x, z: a.z, outside: a.outside };
  });
async function dragAvatar(page, x, z) {
  const a = await layout(page),
    from = await planPoint(page, a.x, a.z),
    to = await planPoint(page, x, z);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y - 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await frames(page);
}
// 방 위 컨트롤이 가리지 않는 영역.
const clearArea = (page) =>
  page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect(),
      css = getComputedStyle(document.documentElement),
      num = (name) => parseFloat(css.getPropertyValue(name)) || 0;
    return {
      left: stage.left + num('--inset-left'),
      right: stage.right,
      top: document.querySelector('.stage-top').getBoundingClientRect().bottom,
      bottom: stage.bottom - num('--inset-bottom'),
    };
  });

test('아바타는 방 밖에서 시작하고 2D에서 끌어 방 안팎으로 옮긴다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await say(page, '내 키 175cm');
  await expect(page.locator('.thread')).toContainText('아바타를 방 옆에 세웠어요');
  const s = await stored(page),
    { w, d } = s.room;
  expect(s.avatar.x).toBeLessThan(-w / 2);
  expect(s.avatar.z).toBeGreaterThan(d / 2);
  expect((await layout(page)).outside).toBe(true);
  // 3D: 이름표와 몸이 방 위 컨트롤에 가리지 않는 자리에 보인다.
  await frames(page);
  const tag = page.locator('[data-avatar-tag]');
  await expect(tag).toBeInViewport({ ratio: 1 });
  const area = await clearArea(page),
    feet = await page.evaluate(() => {
      const sc = window.__roomggu.app.scenes.three,
        a = window.__roomggu.store.avatarHere(),
        v = sc.avatarAt.clone().set(a.x, 0, a.z).project(sc.camera),
        r = sc.renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    });
  expect(feet.x).toBeGreaterThan(area.left + 8);
  expect(feet.x).toBeLessThan(area.right);
  expect(feet.y).toBeGreaterThan(area.top);
  expect(feet.y).toBeLessThan(area.bottom);
  await expect(page.locator('[data-surface=avatar]')).toContainText('아바타는 방 옆에 서 있어요');
  // 2D: 방 밖 아바타까지 도면에 담는다. 이름표는 몸 아래에 둔다.
  await page.locator('[data-view="2d"]').click();
  await page.waitForFunction(() => Number.isFinite(window.__roomggu.app.scenes.plan.scale));
  await frames(page);
  const out = await planPoint(page, s.avatar.x, s.avatar.z),
    canvas = await page.locator('#viewport-2d canvas').boundingBox();
  expect(out.x).toBeGreaterThan(Math.max(canvas.x, area.left) + 20);
  expect(out.y).toBeLessThan(area.bottom - 20);
  const tagBox = await tag.boundingBox();
  expect(tagBox.y).toBeGreaterThan(out.y);
  // 방 안으로 끌어 놓으면 방 안에 서고, 도면은 다시 방에 맞춘다.
  await dragAvatar(page, 0.2, 1.2);
  let a = await layout(page);
  expect(a.outside).toBe(false);
  expect(a.x).toBeCloseTo(0.2, 1);
  expect(a.z).toBeCloseTo(1.2, 1);
  expect((await planPoint(page, 0, 0)).s).toBeGreaterThan(out.s);
  await expect(page.locator('[data-surface=avatar]')).toContainText('방 안팎으로');
  // 벽 위에 놓으면 벽에 걸치지 않고 가까운 쪽으로 붙는다.
  await dragAvatar(page, w / 2 + 0.25, 1.0);
  a = await layout(page);
  expect(a.outside).toBe(true);
  expect(a.x).toBeGreaterThan(w / 2 + 0.3);
  await dragAvatar(page, w / 2 - 0.1, 1.0);
  a = await layout(page);
  expect(a.outside).toBe(false);
  expect(a.x).toBeLessThan(w / 2 - 0.25);
  // 되돌리기는 끌기 한 번을 한 단계로 되돌린다.
  await page.keyboard.press('Escape');
  await page.locator('#undo').click();
  expect((await layout(page)).outside).toBe(true);
  // 새로고침해도 놓은 자리가 남고, 숨겼다 다시 세우면 방 밖 기본 자리로 돌아온다.
  const kept = (await stored(page)).avatar;
  await page.reload();
  await page.waitForFunction(() => window.__roomggu?.app.scenes.plan);
  expect((await stored(page)).avatar).toEqual(kept);
  await page.locator('#avatar-toggle').click();
  await page.locator('#avatar-toggle').click();
  const again = (await stored(page)).avatar;
  expect(again.x).toBeCloseTo(s.avatar.x, 2);
  expect(again.z).toBeCloseTo(s.avatar.z, 2);
  expect(errors).toEqual([]);
});

test('옆에 방이 붙어 있으면 그 방과 겹치지 않는 바깥 자리에 서고 집 전체에서도 보인다', async ({
  page,
}) => {
  await open(page);
  // 왼쪽과 아래쪽에 방을 붙여 기본 자리(앞쪽 왼 모서리)를 막는다.
  await page.evaluate(() => {
    const { store, app } = window.__roomggu,
      home = app.state.roomId;
    store.addSpace('bedroom', { side: 'left' });
    store.switchSpace(home);
    store.addSpace('bathroom', { side: 'front' });
    store.switchSpace(home);
    store.setScope('room');
  });
  await page.locator('#avatar-toggle').click();
  const s = await stored(page),
    at = s.floorplan.positions[s.roomId],
    a = await layout(page);
  expect(a.outside).toBe(true);
  const body = {
    left: at.x + a.x - 0.3,
    right: at.x + a.x + 0.3,
    top: at.z + a.z - 0.17,
    bottom: at.z + a.z + 0.17,
  };
  for (const r of [{ roomId: s.roomId, room: s.room }, ...s.otherRooms]) {
    const p = s.floorplan.positions[r.roomId],
      apart =
        body.right <= p.x - r.room.w / 2 ||
        body.left >= p.x + r.room.w / 2 ||
        body.bottom <= p.z - r.room.d / 2 ||
        body.top >= p.z + r.room.d / 2;
    expect(apart, `${r.roomId}와 겹침`).toBe(true);
  }
  // 집 전체 2D·3D에서도 이름표가 화면 안에 보인다.
  await page.locator('#scope-house').click();
  for (const view of ['2d', '3d']) {
    await page.locator(`[data-view="${view}"]`).click();
    await frames(page);
    await expect(page.locator('[data-avatar-tag]')).toBeInViewport({ ratio: 1 });
  }
});

for (const [width, height] of [
  [390, 844],
  [320, 640],
]) {
  test(`모바일 ${width}: 방 밖 아바타와 이름표가 화면 안에 보이고 입력창이 남는다`, async ({
    page,
  }) => {
    await open(page, { width, height });
    await page.locator('#avatar-toggle').click();
    await expect(page.locator('#avatar-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect((await layout(page)).outside).toBe(true);
    for (const view of ['3d', '2d']) {
      await page.locator(`[data-view="${view}"]`).click();
      await frames(page);
      const tag = page.locator('[data-avatar-tag]'),
        box = await tag.boundingBox(),
        area = await clearArea(page);
      await expect(tag).toBeInViewport({ ratio: 1 });
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(area.top - 1);
    }
    const a = await layout(page),
      p = await planPoint(page, a.x, a.z),
      area = await clearArea(page);
    expect(p.x).toBeGreaterThan(8);
    expect(p.y).toBeLessThan(area.bottom);
    await expect(page.locator('#chat-input')).toBeInViewport();
  });
}
