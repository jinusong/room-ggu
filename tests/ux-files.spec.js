import { test, expect } from '@playwright/test';

async function start(page, { worker = false } = {}) {
  await page.addInitScript(
    ({ worker }) => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return String(type).includes('webgl') ? null : original.call(this, type, ...args);
      };
      if (worker) {
        window.__jobs = [];
        window.Worker = class {
          postMessage(data) {
            window.__jobs.push({ ...data, worker: this });
          }
          terminate() {
            this.terminated = true;
          }
        };
      }
    },
    { worker },
  );
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.evaluate(() => {
    window.__roomggu.store.dismissToast();
    window.__saved = () => structuredClone(window.__roomggu.app.state);
    window.__file = (name) => {
      const state = window.__saved();
      state.name = name;
      return { size: 100, text: async () => JSON.stringify(state) };
    };
    window.__defer = (name) => {
      const file = window.__file(name),
        json = file.text();
      return {
        size: 100,
        text: () =>
          new Promise((resolve) => {
            window.__release = async () => resolve(await json);
          }),
      };
    };
  });
}
const get = (page) =>
  page.evaluate(() => ({
    name: window.__roomggu.app.state.name,
    draft: window.__roomggu.app.draft,
    queue: window.__roomggu.app.queue,
    photo: window.__roomggu.app.photo,
    busy: window.__roomggu.app.busy,
    loading: window.__roomggu.app.fileLoading,
    error: window.__roomggu.app.fileError,
  }));

test('마지막으로 고른 배치 파일을 유지한다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    const a = store.importJSON(window.__defer('먼저 고른 파일'));
    await store.importJSON(window.__file('나중에 고른 파일'));
    await window.__release();
    await a;
  });
  expect((await get(page)).name).toBe('나중에 고른 파일');
});

test('이전 파일의 늦은 오류가 새 파일의 성공을 덮지 않는다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    let release;
    const a = store.importJSON({
      size: 100,
      text: () =>
        new Promise((_, reject) => {
          release = () => reject(Error('이전 파일 오류'));
        }),
    });
    await store.importJSON(window.__file('정상 파일'));
    release();
    await a;
  });
  expect(await get(page)).toMatchObject({ name: '정상 파일', error: '', loading: false });
});

test('나중에 고른 파일이 잘못됐으면 먼저 고른 파일도 적용하지 않는다', async ({ page }) => {
  await start(page);
  const before = (await get(page)).name;
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    const a = store.importJSON(window.__defer('먼저 파일'));
    await store.importJSON({ size: 5, text: async () => '{' });
    await window.__release();
    await a;
  });
  expect((await get(page)).name).toBe(before);
  expect((await get(page)).error).toContain('JSON 형식');
});

test('파일 읽기 중 직접 편집한 배치를 유지한다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { app, store } = window.__roomggu;
    const a = store.importJSON(window.__defer('파일 배치'));
    app.state.room.w = 6;
    await window.__release();
    await a;
  });
  expect(await page.evaluate(() => window.__roomggu.app.state.room.w)).toBe(6);
  expect((await get(page)).error).toContain('직접 고친 배치');
});

test('파일 읽기 중 보기만 바꾸면 파일을 정상 적용한다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { app, store } = window.__roomggu;
    const a = store.importJSON(window.__defer('파일 배치'));
    app.state.scope = 'house';
    app.state.grid = !app.state.grid;
    await window.__release();
    await a;
  });
  expect(await get(page)).toMatchObject({ name: '파일 배치', error: '', loading: false });
});

test('불러오기 취소 뒤 늦게 읽힌 파일을 적용하지 않는다', async ({ page }) => {
  await start(page);
  const before = (await get(page)).name;
  await page.evaluate(() => {
    window.__reading = window.__roomggu.store.importJSON(window.__defer('느린 파일'));
  });
  await expect(page.getByRole('button', { name: '배치 불러오기 취소' })).toBeVisible();
  await expect(page.getByRole('button', { name: '설명 보내기' })).toBeDisabled();
  await page.getByRole('button', { name: '배치 불러오기 취소' }).click();
  await page.evaluate(async () => {
    await window.__release();
    await window.__reading;
  });
  expect(await get(page)).toMatchObject({ name: before, loading: false, error: '' });
});

test('새 대화를 시작하면 이전 파일 읽기도 종료한다', async ({ page }) => {
  await start(page);
  const before = (await get(page)).name;
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    const a = store.importJSON(window.__defer('늦은 파일'));
    store.clearThread();
    await window.__release();
    await a;
  });
  expect(await get(page)).toMatchObject({ name: before, loading: false, error: '' });
});

