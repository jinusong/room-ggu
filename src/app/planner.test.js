import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleState, freshState, makeItem, spaces } from '../data.js';
import { planTurn, resolveScope, parseFurnitureColor, splitRequest, objectsOf } from './planner.js';
import { setRoom, roomWithType, addSpace, switchSpace } from './ops.js';
import { roomMentions } from '../room-consult.js';
import { usableReply } from './model-turn.js';

const room = { type: 'room' };
test('방 설명은 방 크기 도구와 변경 계획을 만든다', () => {
  const s = freshState();
  const p = planTurn('거실 가로 5m 세로 4m 천장 2.6m로 바꿔줘', { state: s, target: room });
  assert.equal(p.intent, 'room');
  assert.equal(p.changes.room.type, 'living');
  assert.deepEqual([p.changes.room.w, p.changes.room.d, p.changes.room.h], [5, 4, 2.6]);
  assert.equal(p.surfaces[0].kind, 'room-size');
  assert.equal(s.room.w, 4, '계획 단계에서는 상태를 바꾸지 않는다');
});
test('마감 요청은 비교 도구를, 공간 추가는 새 공간 계획을 만든다', () => {
  const s = freshState();
  const finish = planTurn('벽은 세이지, 바닥은 월넛', { state: s, target: room });
  assert.equal(finish.surfaces[0].kind, 'finishes');
  assert.equal(finish.changes.room.wallColor, '#c0cbbb');
  const add = planTurn('아담한 서재 하나 추가해줘', { state: s, target: room });
  assert.equal(add.changes.addSpace, 'office');
});
test('방을 줄여 가구가 벽을 넘으면 배치 확인 도구를 함께 연다', () => {
  const s = exampleState();
  const p = planTurn('원룸 가로 2m 세로 2m', { state: s, target: room });
  assert.ok(p.surfaces.some((x) => x.kind === 'impact'));
});
test('가구 설명은 초안과 규격 비교를 만들고 선택한 가구의 종류를 바꾸지 않는다', () => {
  const s = exampleState();
  const p = planTurn('두 명이 앉는 소파야', { state: s, target: room });
  assert.equal(p.changes.draft.type, 'sofa');
  assert.equal(p.surfaces[0].kind, 'furniture-size');
  assert.equal(p.suggestions[0].action, 'place');
  const bed = s.items.find((a) => a.type === 'bed');
  const desk = planTurn('책상도 하나 놓고 싶어', {
    state: s,
    target: { type: 'item', id: bed.id },
  });
  assert.equal(desk.changes.draft.type, 'desk');
  assert.equal(desk.changes.item, undefined);
});
test('가구를 선택한 상태의 치수·색 요청은 그 가구에 적용한다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const t = { type: 'item', id: desk.id };
  assert.equal(resolveScope('가로 2m로', t), 'furniture');
  const p = planTurn('가로 140cm로 바꿔줘', { state: s, target: t });
  assert.equal(p.changes.item.next.dims[0], 140);
  assert.equal(p.changes.item.next.sources[0], '사용자 설정');
  const c = planTurn('초록색으로 바꿔줘', { state: s, target: t });
  assert.equal(c.changes.item.next.color, '#83917d');
  assert.equal(c.surfaces[0].kind, 'furniture-color');
  assert.equal(resolveScope('방 가로 5m로', t), 'room');
});
test('선택 가구 동작과 메타 요청을 구분한다', () => {
  const s = exampleState();
  const t = { type: 'item', id: s.items[0].id };
  assert.equal(planTurn('45도 돌려줘', { state: s, target: t }).arg.deg, 45);
  assert.equal(planTurn('이거 삭제해줘', { state: s, target: t }).action, 'delete');
  assert.equal(planTurn('되돌려줘', { state: s, target: room }).action, 'undo');
  assert.equal(planTurn('배치 저장할래', { state: s, target: room }).surfaces[0].kind, 'files');
  assert.equal(
    planTurn('어떤 가구를 놓을까', { state: s, target: room }).surfaces[0].kind,
    'catalog',
  );
  assert.equal(planTurn('겹치지 않게 정리해줘', { state: s, target: room }).action, 'relocate');
  const draft = makeItem('sofa');
  assert.equal(
    planTurn('방에 놓아줘', { state: s, target: { type: 'draft' }, draft }).action,
    'place',
  );
  assert.equal(
    planTurn('거실에 놓을 2인용 소파야', { state: s, target: room, draft }).intent,
    'furniture',
  );
});
test('가구 색 이름을 해석한다', () => {
  assert.equal(parseFurnitureColor('네이비 소파'), '#3f4d63');
  assert.equal(parseFurnitureColor('그냥 소파'), null);
});
test('모델 답의 숫자 문장과 마크업은 쓰지 않는다', () => {
  assert.equal(usableReply('가로 200cm가 좋아요', '소파'), null);
  assert.equal(usableReply('<b>좋아요</b>', '소파'), null);
  assert.equal(usableReply('팔걸이가 있는 편인가요?', '소파'), '팔걸이가 있는 편인가요?');
});
test('규칙 경로: 깊은 좌석·초안 중 방 이야기·분명한 도구', () => {
  const s = freshState();
  const sofa = planTurn('세 명이 앉는 낮은 소파야', { state: s, target: room });
  assert.equal(sofa.confident, false);
  const deep = planTurn('앉는 부분이 깊었으면 좋겠어', {
    state: s,
    target: { type: 'draft' },
    draft: sofa.changes.draft,
  });
  assert.equal(deep.changes.draft.dims[2], 100);
  assert.doesNotMatch(deep.reply, /유형별 기본값/);
  const roomTalk = planTurn('책 읽는 아담한 방으로 꾸며줘', {
    state: s,
    target: { type: 'draft' },
    draft: sofa.changes.draft,
  });
  assert.equal(roomTalk.intent, 'room');
  const wall = planTurn('벽 색상을 고르고 싶어. 벽은 세이지로 바꿔줘', { state: s, target: room });
  assert.equal(wall.confident, true);
  assert.equal(
    usableReply('벽 색상을 고르시는군요. 벽은 세이지로 바꿔주세요.', '벽은 세이지로 바꿔줘'),
    null,
  );
});
test('모델 답이 프롬프트 예시를 베끼거나 말하지 않은 인원수를 말하면 버린다', () => {
  assert.equal(
    usableReply(
      '1인용의 소파로 가늠해볼게요. 앉는 부분도 깊은 편인가요?',
      '두 명이 앉는 소파 색상은 네이비로',
    ),
    null,
  );
  assert.equal(usableReply('세 명이 앉기 좋겠어요.', '두 명이 앉는 소파'), null);
  assert.equal(
    usableReply('두 명이 쓰기 좋은 크기예요. 팔걸이가 있나요?', '두 명이 앉는 소파'),
    '두 명이 쓰기 좋은 크기예요. 팔걸이가 있나요?',
  );
});
test('예시 방 요청은 파일 불러오기보다 먼저 해석한다', () => {
  const s = freshState();
  assert.equal(planTurn('예시 방 불러오기', { state: s, target: room }).action, 'example');
  assert.equal(
    planTurn('배치 파일 불러오기', { state: s, target: room }).surfaces[0].kind,
    'files',
  );
});

