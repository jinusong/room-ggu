import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, exampleState, makeItem } from '../data.js';
import { planFromModel, readModel } from './interpret.js';
import { photoCandidates, PHOTO_CONFIDENT } from './photo.js';

const room = { type: 'room' };
const model = (v) =>
  JSON.stringify({
    intent: 'furniture',
    action: 'none',
    furniture: 'none',
    room_type: 'none',
    space: 'none',
    seats: null,
    size: 'unknown',
    depth: 'unknown',
    height: 'unknown',
    color: 'none',
    wall: 'none',
    floor: 'none',
    ui: 'none',
    reply: '',
    ...v,
  });

test('모델이 가구와 크기 느낌을 정하면 그대로 초안을 만든다', () => {
  const s = freshState();
  const p = planFromModel(
    model({
      furniture: 'sofa',
      seats: 2,
      height: 'low',
      ui: 'furniture_sizes',
      reply: '둘이 쓰기 좋은 낮은 소파예요. 팔걸이가 있나요?',
    }),
    '두 명이 앉는 낮은 소파',
    { state: s, target: room },
  );
  assert.equal(p.decidedBy, 'model');
  assert.deepEqual(p.fixes, []);
  assert.equal(p.changes.draft.type, 'sofa');
  assert.equal(p.changes.draft.dims[0], 170);
  assert.equal(p.changes.draft.dims[1], 65);
  assert.match(p.changes.draft.sources[1], /AI 단서/);
  assert.equal(p.surfaces[0].kind, 'furniture-size');
  assert.equal(p.reply, '둘이 쓰기 좋은 낮은 소파예요. 팔걸이가 있나요?');
});

test('문장에 이름이 없으면 모델이 고른 가구를 쓴다', () => {
  const p = planFromModel(
    model({
      furniture: 'armchair',
      reply: '혼자 기대기 좋은 라운지체어로 잡았어요. 색은 어떤가요?',
    }),
    '책 읽을 때 푹 기대 앉을 거 하나',
    { state: freshState(), target: room },
  );
  assert.equal(p.changes.draft.type, 'armchair');
  assert.deepEqual(p.fixes, []);
});

test('문장에 적힌 가구 이름·숫자와 어긋나면 문장을 따르고 바로잡은 내용을 남긴다', () => {
  const p = planFromModel(
    model({ furniture: 'dining', size: 'large', reply: '큰 식탁으로 잡았어요.' }),
    '책상 가로 120cm',
    { state: freshState(), target: room },
  );
  assert.equal(p.changes.draft.type, 'desk');
  assert.equal(p.changes.draft.dims[0], 120);
  assert.equal(p.changes.draft.sources[0], '사용자 설정');
  assert.ok(p.fixes.some((f) => f.includes('책상')));
  assert.doesNotMatch(p.reply, /식탁/);
});

test('말하지 않은 속성은 바꾸지 않는다: 벽만 말하면 바닥·공간 유형은 그대로', () => {
  const s = freshState();
  const p = planFromModel(
    model({
      intent: 'room',
      room_type: 'kitchen',
      wall: '세이지',
      floor: '월넛',
      ui: 'room_type',
      reply: '벽을 세이지로 바꿨어요.',
    }),
    '벽은 세이지로 바꿔줘',
    { state: s, target: room },
  );
  assert.equal(p.changes.room.type, s.room.type);
  assert.equal(p.changes.room.wallColor, '#c0cbbb');
  assert.equal(p.changes.room.floorColor, s.room.floorColor);
  assert.equal(p.surfaces[0].kind, 'finishes');
  assert.ok(p.fixes.some((f) => f.includes('바닥')));
  assert.ok(p.fixes.some((f) => f.includes('공간 유형')));
});

