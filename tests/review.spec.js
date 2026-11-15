import { test, expect } from '@playwright/test';

// 팀원 의견 네 가지(키 비교, 앉기·눕기, 화장실을 포함한 집, 집 전체 3D)를 화면 위 조작으로 재현한다.
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
const frames = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function open(page, size) {
  if (size) await page.setViewportSize(size);
  await page.goto('/?model=off');
  await page.waitForFunction(
    () => window.__roomggu?.app.scenes.three || window.__roomggu?.app.view.webglError,
  );
}
async function say(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기' }).click();
}
async function pick(page, type) {
  const id = (await stored(page)).items.find((i) => i.type === type).id;
  await frames(page);
  const p = await page.evaluate((id) => window.__roomggu.anchor(id, { center: true }), id);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#selection-tools')).toBeVisible();
  return id;
}
// 3D 아바타 모형의 위치·회전과 몸에서 가장 낮은 점.
const avatar3d = (page) =>
  page.evaluate(() => {
    const sc = window.__roomggu.app.scenes.three,
      model = sc.comparison.children.find((o) => o.userData.avatar);
    if (!model) return null;
    model.updateMatrixWorld(true);
    let low = Infinity,
      high = -Infinity;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      low = Math.min(low, box.min.y);
      high = Math.max(high, box.max.y);
    });
    return {
      x: model.position.x,
      z: model.position.z,
      turn: Math.round((model.rotation.y * 180) / Math.PI),
      low,
      high,
    };
  });

test('방 위의 사람 버튼으로 아바타를 세우고 키 출처를 구별한다', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-starter=avatar]')).toBeVisible();
  await expect(page.locator('[data-starter=floorplan]')).toBeVisible();
  const before = await stored(page);
  await page.locator('#avatar-toggle').click();
  await expect(page.locator('#avatar-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-surface=avatar]')).toBeVisible();
  // 키를 말하지 않았으면 170cm 기본값이고 점선으로 표시한다.
  await expect(page.locator('.avatar-bar .tape')).toHaveClass(/is-draft/);
  await expect(page.locator('.avatar-bar .tape')).toHaveText('키 170cm');
  let body = await avatar3d(page);
  expect(body.high).toBeCloseTo(1.7, 2);
  expect(body.low).toBeGreaterThan(-0.02);
  const field = page.getByLabel('아바타 키', { exact: true });
  await field.fill('182');
  await field.blur();
  await expect(page.locator('.avatar-bar .tape')).toHaveClass(/is-set/);
  body = await avatar3d(page);
  expect(body.high).toBeCloseTo(1.82, 2);
  // 가구 치수와 위치는 그대로다.
  expect((await stored(page)).items).toEqual(before.items);
  // 범위를 벗어난 키: 치는 동안에는 안내하지 않고, 입력을 마치면 이유와 지금 값을 알린다. 값은 그대로다.
  await field.fill('999');
  await expect(page.locator('[data-surface=avatar] .field-error')).toHaveCount(0);
  await field.blur();
  await expect(page.locator('[data-surface=avatar] .field-error')).toContainText(
    '80~230cm 범위로 입력해 주세요 · 지금 값 182cm',
  );
  expect((await stored(page)).avatar.height).toBe(182);
  await field.fill('168');
  await expect(page.locator('[data-surface=avatar] .field-error')).toHaveCount(0);
  await field.blur();
  expect((await stored(page)).avatar.height).toBe(168);
  await field.fill('182');
  await field.blur();
  await expect(page.locator('[data-surface=avatar] svg[role=img]')).toHaveAttribute(
    'aria-label',
    /키 182cm와 가구 4개/,
  );
  await page.locator('#avatar-toggle').click();
  expect((await stored(page)).avatar).toMatchObject({ enabled: false, height: 182 });
  await expect(page.locator('[data-avatar-tag]')).toHaveCount(0);
});

