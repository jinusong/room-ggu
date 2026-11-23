import { test, expect } from '@playwright/test';

async function start(page) {
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.evaluate(() => {
    window.photoFile = async ({
      w = 120,
      h = 60,
      type = 'image/png',
      name = '가구.png',
      color = '#cc3322',
      transparent = false,
    } = {}) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      if (!transparent) {
        const ctx = c.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
      }
      const blob = await new Promise((r) => c.toBlob(r, type));
      return new File([blob], name, { type });
    };
    window.photoPixels = async () => {
      const { photo } = window.__roomggu.app;
      if (!photo) return null;
      const img = new Image();
      img.src = photo.data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return {
        w: img.width,
        h: img.height,
        rgba: [...c.getContext('2d').getImageData(0, 0, 1, 1).data],
        data: photo.data.slice(0, 23),
      };
    };
  });
}

for (const type of ['image/png', 'image/jpeg', 'image/webp'])
  test(`${type} 실제 디코딩·JPEG 정규화`, async ({ page }) => {
    await start(page);
    const result = await page.evaluate(async (type) => {
      await window.__roomggu.store.attachPhoto(await window.photoFile({ type }));
      return window.photoPixels();
    }, type);
    expect(result).toMatchObject({ w: 120, h: 60, data: 'data:image/jpeg;base64,' });
    expect(result.rgba[0]).toBeGreaterThan(190);
  });
for (const [w, h, ew, eh] of [
  [2000, 1000, 768, 384],
  [1000, 2000, 384, 768],
  [1, 1, 1, 1],
  [48, 24, 48, 24],
])
  test(`실제 사진 크기 ${w}×${h}`, async ({ page }) => {
    await start(page);
    const result = await page.evaluate(
      async ({ w, h }) => {
        await window.__roomggu.store.attachPhoto(await window.photoFile({ w, h }));
        return window.photoPixels();
      },
      { w, h },
    );
    expect(result).toMatchObject({ w: ew, h: eh });
  });
for (const type of ['image/png', 'image/webp'])
  test(`${type} 투명 영역은 흰색으로 보존`, async ({ page }) => {
    await start(page);
    const result = await page.evaluate(async (type) => {
      await window.__roomggu.store.attachPhoto(await window.photoFile({ type, transparent: true }));
      return window.photoPixels();
    }, type);
    expect(result.rgba.slice(0, 3).every((v) => v > 250)).toBe(true);
  });

test('createImageBitmap 없는 브라우저도 사진을 읽고 임시 URL을 해제한다', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    window.createImageBitmap = undefined;
    const revoke = URL.revokeObjectURL.bind(URL);
    let count = 0;
    URL.revokeObjectURL = (url) => {
      count++;
      revoke(url);
    };
    await window.__roomggu.store.attachPhoto(await window.photoFile());
    return { pixels: await window.photoPixels(), count };
  });
  expect(result.pixels).toMatchObject({ w: 120, h: 60 });
  expect(result.count).toBe(1);
});

