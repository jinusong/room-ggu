import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleState, freshState, makeItem } from '../data.js';
import { planTurn, resolveScope, parseFurnitureColor } from './planner.js';
import { mergeFurnitureModel, mergeRoomModel, usableReply } from './model-turn.js';

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
test('모델 응답의 숫자 문장과 마크업은 쓰지 않고 UI 선택만 허용 목록으로 바꾼다', () => {
  assert.equal(usableReply('가로 200cm가 좋아요', '소파'), null);
  assert.equal(usableReply('<b>좋아요</b>', '소파'), null);
  assert.equal(usableReply('팔걸이가 있는 편인가요?', '소파'), '팔걸이가 있는 편인가요?');
  const sofa = { ...makeItem('sofa'), sources: ['사용자 설정', '유형 기본값', '유형 기본값'] };
  const m = mergeFurnitureModel(
    '{"seats":3,"size":"unknown","depth_profile":"deep","height_profile":"unknown","ui":"colors","reply":"깊은 소파로 볼게요."}',
    sofa,
    '세 명이 앉는 깊은 소파',
  );
  assert.equal(m.item.dims[0], sofa.dims[0]);
  assert.equal(m.item.dims[2], 100);
  assert.equal(m.kind, 'furniture-color');
  const r = mergeRoomModel(
    '{"room_type":"kitchen","size":"large","ui":"finishes","reply":"벽은 세이지가 어울려요."}',
    freshState().room,
    '벽은 세이지로 바꿔줘',
  );
  assert.equal(r.room.type, 'studio');
  assert.equal(r.room.w, 4);
  assert.equal(r.kind, 'finishes');
});
test('실제 모델 확인에서 찾은 경우: 깊은 좌석·초안 중 방 이야기·분명한 도구', () => {
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
