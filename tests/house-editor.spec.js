import { test, expect } from '@playwright/test';
import { exampleState, freshState, makeRoom } from '../src/data.js';
import { connections } from '../src/floorplan.js';
import { addSpace, renameSpace, setRoom, SIDES, switchSpace } from '../src/app/ops.js';

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

test('방 이름만 고치면 기존 종류를 유지하고 직접 고른 종류는 저장한다', async ({ page }) => {
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const before = await read(page);
  const edit = editor(page).getByRole('button', { name: '방 편집', exact: true });
  const form = editor(page).getByRole('form', { name: '방 편집' });
  const type = form.getByLabel('방 종류');
  const save = form.getByRole('button', { name: '저장', exact: true });
  await edit.click();
  await expect(type).toHaveValue(before.room.type);
  await form.getByLabel('방 이름').fill('창가 방');
  await save.click();
  const renamed = await read(page);
  expect(renamed).toEqual({ ...before, name: '창가 방' });
  await edit.click();
  await type.selectOption('office');
  await save.click();
  expect(await read(page)).toMatchObject({ name: '창가 방', room: { type: 'office' } });
  await editor(page).getByRole('button', { name: '실행 취소', exact: true }).click();
  expect(await read(page)).toEqual(renamed);
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

test('지목한 화장실이 없으면 다른 방에 대신 붙이지 않는다', async ({ page }) => {
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const before = await read(page);
  const chat = page.locator('#chat-input');
  await chat.fill('화장실 옆에 침실 추가해달라');
  await chat.press('Enter');
  await expect(page.locator('.msg.assistant').last()).toContainText('평면도에 화장실이 없어요');
  expect(await read(page)).toEqual(before);
});

test('기준 화장실 사방이 막혀 있으면 배치와 다시 실행을 지킨다', async ({ page }) => {
  const state = freshState();
  const bath = state.roomId;
  setRoom(state, makeRoom('bathroom'));
  renameSpace(state, '기준 화장실');
  let right;
  for (const side of Object.keys(SIDES)) {
    switchSpace(state, bath);
    const vertical = side === 'right' || side === 'left';
    const id = addSpace(state, 'studio', side, {
      room: { ...makeRoom('studio'), w: vertical ? 4 : 1.8, d: vertical ? 2.2 : 4 },
    });
    if (side === 'right') right = id;
  }
  await page.addInitScript(
    (seed) => localStorage.setItem('room-ggu-v2', JSON.stringify(seed)),
    state,
  );
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const area = editor(page);
  await area.getByRole('button', { name: '방 편집', exact: true }).click();
  const form = area.getByRole('form', { name: '방 편집' });
  await form.getByLabel('방 이름').fill('새 원룸 이름');
  await form.getByRole('button', { name: '저장', exact: true }).click();
  await area.getByRole('button', { name: '실행 취소', exact: true }).click();
  const before = await read(page);
  const redo = area.getByRole('button', { name: '다시 실행', exact: true });
  await expect(redo).toBeEnabled();
  const chat = page.locator('#chat-input');
  await chat.fill('화장실 옆에 침실 추가해줘');
  await chat.press('Enter');
  const reply = page.locator('.msg.assistant').last();
  await expect(reply).toContainText('기준 화장실 둘레에 침실을 붙일 자리가 없어요');
  await expect(reply.locator('[data-surface]')).toHaveCount(0);
  expect(await read(page)).toEqual(before);
  await redo.click();
  expect((await read(page)).name).toBe('새 원룸 이름');
  await area.getByLabel('선택한 방').selectOption(right);
  await area.getByRole('button', { name: '방 삭제', exact: true }).click();
  await area
    .getByRole('group', { name: '방 삭제 확인' })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await chat.fill('화장실 왼쪽에 침실 추가해줘');
  await chat.press('Enter');
  await expect(reply).toContainText('왼쪽에는 자리가 없어 다른 벽에 붙였어요');
  await expect(reply).toContainText('기준 화장실 오른쪽에');
  const added = await read(page);
  expect(added.room.type).toBe('bedroom');
  const link = connections([added, ...added.otherRooms], added.floorplan).find(
    ({ ids }) => ids.includes(bath) && ids.includes(added.roomId),
  );
  expect(link?.opening).toBeTruthy();
});

test('화장실이 여럿이면 기준을 고르고 새로고침 뒤 방 종류에 답한다', async ({ page }) => {
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const home = await read(page);
  const second = await page.evaluate((id) => {
    const { app, store } = window.__roomggu;
    store.addSpace('bathroom', { side: 'right' });
    store.switchSpace(id);
    store.addSpace('bathroom', { side: 'left' });
    const bath = app.state.roomId;
    store.switchSpace(id);
    return bath;
  }, home.roomId);
  const before = await read(page);
  const chat = page.locator('#chat-input');
  await chat.fill('화장실 왼쪽에 가로 3m 세로 2.5m짜리 방 추가해달라');
  await chat.press('Enter');
  const last = page.locator('.msg.assistant').last();
  await expect(last).toContainText('어느 화장실');
  expect(await read(page)).toEqual(before);
  await last.getByRole('button', { name: '나의 화장실 2', exact: true }).click();
  await expect(last).toContainText('나의 화장실 2 왼쪽에 어떤 공간');
  await page.reload();
  await expect(plan(page)).toBeVisible();
  await chat.fill('침실로 해줘');
  await chat.press('Enter');
  const after = await read(page);
  expect(after.roomOrder).toHaveLength(before.roomOrder.length + 1);
  expect(after.room).toMatchObject({ type: 'bedroom', w: 3, d: 2.5 });
  expect(after.floorplan.positions[after.roomId].x).toBeCloseTo(
    before.floorplan.positions[second].x - (1.8 + after.room.w) / 2,
  );
  await chat.fill('나의 화장실 2 위쪽에 가로 2m 서재 추가해줘');
  await chat.press('Enter');
  const named = await read(page);
  expect(named.roomOrder).toHaveLength(after.roomOrder.length + 1);
  expect(named.room).toMatchObject({ type: 'office', w: 2 });
  expect(named.floorplan.positions[named.roomId].z).toBeCloseTo(
    before.floorplan.positions[second].z - (2.2 + named.room.d) / 2,
  );
});

test('삭제 확인에서 추가를 열고 취소하면 팝업과 배치가 남지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  await page.evaluate(() => window.__roomggu.store.addSpace('bathroom', { side: 'right' }));
  const before = await read(page);
  const area = editor(page);
  const remove = area.getByRole('button', { name: '방 삭제', exact: true });
  const add = area.getByRole('button', { name: '방 추가', exact: true });
  await remove.click();
  const confirm = area.getByRole('group', { name: '방 삭제 확인' });
  await expect(confirm).toBeVisible();
  await add.click();
  const picker = area.getByRole('group', { name: '방 추가', exact: true });
  await expect(picker).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await picker.locator('[data-add-type=bathroom]').focus();
  expect(await page.evaluate(() => window.__roomggu.app.view.ghostRoom)).not.toBeNull();
  await picker.getByRole('button', { name: '방 추가 닫기' }).click();
  await expect(picker).toHaveCount(0);
  await expect(add).toBeFocused();
  expect(await page.evaluate(() => window.__roomggu.app.view.ghostRoom)).toBeNull();
  expect(await read(page)).toEqual(before);
});

test('키보드로 방 종류 목록을 벗어나면 점선 미리보기가 사라진다', async ({ page }) => {
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const area = editor(page);
  await area.getByRole('button', { name: '방 추가', exact: true }).click();
  const picker = area.getByRole('group', { name: '방 추가', exact: true });
  await picker.getByLabel('붙일 위치').press('Tab');
  await expect(picker.locator('[data-add-type]').first()).toBeFocused();
  const readPreview = () => page.evaluate(() => window.__roomggu.app.view.ghostRoom);
  expect(await readPreview()).not.toBeNull();
  await page.keyboard.press('Shift+Tab');
  await expect(picker.getByLabel('붙일 위치')).toBeFocused();
  expect(await readPreview()).toBeNull();
});
