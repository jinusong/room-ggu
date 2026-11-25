import { test, expect } from '@playwright/test';
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
const thread = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-thread-v1')));
const ready = (page) =>
  page.waitForFunction(() => window.__roomggu?.ready(), null, { timeout: 20000 });
async function say(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.getByRole('button', { name: '설명 보내기', exact: true }).click();
}
async function openTool(page, name) {
  await page.getByRole('button', { name: '도구 열기' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('첫 화면은 대화가 중심이고, 방 설명으로 크기 도구가 나타나 도면에 바로 반영된다', async ({
  page,
}) => {
  await page.goto('/?model=off');
  await ready(page);
  await expect(page.locator('#chat-input')).toBeVisible();
  // 상담은 룸꾸의 인사 말풍선으로 시작하고, 누가 답하는지는 대화 머리에 있다.
  const thread = page.getByRole('log', { name: '상담 대화' });
  await expect(thread.locator('#greeting')).toContainText('안녕하세요, 방 꾸미기를 돕는 룸꾸예요');
  await expect(thread.locator('[data-starter]')).toHaveCount(6);
  await expect(page.locator('.sheet-head')).toContainText('방 꾸미기 상담');
  await expect(page.locator('.sheet-head .status-line')).toContainText(
    '모델 꺼 둠, 규칙으로 답해요',
  );
  await expect(page.locator('.surface')).toHaveCount(0);
  // 대화는 화면 높이를 다 쓰는 왼쪽 열이고 화면 폭의 40%를 차지한다.
  const sheet = await page.locator('.sheet').boundingBox();
  expect(sheet.x).toBe(0);
  expect(sheet.width).toBeGreaterThanOrEqual(570);
  expect(sheet.height).toBeGreaterThanOrEqual(959);
  await expect(page.locator('#viewport-house canvas')).toBeVisible();
  await say(page, '거실 가로 5m 세로 4m 천장 2.6m로 바꿔줘');
  await expect(page.locator('[data-surface=room-size]')).toBeVisible();
  // 사용자 말은 오른쪽의 먹색 말풍선, 룸꾸의 답은 얼굴이 붙은 왼쪽 말풍선이다.
  const mine = page.locator('.msg.user p').last(),
    reply = page.locator('.msg.assistant').last();
  expect(await mine.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(31, 29, 25)');
  await expect(reply.locator('.chat-avatar')).toBeVisible();
  const [mineBox, replyBox] = [
    await mine.boundingBox(),
    await reply.locator('.bubble').boundingBox(),
  ];
  expect(mineBox.x + mineBox.width).toBeGreaterThan(replyBox.x + replyBox.width - 1);
  // 인사는 대화 맨 위에 남고 시작점은 접힌다.
  await expect(thread.locator('#greeting')).toHaveCount(1);
  await expect(thread.locator('[data-starter]')).toHaveCount(0);
  await expect(page.locator('.msg.assistant .msg-meta').last()).toHaveText(
    '상담 모델을 꺼 둬서 규칙으로 처리',
  );
  let s = await stored(page);
  expect([s.room.type, s.room.w, s.room.d, s.room.h]).toEqual(['living', 5, 4, 2.6]);
  await expect(page.locator('.receipt')).toContainText('4m');
  await expect(page.locator('.receipt')).toContainText('5m');
  await page.getByRole('textbox', { name: '방 가로', exact: true }).fill('5.5');
  expect((await stored(page)).room.w).toBe(5.5);
  await expect(page.locator('.room-tag.is-selected')).toContainText('5.5 × 4m');
  await say(page, '벽은 세이지 바닥은 월넛');
  await expect(page.locator('[data-surface=finishes]')).toBeVisible();
  await expect(page.locator('[data-surface=room-size]')).toHaveCount(0);
  await expect(page.locator('[data-surface-chip=room-size]')).toBeVisible();
  await page.getByRole('button', { name: '벽 블루그레이', exact: true }).click();
  await page.mouse.move(1300, 200);
  s = await stored(page);
  expect(s.room.wallColor).toBe('#bfcbd1');
  expect(s.room.floorColor).toBe('#93785c');
  await expect(page.locator('.corner figcaption').nth(1)).toHaveText('바꾸기 전');
});

test('가구 설명 → 방 안의 점선 초안 → 놓기 → 회전·삭제·되돌리기, 대화는 계속 남는다', async ({
  page,
}) => {
  await page.goto('/?model=off');
  await ready(page);
  await say(page, '두 명이 넉넉하게 앉는 소파야. 가로 200cm 깊이 85cm');
  const tool = page.locator('[data-surface=furniture-dims]');
  await expect(tool).toBeVisible();
  await expect(page.getByRole('textbox', { name: '가구 가로', exact: true })).toHaveValue('200');
  await expect(page.getByRole('textbox', { name: '가구 깊이', exact: true })).toHaveValue('85');
  await expect(tool.locator('.tape.is-set')).toHaveCount(2);
  await expect(tool.locator('.tape.is-draft')).toHaveCount(1);
  await expect(page.locator('.target.is-draft')).toContainText('초안');
  await expect(page.locator('.draft-note')).toBeVisible();
  expect(await page.evaluate(() => window.__roomggu.app.draft?.dims)).toEqual([200, 82, 85]);
  await page.locator('.surface-foot .btn.primary').click();
  let s = await stored(page);
  expect(s.items).toHaveLength(5);
  expect(s.items.at(-1).dims).toEqual([200, 82, 85]);
  await expect(page.locator('.thread')).toContainText('두 명이 넉넉하게 앉는 소파야');
  await expect(page.locator('.thread')).toContainText('방에 놓았어요');
  await expect(page.locator('[data-surface=furniture-dims] .surface-meta')).toHaveText('방에 놓임');
  await expect(page.locator('.target.is-item')).toContainText('선택한 가구');
  const placedAngle = s.items.at(-1).angle;
  expect([0, 90, 180, 270]).toContain(placedAngle);
  await page.locator('#rotate').click();
  expect((await stored(page)).items.at(-1).angle).toBe((placedAngle + 90) % 360);
  await page.locator('#delete').click();
  expect((await stored(page)).items).toHaveLength(4);
  await expect(page.locator('.event').last()).toContainText('뺐어요');
  await page.locator('#undo').click();
  expect((await stored(page)).items).toHaveLength(5);
  await page.reload();
  await ready(page);
  expect((await stored(page)).items).toHaveLength(5);
  await expect(page.locator('.thread')).toContainText('방에 놓았어요');
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일과 설정' }).click();
  await page.locator('#export').click();
  // WebKit은 내려받는 파일 이름의 한글을 자모로 풀어(NFD) 알려 주므로 합쳐서 견준다.
  expect((await file).suggestedFilename().normalize('NFC')).toMatch(/배치\.json$/);
});

test('선택한 가구는 입력창의 대상이 되고, 다른 가구 이름은 새 초안을 만든다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);
  const desk = (await stored(page)).items.find((a) => a.type === 'desk');
  await page.evaluate((id) => {
    const { app } = window.__roomggu;
    window.__roomggu.store.select(id);
  }, desk.id);
  await expect(page.locator('.target.is-item')).toContainText('책상');
  await say(page, '가로 140cm로 바꿔줘');
  let s = await stored(page);
  expect(s.items.find((a) => a.id === desk.id).dims[0]).toBe(140);
  expect(s.items.find((a) => a.id === desk.id).type).toBe('desk');
  await say(page, '초록색으로 바꿔줘');
  await expect(page.locator('[data-surface=furniture-color]')).toBeVisible();
  expect((await stored(page)).items.find((a) => a.id === desk.id).color).toBe('#83917d');
  await say(page, '침대도 하나 더 놓고 싶어');
  await expect(page.locator('.target.is-draft')).toContainText('침대');
  expect((await stored(page)).items.find((a) => a.id === desk.id).type).toBe('desk');
});

test('주방·반려동물·식물을 포함한 가구 93종을 고르고 규격을 비교해 배치한다', async ({ page }) => {
  test.slow();
  await page.goto('/?model=off');
  await ready(page);
  await openTool(page, '가구 고르기');
  await expect(page.locator('.catalog-card')).toHaveCount(93);
  // CI의 소프트웨어 WebGL은 카드 93개의 썸네일을 모두 렌더링한 뒤 이미지를 붙인다.
  await expect(page.locator('.catalog-card img')).toHaveCount(93, { timeout: 30_000 });
  await expect(page.locator('.catalog-card[data-type=toilet]')).toContainText('변기');
  await page.getByRole('button', { name: '반려동물', exact: true }).click();
  await expect(page.locator('.catalog-card')).toHaveCount(11);
  await expect(page.locator('.catalog-card[data-type=cat_tower]')).toContainText('캣타워');
  await page.getByRole('button', { name: '전체', exact: true }).click();
  await page.getByRole('textbox', { name: '가구 검색' }).fill('식탁');
  await expect(page.locator('.catalog-card')).toHaveCount(2);
  await page.locator('.catalog-card[data-type=dining]').click();
  await page.getByRole('button', { name: /6인 식탁/ }).click();
  expect(await page.evaluate(() => window.__roomggu.app.draft.dims)).toEqual([180, 74, 90]);
  await expect(page.locator('.size-card.is-active')).toContainText('6인 식탁');
  await page.locator('.chip.is-primary').click();
  const s = await stored(page);
  expect(s.items.at(-1).type).toBe('dining');
  expect(s.items.at(-1).dims).toEqual([180, 74, 90]);
  await openTool(page, '가구 고르기');
  await page.locator('.catalog-card[data-type=rug]').last().click();
  await page.locator('.surface-foot .btn.primary').last().click();
  expect((await stored(page)).items.at(-1).type).toBe('rug');
});

test('방 크기를 입력 도중 반영하고 한 번에 되돌리며, 유형·초안·마감을 바꾼다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);
  await openTool(page, '방 크기');
  const before = await stored(page);
  const width = page.getByRole('textbox', { name: '방 가로', exact: true });
  await width.fill('6.5');
  expect((await stored(page)).room.w).toBe(6.5);
  await expect(page.locator('[data-surface=room-size] .surface-meta')).toContainText('26.0m²');
  await width.blur();
  await page.locator('#undo').click();
  expect((await stored(page)).room.w).toBe(before.room.w);
  await page.getByRole('button', { name: '방 가로 늘리기' }).click();
  expect((await stored(page)).room.w).toBe(before.room.w + 0.1);
  await openTool(page, '공간 유형');
  await page.locator('.type-tile', { hasText: '거실' }).click();
  let s = await stored(page);
  expect(s.room.type).toBe('living');
  expect(s.room.w).toBe(before.room.w + 0.1);
  await openTool(page, '방 크기');
  await page.locator('[data-surface=room-size] .preset').first().click();
  expect((await stored(page)).room.w).toBe(4);
  await openTool(page, '벽과 바닥');
  await page.getByRole('button', { name: '바닥 월넛', exact: true }).click();
  expect((await stored(page)).room.floorColor).toBe('#93785c');
});

test('대화로 방을 바꾸고 새 공간을 만들어도 대화는 이어지고 공간마다 가구를 보존한다', async ({
  page,
}) => {
  await page.goto('/?model=off');
  await ready(page);
  const first = await stored(page);
  await say(page, '거실 가로 5m 세로 4m 천장 2.6m로 바꿔줘. 소파 중심으로 꾸밀 거야.');
  let s = await stored(page);
  expect([s.room.type, s.room.w, s.items.length]).toEqual(['living', 5, 4]);
  await say(page, '아담한 서재 하나 추가해줘');
  s = await stored(page);
  expect([s.room.type, s.room.w, s.items.length, s.otherRooms.length]).toEqual([
    'office',
    2.5,
    0,
    1,
  ]);
  await expect(page.locator('.thread')).toContainText('소파 중심으로 꾸밀 거야');
  await say(page, '가로 120cm인 책상이야');
  await page.locator('.chip.is-primary').click();
  expect((await stored(page)).items).toHaveLength(1);
  await page.getByLabel('선택한 방').selectOption(first.roomId);
  s = await stored(page);
  expect([s.items.length, s.room.w]).toEqual([4, 5]);
  await expect(page.locator('.surface-chip', { hasText: '다른 공간' })).toHaveCount(1);
  await page.reload();
  await ready(page);
  expect((await stored(page)).otherRooms[0].items).toHaveLength(1);
  await expect(page.getByLabel('선택한 방').locator('option')).toHaveCount(2);
});

test('공간을 추가·삭제하고 실행 취소로 공간 전체를 복원한다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);
  await page.locator('#add-space').click();
  await page.locator('[data-add-type=bedroom]').click();
  expect((await stored(page)).room.type).toBe('bedroom');
  await openTool(page, '내 공간');
  await page.getByRole('button', { name: '나의 침실 삭제' }).click();
  await page.locator('[data-surface=spaces] .btn.danger').click();
  expect((await stored(page)).otherRooms).toHaveLength(0);
  await page.locator('#undo').click();
  const s = await stored(page);
  expect(s.room.type).toBe('bedroom');
  expect(s.otherRooms).toHaveLength(1);
});

test('잘못된 배치 파일을 거절하고 기존 데이터를 보존한다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);
  const before = await stored(page);
  await page.locator('#layout-file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":2,"items":[]}'),
  });
  await expect(page.locator('#toast')).toContainText('불러오기 실패');
  expect(await stored(page)).toEqual(before);
  await page.locator('#layout-file').setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before)),
  });
  await expect(page.locator('#toast')).toContainText('배치를 불러왔어요');
  expect(await stored(page)).toEqual(before);
});

