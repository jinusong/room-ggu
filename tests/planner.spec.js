import { test, expect } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));

test('상담 → 치수 확인 → 가구 배치 → 실행 취소 → 새로고침 복원', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-panel=consult]').first().click();
  await page
    .getByRole('textbox', { name: '공간 또는 가구 설명', exact: true })
    .fill('두 명이 넉넉하게 앉는 소파야. 가로 200cm 깊이 85cm');
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '등록 가구 가로', exact: true })).toHaveValue(
    '200',
  );
  await expect(page.getByRole('spinbutton', { name: '등록 가구 깊이', exact: true })).toHaveValue(
    '85',
  );
  await page.locator('#add-item').click();
  expect((await stored(page)).items).toHaveLength(5);
  await page.locator('#rotate').click();
  expect((await stored(page)).items.at(-1).angle).toBe(90);
  await page.locator('#delete').first().click();
  expect((await stored(page)).items).toHaveLength(4);
  await page.locator('#undo').click();
  expect((await stored(page)).items).toHaveLength(5);
  await page.reload();
  await expect(page.locator('#room-meta')).toContainText('가구 5개');
  const file = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await file).suggestedFilename()).toMatch(/배치\.json$/);
});

test('2D로 복원한 후 3D에서 실제 가구를 드래그할 수 있다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '2D 평면', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '3D 공간', exact: true }).click();
  await page.locator('#viewport-3d canvas').waitFor();
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const box = await page.locator('#viewport-3d canvas').boundingBox(),
    s = await stored(page),
    a = s.items[0];
  const camera = new PerspectiveCamera(38, box.width / box.height, 0.05, 100);
  camera.position.set(6.6, 5.8, 7);
  camera.lookAt(0, 0.5, 0);
  camera.updateMatrixWorld();
  const p = new Vector3(a.x, 0.5, a.z).project(camera),
    x = box.x + ((p.x + 1) * box.width) / 2,
    y = box.y + ((1 - p.y) * box.height) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 15, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#selection-tools')).toContainText('침대');
  const next = (await stored(page)).items[0];
  expect(Math.abs(next.x - a.x) + Math.abs(next.z - a.z)).toBeGreaterThan(0.1);
});

test('모바일에서 방 설정·목록·불러오기에 접근하고 가로 넘침이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#mobile-menu').click();
  await page.locator('.mobile-panel-nav [data-panel="room"]').click();
  await page.locator('#room-form input[name=w]').fill('4.5');
  await page.locator('#room-form button').click();
  await expect(page.locator('#room-meta')).toContainText('4.5 × 4');
  await page.locator('.mobile-panel-nav [data-panel="items"]').click();
  await expect(page.locator('.item-list')).toBeVisible();
  await page.locator('#mobile-close').click();
  await expect(page.locator('#import')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('잘못된 배치 파일을 거절하고 기존 데이터를 보존한다', async ({ page }) => {
  await page.goto('/');
  const before = await stored(page);
  await page.locator('#layout-file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":2,"items":[]}'),
  });
  await expect(page.locator('#toast')).toContainText('불러오기 실패');
  expect(await stored(page)).toEqual(before);
  await page.locator('#layout-file').setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before)),
  });
  await expect(page.locator('#toast')).toContainText('배치를 불러왔어요');
  expect(await stored(page)).toEqual(before);
});

test('가구 20종을 검색하고 여러 크기 초안을 적용해 배치한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-panel=catalog]').first().click();
  await expect(page.locator('.catalog-card')).toHaveCount(20);
  await expect(page.locator('.catalog-card img')).toHaveCount(20);
  await page.locator('#catalog-search').fill('식탁');
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  await page.locator('.catalog-card').click();
  await page.getByRole('button', { name: '6인 식탁' }).click();
  await expect(page.getByRole('spinbutton', { name: '등록 가구 가로', exact: true })).toHaveValue(
    '180',
  );
  await page.locator('#add-item').click();
  const s = await stored(page);
  expect(s.items.at(-1).type).toBe('dining');
  expect(s.items.at(-1).dims).toEqual([180, 74, 90]);
  await page.locator('[data-panel=catalog]').first().click();
  await page.locator('#catalog-search').fill('러그');
  await page.locator('.catalog-card').click();
  await page.locator('#add-item').click();
  expect((await stored(page)).items.at(-1).dims[1]).toBe(1);
});

test('입력 도중 방 크기를 즉시 반영하며 한 번의 실행 취소로 복구한다', async ({ page }) => {
  await page.goto('/');
  const before = await stored(page);
  const width = page.getByRole('spinbutton', { name: '방 가로', exact: true });
  await width.fill('6.5');
  await expect(page.locator('#room-meta')).toContainText('6.5 × 4');
  expect((await stored(page)).room.w).toBe(6.5);
  await expect(page.locator('#room-area')).toContainText('26.0');
  await width.blur();
  await page.locator('#undo').click();
  expect((await stored(page)).room.w).toBe(before.room.w);
  await page.locator('[data-room-type=living]').click();
  await expect(page.locator('#room-meta')).toContainText('거실 · 5.5 × 4.5');
  await page.locator('[data-room-size="0"]').click();
  expect((await stored(page)).room.w).toBe(4);
  await page.getByRole('button', { name: '바닥 색상 월넛', exact: true }).click();
  expect((await stored(page)).room.floorColor).toBe('#93785c');
});

test('상담으로 방을 수정·추가하고 전환해도 각 방의 가구를 보존한다', async ({ page }) => {
  await page.goto('/');
  const first = await stored(page);
  await page.locator('[data-panel=consult]').first().click();
  await page
    .locator('#chat-input')
    .fill('거실 가로 5m 세로 4m 천장 2.6m로 바꿔줘. 소파 중심으로 꾸밀 거야.');
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  await expect(page.locator('#room-meta')).toContainText('거실 · 5 × 4');
  let s = await stored(page);
  expect(s.room.h).toBe(2.6);
  expect(s.items).toHaveLength(4);
  await expect(page.locator('.conversation-space')).toBeVisible();
  await page.locator('#chat-input').fill('아담한 서재 하나 추가해줘');
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
  s = await stored(page);
  expect(s.room.type).toBe('office');
  expect(s.room.w).toBe(2.5);
  expect(s.items).toHaveLength(0);
  expect(s.otherRooms).toHaveLength(1);
  await page.locator('[data-quick=desk]').first().click();
  await page.locator('#add-item').click();
  expect((await stored(page)).items).toHaveLength(1);
  await page.locator(`[data-space="${first.roomId}"]`).click();
  expect((await stored(page)).items).toHaveLength(4);
  expect((await stored(page)).room.w).toBe(5);
  await page.reload();
  expect((await stored(page)).otherRooms[0].items).toHaveLength(1);
  await expect(page.locator('[data-space]')).toHaveCount(2);
});

test('공간을 직접 추가·삭제하고 실행 취소로 방 전체를 복원한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#space-add').click();
  await page.locator('[data-newspace=bedroom]').click();
  expect((await stored(page)).room.type).toBe('bedroom');
  await page.locator('#delete-room').click();
  await page.locator('#delete-space-confirm').click();
  expect((await stored(page)).otherRooms).toHaveLength(0);
  await page.locator('#undo').click();
  expect((await stored(page)).room.type).toBe('bedroom');
  expect((await stored(page)).otherRooms).toHaveLength(1);
});
