import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, exampleState, makeItem } from '../data.js';
import { planFromModel, readModel } from './interpret.js';
import { setRoom, roomWithType } from './ops.js';
import { planTurn } from './planner.js';
import { makeRoom } from '../catalog.js';
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

test('기대 앉아 읽을 자리에는 모델이 고른 순서로 선택지를 제안한다', () => {
  const p = planFromModel(
    JSON.stringify({ first: 'armchair', second: 'sofa', third: 'none' }),
    '책 읽을 때 푹 기대 앉을 거 하나',
    { state: freshState(), target: room },
  );
  assert.deepEqual(p.recommendation.types, ['armchair', 'sofa']);
  assert.equal(p.changes, undefined);
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
  const v = readModel(model({ furniture: 'trampoline', ui: 'html', color: '보라' }));
  assert.equal(v.furniture, null);
  assert.equal(v.ui, null);
  assert.equal(v.color, null);
});

test('새 가구의 놓기 요청은 모델이 place라고 골라도 초안을 먼저 만들며 치수 축을 물건 이름으로 자르지 않는다', () => {
  const ctx = { state: freshState(), target: { type: 'room' } };
  const desk = planFromModel(
    model({ intent: 'action', action: 'place', furniture: 'desk' }),
    '책상 가로 140cm 깊이 70cm 하나 놓아줘',
    ctx,
  );
  assert.equal(desk.changes.draft.type, 'desk');
  assert.equal(desk.changes.draft.dims[0], 140);
  assert.equal(desk.changes.draft.dims[2], 70);
  const vanity = planFromModel(
    model({ intent: 'furniture', action: 'place', furniture: 'vanity' }),
    '화장대 하나 놓아줘',
    ctx,
  );
  assert.equal(vanity.changes.draft.type, 'vanity');
  assert.equal(vanity.action, undefined);
});

test('사진 점수는 확률로 바꿔 상위 3개만 남긴다', () => {
  const c = photoCandidates([
    { type: 'sofa', score: 0.2 },
    { type: 'armchair', score: 0.01 },
    { type: 'bed', score: 0.0001 },
    { type: 'rocket', score: 0.9 },
    { type: 'rug', score: 0.00001 },
  ]);
  assert.equal(c.length, 3);
  assert.equal(c[0].type, 'sofa');
  assert.ok(c[0].p > PHOTO_CONFIDENT);
  assert.ok(Math.abs(c.reduce((a, x) => a + x.p, 0) - 1) < 0.01);
  assert.deepEqual(photoCandidates(null), []);
});

test('가구 초안을 가리키는 중에 모델이 방 이야기로 잘못 읽어도 문장에 방 말이 없으면 가구에 반영한다', () => {
  const s = freshState();
  const draft = makeItem('sofa');
  const ctx = { state: s, draft, target: { type: 'draft' } };
  // 작은 모델(Qwen3 0.6B)이 실제로 낸 답: 방 이야기로 분류하고 아무 값도 고르지 않았다.
  const color = planFromModel(model({ intent: 'room', ui: 'room_type' }), '네이비로 바꿔줘', ctx);
  assert.equal(color.intent, 'furniture');
  assert.equal(color.changes.draft.color, '#3f4d63');
  assert.match(color.fixes.join(), /지금 대상인 소파 이야기로 처리/);
  const depth = planFromModel(
    model({ intent: 'room', depth: 'deep' }),
    '앉는 부분이 깊었으면 좋겠어',
    ctx,
  );
  assert.equal(depth.intent, 'furniture');
  assert.ok(depth.changes.draft.dims[2] > draft.dims[2]);
  // 방을 가리키는 말이 있거나 방에서 실제로 바뀐 것이 있으면 방 이야기 그대로다.
  const wall = planFromModel(
    model({ intent: 'room', wall: '샌드' }),
    '벽은 따뜻한 느낌이면 좋겠어',
    ctx,
  );
  assert.equal(wall.intent, 'room');
  assert.ok(wall.changes.room);
  const size = planFromModel(model({ intent: 'room' }), '방이 좀 답답해 보여', ctx);
  assert.equal(size.intent, 'room');
  // 대상이 방이면 손대지 않는다.
  const none = planFromModel(model({ intent: 'room' }), '네이비로 바꿔줘', {
    state: s,
    target: room,
  });
  assert.equal(none.intent, 'room');
});

