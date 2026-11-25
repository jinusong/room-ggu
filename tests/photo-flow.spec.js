import { test, expect } from '@playwright/test';

const file = {
  name: 'bed.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};
async function start(page, { mobile = false } = {}) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(
    ({ mobile }) => {
      Object.defineProperty(navigator, 'gpu', {
        value: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) },
      });
      if (mobile) Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Mobile' });
      window.__jobs = [];
      window.__workers = [];
      window.Worker = class {
        constructor() {
          window.__workers.push(this);
        }
        postMessage(data) {
          const job = { ...data, worker: this };
          window.__jobs.push(job);
          if (data.task === 'load-text') {
            window.__textJob = job;
            window.__textProgress = (mb = 300) =>
              this.onmessage({
                data: {
                  event: 'progress',
                  task: 'text',
                  phase: 'fetch',
                  model: 'gemma-4-E2B-it-q4f16_1-MLC',
                  mb,
                  totalMB: 2840,
                  progress: mb / 2840,
                },
              });
            window.__textProgress(); // 응답을 끝내지 않아 Gemma 다운로드를 계속 진행 중으로 둔다.
          }
          if (data.task === 'classify') window.__photoJob = job;
          if (data.task === 'interpret')
            throw Error('다운로드 중에는 텍스트 추론을 기다리면 안 됨');
        }
        terminate() {
          this.terminated = true;
        }
      };
      window.__finishPhoto = (type = 'bed', low = false, job = window.__photoJob) => {
        job.worker.onmessage({
          data: {
            id: job.id,
            result: {
              device: 'webgpu',
              scores: low
                ? [
                    { type: 'bed', score: 0.2 },
                    { type: 'sofa', score: 0.19 },
                    { type: 'chair', score: 0.18 },
                  ]
                : [
                    { type, score: 0.99 },
                    { type: type === 'bed' ? 'sofa' : 'bed', score: 0.01 },
                  ],
            },
          },
        });
      };
    },
    { mobile },
  );
  await page.goto('/');
  await page.waitForFunction(() => window.__roomggu?.ready());
  if (!mobile) await page.waitForFunction(() => window.__textJob);
}
async function sendPhoto(page, text = '이거 가로 120cm 깊이 200cm 높이 50cm 네이비로 바꿔줘') {
  await page.locator('#photo-file').setInputFiles(file);
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기' }).click();
}
const snapshot = (page) =>
  page.evaluate(() => ({
    text: window.__roomggu.app.ai.text,
    vision: window.__roomggu.app.ai.vision,
    draft: window.__roomggu.app.draft,
    photo: window.__roomggu.app.photo,
    download: window.__roomggu.app.ai.download,
    textDownload: window.__roomggu.app.ai.downloads.text,
    textTerminated: !!window.__textJob?.worker.terminated,
    jobs: window.__jobs.map(({ task }) => task),
    busy: window.__roomggu.app.busy?.kind,
  }));