test('고른 가구에 앉히고 눕히며 가구를 옮기고 돌리고 빼도 자세가 맞게 따라간다', async ({
  page,
}) => {
  await open(page);
  const chair = await pick(page, 'chair');
  await page.locator('#pose').click();
  let s = await stored(page);
  expect(s.avatar).toMatchObject({ enabled: true, pose: 'sitting', itemId: chair });
  let item = s.items.find((i) => i.id === chair),
    body = await avatar3d(page);
  expect([body.x, body.z, body.turn]).toEqual([item.x, item.z, item.angle]);
  // 앉은 몸은 바닥을 뚫지 않고 좌판 위에 있다. 기본 의자·평균 키에는 경고가 없다.
  expect(body.low).toBeGreaterThan(-0.02);
  expect(body.high).toBeLessThan(1.7);
  await expect(page.locator('#pose')).toHaveAttribute('aria-pressed', 'true');
  // 가구를 옮기고 돌리면 아바타도 같은 자리와 방향으로 간다.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.locator('#rotate').click();
  s = await stored(page);
  item = s.items.find((i) => i.id === chair);
  body = await avatar3d(page);
  expect([body.x, body.z, body.turn]).toEqual([item.x, item.z, item.angle]);
  expect(s.avatar.itemId).toBe(chair);
  // 침대를 고르면 같은 버튼이 눕히기가 된다.
  await page.keyboard.press('Escape');
  const bed = await pick(page, 'bed');
  await expect(page.locator('#pose')).toHaveAttribute('aria-label', '아바타 눕혀 보기');
  await page.locator('#pose').click();
  s = await stored(page);
  expect(s.avatar).toMatchObject({ pose: 'lying', itemId: bed });
  body = await avatar3d(page);
  const bedItem = s.items.find((i) => i.id === bed);
  // 누운 몸은 침대 전체 높이(헤드보드) 아래, 매트리스 위쪽에 놓인다.
  expect(body.low).toBeGreaterThan((bedItem.dims[1] / 100) * 0.8);
  expect(body.low).toBeLessThan(bedItem.dims[1] / 100);
  // 침대를 빼면 그 자리에 서고, 저장한 자세도 정리된다. 되돌리면 다시 눕는다.
  await page.locator('#delete').click();
  s = await stored(page);
  expect(s.avatar).toMatchObject({ pose: 'standing', itemId: null, x: bedItem.x, z: bedItem.z });
  await page.locator('#undo').click();
  expect((await stored(page)).avatar).toMatchObject({ pose: 'lying', itemId: bed });
  // 방 위 이름표를 눌러 자세 막대를 열고 서기로 바꾼다.
  await page.keyboard.press('Escape');
  await page.locator('[data-avatar-tag]').click();
  await page.locator('[data-pose=standing]').click();
  expect((await stored(page)).avatar).toMatchObject({ pose: 'standing', itemId: null });
});

