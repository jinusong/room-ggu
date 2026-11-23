import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES } from '../catalog.js';
import { exampleState, makeItem } from '../data.js';
import { activityTypes, purposeRequest, uses } from './purpose.js';
import { purposeDraft, planTurn } from './planner.js';
import { planFromModel } from './interpret.js';

const ctx = () => ({ state: exampleState(), target: { type: 'room' } });
test('카탈로그 전체에 비교 설명이 있고 용도 검색 결과에는 지원하는 종류만 있다', () => {
  assert.deepEqual(Object.keys(uses).sort(), Object.keys(TYPES).sort());
  for (const query of ['공부', '식사', '빨래', '독서', '옷을 걸', '미세먼지']) {
    assert.ok(activityTypes(query).every((k) => !!uses[k]));
  }
  assert.deepEqual(activityTypes('독서'), ['armchair', 'sofa']);
});

for (const [text, type] of [
  ['한 사람이 누워서 잘 가구 하나가 필요해', 'bed'],
  ['밤에 누울 데가 필요해', 'bed'],
  ['노트북 펼쳐서 공부할 가구가 필요해', 'desk'],
  ['여럿이 밥 먹을 만한 게 필요해', 'dining'],
  ['소파 말고 독서할 자리가 필요해', 'armchair'],
  ['옷을 걸 가구가 필요한데 행거는 빼고', 'wardrobe'],
  ['공부 말고 식사할 가구가 필요해', 'dining'],
  ['침대 옆에 안경 놓을 자리가 필요해', 'side'],
])
  test(text, () => {
    const c = ctx();
    c.target = { type: 'item', id: c.state.items[0].id };
    const before = structuredClone(c.state);
    assert.equal(planTurn(text, c).changes?.draft?.type, type);
    assert.deepEqual(c.state, before);
  });

test('모델이 고른 순서를 보존하고 중복·제외·근거 밖 후보를 거른다', () => {
  const c = ctx(),
    text = '옷을 걸어둘 가구가 필요해';
  c.draft = makeItem('bed');
  const before = structuredClone(c);
  const result = planFromModel(
    JSON.stringify({ first: 'wardrobe', second: 'wardrobe', third: 'bed' }),
    text,
    c,
  );
  assert.deepEqual(result.recommendation.types, ['wardrobe', 'hanger']);
  assert.equal(result.changes, undefined);
  assert.ok(result.fixes.length);
  assert.deepEqual(c, before);
  assert.throws(() =>
    planFromModel(JSON.stringify({ first: 'unknown', second: 'none', third: 'none' }), text, c),
  );
});

test('선택 시 원문 치수·색과 치수 출처를 적용하고 상충하는 치수는 먼저 되묻는다', () => {
  const p = purposeDraft('독서할 자리. 네이비, 폭 920mm 깊이 85cm', 'sofa');
  assert.equal(p.changes.draft.color, '#3f4d63');
  assert.equal(p.changes.draft.dims[0], 92);
  assert.equal(p.changes.draft.dims[2], 85);
  assert.equal(p.changes.draft.sources[0], '사용자 설정');
  for (const t of ['독서할 가구가 필요해 가로 90cm 가로 120cm', '공부할 가구가 필요해 폭 2000cm'])
    assert.equal(planTurn(t, ctx()).ask, 'constraint');
});

test('용도가 없는 요청, 편집, 공간·아바타·명시한 종류를 별도로 처리한다', () => {
  for (const t of ['가구를 추천해줘', '아무 가구나 추천해 줘', '가구 추천해 주세요']) {
    const p = planFromModel(
      JSON.stringify({ first: 'bed', second: 'sofa', third: 'armchair' }),
      t,
      ctx(),
    );
    assert.equal(p.ask, 'purpose');
    assert.equal(p.changes, undefined);
    assert.equal(p.recommendation, undefined);
  }
  for (const t of [
    '기본 책상 하나',
    '잠잘 방을 만들어줘',
    '공부할 방을 추천해줘',
    '아바타를 앉히고 싶어',
    '노트북 하나 놓아줘',
    '이 가구를 옮기고 싶어',
    '가구를 정리하고 싶어',
    '배치 저장할래',
  ])
    assert.equal(purposeRequest(t), null, t);
});

test('모델이 자유로운 표현에서 찾은 용도는 해당 활동의 가구로만 이어진다', () => {
  const text = '교정지를 쫙 펴놓을 가구가 필요해';
  const raw = {
    activity: '책상에서 공부하거나 일하기',
    first: 'desk',
    second: 'bed',
    third: 'none',
  };
  assert.deepEqual(planFromModel(JSON.stringify(raw), text, ctx()).confirmation.types, ['desk']);
  assert.equal(planTurn(text, ctx()).ask, 'purpose');
});
