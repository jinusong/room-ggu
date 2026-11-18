import { test, expect } from '@playwright/test';

async function start(page, { width = 1440, height = 900, webgl = false } = {}) {
  await page.setViewportSize({ width, height });
  if (!webgl)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return String(type).includes('webgl') ? null : original.call(this, type, ...args);
      };
    });
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.ready());
  await page.evaluate(() => window.__roomggu.store.dismissToast());
}
const say = async (page, text) => {
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기' }).click();
};

for (const trigger of ['도구 열기', '파일과 설정'])
  test(`${trigger}: 키보드로 열고 방향키·Home·End·Esc 조작`, async ({ page }) => {
    await start(page);
    const b = page.getByRole('button', { name: trigger, exact: true });
    await b.focus();
    await b.press('ArrowDown');
    const list = page.locator('[role=menu] [role^=menuitem]');
    await expect(list.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(list.last()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(list.first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(list.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(list.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(b).toBeFocused();
  });

test('도구 메뉴의 Tab·Shift+Tab은 메뉴 밖으로 이동한다', async ({ page }) => {
  await start(page);
  const b = page.getByRole('button', { name: '도구 열기', exact: true });
  await b.focus();
  await b.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('#chat-input')).toBeFocused();
  await b.focus();
  await b.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(b).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
});

test('메뉴에서 도구를 실행해도 키보드 초점이 사라지지 않는다', async ({ page }) => {
  await start(page);
  const b = page.getByRole('button', { name: '도구 열기', exact: true });
  await b.focus();
  await b.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-surface=catalog]')).toBeVisible();
  await expect(b).toBeFocused();
});

test('메뉴를 연 직후 Esc와 삭제 확인의 Tab 이동도 바로 반응한다', async ({ page }) => {
  await start(page);
  const menu = page.getByRole('button', { name: '도구 열기', exact: true });
  await menu.focus();
  await menu.press('Enter');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await say(page, '책상 하나');
  await page.getByRole('button', { name: '새 대화', exact: true }).click();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '대화 지우기', exact: true })).toHaveCount(0);
});

for (const init of [
  { isComposing: true, keyCode: 13 },
  { isComposing: false, keyCode: 229 },
])
  test(`조합 중 Enter 보호 ${JSON.stringify(init)}`, async ({ page }) => {
    await start(page);
    const input = page.locator('#chat-input');
    await input.fill('책상 하나');
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, ...init });
    await expect(input).toHaveValue('책상 하나');
    expect(await page.evaluate(() => window.__roomggu.app.thread)).toEqual([]);
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__roomggu.app.draft?.type)).toBe('desk');
  });

test('Shift+Enter는 줄을 바꾸고 Enter는 한 번 전송한다', async ({ page }) => {
  await start(page);
  const input = page.locator('#chat-input');
  await input.fill('책상');
  await input.press('Shift+Enter');
  await input.press('x');
  expect(await input.inputValue()).toContain('\n');
  expect(await page.evaluate(() => window.__roomggu.app.thread.length)).toBe(0);
  await input.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => window.__roomggu.app.thread.filter((t) => t.role === 'user').length),
    )
    .toBe(1);
});

test('1500자 입력 한도를 화면에서 확인하고 초과 전송을 막는다', async ({ page }) => {
  await start(page);
  const input = page.locator('#chat-input');
  await input.fill('가'.repeat(1500));
  await expect(page.getByText('1500/1500자')).toBeVisible();
  await input.press('x');
  expect((await input.inputValue()).length).toBe(1500);
});

test('숫자 오류가 입력란에 연결되고 빈 값은 방 치수를 바꾸지 않는다', async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__roomggu.store.openTool('room-size'));
  const input = page.getByLabel('방 가로', { exact: true });
  const before = await input.inputValue();
  await input.fill('9999');
  await input.blur();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const id = await input.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${id}"]`)).toContainText('범위');
  await input.fill('');
  await input.blur();
  expect(await input.inputValue()).toBe(before);
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await input.fill('4.5');
  await input.blur();
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
});

test('숫자 입력의 조합 중 방향키는 치수를 바꾸지 않는다', async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__roomggu.store.openTool('room-size'));
  const input = page.getByLabel('방 가로', { exact: true });
  const before = await input.inputValue();
  await input.dispatchEvent('keydown', { key: 'ArrowUp', isComposing: true, bubbles: true });
  await expect(input).toHaveValue(before);
});

