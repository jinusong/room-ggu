import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleState, freshState, makeItem } from '../data.js';
import { planTurn, resolveScope, parseFurnitureColor } from './planner.js';
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
  // 목록의 이름을 품은 말을 그 가구로 읽지 않는다.
  assert.deepEqual(planTurn('안마의자 하나 놓고 싶어', { state: s, target: room }).unlisted, [
    '안마의자',
  ]);
  assert.deepEqual(planTurn('스탠드 에어컨 놓아줘', { state: s, target: room }).unlisted, [
    '에어컨',
  ]);
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
test('이름 하나만 말해도 목록에 없는 물건이면 없다고 답하고 뜻이 있는 낱말은 그대로 처리한다', () => {
  const s = exampleState();
  const desk = s.items.find((a) => a.type === 'desk');
  const bed = s.items.find((a) => a.type === 'bed');
  const onDesk = { type: 'item', id: desk.id };
  for (const t of ['트램펄린', '큰 트램펄린', '안마의자'])
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
