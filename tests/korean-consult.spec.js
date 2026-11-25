import { test, expect } from '@playwright/test';

const reply = { intent: 'furniture', action: 'none', furniture: 'chair' };
async function start(page) {
  await page.addInitScript(() => {
    window.__consultJobs = [];
    window.Worker = class {
      postMessage(job) {
        if (job.task === 'interpret') window.__consultJobs.push({ ...job, worker: this });
      }
      terminate() {}
    };
  });
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.evaluate(() => {
    const { app } = window.__roomggu;
    const small = structuredClone(app.state.room);
    app.state.name = '안방';
    app.state.otherRooms = [
      {
        roomId: 'small',
        name: '작은방',
        room: small,
        items: [
          {
            ...app.state.items.find((i) => i.type === 'bed'),
            id: 'small-bed',
            dims: [140, 55, 210],
          },
        ],
      },
    ];
    app.state.roomOrder.push('small');
    app.ai.text = 'ready';
    app.ai.model = 'gemma-4-E2B-it-q4f16_1-MLC';
  });
}
async function send(page, text, count = 1) {
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-input').press('Enter');
  await page.waitForFunction((n) => window.__consultJobs.length === n, count);
}
async function answer(page, value = JSON.stringify(reply)) {
  await page.evaluate((result) => {
    const job = window.__consultJobs.at(-1);
    job.worker.onmessage({ data: { id: job.id, result } });
  }, value);
  await page.waitForFunction(() => !window.__roomggu.app.busy);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const { app } = window.__roomggu;
    return {
      name: app.state.name,
      bed: app.state.items.find((i) => i.type === 'bed')?.dims,
      draft: app.draft,
      queue: app.queue,
      last: app.thread.findLast((t) => t.role === 'assistant'),
    };
  });
}

test('대상 방을 반영하기 전에 확인하고 같은 가구의 직전 치수만 정정한다', async ({ page }) => {
  await start(page);
  await send(page, '안방 침대 말고 작은방 침대 깊이 2150mm로 바꿔줘');
  expect((await snapshot(page)).name).toBe('안방');
  await answer(page);
  expect(await snapshot(page)).toMatchObject({ name: '작은방', bed: [140, 55, 215], draft: null });
  await send(page, '앗 2150 말고 2050이야', 2);
  await answer(page);
  expect((await snapshot(page)).bed).toEqual([140, 55, 205]);
  await send(page, '아까 그거 5cm만 줄여줘', 3);
  await answer(page);
  expect((await snapshot(page)).bed).toEqual([140, 55, 200]);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__roomggu.store.undo());
  expect(await snapshot(page)).toMatchObject({ name: '안방' });
});

test('진행 중 방을 바꿨다 돌아오면 이전 응답을 버린다', async ({ page }) => {
  await start(page);
  const before = await snapshot(page);
  await send(page, '침대 가로 185cm로 해줘');
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    const first = app.state.roomId;
    store.switchSpace('small');
    store.switchSpace(first);
  });
  await answer(page);
  expect(await snapshot(page)).toMatchObject({ name: before.name, bed: before.bed, draft: null });
  await expect(page.locator('.msg.assistant').last()).toContainText('상담 중에 배치가 바뀌었어요');
});

test('멈추기를 누르면 규칙도 배치를 바꾸지 않는다', async ({ page }) => {
  await start(page);
  const before = await snapshot(page);
  await send(page, '침대 가로 185cm로 해줘');
  await page.getByRole('button', { name: '멈추기', exact: true }).click();
  await answer(page);
  expect(await snapshot(page)).toMatchObject({ bed: before.bed, draft: null });
  await expect(page.locator('.msg.assistant').last()).toContainText('상담을 멈췄어요');
});

for (const fallback of ['invalid', 'timeout']) {
  test(`상담 ${fallback}이면 요청한 치수만 규칙으로 반영한다`, async ({ page }) => {
    await start(page);
    if (fallback === 'timeout') await page.clock.install();
    const before = await snapshot(page);
    await send(page, '침대 가로 175cm로 해줘');
    if (fallback === 'invalid') await answer(page, '{"intent":"furniture",');
    else await page.clock.fastForward(25001);
    expect(await snapshot(page)).toMatchObject({
      bed: [175, ...before.bed.slice(1)],
      last: { fallback, engine: 'rule' },
    });
    if (fallback === 'timeout') await answer(page);
    expect((await snapshot(page)).bed[0]).toBe(175);
  });
}

