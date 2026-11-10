import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom } from './catalog.js';
import {
  consultRoom,
  parseRoomDimensions,
  isRoomIntent,
  applyRoomModel,
  consultationScope,
} from './room-consult.js';
test('방 대화의 m·cm·mm 및 가로×세로×천장 높이를 구분한다', () => {
  assert.deepEqual(parseRoomDimensions('거실 가로 5m 세로 400cm 천장 2500mm'), {
    w: 5,
    d: 4,
    h: 2.5,
  });
  assert.deepEqual(parseRoomDimensions('4.5 × 3 × 2.4m'), { w: 4.5, d: 3, h: 2.4 });
  assert.throws(() => parseRoomDimensions('가로 20m'));
});
test('방 유형과 치수·마감을 반영하고 면적 기반 초안의 가정을 알린다', () => {
  const r = consultRoom('거실 가로 5m 세로 4m 벽은 세이지 바닥은 월넛', makeRoom());
  assert.equal(r.room.type, 'living');
  assert.equal(r.room.w, 5);
  assert.equal(r.room.d, 4);
  assert.equal(r.room.wallColor, '#c0cbbb');
  assert.equal(r.room.floorColor, '#93785c');
  const area = consultRoom('6평 원룸', makeRoom());
  assert.ok(Math.abs(area.room.w * area.room.d - 6 * 3.3058) < 0.1);
  assert.match(area.reply, /가정|초안/);
});
test('기존 공간의 직접 입력을 보존하고 새 공간에는 이전 방 치수를 복사하지 않는다', () => {
  let r = consultRoom('가로 5m', makeRoom()).room;
  r = consultRoom('아담한 서재로', r).room;
  assert.equal(r.w, 5);
  const added = consultRoom('아담한 서재 하나 추가해줘', r);
  assert.equal(added.add, true);
  assert.equal(added.room.w, 2.5);
  assert.equal(added.room.type, 'office');
});
test('AI의 공간 초안이 사용자 설정과 면적에서 가정한 치수를 덮어쓰지 않는다', () => {
  const r = consultRoom('가로 5m 세로 4m', makeRoom()).room;
  const v = applyRoomModel(
    '{"room_type":"living","size":"compact","reply":"소파가 중심인가요?"}',
    r,
  );
  assert.equal(v.room.w, 5);
  assert.equal(v.room.d, 4);
  assert.throws(() => applyRoomModel('no json', r));
  assert.equal(isRoomIntent('침실 가로 4m로 바꿔줘'), true);
});

test('방 치수 뒤에 가구를 언급해도 방 상담으로 해석한다', () => {
  assert.equal(
    consultationScope('거실 가로 5m 세로 4m로 바꿔줘. 소파 중심으로 꾸밀 거야.'),
    'room',
  );
  assert.equal(consultationScope('거실에 놓을 2인용 소파야. 가로 180cm'), 'furniture');
  assert.equal(consultationScope('가로 180cm인 소파', 'furniture'), 'furniture');
});