test('모델이 책상을 골라도 목록에 없는 물건이면 가구를 만들지 않는다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const p = planFromModel(
    model({ furniture: 'desk', reply: '책상을 하나 더 놓았어요.' }),
    '책상에 컴퓨터 추가해줘',
    { state: s, target: { type: 'item', id: desk.id } },
  );
  assert.equal(p.decidedBy, 'model');
  assert.equal(p.changes, undefined);
  assert.match(p.reply, /컴퓨터는 아직 가구 목록에 없어서/);
  assert.match(p.fixes[0], /목록에 없는 물건\(컴퓨터\)/);
  const del = planFromModel(model({ intent: 'action', action: 'delete' }), '모니터 빼줘', {
    state: s,
    target: { type: 'item', id: desk.id },
  });
  assert.equal(del.action, undefined);
});

test('모델이 삭제를 골라도 문장에 적은 가구를 뺀다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const bed = s.items.find((a) => a.type === 'bed');
  const p = planFromModel(
    model({ intent: 'action', action: 'delete', furniture: 'bed' }),
    '침대 빼줘',
    { state: s, target: { type: 'item', id: desk.id } },
  );
  assert.equal(p.action, 'delete');
  assert.equal(p.arg.id, bed.id);
});

// ---------- 실제 대화에서 틀렸던 문장들(Gemma 4 E2B가 맞게 골랐는데 앱이 뒤집던 경우 포함) ----------
const bathroomHome = () => {
  const s = freshState();
  setRoom(s, roomWithType(s.room, 'bathroom'));
  s.name = '나의 화장실';
  return s;
};
test('모델이 고른 새 공간 유형을 자리로 쓴 이름("화장실 옆에") 때문에 뒤집지 않는다', () => {
  const s = bathroomHome();
  const p = planFromModel(
    model({
      intent: 'action',
      action: 'new_space',
      room_type: 'living',
      reply: '화장실 옆에 거실 공간을 추가했어요. 거실의 크기와 가구를 정해볼까요?',
    }),
    '화장실 옆에 방하나 추가하자. 거기는 거실임',
    { state: s, target: room },
  );
  assert.deepEqual(p.fixes, []);
  assert.equal(p.changes.addSpace, 'living');
  assert.equal(p.changes.near.roomId, s.roomId);
  // 새 공간의 답은 붙은 자리를 넣어 앱이 쓴다. 모델 답은 쓰지 않는다.
  assert.notEqual(p.replyBy, 'model');
  // 모델이 자리로 쓴 이름을 유형으로 골랐으면 문장의 유형으로 바로잡고, 모델이 쓴 답은 쓰지 않는다.
  const q = planFromModel(
    model({
      intent: 'action',
      action: 'new_space',
      room_type: 'bathroom',
      reply: '화장실을 추가했어요. 크기를 정해볼까요?',
    }),
    '화장실 옆에 방하나 추가하자. 거기는 거실임',
    { state: s, target: room },
  );
  assert.equal(q.changes.addSpace, 'living');
  assert.equal(q.fixes.length, 1);
  assert.notEqual(q.replyBy, 'model');
  assert.doesNotMatch(q.reply, /화장실을 추가/);
  // 유형을 말하지 않았는데 모델이 자리로 쓴 이름을 고르면 만들지 않고 되묻는다.
  const r = planFromModel(
    model({
      intent: 'action',
      action: 'new_space',
      room_type: 'bathroom',
      reply: '화장실을 추가했어요.',
    }),
    '화장실 옆에 방 하나 더 만들어줘',
    { state: s, target: room },
  );
  assert.equal(r.changes.addSpace, undefined);
  assert.match(r.reply, /어떤 공간을 추가할까요/);
});
test('따지는 문장에서 아니라고 한 유형을 지키지 않고 바라는 유형으로 바꾼다', () => {
  const s = bathroomHome();
  const p = planFromModel(
    model({ intent: 'room', room_type: 'living', ui: 'room_type', reply: '거실로 바꿨어요.' }),
    '아니 거실이라니까 왜 자꾸 화장실로 고정하냐고!!!!',
    { state: s, target: room },
  );
  assert.equal(p.changes.room.type, 'living');
  assert.deepEqual(p.fixes, []);
  // 모델이 아니라고 한 유형을 골라도 따르지 않는다.
  const q = planFromModel(
    model({ intent: 'room', room_type: 'bathroom', reply: '화장실로 유지했어요.' }),
    '아니 거실이라니까 왜 자꾸 화장실로 고정하냐고!!!!',
    { state: s, target: room },
  );
  assert.equal(q.changes.room.type, 'living');
  // 바라는 유형을 말하지 않았으면 앞 대화에서 찾는다.
  const r = planFromModel(
    model({
      intent: 'room',
      room_type: 'bathroom',
      ui: 'room_type',
      reply: '화장실 크기를 알려 주세요.',
    }),
    '왜 화장실로 생성하는거야',
    { state: s, target: room, said: ['화장실 옆에 방하나 추가하자. 거기는 거실임'] },
  );
  assert.equal(r.changes.room.type, 'living');
  assert.equal(r.fixes.length, 1);
  assert.match(r.reply, /잘못 읽었어요/);
});
test('모델이 가구 하나만 골라도 문장의 방 이야기와 나머지 가구를 함께 처리한다', () => {
  const s = bathroomHome();
  const p = planFromModel(
    model({ furniture: 'dining', ui: 'furniture_sizes', reply: '식탁 초안을 잡았어요.' }),
    '거실이라고 그리고 거기에 소파랑 밥먹을 수 있는 식탁이 있었으면 좋겠어. 거실 평수는 대략 6평정도야',
    { state: s, target: room },
  );
  assert.equal(p.intent, 'compound');
  assert.equal(p.changes.room.type, 'living');
  assert.ok(Math.abs(p.changes.room.w * p.changes.room.d - 6 * 3.3058) < 0.1);
  assert.deepEqual(
    [p.changes.draft.type, ...p.changes.queue.map((a) => a.type)],
    ['sofa', 'dining'],
  );
  assert.ok(p.fixes.some((f) => /나눠 처리/.test(f)));
  assert.match(p.reply, /거실로 바꾸고 6평\(약 19\.8m²\)에 맞춰.*소파와 식탁 초안/);
  // 모델이 방 이야기로 읽었어도 말한 면적을 답에서 받아 준다.
  const asRoom = planFromModel(
    model({ intent: 'room', room_type: 'living', ui: 'room_size', reply: '거실 크기를 맞췄어요.' }),
    '거실이라고 그리고 거기에 소파랑 밥먹을 수 있는 식탁이 있었으면 좋겠어. 거실 평수는 대략 6평정도야',
    { state: s, target: room },
  );
  assert.match(asRoom.reply, /6평\(약 19\.8m²\)에 맞춰/);
  assert.equal(asRoom.changes.queue[0].type, 'dining');
  // 모델의 단서(두 명·낮게)는 모델이 고른 가구에만 쓴다.
  const q = planFromModel(
    model({ furniture: 'sofa', seats: 2, height: 'low', reply: '소파를 잡았어요.' }),
    '두 명이 앉는 낮은 소파랑 책상',
    { state: freshState(), target: room },
  );
  assert.equal(q.changes.draft.type, 'sofa');
  assert.equal(q.changes.draft.dims[0], 170);
  assert.match(q.changes.draft.sources[1], /AI 단서/);
  assert.deepEqual(q.changes.queue[0].dims, makeItem('desk').dims);
});
test('하지 않은 일을 했다고 하는 모델 답은 보여 주지 않는다', () => {
  // 문장에 없는 동작을 막았는데 모델 답은 "비웠습니다"라고 한다.
  const p = planFromModel(
    model({ intent: 'action', action: 'delete', reply: '모든 가구를 비웠습니다.' }),
    '오늘 날씨 좋다',
    { state: exampleState(), target: room },
  );
  assert.equal(p.action, undefined);
  assert.doesNotMatch(p.reply, /비웠/);
  // 바로잡은 것이 없어도, 바뀐 것 없이 "했어요"라고 하면 쓰지 않는다.
  const q = planFromModel(
    model({ intent: 'chat', reply: '소파를 방에 놓았어요.' }),
    '음 뭐가 좋을까',
    { state: freshState(), target: room },
  );
  assert.doesNotMatch(q.reply, /놓았어요/);
  // 실제로 바꾼 턴의 모델 답과, 완료를 말하지 않는 답은 그대로 쓴다.
  const r = planFromModel(
    model({ intent: 'chat', reply: '안녕하세요! 어떤 방을 꾸미고 싶으세요?' }),
    '안녕',
    { state: freshState(), target: room },
  );
  assert.equal(r.reply, '안녕하세요! 어떤 방을 꾸미고 싶으세요?');
  assert.equal(r.replyBy, 'model');
  // "방 초기화"는 가구 비우기로 읽는다.
  const c = planFromModel(
    model({ intent: 'action', action: 'clear', reply: '모든 가구를 비웠습니다.' }),
    '방 초기화할래',
    { state: exampleState(), target: room },
  );
  assert.equal(c.action, 'clear');
});
test('겹친다는 말과 방 돌리기는 모델이 다른 것을 골라도 명령으로 처리한다', () => {
  const s = bathroomHome();
  const p = planFromModel(
    model({ intent: 'action', action: 'relocate', reply: '겹친 가구를 정리했어요.' }),
    '거실로 바꿨는데 겹치잖아...',
    { state: s, target: room },
  );
  assert.equal(p.action, 'relocate');
  const q = planFromModel(
    model({ intent: 'action', action: 'rotate', reply: '돌렸어요.' }),
    '이 방 통째로 90도 돌려줘',
    { state: s, target: room },
  );
  assert.equal(q.action, 'rotate-space');
  assert.match(q.fixes[0], /방 돌리기/);
});
test('면적만 말한 문장에는 말한 면적을 받아 주는 앱의 답을 쓰고 경고를 붙이지 않는다', () => {
  const s = freshState();
  setRoom(s, roomWithType(s.room, 'living'));
  const p = planFromModel(
    model({ intent: 'room', ui: 'room_size', reply: '거실 크기를 맞췄어요. 가구도 놓아 볼까요?' }),
    '한 6평정도 됨',
    { state: s, target: room },
  );
  assert.deepEqual(p.fixes, []);
  assert.deepEqual([p.changes.room.w, p.changes.room.d], [4.9, 4.05]);
  assert.match(p.reply, /^6평\(약 19\.8m²\)에 맞춰 거실을 가로 4\.9m, 세로 4\.05m로 잡았어요/);
  assert.equal(p.note, undefined);
  assert.notEqual(p.replyBy, 'model');
  assert.deepEqual(
    p.suggestions.slice(0, 2).map((c) => c.text),
    ['6평, 가로 5m', '6평 정사각형'],
  );
});
test('실제 Gemma 4 E2B가 틀린 두 문장: 엉뚱한 공간으로 옮기지 않고, 유형 없는 새 공간은 되묻는다', () => {
  const s = freshState();
  setRoom(s, roomWithType(s.room, 'living'));
  s.name = '나의 거실';
  s.otherRooms.push({ roomId: 'bath', name: '나의 화장실', room: makeRoom('bathroom'), items: [] });
  s.roomOrder.push('bath');
  // 모델이 "바꿔"를 보고 공간 이동을 골랐다. 문장에 화장실은 없다.
  const p = planFromModel(
    model({
      intent: 'action',
      action: 'switch_space',
      space: '나의 화장실',
      room_type: 'bedroom',
      reply: '옮겼어요.',
    }),
    '거실 말고 침실로 바꿔줘',
    { state: s, target: room },
  );
  assert.notEqual(p.action, 'switch');
  assert.equal(p.changes.room.type, 'bedroom');
  // 그 공간의 유형을 말하며 옮기자고 하면 옮긴다.
  const go = planFromModel(
    model({ intent: 'action', action: 'switch_space', space: '나의 화장실', reply: '옮겼어요.' }),
    '화장실 보여줘',
    { state: s, target: room },
  );
  assert.equal(go.action, 'switch');
  // 초안을 띄워 둔 중에 "방 하나 더 만들어줘": 초안 도구가 아니라 어떤 공간인지 묻는다.
  const draft = makeItem('desk');
  const ask = planFromModel(
    model({
      intent: 'action',
      action: 'new_space',
      reply: '새로운 공간을 만들게요. 방의 크기를 정해주세요.',
    }),
    '방 하나 더 만들어줘',
    { state: s, target: { type: 'draft' }, draft },
  );
  assert.deepEqual(ask.changes, {});
  assert.match(ask.reply, /어떤 공간을 추가할까요/);
  assert.deepEqual(ask.surfaces, []);
  // 모델이 용도에서 유형을 읽어 냈으면 따른다.
  const sleep = planFromModel(
    model({
      intent: 'action',
      action: 'new_space',
      room_type: 'bedroom',
      reply: '침실을 만들었어요.',
    }),
    '잠잘 방 하나 추가해줘',
    { state: s, target: room },
  );
  assert.equal(sleep.changes.addSpace, 'bedroom');
  // 규칙 경로도 같다.
  const ruleAsk = planTurn('방 하나 더 만들어줘', { state: s, target: { type: 'draft' }, draft });
  assert.equal(ruleAsk.ask, 'space-type');
  assert.equal(
    planTurn('의자 하나 더 추가해줘', { state: s, target: room }).changes.draft.type,
    'chair',
  );
});
test('모델 답을 쓸 수 없을 때도 색만 바꾼 턴은 치수가 아니라 바뀐 색을 말한다', () => {
  const s = freshState();
  const draft = makeItem('sofa');
  // 모델이 문장에 없는 회전을 골라 바로잡은 턴(실제 Gemma 4 E2B의 "네이비로 바꿔줘").
  const p = planFromModel(
    model({
      intent: 'action',
      action: 'rotate',
      furniture: 'sofa',
      color: '네이비',
      reply: '돌렸어요.',
    }),
    '네이비로 바꿔줘',
    { state: s, target: { type: 'draft' }, draft },
  );
  assert.equal(p.changes.draft.color, '#3f4d63');
  assert.equal(p.reply, '나의 소파 색을 네이비로 바꿨어요.');
  assert.equal(p.surfaces[0].kind, 'furniture-color');
});
test('가리키는 것 없는 불만은 떠 있는 초안 이야기로 받지 않고 되묻는다', () => {
  const s = freshState();
  const draft = makeItem('desk');
  const ctx = { state: s, target: { type: 'draft' }, draft };
  // 실제 Gemma 3 1B는 놓기를 골랐다.
  const p = planFromModel(
    model({ intent: 'action', action: 'place', furniture: 'desk', reply: '책상을 놓았어요.' }),
    '아니 그게 아니라',
    ctx,
  );
  assert.equal(p.action, undefined);
  assert.equal(p.changes.draft, undefined);
  assert.match(p.reply, /어디가 다르게 됐는지/);
  // 모델이 되묻는 답을 썼으면 그 답을 쓴다.
  const q = planFromModel(
    model({ intent: 'chat', reply: '무엇을 말씀하고 싶으신가요?' }),
    '아니 그게 아니라',
    ctx,
  );
  assert.equal(q.reply, '무엇을 말씀하고 싶으신가요?');
});

