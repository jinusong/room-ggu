import { test, expect } from '@playwright/test';

// 실제 대화에서 틀렸던 흐름을 그대로 다시 넣어 본다(규칙 경로).
// 화장실 옆에 거실 붙이기 → 따지는 말 → 한 문장의 방·가구 여럿 → 겹침 → 방 돌리기 → 화장실 설비 고치기.
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('room-ggu-v2')));
const frames = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const overlaps = (page) =>
  page.evaluate(() => {
    const s = window.__roomggu.app.state,
      list = [{ roomId: s.roomId, room: s.room }, ...s.otherRooms],
      box = (r) => {
        const p = s.floorplan.positions[r.roomId];
        return [p.x - r.room.w / 2, p.x + r.room.w / 2, p.z - r.room.d / 2, p.z + r.room.d / 2];
      };
    let n = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = box(list[i]),
          b = box(list[j]);
        if (
          Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.005 &&
          Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > 0.005
        )
          n++;
      }
    return n;
  });
async function say(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForFunction((text) => {
    const { app } = window.__roomggu,
      turns = app.thread,
      i = turns.findLastIndex((t) => t.role === 'user' && t.text === text);
    return (
      !app.busy && i >= 0 && turns[i + 1]?.role === 'assistant' && turns[i + 1].status === 'done'
    );
  }, text);
  await frames(page);
  return page.evaluate(() => {
    const t = window.__roomggu.app.thread.findLast((x) => x.role === 'assistant');
    return {
      text: t.text,
      surfaces: t.surfaces.map((x) => x.kind),
      receipt: t.receipt.map((r) => `${r.label}:${r.to}`),
      chips: t.suggestions.map((x) => x.label),
    };
  });
}
// 화장실 하나만 있는 집에서 시작한다.
async function bathroomHome(page, size) {
  if (size) await page.setViewportSize(size);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.removeItem('room-ggu-thread-v1');
    localStorage.setItem(
      'room-ggu-v2',
      JSON.stringify({
        version: 5,
        roomId: 'bath',
        roomOrder: ['bath'],
        otherRooms: [],
        name: '나의 화장실',
        room: {
          type: 'bathroom',
          w: 1.8,
          d: 2.2,
          h: 2.4,
          wallColor: '#faf9f5',
          floorColor: '#dce1dc',
          sources: { w: '공간 유형 기본값', d: '공간 유형 기본값', h: '공간 유형 기본값' },
        },
        items: [],
        scope: 'house',
        view: '2d',
        floorplan: { positions: { bath: { x: 0, z: 0 } } },
      }),
    );
  });
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.app.scenes.house?.scale > 0);
  await frames(page);
}