test('평면도를 복원한 뒤 가구 두 개를 직접 끌어 옮긴다', async ({ page }) => {
  await page.goto('/?model=off');
  await ready(page);

  await page.reload();
  await ready(page);

  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const a = (await stored(page)).items[0];
  let p = await page.evaluate((id) => window.__roomggu.anchor(id, { center: true }), a.id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#selection-tools')).toContainText('침대');
  let next = (await stored(page)).items[0];
  expect(Math.abs(next.x - a.x) + Math.abs(next.z - a.z)).toBeGreaterThan(0.1);

  const b = (await stored(page)).items[1];
  p = await page.evaluate((id) => window.__roomggu.anchor(id, { center: true }), b.id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 30, p.y + 30, { steps: 6 });
  await page.mouse.up();
  next = (await stored(page)).items[1];
  expect(Math.abs(next.x - b.x) + Math.abs(next.z - b.z)).toBeGreaterThan(0.1);
});

test('모바일은 대화로 시작하고 시트를 접고 펴도 입력창이 화면 안에 남는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?model=off');
  await ready(page);
  await expect(page.locator('#chat-input')).toBeVisible();
  await expect(page.locator('#greeting')).toContainText('안녕하세요, 방 꾸미기를 돕는 룸꾸예요');
  await expect(page.locator('.sheet-head')).toContainText('방 꾸미기 상담');
  await expect(page.locator('#viewport-house canvas')).toBeVisible();
  await page.locator('#chat-input').fill('입력하던 설명');
  await page.locator('.sheet-handle').click();
  await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'full');
  await expect(page.locator('#chat-input')).toHaveValue('입력하던 설명');
  await say(page, '침실 가로 4m 세로 3m');
  await expect(page.locator('[data-surface=room-size]')).toBeVisible();
  expect((await stored(page)).room.w).toBe(4);
  for (const snap of ['peek', 'half']) {
    await page.locator('.sheet-handle').click();
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', snap);
    await page.waitForTimeout(450);
    const field = await page.locator('#chat-input').boundingBox();
    expect(field.y + field.height).toBeLessThanOrEqual(844);
    expect(field.y).toBeGreaterThan(400);
  }
  await say(page, '두 명이 앉는 소파야');
  await page.locator('.chip.is-primary').click();
  await expect(page.locator('#selection-tools')).toBeVisible();
  await expect(page.locator('.thread')).toContainText('방에 놓았어요');
  expect(await noOverflow(page)).toBe(true);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await noOverflow(page)).toBe(true);
  await expect(page.locator('#chat-input')).toBeInViewport();
});