test('실제 Qwen의 가구 높이 오분류: 방 높이 검증이 실패해도 고른 침대에 60cm를 반영한다', () => {
  const s = freshState(),
    bed = makeItem('bed');
  bed.dims[0] = 180;
  bed.sources[0] = '사용자 설정 · 대화';
  s.items = [bed];
  const p = planFromModel(model({ intent: 'room', ui: 'finishes' }), '높이는 60cm로 바꿔줘', {
    state: s,
    target: { type: 'item', id: bed.id },
    draft: null,
    said: [],
  });
  assert.equal(p.decidedBy, 'model');
  assert.equal(p.fallback, undefined);
  assert.equal(p.changes.item.id, bed.id);
  assert.deepEqual(p.changes.item.next.dims, [180, 60, 200]);
  assert.equal(s.room.h, 2.4);
  assert.ok(p.fixes.length);
});

test('모델이 공간 도구를 골라도 문장에 있는 치수 편집을 처리한다', () => {
  const state = exampleState();
  const p = planFromModel(
    model({ intent: 'room', action: 'spaces', furniture: 'bed' }),
    '침대 깊이 2050mm로',
    { state, target: room },
  );
  assert.equal(p.changes.item.next.dims[2], 205);
  assert.equal(p.changes.room, undefined);
  assert.ok(p.fixes.length);
});

