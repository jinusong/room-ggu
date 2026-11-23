import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhotoFile, imageData, MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS } from './photo-input.js';

function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() =>
      descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key],
    );
  }
}

for (const ext of ['jpg', 'JPEG', 'png', 'WEBP', 'gif', 'bmp', 'avif', 'heic', 'heif'])
  test(`MIME 없는 ${ext} 파일을 사진으로 받는다`, () =>
    assert.equal(isPhotoFile({ name: `가구.${ext}`, type: '' }), true));
for (const file of [
  null,
  {},
  { name: 'file.json' },
  { name: 'x.jpg.exe' },
  { name: 'x.png', type: 'text/plain' },
  { type: 'application/pdf' },
])
  test(`사진 아닌 파일 거절 ${JSON.stringify(file)}`, () => assert.equal(isPhotoFile(file), false));

for (const [label, file, message] of [
  ['잘못된 형식', { type: 'text/plain', size: 1 }, /사진 파일/],
  ['빈 파일', { type: 'image/png', size: 0 }, /비어/],
  ['20MB 초과', { type: 'image/png', size: MAX_PHOTO_BYTES + 1 }, /20MB/],
])
  test(label, async () => assert.rejects(imageData(file), message));

// 화소 계산·자원 해제는 브라우저 디코더와 분리해 경계값을 재현한다.
for (const [w, h, outW, outH] of [
  [1600, 800, 768, 384],
  [800, 1600, 384, 768],
  [1, 1, 1, 1],
  [100, 50, 100, 50],
  [768, 768, 768, 768],
  [8000, 6000, 768, 576],
  [1, 2000, 1, 768],
])
  test(`사진 비율·축소 ${w}×${h}`, async (t) => {
    let closed = 0;
    const calls = [];
    const ctx = {
      fillRect: (...x) => calls.push(['fill', ...x]),
      drawImage: (...x) => calls.push(['draw', ...x]),
    };
    const canvas = { getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,ok' };
    globals(t, { createImageBitmap: async () => ({ width: w, height: h, close: () => closed++ }) });
    globals(t, { document: { createElement: () => canvas } });
    assert.equal(
      await imageData({ type: 'image/png', size: MAX_PHOTO_BYTES }),
      'data:image/jpeg;base64,ok',
    );
    assert.equal(canvas.width, outW);
    assert.equal(canvas.height, outH);
    assert.equal(ctx.fillStyle, '#ffffff');
    assert.equal(calls[0][0], 'fill');
    assert.equal(calls[1][0], 'draw');
    assert.equal(closed, 1);
  });

for (const [label, w, h, context, result, pattern] of [
  ['0 치수', 0, 10, {}, '', /해상도/],
  ['무한 치수', Infinity, 10, {}, '', /해상도/],
  ['8천만 화소 초과', MAX_PHOTO_PIXELS + 1, 1, {}, '', /해상도/],
  ['캔버스 없음', 10, 10, null, '', /준비하지/],
  ['변환 실패', 10, 10, { fillRect() {}, drawImage() {} }, 'data:,', /변환하지/],
])
  test(`실패해도 bitmap 해제: ${label}`, async (t) => {
    let closed = 0;
    globals(t, { createImageBitmap: async () => ({ width: w, height: h, close: () => closed++ }) });
    globals(t, {
      document: { createElement: () => ({ getContext: () => context, toDataURL: () => result }) },
    });
    await assert.rejects(imageData({ type: 'image/png', size: 1 }), pattern);
    assert.equal(closed, 1);
  });