test('배치 불러오기는 이전 초안·대기 목록·사진·미리보기를 비운다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { app, store } = window.__roomggu;
    store.createDraft('bed');
    app.queue = [structuredClone(app.draft)];
    app.photo = { sent: true };
    app.design = { surfaceId: 'old' };
    app.view.preview = { dims: [100, 100, 100] };
    await store.importJSON(window.__file('불러온 방'));
  });
  expect(await get(page)).toMatchObject({ name: '불러온 방', draft: null, queue: [], photo: null });
  expect(
    await page.evaluate(() => ({
      target: window.__roomggu.app.target,
      preview: window.__roomggu.app.view.preview,
      design: window.__roomggu.app.design,
    })),
  ).toEqual({ target: { type: 'room' }, preview: null, design: null });
});

test('이전 사진 판별의 늦은 결과가 불러온 배치를 바꾸지 않는다', async ({ page }) => {
  await start(page, { worker: true });
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    app.photo = { sent: true, data: 'data:image/jpeg;base64,AA', roomId: app.state.roomId };
    window.__classifying = store.analyzePhoto();
  });
  await page.waitForFunction(() => window.__jobs.some((j) => j.task === 'classify'));
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    await store.importJSON(window.__file('새 파일'));
    const job = window.__jobs.find((j) => j.task === 'classify');
    job.worker.onmessage({
      data: {
        id: job.id,
        result: {
          device: 'webgpu',
          scores: [
            { type: 'bed', score: 0.99 },
            { type: 'sofa', score: 0.01 },
          ],
        },
      },
    });
    await window.__classifying;
  });
  expect(await get(page)).toMatchObject({ name: '새 파일', draft: null, photo: null, busy: null });
});

test('이전 상담의 늦은 결과가 불러온 배치를 바꾸지 않는다', async ({ page }) => {
  await start(page, { worker: true });
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    app.ai.text = 'ready';
    app.ai.model = 'gemma3-1b-it-q4f16_1-MLC';
    window.__responding = store.send('침대 가로 180cm로 만들어줘');
  });
  await page.waitForFunction(() => window.__jobs.some((j) => j.task === 'interpret'));
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    await store.importJSON(window.__file('새 배치'));
    const job = window.__jobs.find((j) => j.task === 'interpret');
    job.worker.onmessage({
      data: { id: job.id, result: '{"intent":"furniture","type":"bed","action":"new"}' },
    });
    await window.__responding;
  });
  expect(await get(page)).toMatchObject({ name: '새 배치', draft: null, busy: null });
  expect(
    await page.evaluate(() => window.__roomggu.app.thread.some((t) => t.status === 'thinking')),
  ).toBe(false);
});

for (const [label, size, text, error] of [
  ['손상', 1, '{', 'JSON 형식'],
  ['빈 파일', 0, '', 'JSON 형식'],
  ['용량 초과', 5e6 + 1, '{}', '5MB'],
])
  test(`${label} 파일은 기존 배치를 보존하고 이유를 한국어로 안내한다`, async ({ page }) => {
    await start(page);
    const before = await page.evaluate(() => JSON.stringify(window.__roomggu.app.state));
    await page.evaluate(
      async ({ size, text }) => window.__roomggu.store.importJSON({ size, text: async () => text }),
      { size, text },
    );
    expect(await page.evaluate(() => JSON.stringify(window.__roomggu.app.state))).toBe(before);
    await expect(page.locator('.photo-error')).toContainText(error);
  });

for (const version of [1, 2, 3, 4, 5])
  test(`저장 형식 v${version}을 파일 입력에서 복원한다`, async ({ page }) => {
    await start(page);
    const state = await page.evaluate(() => window.__saved());
    state.version = version;
    state.name = `이전 형식 ${version}`;
    await page.locator('#layout-file').setInputFiles({
      name: `v${version}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(state)),
    });
    await expect.poll(async () => (await get(page)).name).toBe(`이전 형식 ${version}`);
    expect(await page.evaluate(() => window.__roomggu.app.state.version)).toBe(5);
  });

test('파일을 불러온 뒤 실행 취소로 이전 배치를 복원한다', async ({ page }) => {
  await start(page);
  const before = await page.evaluate(() => structuredClone(window.__roomggu.app.state));
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    await store.importJSON(window.__file('새 파일'));
    store.undo();
  });
  expect(await page.evaluate(() => window.__roomggu.app.state)).toEqual(before);
});

test('WebGL 없는 기기에서 3D 파일을 불러와도 2D를 유지한다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { store } = window.__roomggu;
    const file = window.__file('3D 파일');
    const state = JSON.parse(await file.text());
    state.view = '3d';
    await store.importJSON({ size: 100, text: async () => JSON.stringify(state) });
  });
  expect(await page.evaluate(() => window.__roomggu.app.state.view)).toBe('2d');
  await expect(page.locator('#chat-input')).toBeVisible();
});