test('받침 없는 색 이름도 “~로 바꿔줘”로 바꾸고, 색만 바꿨으면 바뀐 색을 말한다', () => {
  const s = exampleState();
  const sofa = makeItem('sofa');
  s.items.push(sofa);
  for (const [text, hex, name] of [
    ['네이비로 바꿔줘', '#3f4d63', '네이비'],
    ['차콜로 해줘', '#575c58', '차콜'],
    ['월넛으로 바꿔줘', '#7a5c43', '월넛'],
  ]) {
    const p = planTurn(text, { state: s, target: { type: 'item', id: sofa.id } });
    assert.equal(p.changes.item.next.color, hex, text);
    assert.deepEqual(p.changes.item.next.dims, sofa.dims);
    assert.match(p.reply, new RegExp(`색을 ${name}(으로|로) 바꿨어요`));
  }
  // 치수를 함께 말하면 치수 답을 그대로 쓴다.
  const both = planTurn('네이비로 바꾸고 가로 200cm', {
    state: s,
    target: { type: 'item', id: sofa.id },
  });
  assert.equal(both.changes.item.next.color, '#3f4d63');
  assert.equal(both.changes.item.next.dims[0], 200);
  assert.doesNotMatch(both.reply, /색을 네이비로 바꿨어요/);
});
test('목록에 없는 물건은 새 가구를 만들거나 고른 가구를 바꾸지 않고 없다고 답한다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const onDesk = { type: 'item', id: desk.id };
  const pc = planTurn('책상에 컴퓨터 추가해줘', { state: s, target: onDesk });
  assert.equal(pc.intent, 'chat');
  assert.equal(pc.changes, undefined);
  assert.deepEqual(pc.unlisted, ['컴퓨터']);
  assert.match(pc.reply, /컴퓨터는 아직 가구 목록에 없어서 책상 위에/);
  assert.equal(
    planTurn('모니터를 책상 위에 올려줘', { state: s, target: room }).unlisted?.[0],
    '모니터',
  );
  const made = planTurn('컴퓨터를 책상위에 만들어줘', { state: s, target: room });
  assert.equal(made.changes, undefined);
  assert.match(made.reply, /컴퓨터는 아직 가구 목록에 없어서 책상 위에/);
  // 사전에 없는 물건도 같은 답을 받는다.
  const odd = planTurn('트램펄린 하나 놓아줘', { state: s, target: onDesk });
  assert.equal(odd.changes, undefined);
  assert.match(odd.reply, /^트램펄린은 아직 가구 목록에 없어요/);
  // 고른 가구를 지우거나 놓지 않는다.
  assert.equal(planTurn('모니터 빼줘', { state: s, target: onDesk }).action, undefined);
  assert.equal(planTurn('이거 빼줘', { state: s, target: onDesk }).action, 'delete');
  // 목록에 없는 물건은 비슷한 이름의 가구로 읽지 않는다.
  assert.deepEqual(planTurn('전자레인지 하나 놓고 싶어', { state: s, target: room }).unlisted, [
    '전자레인지',
  ]);
  assert.deepEqual(planTurn('상부장 달아줘', { state: s, target: room }).unlisted, ['상부장']);
  // 목록의 이름을 품은 긴 이름은 긴 이름의 가구다.
  assert.equal(
    planTurn('안마의자 하나 놓고 싶어', { state: s, target: room }).changes.draft.type,
    'massage_chair',
  );
  assert.equal(
    planTurn('스탠드 에어컨 놓아줘', { state: s, target: room }).changes.draft.type,
    'standing_ac',
  );
});
test('목록의 가구는 그대로 처리하고 함께 말한 목록에 없는 물건만 뺐다고 알린다', () => {
  const s = freshState();
  for (const t of ['컴퓨터 책상 하나 놓아줘', '컴퓨터책상 하나 놓아줘', 'TV장 하나 놓아줘'])
    assert.ok(planTurn(t, { state: s, target: room }).changes.draft, t);
  const both = planTurn('컴퓨터랑 책상 놓아줘', { state: s, target: room });
  assert.equal(both.changes.draft.type, 'desk');
  assert.match(both.reply, /컴퓨터는 가구 목록에 없어서 뺐어요\.$/);
  // 방 이야기의 물건 이름은 목록 밖 물건으로 보지 않는다.
  assert.equal(
    planTurn('컴퓨터 하는 서재 하나 추가해줘', { state: s, target: room }).changes.addSpace,
    'office',
  );
  assert.equal(
    planTurn('피아노 치는 방으로 꾸며줘', { state: s, target: room }).unlisted,
    undefined,
  );
});
test('새 가구는 띄어 쓴 이름이나 공간 이름이 들어간 이름으로 말해도 그 가구 초안을 만든다', () => {
  const s = freshState();
  for (const [text, type] of [
    ['고양이 화장실 놓아줘', 'litter_box'],
    ['강아지 방석 하나 놓아줘', 'pet_bed'],
    ['화분 받침 놓아줘', 'plant_stand'],
    ['책상 서랍 추가해줘', 'drawer_unit'],
    ['싱크대 넣어줘', 'sink'],
    ['요가매트 깔아줘', 'yoga_mat'],
  ])
    assert.equal(planTurn(text, { state: s, target: room }).changes?.draft?.type, type, text);
  assert.equal(
    planTurn('화장실 하나 추가해줘', { state: s, target: room }).changes.addSpace,
    'bathroom',
  );
  assert.deepEqual(planTurn('책상에 컴퓨터 추가해줘', { state: s, target: room }).unlisted, [
    '컴퓨터',
  ]);
});
test('이름 하나만 말해도 목록에 없는 물건이면 없다고 답하고 뜻이 있는 낱말은 그대로 처리한다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const bed = s.items.find((a) => a.type === 'bed');
  const onDesk = { type: 'item', id: desk.id };
  for (const t of ['트램펄린', '큰 트램펄린', '정수기'])
    assert.ok(planTurn(t, { state: s, target: onDesk }).unlisted, t);
  assert.equal(planTurn('트램펄린', { state: s, target: onDesk }).changes, undefined);
  // 규격·색·방 이름·인사·서술어는 목록 밖 물건으로 보지 않는다.
  assert.equal(
    planTurn('퀸', { state: s, target: { type: 'item', id: bed.id } }).changes.item.next.dims[0],
    150,
  );
  assert.equal(planTurn('초록색', { state: s, target: onDesk }).changes.item.next.color, '#83917d');
  for (const t of ['네이비', '서재', '안녕', '도와줘', '모던', '이거', '더 크고 넉넉하게', '넓게'])
    assert.equal(planTurn(t, { state: s, target: onDesk }).unlisted, undefined, t);
});
test('고른 가구와 다른 가구를 말하면 그 가구에 하고, 없거나 여럿이면 실행하지 않는다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const bed = s.items.find((a) => a.type === 'bed');
  const onDesk = { type: 'item', id: desk.id };
  const del = planTurn('침대 빼줘', { state: s, target: onDesk });
  assert.equal(del.action, 'delete');
  assert.equal(del.arg.id, bed.id);
  const turn = planTurn('침대 90도 돌려줘', { state: s, target: onDesk });
  assert.deepEqual(turn.arg, { deg: 90, id: bed.id });
  assert.equal(planTurn('이거 빼줘', { state: s, target: onDesk }).arg.id, desk.id);
  assert.equal(planTurn('침대 빼줘', { state: s, target: room }).arg.id, bed.id);
  for (const target of [onDesk, room]) {
    const none = planTurn('소파 빼줘', { state: s, target });
    assert.equal(none.action, undefined);
    assert.equal(none.reply, '이 방에는 소파가 없어요.');
  }
  s.items.push({ ...makeItem('chair'), id: 'c2', x: 1, z: 1 });
  const two = planTurn('의자 빼줘', { state: s, target: onDesk });
  assert.equal(two.action, undefined);
  assert.match(two.reply, /^의자가 2개 있어요/);
  // 같은 종류의 초안이 떠 있으면 초안 이야기다.
  const draft = makeItem('sofa');
  assert.equal(
    planTurn('소파 돌려줘', { state: s, target: { type: 'draft' }, draft }).action,
    undefined,
  );
});
test('답의 조사는 이름의 받침을 따른다', () => {
  const s = freshState();
  assert.match(planTurn('책상', { state: s, target: room }).reply, /^책상을 기준으로/);
  assert.match(planTurn('소파', { state: s, target: room }).reply, /^소파를 기준으로/);
  assert.match(planTurn('서재', { state: s, target: room }).reply, /^서재를 가로/);
  assert.match(planTurn('거실', { state: s, target: room }).reply, /^거실을 가로/);
});
test('색 이름만 말해도 고른 가구의 색을 바꾸고, 바뀐 것이 없으면 바꿨다고 하지 않는다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const t = { type: 'item', id: desk.id };
  const navy = planTurn('네이비', { state: s, target: t });
  assert.equal(navy.changes.item.next.color, '#3f4d63');
  assert.equal(navy.reply, '책상 색을 네이비로 바꿨어요.');
  assert.match(planTurn('크게', { state: s, target: t }).reply, /^책상은 그대로예요/);
});