test('방을 바꿔도 아바타는 원래 방의 가구에 남고 집 전체 2D·3D에 같은 자리로 보인다', async ({
  page,
}) => {
  await open(page);
  await say(page, '내 키 175cm로 침대에 눕혀줘');
  await expect(page.locator('.thread')).toContainText('침대에 눕혔어요');
  const home = await stored(page);
  expect(home.avatar).toMatchObject({ pose: 'lying', height: 175, roomId: home.roomId });
  await page.locator('#scope-room').click();
  await page.locator('[data-newspace=bedroom]').click();
  let s = await stored(page);
  expect(s.roomId).not.toBe(home.roomId);
  expect(s.avatar).toEqual(home.avatar);
  // 새 방에는 아바타가 없다.
  await expect(page.locator('[data-avatar-tag]')).toHaveCount(0);
  await expect(page.locator('#avatar-toggle')).toHaveAttribute('aria-pressed', 'false');
  expect(await avatar3d(page)).toBe(null);
  // 집 전체에서는 원래 방의 침대 위에 그대로 보인다.
  await page.locator('#scope-house').click();
  await frames(page);
  const bed = home.items.find((i) => i.id === home.avatar.itemId),
    origin = s.floorplan.positions[home.roomId];
  const body = await avatar3d(page);
  expect(body.x).toBeCloseTo(origin.x + bed.x, 5);
  expect(body.z).toBeCloseTo(origin.z + bed.z, 5);
  await expect(page.locator('[data-avatar-tag]')).toHaveText('키 175cm');
  await page.locator('[data-view="2d"]').click();
  await page.waitForFunction(() => Number.isFinite(window.__roomggu.app.scenes.house.scale));
  await frames(page);
  const anchor = await page.evaluate(() => {
    const sc = window.__roomggu.app.scenes.house,
      r = sc.canvas.getBoundingClientRect(),
      a = sc.avatarAnchor();
    return { x: (a.x - r.left - sc.ox) / sc.scale, z: (a.y - r.top - sc.oy) / sc.scale };
  });
  expect(anchor.x).toBeCloseTo(origin.x + bed.x, 2);
  await expect(page.locator('[data-avatar-tag]')).toBeVisible();
  // 원래 방으로 돌아가면 여전히 같은 침대에 누워 있다.
  await page.locator(`[data-room-tag="${home.roomId}"] .tag-main`).click();
  await page.getByRole('button', { name: '선택한 방 편집' }).click();
  s = await stored(page);
  expect([s.roomId, s.scope]).toEqual([home.roomId, 'room']);
  expect(s.avatar).toEqual(home.avatar);
  await expect(page.locator('#avatar-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('집 전체 길잡이·이름표로 공간을 고르고 ㄱ자 집을 만들며 문과 설비가 2D·3D에서 일치한다', async ({
  page,
}) => {
  await open(page);
  const first = (await stored(page)).roomId;
  await page.locator('#scope-house').click();
  await expect(page.locator('#scope-house')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-room-tag]')).toHaveCount(1);
  await page.locator('#scope-house').click();
  await page.locator('[data-newspace=bathroom]').click();
  let s = await stored(page);
  const bath = s.roomId;
  expect(s.scope).toBe('house');
  expect(s.room.type).toBe('bathroom');
  await expect(page.locator('[data-room-tag]')).toHaveCount(2);
  await expect(page.locator(`[data-room-tag="${bath}"]`)).toHaveClass(/is-selected/);
  // 3D: 문 하나, 설비 셋. 설비는 문 앞 통로를 막지 않는다.
  await frames(page);
  const model = await page.evaluate((bath) => {
    const { app } = window.__roomggu,
      sc = app.scenes.three,
      p = app.state.floorplan.positions[bath],
      out = { doors: 0, fixtures: [], tags: app.scenes.tags().map((t) => t.text) };
    sc.room.updateMatrixWorld(true);
    sc.room.traverse((o) => {
      if (o.userData.opening) out.doors++;
      if (o.userData.fixture) {
        const v = o.getWorldPosition(o.position.clone());
        out.fixtures.push({ type: o.userData.fixture, x: v.x - p.x, z: v.z - p.z });
      }
    });
    return out;
  }, bath);
  expect(model.doors).toBe(1);
  expect(model.fixtures.map((f) => f.type).sort()).toEqual(['basin', 'shower', 'toilet']);
  // 화장실은 원룸 오른쪽에 붙어 문이 왼쪽 벽에 난다. 문 앞 50cm 안에 설비 중심이 없다.
  for (const f of model.fixtures) expect(f.x > -0.9 + 0.5 || Math.abs(f.z - 0.9) > 0.4).toBe(true);
  expect(model.tags).toEqual(
    expect.arrayContaining([
      expect.stringContaining('나의 화장실'),
      expect.stringContaining('4 × 4m'),
    ]),
  );
  // 2D에서 화장실을 원룸 아래쪽으로 끌어 ㄱ자 외곽을 만든다. 벽에 붙고 문이 다시 이어진다.
  await page.locator('[data-view="2d"]').click();
  await frames(page);
  const from = await page.evaluate((id) => window.__roomggu.app.scenes.house.anchor(id), bath);
  const scale = await page.evaluate(() => window.__roomggu.app.scenes.house.scale);
  const target = { x: -1.1 - 2.9, z: 2 + 1.1 - -0.9 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + target.x * scale, from.y + target.z * scale + 4, { steps: 12 });
  await page.mouse.up();
  s = await stored(page);
  const pos = s.floorplan.positions[bath];
  expect(pos.z).toBeCloseTo(3.1, 2);
  expect(Math.abs(pos.x - -1.1)).toBeLessThan(0.11);
  const doors = await page.evaluate(() => {
    let n = 0;
    window.__roomggu.app.scenes.three.room.traverse((o) => o.userData.opening && n++);
    return n;
  });
  expect(doors).toBe(1);
  // 원룸 방 편집에서도 화장실 문 자리가 벽에 비어 있다.
  await page.locator(`[data-room-tag="${first}"] .tag-main`).dblclick();
  s = await stored(page);
  expect([s.scope, s.roomId]).toEqual(['room', first]);
  await page.locator('[data-view="3d"]').click();
  await frames(page);
  expect(
    await page.evaluate(() => {
      let n = 0;
      window.__roomggu.app.scenes.three.room.traverse((o) => o.userData.door && n++);
      return n;
    }),
  ).toBe(1);
  // 문 이름표는 문 너머의 공간을 알리고, 누르면 그 공간으로 간다.
  const door = page.locator(`[data-door-tag="${bath}"]`);
  await expect(door).toContainText('나의 화장실');
  await door.click();
  expect((await stored(page)).roomId).toBe(bath);
  await expect(page.locator(`[data-door-tag="${first}"]`)).toBeVisible();
  await page.locator(`[data-door-tag="${first}"]`).click();
  expect((await stored(page)).roomId).toBe(first);
  // 실행 취소로 공간 위치를 되돌리고, 새로고침 뒤에도 같은 집이 열린다.
  const kept = await stored(page);
  await page.reload();
  await page.waitForFunction(() => window.__roomggu?.app.scenes.three);
  expect(await stored(page)).toEqual(kept);
});

test('집 전체 이미지에는 방 이름표와 키 이름표가 함께 저장된다', async ({ page }) => {
  await open(page);
  await say(page, '내 키 168cm');
  await page.locator('#scope-house').click();
  for (const view of ['3d', '2d']) {
    await page.locator(`[data-view="${view}"]`).click();
    await frames(page);
    const result = await page.evaluate(() => {
      const { app } = window.__roomggu,
        sc = app.state.view === '3d' ? app.scenes.three : app.scenes.house,
        tags = app.scenes.tags();
      return { tags, changed: sc.png([]) !== sc.png(tags) };
    });
    expect(result.tags.map((t) => t.text)).toEqual(
      expect.arrayContaining(['키 168cm', expect.stringContaining('햇살이 드는 작은 방')]),
    );
    expect(result.changed).toBe(true);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '파일과 설정' }).click();
    await page.locator('#png').click();
    expect((await download).suggestedFilename()).toBe('집 전체-배치.png');
  }
});