test('대화와 방 사이를 끌거나 방향키로 대화 폭을 바꾸고 다음 방문에도 기억한다', async ({
  page,
}) => {
  await page.goto('/?model=off');
  await ready(page);
  const sheet = page.locator('.sheet'),
    handle = page.getByRole('separator', { name: '대화 폭 조절' });
  const before = (await sheet.boundingBox()).width;
  // 기본은 화면의 절반이다.
  expect(before).toBeCloseTo(720, 0);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, 400, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 120, 400, { steps: 4 });
  await page.mouse.up();
  const wide = (await sheet.boundingBox()).width;
  expect(wide).toBeCloseTo(before + 120, 0);
  // 방은 대화가 넓어진 만큼 비켜 그린다.
  expect(
    await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-left')),
    ),
  ).toBeCloseTo(wide + 8, 0);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await sheet.boundingBox()).width).toBeCloseTo(wide - 24, 0);
  await page.reload();
  await ready(page);
  expect((await sheet.boundingBox()).width).toBeCloseTo(wide - 24, 0);
  // 너무 좁히거나 넓혀도 대화와 방이 모두 쓸 만한 폭을 지킨다.
  await handle.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  expect((await sheet.boundingBox()).width).toBe(360);
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  // 넓혀도 방 쪽 도구 줄이 들어갈 520px은 남는다.
  expect((await sheet.boundingBox()).width).toBe(1440 - 520);
  await handle.dblclick();
  expect((await sheet.boundingBox()).width).toBeCloseTo(before, 0);
});
