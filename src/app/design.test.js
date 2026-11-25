import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES,
  designRequest,
  templateDesign,
  readDesign,
  designSchema,
  designSlots,
} from './design.js';
import { buildDesign } from './ops.js';
import { freshState, spaces, validateState, layoutWarnings, overlaps, footprint } from '../data.js';
import { floorplanWarnings, connections, roomOpenings } from '../floorplan.js';

for (const [key, theme] of Object.entries(THEMES)) {
  for (const area of [60, 80, 100, 120, 150]) {
    test(`${area}평 ${theme.name}: 집 전체 면적·공간 구성·가구·연결문·저장 왕복`, () => {
      const request = designRequest(`${area}평 집 전체를 ${theme.name} 테마로 꾸며줘`);
      assert.equal(request.theme, key);
      const old = freshState(),
        copy = structuredClone(old),
        spec = templateDesign(request);
      const out = buildDesign(old, spec),
        s = out.state,
        list = spaces(s);
      assert.deepEqual(old, copy, '초안으로 현재 배치를 바꾸지 않음');
      assert.equal(list.length, designSlots(request).length);
      assert.deepEqual(out.omitted, []);
      const actual = list.reduce((n, r) => n + r.room.w * r.room.d, 0);
      assert.ok(Math.abs(actual - request.areaM2) / request.areaM2 < 0.002, '총면적 0.2% 이내');
      assert.equal(floorplanWarnings(list, s.floorplan).size, 0);
      const links = connections(list, s.floorplan).filter((l) => !l.closed),
        seen = new Set([s.roomId]);
      for (let i = 0; i < list.length; i++)
        for (const l of links)
          if (l.ids.some((id) => seen.has(id))) l.ids.forEach((id) => seen.add(id));
      assert.equal(seen.size, list.length, '모든 공간이 문으로 연결');
      for (const r of list) {
        assert.ok(r.items.length > 0, r.name);
        assert.equal(layoutWarnings(r).all.size, 0, r.name);
        assert.equal(r.room.wallColor, theme.wall);
        assert.equal(r.room.floorColor, r.room.type === 'bathroom' ? '#dce1dc' : theme.floor);
        for (const o of roomOpenings(list, s.floorplan, r.roomId)) {
          const zone = {
            type: 'cabinet',
            id: 'door',
            angle: 0,
            x: o.x + (o.vertical ? (o.x > 0 ? -0.45 : 0.45) : 0),
            z: o.z + (!o.vertical ? (o.z > 0 ? -0.45 : 0.45) : 0),
            dims: o.vertical ? [90, 100, (o.width + 0.4) * 100] : [(o.width + 0.4) * 100, 100, 90],
          };
          assert.ok(
            r.items.filter((i) => i.type !== 'rug').every((i) => !overlaps(i, zone)),
            `${r.name} 문 앞 통로`,
          );
        }
      }
      assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))), s);
    });
  }
}

test('집 전체 명령은 단일 방·가구·집 전체 보기와 구분하고 면적 단위를 읽는다', () => {
  for (const t of ['거실 6평', '책상 가로 100cm', '집 전체 3D로 보여줘', '내 키 175cm'])
    assert.equal(designRequest(t), null, t);
  assert.equal(designRequest('330.58m² 아파트 전체를 모던으로 인테리어해줘').areaM2, 330.58);
  assert.equal(designRequest('집 전체 빈티지 말고 북유럽으로 바꿔줘').theme, 'nordic');
  assert.equal(designRequest('집 전체 재팬디로 해줘').mode, 'theme');
  assert.equal(designRequest('집 전체 인테리어해줘').mode, 'house');
  assert.equal(designSchema(designRequest('100평 집 전체 인테리어해줘')).required.length, 13);
});

test('작은 집은 샤워부스가 들어갈 자리를 확보하고 직접 요청한 공간을 유지한다', () => {
  for (const [text, skipped] of [
    ['40m² 집 전체를 재팬디로 꾸며줘', ['다용도실', '드레스룸']],
    ['14평 집 전체를 드레스룸 넣어서 재팬디로 꾸며줘', ['다용도실']],
  ]) {
    const request = designRequest(text);
    const out = buildDesign(freshState(), templateDesign(request));
    const rooms = spaces(out.state);
    const bathroom = rooms.find((r) => r.room.type === 'bathroom');
    assert.ok(bathroom.items.some((i) => i.type === 'shower'));
    assert.ok(rooms.every((r) => r.items.length > 0 && layoutWarnings(r).all.size === 0));
    const area = rooms.reduce((total, { room }) => total + room.w * room.d, 0);
    assert.ok(Math.abs(area - request.areaM2) / request.areaM2 < 0.002);
    assert.deepEqual([...out.skipped].sort(), skipped);
    assert.equal(floorplanWarnings(rooms, out.state.floorplan).size, 0);
    if (skipped.length === 1) assert.ok(rooms.some((r) => r.name === '드레스룸'));
  }
});