test('화장실 옆에 거실을 붙이고, 한 문장의 방·가구 요청과 겹침·방 돌리기를 처리한다', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bathroomHome(page);

  // 1) "화장실 옆에"는 자리다. 새 공간은 거실이고 화장실 벽에 붙는다.
  let r = await say(page, '화장실 옆에 방하나 추가하자. 거기는 거실임');
  let s = await stored(page);
  expect(s.name).toBe('나의 거실');
  expect(s.room.type).toBe('living');
  expect(s.otherRooms.map((x) => x.name)).toEqual(['나의 화장실']);
  expect(r.text).toContain('나의 화장실 오른쪽에 나의 거실을 붙였어요');
  expect(r.receipt).toEqual(
    expect.arrayContaining([
      '새 공간:나의 거실',
      '자리:나의 화장실 오른쪽',
      '크기:5.5 × 4.5 × 2.5m',
    ]),
  );
  expect(await overlaps(page)).toBe(0);
  await expect(page.locator('[data-room-tag]')).toHaveCount(2);

  // 2) 한 문장에 유형 확인 + 가구 둘 + 면적. 셋 다 반영한다.
  r = await say(
    page,
    '거실이라고 그리고 거기에 소파랑 밥먹을 수 있는 식탁이 있었으면 좋겠어. 거실 평수는 대략 6평정도야',
  );
  s = await stored(page);
  expect(s.room.type).toBe('living');
  expect(Math.abs(s.room.w * s.room.d - 6 * 3.3058)).toBeLessThan(0.1);
  expect(await overlaps(page)).toBe(0);
  expect(r.text).toContain('소파와 식탁 초안을 준비했어요');
  expect(r.receipt.join(' ')).toMatch(/새 초안:소파.*다음 초안:식탁/);
  expect(r.chips).toEqual(['모두 놓기', '소파만 놓기']);
  await page.screenshot({ path: 'test-results/repair-compound.png' });
  await page.getByRole('button', { name: '모두 놓기' }).click();
  await frames(page);
  s = await stored(page);
  expect(s.items.map((a) => a.type)).toEqual(['sofa', 'dining']);
  const draft = await page.evaluate(() => [
    window.__roomggu.app.draft,
    window.__roomggu.app.queue.length,
  ]);
  expect(draft).toEqual([null, 0]);
  // 되돌리기 한 번에 둘 다 물린다.
  await page.locator('#undo').click();
  expect((await stored(page)).items).toHaveLength(0);
  await page.locator('#redo').click();
  expect((await stored(page)).items).toHaveLength(2);

  // 3) 겹친 공간이 없으면 없다고 답한다.
  r = await say(page, '거실로 바꿨는데 겹치잖아...');
  expect(r.text).toBe('겹친 공간도, 겹치거나 벽을 넘은 가구도 없어요.');

  // 4) 방을 통째로 돌린다. 가구가 함께 돌고 화장실과 겹치지 않는다.
  const before = (await stored(page)).room;
  r = await say(page, '이 방 90도 돌려줘');
  s = await stored(page);
  expect([s.room.w, s.room.d]).toEqual([before.d, before.w]);
  expect(r.text).toContain('나의 거실을 오른쪽으로 90° 돌렸어요');
  expect(await overlaps(page)).toBe(0);
  // 집 전체에서 고른 방의 이름표에도 돌리기 단추가 있다.
  await page.locator('[data-room-turn]').click();
  await frames(page);
  s = await stored(page);
  expect([s.room.w, s.room.d]).toEqual([before.w, before.d]);
  expect(await overlaps(page)).toBe(0);
  await page.screenshot({ path: 'test-results/repair-house.png' });
  expect(errors).toEqual([]);
});

test('따지는 말에서 아니라고 한 유형은 지키지 않고, 유형을 바꾸면 이름·설비·자리가 따라온다', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bathroomHome(page);
  // 화장실을 하나 더 붙인 뒤(예전에 잘못 만들어지던 모양) 따진다.
  await page.evaluate(() => window.__roomggu.store.addSpace('bathroom', { side: 'right' }));
  await frames(page);
  let s = await stored(page);
  expect(s.name).toBe('나의 화장실 2');
  expect(s.items.map((a) => a.type).sort()).toEqual(['basin', 'shower', 'toilet']);

  let r = await say(page, '아니 거실이라니까 왜 자꾸 화장실로 고정하냐고!!!!');
  s = await stored(page);
  expect(s.room.type).toBe('living');
  expect(s.name).toBe('나의 거실');
  expect(s.items).toHaveLength(0);
  expect(r.text).toMatch(/^제가 잘못 읽었어요/);
  expect(await overlaps(page)).toBe(0);

  // 바라는 유형을 말하지 않고 아니라고만 하면, 앞에서 말한 유형이 없을 때는 묻는다.
  await page.evaluate(() => window.__roomggu.store.clearThread());
  await page.evaluate(() => window.__roomggu.store.setRoomType('bathroom'));
  r = await say(page, '왜 화장실로 생성하는거야');
  expect(r.text).toContain('화장실이 아니라면 어떤 공간으로 바꿀까요?');
  expect(r.surfaces).toEqual(['room-type']);
  expect((await stored(page)).room.type).toBe('bathroom');
  // 칩으로 고르면 바뀐다.
  await page.getByRole('button', { name: '거실', exact: true }).last().click();
  await page.waitForFunction(() => window.__roomggu.app.state.room.type === 'living');
  expect((await stored(page)).name).toBe('나의 거실');
  expect(await overlaps(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('화장실 설비는 가구처럼 고르고 옮기고 빼고 다시 놓을 수 있다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // v4 저장본의 화장실은 설비가 그림뿐이었다. 불러오면 가구로 옮겨진다.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.removeItem('room-ggu-thread-v1');
    localStorage.setItem(
      'room-ggu-v2',
      JSON.stringify({
        version: 4,
        roomId: 'bath',
        roomOrder: ['bath'],
        otherRooms: [],
        name: '나의 화장실',
        room: {
          type: 'bathroom',
          w: 1.8,
          d: 2.2,
          h: 2.4,
          wallColor: '#faf9f5',
          floorColor: '#e0d4bf',
        },
        items: [],
        view: '2d',
        floorplan: { positions: { bath: { x: 0, z: 0 } } },
      }),
    );
  });
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.app.scenes.plan?.scale > 0);
  await frames(page);
  let s = await page.evaluate(() => window.__roomggu.app.state);
  expect(s.version).toBe(5);
  expect(s.items.map((a) => a.type)).toEqual(['toilet', 'basin', 'shower']);
  expect(s.room.floorColor).toBe('#dce1dc');

  // 2D에서 변기를 눌러 고르고 끌어 옮긴다.
  const toilet = s.items[0];
  const at = await page.evaluate(
    (id) => window.__roomggu.app.scenes.plan.anchor(id, { center: true }),
    toilet.id,
  );
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__roomggu.app.selected)).toBe(toilet.id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 20, at.y + 90, { steps: 8 });
  await page.mouse.up();
  await frames(page);
  s = await stored(page);
  expect(s.items[0].z).toBeGreaterThan(toilet.z + 0.2);
  await page.screenshot({ path: 'test-results/bathroom-edit.png' });

  // 대화로 빼고, 가구 고르기의 욕실 분류에서 다시 놓는다.
  await say(page, '이거 빼줘');
  s = await stored(page);
  expect(s.items.map((a) => a.type)).toEqual(['basin', 'shower']);
  const r = await say(page, '변기 하나 놓고 싶어');
  expect(r.receipt.join(' ')).toContain('새 초안:변기');
  await page.getByRole('button', { name: '방에 놓기' }).last().click();
  await frames(page);
  expect((await stored(page)).items.map((a) => a.type).sort()).toEqual([
    'basin',
    'shower',
    'toilet',
  ]);
  // 3D에서도 설비 모형이 가구로 선다.
  await page.locator('[data-view="3d"]').click();
  await frames(page);
  const fixtures = await page.evaluate(() => {
    const out = [];
    window.__roomggu.app.scenes.three?.objects.traverse(
      (o) => o.userData.fixture && out.push(o.userData.fixture),
    );
    return out.sort();
  });
  if (!(await page.evaluate(() => window.__roomggu.app.view.webglError)))
    expect(fixtures).toEqual(['basin', 'shower', 'toilet']);
  expect(errors).toEqual([]);
});

