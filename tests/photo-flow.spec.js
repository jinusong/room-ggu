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
