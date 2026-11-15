import { test, expect } from '@playwright/test';

// 집 전체에서 고른 공간의 벽에 + 손잡이로 새 공간을 붙이는 흐름.
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
  await page.locator('#scope-house').click();
  await page.locator('[data-view="2d"]').click();
  await page.waitForFunction(() => window.__roomggu.app.scenes.house.scale > 0);
  await frames(page);
}
const shown = (page) =>
  page
    .locator('[data-add-side]')
    .evaluateAll((els) =>
      els.filter((el) => el.style.visibility !== 'hidden').map((el) => el.dataset.addSide),
    );

test('고른 공간의 벽에서 +를 눌러 종류를 고르면 미리 본 자리에 붙고 문이 이어진다', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHouse(page);
  const studio = (await stored(page)).roomId;
  // 방이 하나면 네 벽 모두에 손잡이가 있다.
  expect((await shown(page)).sort()).toEqual(['back', 'front', 'left', 'right']);
  const handle = page.getByRole('button', { name: /오른쪽에 공간 붙이기/ });
  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  const pop = page.getByRole('group', { name: '오른쪽에 붙일 공간' });
  await expect(pop).toBeVisible();
  await expect(pop.locator('[data-add-type]')).toHaveCount(8);
  await expect(pop.locator('[data-add-type=bedroom]')).toContainText('4 × 3.5m');
  // 가리키면 붙을 자리와 크기를 점선으로 미리 보여 주고, 그 자리가 화면 안에 들어온다.
  await pop.locator('[data-add-type=bedroom]').hover();
  const ghost = await page.evaluate(() => {
    const { app } = window.__roomggu,
      sc = app.scenes.house,
      g = sc.ghostRoom,
      rect = sc.canvas.getBoundingClientRect();
    return g && { ...g, right: rect.left + sc.ox + (g.x + g.w / 2) * sc.scale, edge: rect.right };
  });
  expect(ghost).toMatchObject({ type: 'bedroom', x: 4, z: -0.25, w: 4, d: 3.5 });
  expect(ghost.right).toBeLessThan(ghost.edge);
  await page.screenshot({ path: 'test-results/add-room.png' });
  expect((await stored(page)).otherRooms).toHaveLength(0);
  await pop.locator('[data-add-type=bedroom]').click();
  await expect(pop).toHaveCount(0);
  let s = await stored(page);
  expect(s.otherRooms).toHaveLength(1);
  // 새 공간이 고른 공간이 되고 집 전체에 머문다. 미리 본 자리 그대로다.
  expect([s.scope, s.room.type, s.name]).toEqual(['house', 'bedroom', '나의 침실']);
  expect(s.floorplan.positions[s.roomId]).toEqual({ x: 4, z: -0.25 });
  expect(await page.evaluate(() => window.__roomggu.app.view.ghostRoom)).toBeNull();
  // 맞닿은 벽(x = 2m) 가운데에 문이 생겼다.
  expect(
    await page.evaluate(() => !!window.__roomggu.app.scenes.house.doorAt({ x: 2, z: -0.25 })),
  ).toBe(true);
  // 대화에도 무엇을 했는지 남는다.
  await expect(page.locator('.msg.user').last()).toContainText('오른쪽에 침실 붙이기');
  await expect(page.locator('.msg.assistant').last()).toContainText(
    '나의 침실을 햇살이 드는 작은 방 오른쪽에 붙였어요',
  );
  // 침실의 왼쪽 벽은 원룸과 맞닿아 손잡이가 없다.
  await frames(page);
  expect((await shown(page)).sort()).toEqual(['back', 'front', 'right']);
  // 원룸을 다시 고르면 막힌 오른쪽 벽에는 손잡이가 없다.
  await page.locator(`[data-room-tag="${studio}"] .tag-main`).click();
  await frames(page);
  expect((await shown(page)).sort()).toEqual(['back', 'front', 'left']);
  // 위쪽의 공간 추가 버튼은 비어 있는 첫 벽의 고르기 창을 연다. Esc로 닫으면 초점이 손잡이로 돌아간다.
  await page.locator('#add-space').click();
  await expect(page.locator('[data-add-list]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-add-list]')).toHaveCount(0);
  await expect(page.locator('[data-add-side].is-open')).toHaveCount(0);
  // 아래쪽에 화장실을 붙여 ㄱ자 집을 만든다.
  await page.getByRole('button', { name: /아래쪽에 공간 붙이기/ }).click();
  await page.locator('[data-add-type=bathroom]').click();
  s = await stored(page);
  expect(s.otherRooms).toHaveLength(2);
  expect(s.floorplan.positions[s.roomId]).toEqual({ x: -1.1, z: 3.1 });
  // 3D에서도 손잡이와 미리 보기 테두리가 뜬다.
  await page.locator('[data-view="3d"]').click();
  await frames(page);
  expect((await shown(page)).length).toBeGreaterThan(0);
  await page.locator('#add-space').click();
  await page.locator('[data-add-type=bathroom]').focus();
  expect(await page.evaluate(() => !!window.__roomggu.app.scenes.three.roomGhost)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => !!window.__roomggu.app.scenes.three.roomGhost)).toBe(false);
  // 실행 취소로 붙인 공간이 사라진다.
  await page.locator('#undo').click();
  expect((await stored(page)).otherRooms).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`모바일 ${size.width}: 고르는 줄이 모형을 가리지 않고 화면 안에 들어온다`, async ({
    page,
  }) => {
    await openHouse(page, size);
    await page.locator('[data-add-side=right]').click();
    const list = page.locator('[data-add-list]');
    await expect(list).toBeVisible();
    const box = await list.boundingBox(),
      tools = await page.locator('.stage-bottom').boundingBox(),
      model = await page.evaluate(() => {
        const { app } = window.__roomggu,
          sc = app.scenes.house,
          p = sc.anchor(app.state.roomId),
          half = (app.state.room.d / 2) * sc.scale;
        return { top: p.y - half, bottom: p.y + half };
      });
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    // 방 아래 도구 줄 바로 위에 깔린다.
    expect(box.y + box.height).toBeLessThanOrEqual(tools.y + 1);
    expect(box.y).toBeGreaterThan(model.top);
    await list.locator('[data-add-type=bathroom]').click();
    const s = await stored(page);
    expect(s.otherRooms).toHaveLength(1);
    expect(s.room.type).toBe('bathroom');
    await expect(list).toHaveCount(0);
  });
}