test('겹친 채 저장된 공간은 "겹친다"는 말이나 배치 확인의 단추로 떼어 놓는다', async ({ page }) => {
  // 예전 버전에서 유형을 바꾸다 겹친 채 저장된 모양(v5 저장본이라 불러올 때 저절로 고치지 않는다).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.removeItem('room-ggu-thread-v1');
    const room = (type, w, d) => ({
      type,
      w,
      d,
      h: 2.4,
      wallColor: '#faf9f5',
      floorColor: '#e0d4bf',
    });
    localStorage.setItem(
      'room-ggu-v2',
      JSON.stringify({
        version: 5,
        roomId: 'living',
        roomOrder: ['bath', 'living'],
        name: '나의 거실',
        room: room('living', 5.5, 4.5),
        items: [],
        otherRooms: [
          { roomId: 'bath', name: '나의 화장실', room: room('bathroom', 1.8, 2.2), items: [] },
        ],
        scope: 'house',
        view: '2d',
        floorplan: { positions: { bath: { x: 0, z: 0 }, living: { x: 1.8, z: 0 } } },
      }),
    );
  });
  await page.goto('/?model=off');
  await page.waitForFunction(() => window.__roomggu?.app.scenes.house?.scale > 0);
  expect(await overlaps(page)).toBe(1);
  const r = await say(page, '거실로 바꿨는데 겹치잖아...');
  expect(r.text).toBe(
    '나의 화장실과 나의 거실이 겹쳐 있었어요. 나의 화장실을 겹치지 않게 옆으로 옮겼어요.',
  );
  expect(await overlaps(page)).toBe(0);
  // 되돌려 다시 겹치게 한 뒤, 배치 확인 도구의 단추로도 고친다.
  await page.locator('#undo').click();
  expect(await overlaps(page)).toBe(1);
  await expect(page.locator('.surface').last()).toContainText('다른 공간과 겹쳐요');
  await expect(page.locator('.surface').last()).toHaveAttribute(
    'data-a2ui-component',
    'RoomGguImpact',
  );
  await page.locator('[data-separate]').last().click();
  await frames(page);
  expect(await overlaps(page)).toBe(0);
  await expect(page.locator('.surface').last()).toContainText(
    '겹친 공간도, 겹치거나 벽을 넘은 가구도 없어요',
  );
});