for (const [width, height] of [
  [1440, 900],
  [1024, 900],
  [900, 900],
  [390, 844],
  [320, 640],
])
  test(`사진 전체 종류와 입력창 레이아웃 ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await start(page, { mobile: width < 900 });
    // start의 모바일 프리셋 이후 검증할 뷰포트를 다시 적용한다.
    await page.setViewportSize({ width, height });
    if (width < 900) await page.locator('#ask-later').click();
    else await page.evaluate(() => window.__roomggu.store.setModelOn(false));
    await sendPhoto(page, '가로 120cm 깊이 200cm 높이 50cm');
    await page.getByRole('button', { name: '다른 종류', exact: true }).click();
    await expect(page.locator('.photo-kind-grid')).toBeVisible();
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    // 느린 소프트웨어 렌더러에서도 새 도구의 레이아웃이 반영된 뒤 크기를 잰다.
    await expect
      .poll(() =>
        page
          .locator('.photo-kind-grid .chip')
          .evaluateAll(
            (els) => els.length === 93 && els.every((e) => e.getBoundingClientRect().height >= 44),
          ),
      )
      .toBe(true);
    await page.screenshot({ path: `test-results/photo-review-${width}.png` });
    expect(errors).toEqual([]);
  });

test('사진 판별 중 직접 만든 초안과 기다리는 초안을 덮어쓰지 않는다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => {
    // 모델 응답을 기다리는 동안 도면·도구의 직접 편집이 가능하다.
    const { app } = window.__roomggu;
    app.draft = {
      id: 'manual',
      type: 'desk',
      name: '직접 만든 책상',
      dims: [140, 74, 60],
      sources: ['사용자 설정', '사용자 설정', '사용자 설정'],
      color: '#333333',
      x: 0,
      z: 0,
      rot: 0,
    };
    app.queue = [structuredClone(app.draft)];
    app.target = { type: 'draft' };
    window.__finishPhoto();
  });
  await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
  expect((await snapshot(page)).draft.id).toBe('manual');
  expect((await snapshot(page)).photo.captionPending).toBe(true);
  expect(await page.evaluate(() => window.__roomggu.app.queue.length)).toBe(1);
});

test('사진 판별 중 방 치수를 바꾸면 결과가 배치를 덮어쓰지 않는다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => {
    window.__roomggu.app.state.room.w = 6;
    window.__finishPhoto();
  });
  await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
  expect((await snapshot(page)).draft).toBe(null);
  expect(await page.evaluate(() => window.__roomggu.app.state.room.w)).toBe(6);
});

test('다른 종류의 전체 목록에서 골라도 사진 설명을 보존한다', async ({ page }) => {
  await start(page, { mobile: true });
  await page.locator('#ask-later').click();
  await sendPhoto(page, '가로 75cm 깊이 65cm 높이 190cm');
  await page.getByRole('button', { name: '다른 종류', exact: true }).click();
  await page.getByRole('textbox', { name: '사진의 가구 종류 검색' }).fill('냉장고');
  await page
    .locator('.photo-kind-grid')
    .getByRole('button', { name: '냉장고', exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([75, 190, 65]);
  expect((await snapshot(page)).draft.type).toBe('fridge');
  expect((await snapshot(page)).jobs).toEqual([]);
});

test('전체 종류 검색의 빈 상태에서 다시 찾을 수 있다', async ({ page }) => {
  await start(page, { mobile: true });
  await page.locator('#ask-later').click();
  await sendPhoto(page, '');
  await page.getByRole('button', { name: '다른 종류', exact: true }).click();
  const q = page.getByRole('textbox', { name: '사진의 가구 종류 검색' });
  await q.fill('존재하지않는가구');
  await expect(page.getByText('맞는 종류가 없어요. 검색어를 바꿔 주세요.')).toBeVisible();
  await q.fill('');
  await expect(page.locator('.photo-kind-grid button')).toHaveCount(93);
});

test('이전 사진의 후보를 누르면 지금 사진·초안을 바꾸지 않는다', async ({ page }) => {
  await start(page);
  await sendPhoto(page, '');
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.type).toBe('bed');
  await page.evaluate(() => {
    window.__oldSuggestion = window.__roomggu.app.thread
      .flatMap((t) => t.suggestions || [])
      .find((s) => s.action === 'draft');
  });
  await page.locator('#photo-file').setInputFiles({ ...file, name: 'next.png' });
  await expect(page.locator('.photo-tray img')).toBeVisible();
  const before = (await snapshot(page)).draft;
  await page.evaluate(() => window.__roomggu.store.runSuggestion(window.__oldSuggestion));
  expect((await snapshot(page)).draft).toEqual(before);
  await expect(page.locator('#toast')).toContainText('이전 사진');
});

test('재분석해도 직접 정한 치수·색을 유지한다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([120, 50, 200]);
  await page.evaluate(() => {
    window.__roomggu.store.analyzePhoto();
  });
  await expect
    .poll(async () => (await snapshot(page)).jobs.filter((t) => t === 'classify').length)
    .toBe(2);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
  expect((await snapshot(page)).draft.dims).toEqual([120, 50, 200]);
  expect((await snapshot(page)).draft.color).toBe('#3f4d63');
});

test('새 사진의 확신 초안을 만들면 이전 대기 초안은 비운다', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    window.__roomggu.app.queue = [{ id: 'old' }];
  });
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.type).toBe('bed');
  expect(await page.evaluate(() => window.__roomggu.app.queue)).toEqual([]);
});

for (const [label, scores] of [
  ['빈 결과', []],
  ['알 수 없는 종류', [{ type: 'toilet', score: 1 }]],
  ['단일 점수', [{ type: 'bed', score: 0.99 }]],
  [
    '범위 밖',
    [
      { type: 'bed', score: 2 },
      { type: 'sofa', score: -1 },
    ],
  ],
  [
    '중복 종류',
    [
      { type: 'bed', score: 0.99 },
      { type: 'bed', score: 0.98 },
    ],
  ],
])
  test(`모델 ${label}는 초안 없이 설명을 보존한다`, async ({ page }) => {
    await start(page);
    await sendPhoto(page);
    await page.waitForFunction(() => window.__photoJob);
    await page.evaluate((scores) => {
      const job = window.__photoJob;
      job.worker.onmessage({ data: { id: job.id, result: { scores, device: 'webgpu' } } });
    }, scores);
    await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
    expect((await snapshot(page)).draft).toBe(null);
    expect((await snapshot(page)).photo.captionPending).toBe(true);
  });

test('사진 원본은 새로고침·배치 내보내기용 저장소에 남지 않는다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
  const saved = await page.evaluate(() => ({
    layout: localStorage.getItem('room-ggu-v2'),
    thread: localStorage.getItem('room-ggu-thread-v1'),
  }));
  expect(saved.layout).not.toContain('data:image');
  expect(saved.thread).not.toContain('data:image');
  expect(saved.thread).toContain('hadPhoto');
  await page.reload();
  await page.waitForFunction(() => window.__roomggu?.ready());
  expect((await snapshot(page)).photo).toBe(null);
  expect((await snapshot(page)).draft.dims).toEqual([120, 50, 200]);
});

test('사진 판별 중 새 대화를 열면 Worker를 멈추고 늦은 응답을 버린다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => {
    window.__roomggu.store.clearThread();
    window.__finishPhoto();
  });
  expect(
    await page.evaluate(() => ({
      busy: window.__roomggu.app.busy,
      photo: window.__roomggu.app.photo,
      thread: window.__roomggu.app.thread,
    })),
  ).toEqual({ busy: null, photo: null, thread: [] });
  await page.locator('#chat-input').fill('책상 하나');
  await expect(page.getByRole('button', { name: '설명 보내기' })).toBeEnabled();
});

test('새로고침 후 사진 없는 예전 후보를 실행하지 않는다', async ({ page }) => {
  await start(page);
  await sendPhoto(page, '');
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto('bed', true));
  await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
  await page.reload();
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    store.runSuggestion(
      app.thread.flatMap((t) => t.suggestions || []).find((s) => s.action === 'draft'),
    );
  });
  expect((await snapshot(page)).draft).toBe(null);
  await expect(page.locator('#toast')).toContainText('이전 사진');
});

test('사진+글: Gemma 다운로드가 끝나기 전에 판별하고 같은 초안에 설명을 반영한다', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  expect(await page.evaluate(() => window.__photoJob.worker !== window.__textJob.worker)).toBe(
    true,
  );
  await page.evaluate(() => {
    window.__textProgress(600);
    window.__finishPhoto();
  });
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([120, 50, 200]);
  const s = await snapshot(page);
  expect(s).toMatchObject({ text: 'loading', vision: 'ready', textTerminated: false });
  expect(s.draft.type).toBe('bed');
  expect(s.draft.sources.every((source) => source.startsWith('사용자'))).toBe(true);
  expect(s.draft.color).toBe('#3f4d63');
  expect(s.photo.captionPending).toBe(false);
  expect(s.jobs).toEqual(['load-text', 'classify']);
  expect(s.textDownload.mb).toBe(600);
  // 다른 후보로 바로잡아도 이미 직접 정한 치수·색은 보존한다.
  await page.evaluate(() => window.__roomggu.store.createDraft('sofa', { via: 'photo' }));
  const corrected = await snapshot(page);
  expect(corrected.draft.type).toBe('sofa');
  expect(corrected.draft.dims).toEqual([120, 50, 200]);
  expect(corrected.draft.color).toBe('#3f4d63');
  // 사진 안내를 닫으면 계속 받던 Gemma 진행률이 돌아온다.
  await page.evaluate(() => window.__roomggu.store.closeDownload());
  await expect(page.locator('#model-island')).toHaveAttribute('data-task', 'text');
  await expect(page.locator('#chat-input')).toBeInViewport();
  expect(errors).toEqual([]);
});

test('사진 취소와 상담 모델 끄기는 서로의 Worker와 결과를 지우지 않는다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.locator('#island-toggle').click();
  await page.locator('#island-cancel').click();
  expect(await snapshot(page)).toMatchObject({
    text: 'loading',
    vision: 'off',
    textTerminated: false,
  });
  await page.getByRole('button', { name: '사진으로 종류 확인', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).jobs.filter((task) => task === 'classify').length)
    .toBe(2);
  await page.evaluate(() => window.__roomggu.store.setModelOn(false));
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([120, 50, 200]);
  expect(await snapshot(page)).toMatchObject({
    text: 'off',
    vision: 'ready',
    textTerminated: true,
  });
});

test('확신이 낮으면 설명을 보관하고, 후보를 고른 뒤 한 번만 반영한다', async ({ page }) => {
  await start(page);
  await sendPhoto(page, '가로 155cm 깊이 210cm 높이 45cm');
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto('bed', true));
  await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
  expect((await snapshot(page)).draft).toBe(null);
  expect((await snapshot(page)).photo.captionPending).toBe(true);
  await page.getByRole('button', { name: '침대로 잡기', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([155, 45, 210]);
  expect((await snapshot(page)).photo.captionPending).toBe(false);
});

test('새 사진을 붙이면 이전 사진의 늦은 결과가 새 초안을 덮어쓰지 않는다', async ({ page }) => {
  await start(page);
  await sendPhoto(page, '가로 120cm');
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => {
    window.__oldPhotoJob = window.__photoJob;
  });
  await page.locator('#photo-file').setInputFiles({ ...file, name: 'chair.png' });
  await page.locator('#chat-input').fill('가로 60cm 깊이 60cm 높이 90cm');
  await page.getByRole('button', { name: '설명 보내기' }).click();
  await expect
    .poll(async () => (await snapshot(page)).jobs.filter((task) => task === 'classify').length)
    .toBe(2);
  await page.evaluate(() => {
    window.__finishPhoto('bed', false, window.__oldPhotoJob);
    window.__finishPhoto('chair');
  });
  await expect.poll(async () => (await snapshot(page)).draft?.type).toBe('chair');
  expect((await snapshot(page)).draft.dims).toEqual([60, 90, 60]);
  expect((await snapshot(page)).textTerminated).toBe(false);
});

test('휴대 기기는 사진+설명도 동의 전에는 받지 않고, 사진 판별을 누르면 설명까지 반영한다', async ({
  page,
}) => {
  await start(page, { mobile: true });
  await page.locator('#ask-later').click();
  await sendPhoto(page);
  expect((await snapshot(page)).jobs).toEqual([]);
  await page.getByRole('button', { name: '사진으로 종류 확인', exact: true }).click();
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([120, 50, 200]);
  expect((await snapshot(page)).jobs).toEqual(['classify']);
  await expect(page.locator('#chat-input')).toBeInViewport();
  // 이미 사용자가 준비한 사진 모델은 상담 모델의 '나중에' 설정과 별개로 재사용한다.
  await sendPhoto(page, '가로 150cm 깊이 210cm 높이 55cm');
  await expect.poll(async () => (await snapshot(page)).jobs.length).toBe(2);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([150, 55, 210]);
});

test('상담 Worker가 실패해도 진행 중인 사진 판별과 설명 반영은 끝난다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__textJob.worker.onerror());
  await expect.poll(async () => (await snapshot(page)).text).toBe('error');
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([120, 50, 200]);
  expect((await snapshot(page)).vision).toBe('ready');
  await page.evaluate(() => window.__roomggu.store.closeDownload());
  await expect(page.locator('#model-island')).toHaveAttribute('data-task', 'text');
  await expect(page.locator('#model-island')).toHaveAttribute('data-phase', 'error');
  await expect(page.locator('#island-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('사진 Worker 실패는 상담 다운로드를 멈추지 않고 설명을 남겨 재시도한다', async ({ page }) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__photoJob.worker.onerror());
  await expect.poll(async () => (await snapshot(page)).vision).toBe('error');
  expect(await snapshot(page)).toMatchObject({ text: 'loading', textTerminated: false });
  expect((await snapshot(page)).photo.captionPending).toBe(true);
  await page.locator('#island-retry').click();
  await expect
    .poll(async () => (await snapshot(page)).jobs.filter((task) => task === 'classify').length)
    .toBe(2);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).draft?.dims).toEqual([120, 50, 200]);
});

test('판별 중 다른 방으로 이동하면 그 방을 바꾸지 않고 원래 방에서 설명을 이어 반영한다', async ({
  page,
}) => {
  await start(page);
  await sendPhoto(page);
  await page.waitForFunction(() => window.__photoJob);
  const roomId = await page.evaluate(() => window.__roomggu.app.state.roomId);
  await page.evaluate(() => window.__roomggu.store.addSpace('bedroom'));
  expect(await page.evaluate(() => window.__roomggu.app.state.roomId)).not.toBe(roomId);
  await page.evaluate(() => window.__finishPhoto());
  await expect.poll(async () => (await snapshot(page)).vision).toBe('ready');
  expect((await snapshot(page)).draft).toBe(null);
  expect((await snapshot(page)).photo.captionPending).toBe(true);
  await page.evaluate(async (id) => {
    window.__roomggu.store.switchSpace(id);
    await window.__roomggu.store.createDraft('bed', { via: 'photo' });
  }, roomId);
  expect((await snapshot(page)).draft.dims).toEqual([120, 50, 200]);
});

test('사진과 설명의 가구 종류가 다르면 확인하고 고른 가구에 치수를 반영한다', async ({ page }) => {
  await start(page);
  await sendPhoto(page, '책상 가로 130cm 깊이 70cm로 해줘');
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto('bed'));
  await expect(page.locator('.msg.assistant').last()).toContainText('설명은 책상');
  expect((await snapshot(page)).draft).toBeNull();
  await page.getByRole('button', { name: '침대로 잡기', exact: true }).click();
  expect((await snapshot(page)).draft).toMatchObject({ type: 'bed', dims: [130, 55, 70] });
});

test('사진 판별 답에서 전체 종류를 열고 고쳐도 직접 말한 치수는 보존한다', async ({ page }) => {
  await start(page, { mobile: true });
  await page.locator('#ask-later').click();
  await sendPhoto(page, '가로 120cm 깊이 60cm');
  await page.getByRole('button', { name: '사진으로 종류 확인' }).click();
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto('bed'));
  const correction = page.getByRole('button', { name: '사진 종류 다시 고르기', exact: true });
  await expect(correction).toBeVisible();
  await correction.click();
  const query = page.getByRole('textbox', { name: '사진의 가구 종류 검색' });
  await expect(query).toBeFocused();
  await expect
    .poll(async () =>
      query.evaluate((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return document.elementFromPoint(x + width / 2, y + height / 2) === el;
      }),
    )
    .toBe(true);
  await query.fill('책상');
  await page.locator('.photo-kind-grid').getByRole('button', { name: '책상', exact: true }).click();
  expect((await snapshot(page)).draft).toMatchObject({
    type: 'desk',
    dims: [120, 74, 60],
    sources: ['사용자 설정', '사진 유형 기본값', '사용자 설정'],
  });
  await expect(page.locator('#chat-input')).toBeInViewport();
});

test('사진 Worker 오류 뒤 직접 고른 종류에 원래 설명의 치수를 반영한다', async ({ page }) => {
  await start(page);
  await sendPhoto(page, '침대 가로 130cm 깊이 67cm');
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__photoJob.worker.onerror());
  await expect.poll(async () => (await snapshot(page)).vision).toBe('error');
  await page.getByRole('button', { name: '다른 종류', exact: true }).click();
  await page.locator('.photo-kind-grid').getByRole('button', { name: '책상', exact: true }).click();
  expect((await snapshot(page)).draft).toMatchObject({ type: 'desk', dims: [130, 74, 67] });
});

test('사진 종류를 직접 고른 뒤 판별해도 초안은 확인할 때까지 그대로 둔다', async ({ page }) => {
  await start(page, { mobile: true });
  await page.locator('#ask-later').click();
  await sendPhoto(page, '이거 가로 123cm 깊이 67cm 높이 77cm 네이비로 바꿔줘');
  const photo = page.locator('[data-surface=photo]');
  await photo.getByRole('button', { name: '책상', exact: true }).click();
  const before = (await snapshot(page)).draft;
  expect(before).toMatchObject({ type: 'desk', dims: [123, 77, 67], color: '#3f4d63' });

  await page.getByRole('button', { name: '사진 종류 다시 고르기' }).click();
  await photo.getByRole('button', { name: '사진으로 종류 확인' }).click();
  await page.waitForFunction(() => window.__photoJob);
  await page.evaluate(() => window.__finishPhoto('bed'));
  await expect(page.locator('.msg.assistant').last()).toContainText('책상 초안은 그대로');
  expect((await snapshot(page)).draft).toEqual(before);

  await page.getByRole('button', { name: '침대로 잡기', exact: true }).click();
  expect((await snapshot(page)).draft).toMatchObject({
    type: 'bed',
    dims: before.dims,
    color: before.color,
  });
  await expect(page.locator('#chat-input')).toBeInViewport();
});