test('선택한 가구의 치수를 방으로 오해한 결과를 고친다', () => {
  const state = exampleState();
  const bed = state.items.find((i) => i.type === 'bed');
  const p = planFromModel(model({ intent: 'room', furniture: 'sofa' }), '너비 162cm로 바꿔줘', {
    state,
    target: { type: 'item', id: bed.id },
  });
  assert.equal(p.changes.item.id, bed.id);
  assert.equal(p.changes.item.next.dims[0], 162);
  assert.equal(p.changes.room, undefined);
});

test('방 이름이 명확하면 모델 JSON에서 이름을 빠뜨려도 지정한 방을 연다', () => {
  const state = exampleState();
  state.otherRooms = [{ roomId: 'small', name: '작은방', room: makeRoom('bedroom'), items: [] }];
  const p = planFromModel(model({ intent: 'room', action: 'switch_space' }), '작은 방으로 가자', {
    state,
    target: room,
  });
  assert.equal(p.action, 'switch');
  assert.deepEqual(p.arg, { id: 'small' });
  assert.ok(p.fixes.includes('문장에 나온 방으로 이동'));
});

test('치수를 적용할 가구를 위치 참조와 구별한다', () => {
  const text = '침대 옆에는 폭 40cm 협탁을 둘래';
  const ctx = { state: freshState(), target: room };
  for (const p of [planFromModel(model({ furniture: 'bed' }), text, ctx), planTurn(text, ctx)]) {
    assert.equal(p.changes.draft.type, 'side');
    assert.equal(p.changes.draft.dims[0], 40);
  }
});

test('가구 용도를 설명하는 동사가 추가 요청을 가로채지 않는다', () => {
  const ctx = { state: freshState(), target: room };
  const p = planFromModel(model({ furniture: 'desk' }), '컴퓨터 놓을 책상, 깊이는 68cm면 돼', ctx);
  assert.equal(p.changes.draft.type, 'desk');
  assert.equal(p.changes.draft.dims[2], 68);
});

test('띄어 쓴 여러 단어의 가구 이름도 목록의 가구로 처리한다', () => {
  const ctx = { state: freshState(), target: room };
  const t = '소파 바로 옆에 높이 1.44m 캣 타워 하나 두고 싶어';
  for (const p of [planFromModel(model({ furniture: 'cat_tower' }), t, ctx), planTurn(t, ctx)]) {
    assert.equal(p.changes.draft.type, 'cat_tower');
    assert.equal(p.changes.draft.dims[1], 144);
  }
});
