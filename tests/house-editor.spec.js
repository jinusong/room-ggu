import { test, expect } from '@playwright/test';
import { exampleState } from '../src/data.js';
import { connections } from '../src/floorplan.js';

const read = (page) => page.evaluate(() => structuredClone(window.__roomggu.app.state));
const editor = (page) => page.getByRole('main', { name: '집 전체 평면도 편집기' });
const plan = (page) => editor(page).locator('canvas');

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 640],
]) {
  test(`${width}px에서 한 평면도로 방 추가·이름과 치수 편집·삭제·복원`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?model=off');
    await expect(plan(page)).toBeVisible();
    const initial = await read(page);
    const add = editor(page).getByRole('button', { name: '방 추가', exact: true });
    const edit = editor(page).getByRole('button', { name: '방 편집', exact: true });
    const remove = editor(page).getByRole('button', { name: '방 삭제', exact: true });
    for (const button of [add, edit, remove])
      expect((await button.boundingBox()).width).toBeGreaterThanOrEqual(44);
    await expect(add.getByText('추가', { exact: true })).toBeVisible();
    await expect(edit.getByText('편집', { exact: true })).toBeVisible();
    await expect(remove.getByText('삭제', { exact: true })).toBeVisible();
    await expect(remove).toBeDisabled();
    await add.click();
    const picker = editor(page).getByRole('group', { name: '방 추가', exact: true });
    await picker.getByLabel('붙일 위치').selectOption('right');
    await picker.locator('[data-add-type=bathroom]').click();
    const added = await read(page);
    expect(added.roomOrder).toHaveLength(2);
    expect(added.room.type).toBe('bathroom');
    expect(added.floorplan.positions[added.roomId].x).toBeCloseTo(
      (initial.room.w + added.room.w) / 2,
    );
    expect(connections([added, ...added.otherRooms], added.floorplan)).toHaveLength(1);
    await edit.click();
    const form = editor(page).getByRole('form', { name: '방 편집', exact: true });
    await form.getByLabel('방 이름').fill('작은 욕실');
    await form.getByLabel('가로 (m)', { exact: true }).fill('2.2');
    await form.getByLabel('세로 (m)', { exact: true }).fill('2.6');
    await form.getByRole('button', { name: '저장', exact: true }).click();
    const edited = await read(page);
    expect(edited).toMatchObject({ name: '작은 욕실', room: { w: 2.2, d: 2.6 } });
    await editor(page).getByRole('button', { name: '실행 취소', exact: true }).click();
    expect(await read(page)).toEqual(added);
    await editor(page).getByRole('button', { name: '다시 실행', exact: true }).click();
    expect(await read(page)).toEqual(edited);
    await remove.click();
    const confirmation = editor(page).getByRole('group', { name: '방 삭제 확인' });
    await expect(confirmation.getByText('작은 욕실을 삭제할까요?')).toBeVisible();
    await confirmation.getByRole('button', { name: '삭제', exact: true }).click();
    expect((await read(page)).roomOrder).toHaveLength(1);
    await editor(page).getByRole('button', { name: '실행 취소', exact: true }).click();
    expect(await read(page)).toEqual(edited);
    expect(await plan(page).count()).toBe(1);
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(errors).toEqual([]);
  });
}

test('이전 3D 저장본을 읽어도 집 전체 평면도에서만 편집하고 저장한다', async ({ page }) => {
  const old = { ...exampleState(), view: '3d', scope: 'room' };
  await page.addInitScript((state) => {
    if (!localStorage.getItem('room-ggu-v2'))
      localStorage.setItem('room-ggu-v2', JSON.stringify(state));
  }, old);
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  expect(await read(page)).toMatchObject({ scope: 'house', view: '2d', items: old.items });
  await page.reload();
  await expect(plan(page)).toBeVisible();
  expect(await plan(page).count()).toBe(1);
  await expect(editor(page).getByRole('group', { name: '보기 방식', exact: true })).toHaveCount(0);
});

test('현재 방 옆과 다른 화장실 옆에 말로 새 공간을 붙인다', async ({ page }) => {
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const chat = page.locator('#chat-input');
  const say = async (text) => {
    await chat.fill(text);
    await chat.press('Enter');
  };
  const first = await read(page);
  await say('내 방 옆에 화장실 붙여줄래?');
  const bath = await read(page);
  expect(bath.roomOrder).toHaveLength(2);
  expect(bath.room.type).toBe('bathroom');
  expect(bath.otherRooms[0].room).toEqual(first.room);
  await editor(page).getByLabel('선택한 방').selectOption(first.roomId);
  await say('화장실 오른쪽에 방 추가해달라');
  await expect(page.locator('.msg.assistant').last()).toContainText(
    '나의 화장실 오른쪽에 어떤 공간',
  );
  const pending = await read(page);
  expect(pending.roomOrder).toEqual(bath.roomOrder);
  await say('침실로 만들어줄래?');
  const added = await read(page);
  expect(added.roomOrder).toHaveLength(3);
  expect(added.room.type).toBe('bedroom');
  expect(added.floorplan.positions[added.roomId].x).toBeCloseTo(
    bath.floorplan.positions[bath.roomId].x + (bath.room.w + added.room.w) / 2,
  );
  expect(added.otherRooms.find((room) => room.roomId === bath.roomId).room).toEqual(bath.room);
  expect(await plan(page).count()).toBe(1);
});