test('명시한 침실·욕실 수, 필수 공간과 가구 누락·잘못된 출력은 적용하지 않는다', () => {
  const request = designRequest('100평 집 전체를 꾸며줘'),
    spec = templateDesign(request);
  for (const mut of [
    (s) => {
      s.theme = '__proto__';
    },
    (s) => {
      s.rooms = [];
    },
    (s) => {
      s.rooms[0].type = 'script';
    },
    (s) => {
      s.rooms[0].name = '<script>';
    },
    (s) => {
      s.rooms[0].weight = NaN;
    },
    (s) => {
      s.rooms[0].items = ['teleport'];
    },
    (s) => {
      s.rooms = s.rooms.filter((r) => r.type !== 'bathroom');
    },
    (s) => {
      s.rooms = s.rooms.filter((r) => !/다용도/.test(r.name));
    },
    (s) => {
      s.rooms.find((r) => r.type === 'office').items = ['desk'];
    },
  ]) {
    const bad = structuredClone(spec);
    mut(bad);
    assert.throws(() => readDesign(bad, request));
  }
  assert.throws(() => readDesign(spec, { ...request, text: '침실 3개 욕실 2개' }), /침실 3개/);
  for (const n of [null, 0, 20, 661, Infinity, NaN])
    assert.throws(() => readDesign(spec, { ...request, areaM2: n }));
});

for (const [key, theme] of Object.entries(THEMES))
  test(`${theme.name} 테마 변경: 치수·직접 설정 출처·위치·문·가구 ID 보존`, () => {
    const s = buildDesign(
      freshState(),
      templateDesign(designRequest('100평 집 전체를 내추럴로 꾸며줘')),
    ).state;
    s.room.sources.w = '사용자 설정';
    s.items[0].sources[0] = '사용자 설정';
    const out = buildDesign(s, { mode: 'theme', theme: key }).state;
    assert.deepEqual(out.floorplan, s.floorplan);
    assert.deepEqual(
      spaces(out).map((r) => [
        r.roomId,
        r.name,
        r.room.w,
        r.room.d,
        r.room.sources,
        r.items.map((i) => [i.id, i.dims, i.sources, i.x, i.z, i.angle]),
      ]),
      spaces(s).map((r) => [
        r.roomId,
        r.name,
        r.room.w,
        r.room.d,
        r.room.sources,
        r.items.map((i) => [i.id, i.dims, i.sources, i.x, i.z, i.angle]),
      ]),
    );
  });

test('실제 모델용 계약은 12개 공간 키를 필수로 두고 빠진 키·잘못된 구성을 거절한다', () => {
  const request = designRequest('100평 집 전체를 모던으로 꾸며줘');
  const raw = Object.fromEntries([
    ['theme', 'modern'],
    ...designSlots(request).map((s) => [s.key, 'standard']),
  ]);
  assert.equal(readDesign(raw, request).rooms.length, 12);
  const missing = { ...raw };
  delete missing.room12;
  assert.throws(() => readDesign(missing, request));
  assert.throws(() => readDesign({ ...raw, room2: '<script>' }, request));
});

test('실제 Qwen3의 빈 think 블록은 읽되 닫히지 않은 생각이나 그 안의 JSON은 적용하지 않는다', () => {
  const request = designRequest('100평 집 전체를 모던으로 꾸며줘'),
    raw = Object.fromEntries([
      ['theme', 'modern'],
      ...designSlots(request).map((s) => [s.key, 'standard']),
    ]);
  assert.equal(
    readDesign(`<think>\n\n</think>\n\n${JSON.stringify(raw)}`, request).rooms.length,
    12,
  );
  assert.throws(() => readDesign(`<think>${JSON.stringify(raw)}`, request));
  assert.throws(() => readDesign(`<think>${JSON.stringify(raw)}</think>`, request));
});

test('침실·욕실 하나나 서재 둘처럼 명시한 구성을 기본 개수보다 우선하고 큰 개수는 즉시 거절한다', () => {
  for (const [text, type, count] of [
    ['100평 집 전체 침실 1개 욕실 1개로 꾸며줘', 'bedroom', 1],
    ['100평 집 전체 서재 두 개로 꾸며줘', 'office', 2],
  ]) {
    const request = designRequest(text),
      spec = templateDesign(request);
    assert.equal(spec.rooms.filter((r) => r.type === type).length, count);
    assert.ok(spec.rooms.length <= 12);
  }
  assert.throws(
    () => designSlots(designRequest('100평 집 전체 침실 999999999999개 인테리어해줘')),
    /최대 12개/,
  );
});
