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
  await page.waitForFunction(() => window.__roomggu?.ready());
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
  const pop = page.getByRole('group', { name: '방 추가', exact: true });
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
  await page.getByLabel('선택한 방').selectOption(studio);
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
  await page.locator('#add-space').click();
  await page.locator('[data-add-type=bathroom]').focus();
  expect(await page.evaluate(() => !!window.__roomggu.app.scenes.house.ghostRoom)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => !!window.__roomggu.app.scenes.house.ghostRoom)).toBe(false);
  // 실행 취소로 붙인 공간이 사라진다.
  await page.locator('#undo').click();
  expect((await stored(page)).otherRooms).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`모바일 ${size.width}: 방 종류 선택지가 시트 위에 들어온다`, async ({ page }) => {
    await openHouse(page, size);
    await page.locator('[data-add-side=right]').click();
    const list = page.locator('[data-add-list]');
    await expect(list).toBeVisible();
    const box = await list.boundingBox(),
      sheet = await page.locator('.sheet').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(sheet.y + 1);
    await list.locator('[data-add-type=bathroom]').click();
    const s = await stored(page);
    expect(s.otherRooms).toHaveLength(1);
    expect(s.room.type).toBe('bathroom');
    await expect(list).toHaveCount(0);
  });
}

test('방 삭제를 Esc로 취소하거나 확인한 뒤 되돌릴 수 있다', async ({ page }) => {
  await openHouse(page);
  await page.evaluate(() => window.__roomggu.store.addSpace('bedroom'));
  await frames(page);
  const bed = await page.evaluate(() => window.__roomggu.app.state.roomId);
  await page.locator('[data-room-delete]').click();
  const confirm = page.getByRole('group', { name: '방 삭제 확인' });
  await expect(confirm).toContainText('나의 침실을 삭제할까요?');
  await page.screenshot({ path: 'test-results/room-delete-ask.png' });
  // Esc는 취소한다.
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await page.locator('[data-room-delete]').click();
  await confirm.locator('[data-room-delete-confirm]').click();
  await expect(page.locator(`[data-room-tag="${bed}"]`)).toHaveCount(0);
  expect((await stored(page)).otherRooms.length).toBe(0);
  await page.locator('#undo').click();
  await expect(page.locator(`[data-room-tag="${bed}"]`)).toHaveCount(1);
  // 마지막 공간이면 휴지통을 끈다.
  await page.getByLabel('선택한 방').selectOption({ index: 0 });
  await page.evaluate(() => window.__roomggu.store.deleteSpace(window.__roomggu.app.state.roomId));
  await frames(page);
  await expect(page.locator('[data-room-delete]')).toBeDisabled();
});

test('벽의 +에서 연 방 추가를 닫으면 그 벽의 손잡이로 초점이 돌아온다', async ({ page }) => {
  await openHouse(page);
  const handle = page.getByRole('button', { name: /오른쪽에 공간 붙이기/ });
  const picker = page.getByRole('group', { name: '방 추가', exact: true });
  await handle.click();
  await expect(picker.getByLabel('붙일 위치')).toBeFocused();
  await picker.getByLabel('붙일 위치').selectOption('left');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(handle).toBeFocused();
  await handle.press('Enter');
  await picker.getByRole('button', { name: '방 추가 닫기', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(handle).toBeFocused();
});