test('모바일 대화 손잡이는 Enter·Space로 조절한다', async ({ page }) => {
  await start(page, { width: 390, height: 844 });
  const handle = page.locator('.sheet-handle');
  await handle.focus();
  await handle.press('Enter');
  await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'full');
  await handle.press('Space');
  await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'peek');
});

test('모바일 손잡이의 취소는 시트를 바꾸지 않는다', async ({ page }) => {
  await start(page, { width: 390, height: 844 });
  const handle = page.locator('.sheet-handle');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await handle.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await page.mouse.up();
  await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'half');
});

test('키보드로 보이는 영역이 줄면 드래그도 그 높이를 넘지 않는다', async ({ page }) => {
  await page.addInitScript(() => {
    const vv = Object.assign(new EventTarget(), {
      height: 300,
      width: 390,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  });
  await start(page, { width: 390, height: 844 });
  const handle = page.locator('.sheet-handle');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, 0);
  expect(
    await page.locator('.sheet').evaluate((e) => e.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(248);
  await page.mouse.up();
});

test('대화 폭은 창 크기에 맞는 ARIA 값으로 바뀐다', async ({ page }) => {
  await start(page);
  const handle = page.getByRole('separator', { name: '대화 폭 조절' });
  await handle.focus();
  await handle.press('End');
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(handle).toHaveAttribute('aria-valuemax', '504');
  await expect(handle).toHaveAttribute('aria-valuenow', '504');
});

test('대화 폭 드래그를 취소하면 커서와 폭을 복원한다', async ({ page }) => {
  await start(page);
  const handle = page.getByRole('separator', { name: '대화 폭 조절' });
  const width = await page.locator('.sheet').evaluate((e) => e.getBoundingClientRect().width);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 200);
  await handle.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await page.mouse.up();
  expect(
    await page.evaluate(() => document.documentElement.classList.contains('is-resizing')),
  ).toBe(false);
  expect(await page.locator('.sheet').evaluate((e) => e.getBoundingClientRect().width)).toBe(width);
});

for (const width of [1440, 390])
  test(`새 대화 삭제 확인은 Esc·취소·바깥 클릭으로 취소 ${width}`, async ({ page }) => {
    await start(page, { width, height: 900 });
    await say(page, '책상 하나');
    const before = await page.evaluate(() => window.__roomggu.app.thread.length);
    const trigger = page.getByRole('button', { name: '새 대화', exact: true });
    await trigger.click();
    await expect(page.getByRole('button', { name: '취소', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('button', { name: '대화 지우기', exact: true })).toHaveCount(0);
    await trigger.click();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await trigger.click();
    await page.locator('#chat-input').click();
    expect(await page.evaluate(() => window.__roomggu.app.thread.length)).toBe(before);
    await expect(page.getByRole('button', { name: '대화 지우기', exact: true })).toHaveCount(0);
  });

test('새 대화 확정 후 배치는 유지되고 입력창으로 돌아온다', async ({ page }) => {
  await start(page);
  await say(page, '책상 하나');
  const before = await page.evaluate(() => JSON.stringify(window.__roomggu.app.state));
  await page.getByRole('button', { name: '새 대화', exact: true }).click();
  await page.getByRole('button', { name: '대화 지우기', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify(window.__roomggu.app.state))).toBe(before);
  await expect(page.locator('#chat-input')).toBeFocused();
  expect(await page.evaluate(() => window.__roomggu.app.thread.length)).toBe(0);
});

for (const [width, height] of [
  [390, 844],
  [844, 390],
  [320, 480],
  [768, 420],
])
  test(`긴 글·회전 뒤 입력창과 보내기 유지 ${width}×${height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await start(page, { webgl: true });
    const input = page.locator('#chat-input');
    const text = '책상과 침대를 놓을 방을 꾸미고 싶어요. '.repeat(4);
    await input.fill(text);
    await page.setViewportSize({ width, height });
    await input.focus();
    await expect(input).toHaveValue(text);
    await expect
      .poll(() => input.evaluate((e) => e.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(height);
    await expect(page.getByRole('button', { name: '설명 보내기' })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.cache/qa2/after-${width}-${height}.png` });
    expect(errors).toEqual([]);
  });

test('알림은 키보드 초점 중 유지되고 Esc로 닫힌다', async ({ page }) => {
  await start(page);
  await page.clock.install();
  const origin = page.getByRole('button', { name: '도구 열기', exact: true });
  await origin.focus();
  await page.evaluate(() => window.__roomggu.store.toast('키보드로 읽는 알림'));
  const close = page.getByRole('button', { name: '알림 닫기' });
  await close.hover();
  await close.focus();
  await page.mouse.move(0, 899);
  await page.clock.fastForward(6000);
  await expect(page.locator('#toast')).toContainText('키보드로 읽는 알림');
  await page.evaluate(() => window.__roomggu.store.toast('초점 중에 갱신한 알림'));
  await expect(page.locator('#toast')).toContainText('초점 중에 갱신한 알림');
  await page.clock.fastForward(6000);
  await expect(close).toBeFocused();
  await close.hover();
  await origin.focus();
  await page.clock.fastForward(6000);
  await expect(close).toBeVisible();
  await close.focus();
  await page.mouse.move(0, 899);
  await close.press('Escape');
  await expect(close).toHaveCount(0);
  await expect(origin).toBeFocused();
});

test('화면이 좁아지면 작성 중인 글의 높이를 다시 계산한다', async ({ page }) => {
  await start(page);
  const input = page.locator('#chat-input');
  await input.fill('책상과 침대를 놓을 방을 꾸미고 싶어요. '.repeat(4));
  const before = await input.evaluate((e) => e.clientHeight);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => input.evaluate((e) => e.clientHeight)).toBeGreaterThan(before);
  await expect(input).toHaveValue('책상과 침대를 놓을 방을 꾸미고 싶어요. '.repeat(4));
});