test('용도를 말하면 모델이 공간 유형과 크기 느낌을 정한다', () => {
  const s = freshState();
  const p = planFromModel(
    model({
      intent: 'room',
      room_type: 'office',
      size: 'compact',
      ui: 'room_type',
      reply: '작은 서재로 잡았어요. 책상이 중심인가요?',
    }),
    '책 읽는 아담한 방으로 꾸며줘',
    { state: s, target: room },
  );
  assert.equal(p.changes.room.type, 'office');
  assert.equal(p.surfaces[0].kind, 'room-type');
});

test('문장에 없는 동작은 실행하지 않고, 있으면 선택한 가구에 실행한다', () => {
  const s = exampleState();
  const target = { type: 'item', id: s.items[0].id };
  const noDelete = planFromModel(
    model({ intent: 'action', action: 'delete', color: '네이비', ui: 'furniture_color' }),
    '색을 네이비로 바꿔줘',
    { state: s, target },
  );
  assert.equal(noDelete.action, undefined);
  assert.ok(noDelete.fixes.some((f) => f.includes('삭제')));
  assert.equal(noDelete.changes.item.next.color, '#3f4d63');
  const del = planFromModel(model({ intent: 'action', action: 'delete' }), '이거 빼줘', {
    state: s,
    target,
  });
  assert.equal(del.action, 'delete');
});

test('직접 정한 치수는 모델 크기 단서가 바꾸지 않는다', () => {
  const s = exampleState();
  const sofa = { ...makeItem('sofa'), id: 'x1', x: 0, z: 0 };
  sofa.dims[0] = 199;
  sofa.sources[0] = '사용자 설정';
  s.items.push(sofa);
  const p = planFromModel(
    model({ furniture: 'sofa', size: 'large', seats: 4 }),
    '더 크고 넉넉하게',
    {
      state: s,
      target: { type: 'item', id: 'x1' },
    },
  );
  assert.equal(p.changes.item.next.dims[0], 199);
});

test('문장에 명령이 분명하면 모델 선택 대신 명령을 따르고, 바꿀 내용을 놓치면 규칙으로 넘긴다', () => {
  const ctx = { state: freshState(), target: room };
  const undo = planFromModel(model({ intent: 'chat', reply: '네' }), '되돌려줘', ctx);
  assert.equal(undo.action, 'undo');
  assert.ok(undo.fixes.some((f) => f.includes('되돌리기')));
  const files = planFromModel(
    model({ intent: 'action', action: 'place' }),
    '배치를 파일로 저장하고 싶어',
    ctx,
  );
  assert.equal(files.action, undefined);
  assert.equal(files.surfaces[0].kind, 'files');
  const missed = planFromModel(model({ intent: 'chat', reply: '좋아요' }), '가로 5m 세로 4m', ctx);
  assert.equal(missed.fallback, 'model-chat');
  const chat = planFromModel(
    model({ intent: 'chat', reply: '안녕하세요. 어떤 방을 꾸밀까요?' }),
    '안녕',
    ctx,
  );
  assert.equal(chat.intent, 'chat');
  assert.equal(chat.reply, '안녕하세요. 어떤 방을 꾸밀까요?');
});

test('형식이 틀린 모델 답은 예외로 넘기고, 허용 목록 밖 값은 버린다', () => {
  assert.throws(() => readModel('모르겠어요'));
  const v = readModel(model({ furniture: 'piano', ui: 'html', color: '보라' }));
  assert.equal(v.furniture, null);
  assert.equal(v.ui, null);
  assert.equal(v.color, null);
});

test('사진 점수는 확률로 바꿔 상위 3개만 남긴다', () => {
  const c = photoCandidates([
    { type: 'sofa', score: 0.2 },
    { type: 'armchair', score: 0.01 },
    { type: 'bed', score: 0.0001 },
    { type: 'piano', score: 0.9 },
    { type: 'rug', score: 0.00001 },
  ]);
  assert.equal(c.length, 3);
  assert.equal(c[0].type, 'sofa');
  assert.ok(c[0].p > PHOTO_CONFIDENT);
  assert.ok(Math.abs(c.reduce((a, x) => a + x.p, 0) - 1) < 0.01);
  assert.deepEqual(photoCandidates(null), []);
});