test('휴대폰 JPEG의 EXIF 회전 방향을 유지한다', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const file = await window.photoFile({ type: 'image/jpeg' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const exif = new Uint8Array([
      255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0,
      0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
    await window.__roomggu.store.attachPhoto(
      new File([bytes.slice(0, 2), exif, bytes.slice(2)], 'phone.jpg', { type: 'image/jpeg' }),
    );
    return window.photoPixels();
  });
  expect(result).toMatchObject({ w: 60, h: 120 });
});

for (const [name, type, size, expected] of [
  ['손상.png', 'image/png', 10, '읽지 못했어요'],
  ['빈.png', 'image/png', 0, '비어 있는'],
  ['큰.png', 'image/png', 20 * 1024 * 1024 + 1, '20MB'],
  ['문서.pdf', 'application/pdf', 10, '사진 파일'],
  ['아이폰.heic', 'image/heic', 10, 'JPG, PNG, WebP'],
])
  test(`${name} 오류에도 기존 사진과 설명을 유지한다`, async ({ page }) => {
    await start(page);
    await page.evaluate(async () => window.__roomggu.store.attachPhoto(await window.photoFile()));
    const data = await page.locator('.photo-tray img').getAttribute('src');
    await page.locator('#chat-input').fill('입력하던 가구 설명');
    await page
      .locator('#photo-file')
      .setInputFiles({ name, mimeType: type, buffer: Buffer.alloc(size) });
    await expect(page.locator('.photo-error')).toContainText(expected);
    expect(await page.locator('.photo-tray img').getAttribute('src')).toBe(data);
    await expect(page.locator('#chat-input')).toHaveValue('입력하던 가구 설명');
  });

test('사진 준비가 뒤늦게 끝나도 마지막 첨부가 유지된다', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const original = createImageBitmap;
    let release;
    const first = await window.photoFile({ color: '#ff0000' }),
      last = await window.photoFile({ color: '#0000ff' });
    window.createImageBitmap = (file) =>
      file === first
        ? new Promise((r) => {
            release = async () => r(await original(file));
          })
        : original(file);
    const a = window.__roomggu.store.attachPhoto(first);
    await window.__roomggu.store.attachPhoto(last);
    await release();
    await a;
    return window.photoPixels();
  });
  expect(result.rgba[2]).toBeGreaterThan(240);
  expect(result.rgba[0]).toBeLessThan(10);
});

test('사진 준비 중 취소하면 늦은 디코딩 결과가 첨부되지 않는다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const original = createImageBitmap;
    const f = await window.photoFile();
    window.createImageBitmap = () =>
      new Promise((r) => {
        window.releasePhoto = async () => r(await original(f));
      });
    window.attaching = window.__roomggu.store.attachPhoto(f);
  });
  await expect(page.getByRole('button', { name: '설명 보내기' })).toBeDisabled();
  await page.getByRole('button', { name: '사진 준비 취소' }).click();
  await page.evaluate(async () => {
    await window.releasePhoto();
    await window.attaching;
  });
  expect(await page.evaluate(() => window.__roomggu.app.photo)).toBe(null);
  await expect(page.getByText('사진을 준비하고 있어요')).toHaveCount(0);
});

test('사진 준비 중 새 대화를 열면 첨부와 오류가 다시 나타나지 않는다', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const original = createImageBitmap;
    const f = await window.photoFile();
    window.createImageBitmap = () =>
      new Promise((r) => {
        window.releasePhoto = async () => r(await original(f));
      });
    const attaching = window.__roomggu.store.attachPhoto(f);
    window.__roomggu.store.clearThread();
    await window.releasePhoto();
    await attaching;
  });
  expect(
    await page.evaluate(() => ({
      photo: window.__roomggu.app.photo,
      loading: window.__roomggu.app.photoLoading,
      error: window.__roomggu.app.photoError,
    })),
  ).toEqual({ photo: null, loading: false, error: '' });
});

test('사진 없이 글을 붙여넣으면 일반 입력을 가로채지 않는다', async ({ page }) => {
  await start(page);
  const cancelled = await page.locator('#chat-input').evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', '내 책상');
    return !el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  expect(cancelled).toBe(false);
});

for (const mode of ['paste', 'drop'])
  test(`MIME 없는 사진 ${mode} 첨부`, async ({ page }) => {
    await start(page);
    await page.evaluate(async (mode) => {
      const f = await window.photoFile();
      const file = new File([f], 'furniture.PNG', { type: '' });
      const data = new DataTransfer();
      data.items.add(file);
      const event =
        mode === 'paste'
          ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
          : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      // Firefox는 합성 ClipboardEvent 생성자의 clipboardData 옵션을 무시한다.
      // 실제 붙여넣기 이벤트와 같은 FileList를 직접 주입해 앱의 처리 경로를 검사한다.
      if (mode === 'paste') Object.defineProperty(event, 'clipboardData', { value: data });
      document.querySelector(mode === 'paste' ? '#chat-input' : '.app').dispatchEvent(event);
    }, mode);
    await expect(page.locator('.photo-tray img')).toBeVisible();
  });