// ---------- 실제 대화에서 틀렸던 문장들 ----------
const bathroomHome = () => {
  const s = freshState();
  setRoom(s, roomWithType(s.room, 'bathroom'));
  s.name = '나의 화장실';
  return s;
};
test('자리를 가리킨 공간 이름은 새 공간 유형으로 읽지 않고 그 공간 옆에 붙인다', () => {
  const s = bathroomHome();
  const p = planTurn('화장실 옆에 방하나 추가하자. 거기는 거실임', { state: s, target: room });
  assert.equal(p.changes.addSpace, 'living');
  assert.equal(p.changes.room.type, 'living');
  assert.deepEqual(p.changes.near, { roomId: s.roomId, name: '나의 화장실', side: null });
  const q = planTurn('침실 오른쪽에 서재 붙여줘', { state: s, target: room });
  assert.equal(q.changes.addSpace, 'office');
  assert.equal(q.changes.near.side, 'right');
  // 침실이 아직 없으면 지금 방을 기준으로 하고 그 사실을 알린다.
  assert.equal(q.changes.near.missing, '침실');
  assert.deepEqual(
    roomMentions('화장실 옆에 방하나 추가하자. 거기는 거실임').map((m) => [m.type, m.role]),
    [
      ['bathroom', 'ref'],
      ['living', 'new'],
    ],
  );
});
test('아니라고 한 유형은 고르지 않고 앞에서 말한 유형으로 바로잡거나 되묻는다', () => {
  const s = bathroomHome();
  const said = ['화장실 옆에 방하나 추가하자. 거기는 거실임'];
  const p = planTurn('왜 화장실로 생성하는거야', { state: s, target: room, said });
  assert.equal(p.repaired, true);
  assert.equal(p.changes.room.type, 'living');
  assert.match(p.reply, /잘못 읽었어요.*거실로 바꿨어요/);
  // 앞에서 말한 유형이 없으면 바꾸지 않고 묻는다.
  const q = planTurn('왜 화장실로 생성하는거야', { state: s, target: room, said: [] });
  assert.deepEqual(q.changes, {});
  assert.equal(q.surfaces[0].kind, 'room-type');
  assert.ok(q.suggestions.every((c) => !c.label.includes('화장실')));
  // 바라는 유형을 함께 말하면 그 유형으로 바꾼다.
  const r = planTurn('아니 거실이라니까 왜 자꾸 화장실로 고정하냐고!!!!', {
    state: s,
    target: room,
  });
  assert.equal(r.changes.room.type, 'living');
  assert.match(r.reply, /^제가 잘못 읽었어요/);
  assert.equal(
    planTurn('거실 말고 침실로 바꿔줘', { state: s, target: room }).changes.room.type,
    'bedroom',
  );
  assert.equal(
    planTurn('화장실이 아니라 거실', { state: s, target: room }).changes.room.type,
    'living',
  );
  // 이미 그 유형이면 다시 바꾸지 않는다.
  const same = planTurn('화장실이라니까', { state: s, target: room });
  assert.deepEqual(same.changes, {});
  assert.match(same.reply, /이미 화장실이에요/);
});
test('한 문장의 방 이야기와 가구 여럿을 나눠 한 번에 처리한다', () => {
  const s = bathroomHome();
  const p = planTurn(
    '거실이라고 그리고 거기에 소파랑 밥먹을 수 있는 식탁이 있었으면 좋겠어. 거실 평수는 대략 6평정도야',
    { state: s, target: room },
  );
  assert.equal(p.intent, 'compound');
  assert.equal(p.changes.room.type, 'living');
  // 6평 ≈ 19.8m²를 거실 기본 비율로 나눈다.
  assert.ok(Math.abs(p.changes.room.w * p.changes.room.d - 6 * 3.3058) < 0.1);
  assert.equal(p.changes.draft.type, 'sofa');
  assert.deepEqual(
    p.changes.queue.map((a) => a.type),
    ['dining'],
  );
  assert.deepEqual(
    p.surfaces.map((x) => x.kind),
    ['furniture-size', 'room-size'],
  );
  assert.equal(p.suggestions[0].action, 'place-all');
  // 가구마다 자기 마디의 치수만 읽는다.
  const q = planTurn('소파는 가로 200cm, 식탁은 가로 150cm', { state: freshState(), target: room });
  assert.equal(q.changes.draft.dims[0], 200);
  assert.equal(q.changes.queue[0].dims[0], 150);
  // 방 마디의 숫자는 방에, 가구 마디의 숫자는 가구에 쓴다.
  const r = planTurn('방 가로 5m 세로 4m로 바꾸고 책상 가로 140cm 놓고 싶어', {
    state: freshState(),
    target: room,
  });
  assert.deepEqual([r.changes.room.w, r.changes.room.d], [5, 4]);
  assert.equal(r.changes.draft.dims[0], 140);
});
test('자리를 가리키는 가구 이름이나 한 덩어리 이름은 여러 가구로 나누지 않는다', () => {
  assert.equal(splitRequest('침대 옆에 협탁 하나'), null);
  assert.equal(splitRequest('책상에 놓을 스탠드'), null);
  assert.equal(splitRequest('소파 테이블 하나 놓고 싶어'), null);
  assert.equal(splitRequest('두 명이 앉는 소파'), null);
  assert.equal(splitRequest('거실에 놓을 소파'), null);
  assert.deepEqual(
    splitRequest('책상이랑 의자 놓고 싶어').pieces.map((x) => x.type),
    ['desk', 'chair'],
  );
  const p = planTurn('침대 옆에 협탁 하나', { state: freshState(), target: room });
  assert.equal(p.changes.draft.type, 'side');
  assert.equal(p.changes.queue, undefined);
});
test('겹친다는 말·방을 돌리라는 말·초기화는 명령으로 읽고, 유형 없는 새 공간은 되묻는다', () => {
  const s = bathroomHome();
  assert.equal(
    planTurn('거실로 바꿨는데 겹치잖아...', { state: s, target: room }).action,
    'relocate',
  );
  assert.equal(planTurn('방이 겹쳤어', { state: s, target: room }).action, 'relocate');
  assert.equal(planTurn('이 방 90도 돌려줘', { state: s, target: room }).action, 'rotate-space');
  assert.equal(
    planTurn('방 자체를 돌리고 싶어', { state: s, target: room }).action,
    'rotate-space',
  );
  assert.equal(planTurn('방 초기화할래', { state: s, target: room }).action, 'clear');
  // 가구를 골라 둔 채 "돌려줘"라고만 하면 가구를 돌린다. "방향"은 방이 아니다.
  const t = exampleState(),
    target = { type: 'item', id: t.items[0].id };
  assert.equal(planTurn('90도 돌려줘', { state: t, target }).action, 'rotate');
  assert.equal(planTurn('방향 돌려줘', { state: t, target }).action, 'rotate');
  assert.equal(planTurn('방을 돌려줘', { state: t, target }).action, 'rotate-space');
  const ask = planTurn('방 하나 더 만들어줘', { state: s, target: room });
  assert.deepEqual(ask.changes, {});
  assert.match(ask.reply, /어떤 공간을 추가할까요/);
  assert.ok(ask.suggestions.length >= 3);
  const vague = planTurn('아니 그게 아니라', { state: s, target: room });
  assert.equal(vague.intent, 'chat');
  assert.match(vague.reply, /되돌릴 수 있어요/);
});
test('이미 바로잡힌 방에 따지면 지금 유형을 알리고, 기다리는 초안은 한꺼번에 놓을 수 있다', () => {
  const s = freshState();
  setRoom(s, roomWithType(s.room, 'living'));
  const p = planTurn('왜 화장실로 생성하는거야', {
    state: s,
    target: room,
    said: ['거기는 거실임'],
  });
  assert.deepEqual(p.changes, {});
  assert.match(p.reply, /화장실이 아니라 거실이에요/);
  const draft = makeItem('sofa'),
    queue = [makeItem('dining')];
  const ctx = { state: s, target: { type: 'draft' }, draft, queue };
  assert.equal(planTurn('둘 다 놓아줘', ctx).action, 'place-all');
  assert.equal(planTurn('모두 놓자', ctx).action, 'place-all');
  assert.equal(planTurn('방에 놓아줘', ctx).action, 'place');
  assert.equal(planTurn('둘 다 놓아줘', { ...ctx, queue: [] }).action, 'place');
});
test('가구를 골라 둔 채 공간 이름으로 돌리라고 하면 그 공간을 돌린다', () => {
  const s = exampleState(),
    bath = addSpace(s, 'bathroom');
  switchSpace(s, spaces(s)[0].roomId);
  const target = { type: 'item', id: s.items[0].id };
  const p = planTurn('화장실 돌려줘', { state: s, target });
  assert.equal(p.action, 'rotate-space');
  assert.equal(p.arg.id, bath);
  assert.equal(planTurn('침대 돌려줘', { state: s, target }).action, 'rotate');
});
test('"앉을 만한 거 하나"의 "거"처럼 물건을 대신하는 말은 목록에 없는 물건으로 읽지 않는다', () => {
  const s = freshState();
  for (const t of [
    '책 읽을 때 푹 기대 앉을 만한 거 하나 놓고 싶어',
    '앉을 것 하나 놓아줘',
    '왜 자꾸 이상하게 만들어',
    '방향 돌려줘',
  ])
    assert.equal(objectsOf(t)?.unlisted.length || 0, 0, t);
  // 진짜 목록에 없는 물건은 그대로 잡는다.
  assert.deepEqual(
    objectsOf('트램펄린 하나 놓아줘').unlisted.map((x) => x.name),
    ['트램펄린'],
  );
  assert.equal(planTurn('컴퓨터 하나 놓아줘', { state: s, target: room }).intent, 'chat');
});

test('가구 여럿의 요청은 다섯 번째부터도 빠뜨리지 않고 과도한 일괄 요청은 거절한다', () => {
  const req = splitRequest('소파랑 식탁이랑 책상이랑 의자랑 책장이랑 화분이랑 조명 놓고 싶어');
  assert.equal(req.pieces.length, 7);
  const p = planTurn(Array(26).fill('소파').join('랑 ') + ' 놓고 싶어', {
    state: freshState(),
    target: room,
  });
  assert.equal(p.error, true);
  assert.equal(p.batchLimit, true);
});
