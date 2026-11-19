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