test('수량을 그대로 준비하고 일괄 배치가 막히면 방과 대기열을 보존한다', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const { app } = window.__roomggu;
    Object.assign(app.state.room, { w: 1.6, d: 1 });
    app.state.items = [];
  });
  await send(page, '책상 두 개만 추가해줘');
  await answer(page);
  const before = await snapshot(page);
  expect(before.queue.map((i) => i.type)).toEqual(['desk']);
  await page.getByRole('button', { name: '모두 놓기', exact: true }).click();
  expect(await page.evaluate(() => window.__roomggu.app.state.items)).toEqual([]);
  expect(await snapshot(page)).toMatchObject({ draft: before.draft, queue: before.queue });
  await expect(page.locator('.msg.assistant').last()).toContainText('빈자리가 없어요');
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`서비스 아이콘과 입력창 ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?model=off');
    await expect(page.locator('img.brand-mark').first()).toBeVisible();
    expect(
      await page
        .locator('img.brand-mark')
        .first()
        .evaluate((img) => img.naturalWidth),
    ).toBe(180);
    expect((await page.request.get('/favicon.png')).ok()).toBe(true);
    await expect(page.locator('#chat-input')).toBeInViewport();
  });
}

test('띄어 쓴 방 이름과 치수 없는 정정으로 가구를 고른 뒤 오타가 있는 치수를 반영한다', async ({
  page,
}) => {
  await start(page);
  await page.locator('#chat-input').fill('안방 침대 말고, 작은 방 침대');
  await page.locator('#chat-input').press('Enter');
  await expect.poll(async () => (await snapshot(page)).name).toBe('작은방');
  expect(await snapshot(page)).toMatchObject({ bed: [140, 55, 210], draft: null });
  await send(page, '침데 너비 165센치로 해죠');
  await answer(page);
  expect((await snapshot(page)).bed).toEqual([165, 55, 210]);
});

test('WebGPU를 지원하지 않을 때에도 치수를 안전하게 반영한다', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.goto('/');
  await page.waitForFunction(() => window.__roomggu?.app.ai.text === 'unsupported');
  await page.locator('#chat-input').fill('침대 깊이 2050mm로 바꿔줘');
  await page.locator('#chat-input').press('Enter');
  await expect.poll(async () => (await snapshot(page)).bed[2]).toBe(205);
  expect((await snapshot(page)).last).toMatchObject({ engine: 'rule', fallback: 'unsupported' });
});

test('상담 중 격자를 바꿔도 같은 평면도와 편집 대상을 유지한다', async ({ page }) => {
  await start(page);
  await send(page, '침대 가로 178cm로 해줘');
  const prior = await page.evaluate(() => {
    const { app } = window.__roomggu;
    window.__gridCanvas = app.scenes.house.canvas;
    return { grid: app.state.grid, items: structuredClone(app.state.items) };
  });
  const grid = page.getByRole('button', { name: '격자 표시' });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', String(!prior.grid));
  const actual = await page.evaluate(() => {
    const { app } = window.__roomggu;
    return {
      same: window.__gridCanvas === app.scenes.house.canvas,
      items: app.state.items,
      busy: app.busy?.kind,
    };
  });
  expect(actual).toEqual({ same: true, items: prior.items, busy: 'model' });
  await answer(page);
  expect((await snapshot(page)).bed[0]).toBe(178);
});

test('거실 기본 가구는 지정한 방에 한 번만 놓고, 한 번에 되돌린다', async ({ page }) => {
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  const send = async (text) => {
    await page.locator('#chat-input').fill(text);
    await page.locator('#chat-input').press('Enter');
    await expect(page.locator('.msg.user').last()).toContainText(text);
  };
  const read = () => page.evaluate(() => window.__roomggu.app.state);
  await send('화장실 하나 추가해줘');
  const bath = await read();
  await send('화장실의 오른쪽에다가 방 하나 만들어줘');
  await expect(page.locator('.msg.assistant').last()).toContainText('어떤 공간을 추가할까요');
  expect((await read()).roomOrder).toEqual(bath.roomOrder);
  await page.reload();
  await page.waitForFunction(() => window.__roomggu?.ready());
  await send('거실');
  const living = await read();
  expect(living.room.type).toBe('living');
  expect(living.roomOrder.length).toBe(bath.roomOrder.length + 1);
  await send('화장실 하나 추가해줘');
  const before = await read();
  await send('거실에 있을 법한 가구를 배치해줘');
  await expect(page.locator('.msg.assistant').last()).toContainText('놓았어요');
  const furnished = await read();
  expect(furnished.roomId).toBe(living.roomId);
  expect(furnished.items.map((i) => i.type)).toEqual(['sofa', 'coffee', 'tvstand']);
  expect(furnished.otherRooms.find((r) => r.roomId === before.roomId).items).toEqual(before.items);
  await send('거실 가구 세팅해줘');
  await expect(page.locator('.msg.assistant').last()).toContainText('기본 가구가 모두 있어요');
  expect((await read()).items).toEqual(furnished.items);
  await send('되돌려줘');
  expect((await read()).roomId).toBe(before.roomId);
  expect((await read()).otherRooms.find((r) => r.roomId === living.roomId).items).toEqual(
    living.items,
  );
});

for (const [unavailable, answer] of [
  ['현관 추가해줘', '아니, 공부방 만들어주세요'],
  ['현관으로 해주세요', '주방'],
  ['현관으로 해주세요', '거실은 말고 부엌으로 해줘'],
]) {
  test(`지원하지 않는 방 종류 뒤에 다시 골라도 처음 위치와 치수를 유지한다 (${answer})`, async ({
    page,
  }) => {
    await page.goto('/?model=off');
    await page.waitForFunction(() => window.__roomggu?.ready());
    const read = () => page.evaluate(() => window.__roomggu.app.state);
    const chat = page.locator('#chat-input');
    for (const text of [
      '화장실 하나 추가해줘',
      '화장실 오른쪽에 가로 3m 세로 2.5m짜리 방 하나 추가해줘',
    ]) {
      await chat.fill(text);
      await chat.press('Enter');
    }
    await expect(page.locator('.msg.assistant').last()).toContainText('어떤 공간을 추가할까요');
    const before = await read();
    await chat.fill(unavailable);
    await chat.press('Enter');
    await expect(page.locator('.msg.assistant').last()).toContainText(
      '현관은 아직 공간 종류에 없어요',
    );
    expect(await read()).toEqual(before);
    await page.reload();
    await page.waitForFunction(() => window.__roomggu?.ready());
    const isOffice = answer.includes('공부방');
    if (answer !== '주방') {
      await chat.fill(answer);
      await chat.press('Enter');
    } else {
      await page
        .locator('.msg.assistant')
        .last()
        .getByRole('button', { name: answer, exact: true })
        .click();
    }
    const name = isOffice ? '나의 공부방' : '나의 주방';
    await expect(page.locator('.msg.assistant').last()).toContainText(name);
    const after = await read();
    expect(after.roomOrder).toHaveLength(before.roomOrder.length + 1);
    expect(after.name).toBe(name);
    expect(after.room).toMatchObject({ type: isOffice ? 'office' : 'kitchen', w: 3, d: 2.5 });
    expect(after.floorplan.positions[after.roomId].x).toBeCloseTo(
      before.floorplan.positions[before.roomId].x + (before.room.w + after.room.w) / 2,
    );
    expect(after.otherRooms.find((r) => r.roomId === before.roomId).room).toEqual(before.room);
  });
}

test('방 종류를 고르기 전에 치수를 고쳐도 기준 방은 유지한다', async ({ page }) => {
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  const chat = page.locator('#chat-input');
  const send = async (message) => {
    await chat.fill(message);
    await chat.press('Enter');
  };
  const read = () => page.evaluate(() => window.__roomggu.app.state);
  await send('화장실 하나 추가해줘');
  const before = await read();
  await send('화장실 오른쪽에 가로 3m 세로 2.5m짜리 방 하나 추가해줘');
  await send('가로 50cm로 해줘');
  await expect(page.locator('.msg.assistant').last()).toContainText('1~15m');
  expect(await read()).toEqual(before);
  await send('가로 3.2m로 해줘');
  await expect(page.locator('.msg.assistant').last()).toContainText('가로 3.2m로 적어 뒀어요');
  expect(await read()).toEqual(before);
  await send('현관으로 해줘');
  await page.reload();
  await page.waitForFunction(() => window.__roomggu?.ready());
  await send('부엌으로 해줘');
  const after = await read();
  expect(after.room).toMatchObject({ type: 'kitchen', w: 3.2, d: 2.5 });
  expect(after.roomOrder).toHaveLength(before.roomOrder.length + 1);
  expect(after.floorplan.positions[after.roomId].x).toBeCloseTo(5.4);
  expect(after.otherRooms.find((r) => r.roomId === before.roomId).room).toEqual(before.room);
});

for (const correction of ['한 문장으로 다시 답하기', '새로고침 후 치수만 다시 답하기']) {
  test(`방 종류와 치수를 한 문장으로 답하기 · ${correction}`, async ({ page }) => {
    await page.goto('/?model=off');
    await page.waitForFunction(() => window.__roomggu?.ready());
    const chat = page.locator('#chat-input');
    const read = () => page.evaluate(() => window.__roomggu.app.state);
    const send = async (message) => {
      await chat.fill(message);
      await chat.press('Enter');
    };
    await send('화장실 하나 추가해줘');
    const before = await read();
    await send('화장실 오른쪽에 가로 3m 세로 2.5m짜리 방 하나 추가해줘');
    await send('부엌으로 하고 가로 50cm로 해줘');
    await expect(page.locator('.msg.assistant').last()).toContainText('1~15m');
    expect(await read()).toEqual(before);
    if (correction.startsWith('새로고침')) {
      await page.reload();
      await page.waitForFunction(() => window.__roomggu?.ready());
      await send('가로 3.2m로 해줘');
    } else {
      await send('부엌으로 하고 가로 3.2m로 해줘');
    }
    const after = await read();
    expect(after.roomOrder).toHaveLength(before.roomOrder.length + 1);
    expect(after.room).toMatchObject({ type: 'kitchen', w: 3.2, d: 2.5 });
    expect(after.floorplan.positions[after.roomId].x).toBeCloseTo(5.4);
    expect(after.otherRooms.find((r) => r.roomId === before.roomId)?.room).toEqual(before.room);
  });
}