test('작은 키보드 영역에서도 사진 오류와 입력·전송을 함께 쓴다', async ({ page }) => {
  await start(page, { width: 390, height: 300 });
  await page.locator('#chat-input').fill('책상을 두고 싶어요');
  await page.locator('#chat-input').focus();
  await page
    .locator('#photo-file')
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.alloc(4) });
  await expect(page.locator('.photo-error')).toContainText('읽지 못했어요');
  await expect(page.getByRole('button', { name: '설명 보내기' })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#chat-input')).toBeInViewport({ ratio: 1 });
});

test('저장 용량이 없어도 파일을 불러오고 JSON으로 내보낸다', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await say(page, '책상 하나');
  await page.evaluate(async () => {
    const { app, store } = window.__roomggu;
    const state = structuredClone(app.state);
    state.name = '용량 없는 기기';
    await store.importJSON({ size: 100, text: async () => JSON.stringify(state) });
  });
  await expect(page.locator('.save-state')).toContainText('자동 저장 불가');
  const download = page.waitForEvent('download');
  await page.evaluate(() => window.__roomggu.store.exportJSON());
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});

for (const [width, height] of [
  [390, 844],
  [844, 390],
  [320, 480],
])
  test(`모델 동의창의 초점·배경·작은 화면 ${width}×${height}`, async ({ page }) => {
    await start(page, { width, height });
    await page.evaluate(() => {
      const { app, store } = window.__roomggu;
      app.view.modelAsk = { name: 'Gemma 4 E2B', mb: 2840 };
      store.emit();
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeFocused();
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((e) => e.contains(document.activeElement))).toBe(true);
    }
    await expect(page.locator('#ask-later')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#ask-go')).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.querySelector('.sheet').inert && document.querySelector('.stage').inert,
      ),
    ).toBe(true);
    await page.evaluate(() => document.querySelector('#chat-input').focus());
    await expect(page.locator('#chat-input')).not.toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector('.sheet').inert)).toBe(false);
  });

test('모델 동의창을 닫는 Esc가 뒤의 메뉴까지 닫지 않는다', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '도구 열기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const { app, store } = window.__roomggu;
    app.view.modelAsk = { name: 'Gemma 4 E2B', mb: 2840 };
    store.emit();
  });
  await expect(page.getByRole('dialog')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('동작 줄이기 설정에서는 대화를 부드럽게 스크롤하지 않는다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  await page.evaluate(() => {
    const original = Element.prototype.scrollTo;
    window.__scrolls = [];
    Element.prototype.scrollTo = function (options, ...args) {
      if (this.classList.contains('thread')) window.__scrolls.push(options);
      return original.call(this, options, ...args);
    };
  });
  await say(page, '책상 하나');
  await expect.poll(() => page.evaluate(() => window.__scrolls.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__scrolls.every((x) => x.behavior === 'auto'))).toBe(
    true,
  );
});

for (const width of [1440, 320])
  test(`긴 방 이름과 가구 이름도 가로 넘침 없이 표시 ${width}`, async ({ page }) => {
    await start(page, { width, height: 844 });
    await page.evaluate(() => {
      const { app, store } = window.__roomggu;
      app.state.name = '이름이아주긴나의침실'.repeat(12);
      store.createDraft('bed');
      app.draft.name = '길게입력한침대이름'.repeat(12);
      store.emit();
    });
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