for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`모바일 ${size.width}: 도구 메뉴·자세 막대·낮춘 시트가 화면 안에 들어온다`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, size);
    const inside = async (selector) => {
      const box = await page.locator(selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
      return box;
    };
    // + 메뉴는 시트 안에서 잘리지 않고 열린다.
    await page.getByRole('button', { name: '도구 열기' }).click();
    const menu = await inside('.tool-menu'),
      sheet = await page.locator('.sheet').boundingBox();
    expect(menu.y).toBeGreaterThanOrEqual(sheet.y);
    await page.locator('[data-tool=avatar]').click();
    await expect(page.locator('.avatar-bar')).toBeVisible();
    await inside('.avatar-bar');
    await page.locator('[data-pose=lying]').click();
    expect((await stored(page)).avatar.pose).toBe('lying');
    // 집 전체로 가도 길잡이와 보기 전환이 한 줄에 들어온다.
    await page.locator('#scope-house').click();
    await inside('.scope-nav');
    await inside('.stage-tools');
    await page.locator('#scope-house').click();
    await page.locator('[data-newspace=bathroom]').click();
    await expect(page.locator('[data-room-tag]')).toHaveCount(2);
    for (const view of ['2d', '3d']) {
      await page.locator(`[data-view="${view}"]`).click();
      await frames(page);
      await inside('.room-tag.is-selected');
    }
    // 낮춘 시트: 입력창이 한 줄로 보이고 잘리는 글이 없다.
    await page.evaluate(() => window.__roomggu.store.setSheet('peek'));
    await page.waitForTimeout(400);
    await inside('.composer');
    const input = await inside('#chat-input');
    expect(input.height).toBeLessThanOrEqual(44);
    await expect(page.locator('.composer-foot')).toBeHidden();
    await page.screenshot({ path: `test-results/review-house-${size.width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('모델을 내려받는 동안 다이얼로그로 알리고, 접거나 취소할 수 있다', async ({ page }) => {
  await open(page);
  // 실제 내려받기 대신 로더가 보내는 진행 상태를 그대로 넣어 화면을 확인한다.
  const progress = (download) =>
    page.evaluate((download) => {
      const { app, store } = window.__roomggu;
      app.ai.text = 'loading';
      app.ai.download = download;
      store.emit();
    }, download);
  await progress({
    task: 'text',
    phase: 'fetch',
    name: 'Gemma 3 1B',
    mb: 247,
    totalMB: 574,
    progress: 0.43,
  });
  const dialog = page.getByRole('dialog', { name: '상담 모델을 내려받는 중' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '43');
  await expect(dialog).toContainText('247MB / 약 574MB');
  await expect(dialog).toContainText('규칙으로 답하니');
  await page.screenshot({ path: 'test-results/model-download.png' });
  // 계속 쓰기: 방 위의 작은 진행 표시로 줄고, 앱은 그대로 쓸 수 있다.
  await dialog.getByRole('button', { name: '계속 쓰기' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#download-pill')).toContainText('43%');
  await say(page, '거실 가로 5m 세로 4m');
  expect((await stored(page)).room).toMatchObject({ w: 5, d: 4 });
  await page.locator('#download-pill').click();
  await expect(dialog).toBeVisible();
  // 취소하면 모델을 끄고 그 선택을 기억한다.
  await dialog.getByRole('button', { name: '취소하고 모델 끄기' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('room-ggu-model'))).toBe('off');
  await expect(page.locator('.status-line')).toContainText('모델 꺼 둠');
  // 실패하면 이유와 다시 시도를 보여준다.
  await progress({
    task: 'text',
    phase: 'error',
    name: 'Gemma 4 E2B',
    totalMB: 2700,
    error: 'GPU 메모리가 부족해요.',
  });
  // 실패는 주의를 끄는 다이얼로그(alertdialog)로 알린다.
  await expect(
    page.getByRole('alertdialog', { name: '상담 모델을 준비하지 못했어요' }),
  ).toContainText('GPU 메모리가 부족해요.');
  // 다이얼로그가 뜨면 확인 버튼에 초점이 가고, Tab은 다이얼로그 안에서만 돈다.
  await expect(page.locator('#download-continue')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#download-continue')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#download-dialog')).toHaveCount(0);
  // AI 도구에서 두 모델의 크기를 비교해 고를 수 있다. 기본은 가벼운 모델이다.
  await page.getByRole('button', { name: '파일과 설정' }).click();
  await page.getByRole('menuitem', { name: '이 기기의 AI' }).click();
  const light = page.getByRole('radio', { name: /Gemma 3 1B/ }),
    large = page.getByRole('radio', { name: /Gemma 4 E2B/ });
  await expect(light).toHaveAttribute('aria-checked', 'true');
  await expect(light).toContainText('600MB');
  await expect(large).toHaveAttribute('aria-checked', 'false');
  await expect(large).toContainText('2.8GB');
});
