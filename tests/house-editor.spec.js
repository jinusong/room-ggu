import { test, expect } from '@playwright/test';
import { exampleState, freshState, makeRoom, spaces } from '../src/data.js';
import { connections, DOOR, floorplanWarnings } from '../src/floorplan.js';
import {
  addSpace,
  addWindow,
  moveSpace,
  renameSpace,
  setRoom,
  setWindow,
  SIDES,
  switchSpace,
} from '../src/app/ops.js';

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
    const selectedRoom = editor(page).getByLabel('선택한 방');
    await selectedRoom.selectOption(initial.roomId);
    expect((await read(page)).roomId).toBe(initial.roomId);
    await selectedRoom.selectOption(added.roomId);
    await edit.click();
    const form = editor(page).getByRole('form', { name: '방 편집', exact: true });
    await form.getByLabel('방 이름').fill('조용한 작업실');
    await form.getByLabel('방 종류').selectOption('office');
    await form.getByLabel('가로 (m)', { exact: true }).fill('2.2');
    await form.getByLabel('세로 (m)', { exact: true }).fill('2.6');
    await form.getByRole('button', { name: '저장', exact: true }).click();
    const edited = await read(page);
    expect(edited).toMatchObject({
      name: '조용한 작업실',
      room: { type: 'office', w: 2.2, d: 2.6 },
    });
    await editor(page).getByRole('button', { name: '실행 취소', exact: true }).click();
    expect(await read(page)).toEqual(added);
    await editor(page).getByRole('button', { name: '다시 실행', exact: true }).click();
    expect(await read(page)).toEqual(edited);
    await remove.click();
    const confirmation = editor(page).getByRole('group', { name: '방 삭제 확인' });
    await expect(confirmation.getByText('조용한 작업실을 삭제할까요?')).toBeVisible();
    await confirmation.getByRole('button', { name: '취소', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(await read(page)).toEqual(edited);
    await remove.click();
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

test('이전 배치 파일의 소수점 셋째 자리 치수도 이름을 바꿀 때 보존한다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const old = exampleState();
  old.version = 4;
  old.room.w = 4.125;
  await page.locator('#layout-file').setInputFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect.poll(async () => (await read(page)).room.w).toBe(old.room.w);
  const imported = await read(page);
  await editor(page).getByRole('button', { name: '방 편집', exact: true }).click();
  const form = editor(page).getByRole('form', { name: '방 편집' });
  await form.getByLabel('방 이름').fill('창가 방');
  await form.getByRole('button', { name: '저장', exact: true }).click();
  expect(await read(page)).toEqual({ ...imported, name: '창가 방' });
  await page.reload();
  await expect(plan(page)).toBeVisible();
  expect(await read(page)).toEqual({ ...imported, name: '창가 방' });
});

test('좌표 범위를 넘기는 크기 변경과 회전은 저장값 및 다시 실행을 보존한다', async ({ page }) => {
  const state = freshState();
  const original = state.roomId;
  const room = { ...makeRoom('studio'), w: 2, d: 4 };
  setRoom(state, room);
  state.floorplan.positions[original].x = 199.5;
  addSpace(state, 'studio', 'left', { room });
  switchSpace(state, original);
  await page.addInitScript((seed) => {
    if (!localStorage.getItem('room-ggu-v2'))
      localStorage.setItem('room-ggu-v2', JSON.stringify(seed));
  }, state);
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const area = editor(page);
  const edit = area.getByRole('button', { name: '방 편집', exact: true });
  const form = area.getByRole('form', { name: '방 편집' });
  const save = form.getByRole('button', { name: '저장', exact: true });
  const redo = area.getByRole('button', { name: '다시 실행', exact: true });
  const message = /공간 위치는 -200~200m/;
  await edit.click();
  await form.getByLabel('방 이름').fill('다시 적용할 이름');
  await save.click();
  await area.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(redo).toBeEnabled();
  const before = await read(page);
  await edit.click();
  await form.getByLabel('가로 (m)', { exact: true }).fill('4');
  await save.click();
  await expect(form.getByRole('alert')).toContainText(message);
  expect(await read(page)).toEqual(before);
  await form.getByRole('button', { name: '선택한 방 90도 돌리기' }).click();
  await expect(page.locator('#toast')).toContainText(message);
  await expect(form).toBeVisible();
  expect(await read(page)).toEqual(before);
  await page.keyboard.press('Escape');
  const chat = page.locator('#chat-input');
  for (const text of ['가로 4m로 바꿔줘', '이 방 돌려줘']) {
    await chat.fill(text);
    await chat.press('Enter');
    await expect(page.locator('.msg.assistant').last()).toContainText(message);
    expect(await read(page)).toEqual(before);
    await expect(redo).toBeEnabled();
  }
  await redo.click();
  await page.reload();
  await expect(plan(page)).toBeVisible();
  expect(await read(page)).toEqual({ ...before, name: '다시 적용할 이름' });
});

test('방 이름을 한글로 조합하는 도중의 Esc는 편집 창을 닫지 않는다', async ({ page }) => {
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const area = editor(page);
  const edit = area.getByRole('button', { name: '방 편집', exact: true });
  await edit.click();
  const form = area.getByRole('form', { name: '방 편집' });
  await form.getByLabel('방 이름').dispatchEvent('keydown', {
    key: 'Escape',
    isComposing: true,
  });
  await expect(form).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test('창문이 연결 문을 막으면 추가 메뉴가 그 벽을 빼고 상담은 빈 벽을 찾는다', async ({ page }) => {
  const state = freshState();
  const bath = state.roomId;
  setRoom(state, makeRoom('bathroom'));
  renameSpace(state, '기준 화장실');
  const window = addWindow(state, 'right');
  setWindow(state, window, { width: state.room.d - 0.1 });
  await page.addInitScript(
    (seed) => localStorage.setItem('room-ggu-v2', JSON.stringify(seed)),
    state,
  );
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  await editor(page).getByRole('button', { name: '방 추가', exact: true }).click();
  const picker = editor(page).getByRole('group', { name: '방 추가', exact: true });
  await expect(picker.locator('option[value=right]')).toHaveCount(0);
  await picker.getByRole('button', { name: '방 추가 닫기' }).click();
  const chat = page.locator('#chat-input');
  await chat.fill('화장실 오른쪽에 가로 3m 세로 2.5m 침실 추가해줘');
  await chat.press('Enter');
  const reply = page.locator('.msg.assistant').last();
  await expect(reply).toContainText('오른쪽에는 자리가 없어 다른 벽에 붙였어요');
  await expect(reply).toContainText('기준 화장실 왼쪽에');
  const added = await read(page);
  expect(added.room).toMatchObject({ type: 'bedroom', w: 3, d: 2.5 });
  expect(added.otherRooms.find(({ roomId }) => roomId === bath).room.windows).toEqual(
    state.room.windows,
  );
  const [link] = connections([added, ...added.otherRooms], added.floorplan);
  expect(link?.opening).toBeTruthy();
  await editor(page).getByRole('button', { name: '실행 취소', exact: true }).click();
  await chat.fill('서재를 추가해줘');
  await chat.press('Enter');
  await expect(reply).toContainText('기준 화장실 왼쪽에');
  expect((await read(page)).room.type).toBe('office');
});

test('25cm 단위 사이에 있는 좁은 자리에 요청한 벽을 따라 붙인다', async ({ page }) => {
  const state = freshState();
  const studio = state.roomId;
  const room = { ...makeRoom('studio'), w: 1.8, d: 1.8 };
  const top = addSpace(state, 'studio', 'right', { room });
  moveSpace(state, top, 2.9, -1.05, { snap: false });
  switchSpace(state, studio);
  const bottom = addSpace(state, 'studio', 'front', { room });
  moveSpace(state, bottom, 2.9, 1.85, { snap: false });
  switchSpace(state, studio);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(
    (seed) => localStorage.setItem('room-ggu-v2', JSON.stringify(seed)),
    state,
  );
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const chat = page.locator('#chat-input');
  await chat.fill('내 방 오른쪽에 가로 2m 세로 1m 침실 추가해줘');
  await chat.press('Enter');
  const reply = page.locator('.msg.assistant').last();
  await expect(reply).toContainText(`${state.name} 오른쪽에`);
  const added = await read(page);
  expect(added.room).toMatchObject({ w: 2, d: 1, type: 'bedroom' });
  expect(added.floorplan.positions[added.roomId].x).toBe(3);
  expect(floorplanWarnings(spaces(added), added.floorplan).size).toBe(0);
  expect(
    connections(spaces(added), added.floorplan).some(
      ({ ids, opening }) => opening && ids.includes(studio) && ids.includes(added.roomId),
    ),
  ).toBe(true);
});

test('같은 벽에서 창문 사이에 문을 낼 수 있는 자리를 찾는다', async ({ page }) => {
  const state = freshState();
  const first = addWindow(state, 'right');
  setWindow(state, first, { offset: 0.05, width: 1.89 });
  const second = addWindow(state, 'right');
  setWindow(state, second, { offset: 2.8, width: 1.15 });
  await page.addInitScript(
    (seed) => localStorage.setItem('room-ggu-v2', JSON.stringify(seed)),
    state,
  );
  await page.goto('/?model=off');
  await expect(plan(page)).toBeVisible();
  const chat = page.locator('#chat-input');
  await chat.fill('내 방 오른쪽에 가로 2m 세로 1m 침실 추가해줘');
  await chat.press('Enter');
  const added = await read(page);
  const [link] = connections(spaces(added), added.floorplan);
  expect(link?.opening).toBeTruthy();
  expect(link?.opening.x).toBe(2);
  const start = link.opening.z - link.opening.width / 2;
  const end = link.opening.z + link.opening.width / 2;
  expect(start).toBeGreaterThanOrEqual(-0.061);
  expect(end).toBeLessThanOrEqual(0.801);
  expect(start).toBeGreaterThanOrEqual(link.wall.start + DOOR.margin - 1e-6);
  expect(end).toBeLessThanOrEqual(link.wall.end - DOOR.margin + 1e-6);
  const reply = page.locator('.msg.assistant').last();
  await expect(reply).toContainText(`${state.name} 오른쪽에`);
  await expect(reply).not.toContainText('오른쪽에는 자리가 없어');
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
  await area.getByLabel('선택한 방').selectOption(bath);
  const selected = await read(page);
  await chat.fill('침실을 추가해줘');
  await chat.press('Enter');
  await expect(reply).toContainText('기준 화장실 둘레에 침실을 붙일 자리가 없어요');
  expect(await read(page)).toEqual(selected);
  await page.evaluate(() => window.__roomggu.store.openTool('spaces'));
  await page.locator('.new-space').getByRole('button', { name: '침실', exact: true }).click();
  await expect(page.locator('#toast')).toContainText(
    '기준 화장실 둘레에 침실을 붙일 자리가 없어요',
  );
  expect(await read(page)).toEqual(selected);
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
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
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
