import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, spaces } from '../data.js';
import { ROOM_TYPES } from '../catalog.js';
import { floorplanWarnings, normalizeFloorplan } from '../floorplan.js';
import { planFromModel } from './interpret.js';
import { planTurn } from './planner.js';
import * as ops from './ops.js';

// 방 만들기 문장과 방 조작을 규격에서 만들어 지켜야 할 규칙만 확인한다.
const room = { type: 'room' };
const ctx = () => ({ state: freshState(), target: room });
const model = (v) =>
  JSON.stringify({
    intent: 'action',
    action: 'new_space',
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
const NAMES = {
  studio: ['원룸'],
  bathroom: ['화장실', '욕실'],
  living: ['거실'],
  bedroom: ['침실', '안방', '손님방', '드레스룸', '옷방'],
  office: ['서재', '작업실', '공부방'],
  dining: ['다이닝룸'],
  kitchen: ['주방', '부엌'],
  kids: ['아이방', '어린이 방'],
};
const ADD = ['%s 하나 추가해줘', '%s 추가', '%s 하나 더 만들어줘'];
const GENERIC = [
  '방 만들어줘',
  '방 하나 만들어줘',
  '방 하나 추가해줘',
  '새 방 만들어줘',
  '방 하나 더',
  '공간 하나 추가해줘',
];

test('공간 이름을 말하고 추가해 달라고 하면 규칙과 모델 모두 그 유형을 새로 만든다', () => {
  assert.deepEqual(Object.keys(NAMES).sort(), Object.keys(ROOM_TYPES).sort());
  for (const [type, names] of Object.entries(NAMES))
    for (const name of names)
      for (const form of ADD) {
        const t = form.replace('%s', name);
        assert.equal(planTurn(t, ctx()).changes?.addSpace, type, t);
        for (const guess of Object.keys(ROOM_TYPES))
          assert.equal(
            planFromModel(model({ room_type: guess }), t, ctx()).changes?.addSpace,
            type,
            `${t} / 모델 ${guess}`,
          );
      }
});

test('공간 종류를 말하지 않으면 모델이 어떤 유형을 골라도 만들지 않고 되묻는다', () => {
  for (const t of GENERIC)
    for (const guess of [...Object.keys(ROOM_TYPES), 'none']) {
      const p = planFromModel(model({ room_type: guess }), t, ctx());
      assert.equal(p.changes?.addSpace, undefined, `${t} / 모델 ${guess}`);
      assert.equal(p.changes?.room, undefined, `${t} / 모델 ${guess}`);
    }
});

test('용도만 말했으면 그 용도와 맞는 모델 유형만 따른다', () => {
  const cases = [
    ['잠잘 방 하나 추가해줘', 'bedroom'],
    ['공부할 방 하나 추가해줘', 'office'],
    ['아기 재울 방 하나 더 만들어줘', 'kids'],
    ['샤워할 공간 하나 추가해줘', 'bathroom'],
  ];
  for (const [t, type] of cases)
    for (const guess of Object.keys(ROOM_TYPES)) {
      const p = planFromModel(model({ room_type: guess }), t, ctx());
      if (guess === type) assert.equal(p.changes?.addSpace, type, t);
      else if (p.changes?.addSpace)
        assert.ok(
          ['bedroom', 'kids'].includes(guess) && ['bedroom', 'kids'].includes(type),
          `${t} / 모델 ${guess}`,
        );
    }
});

test('따로 유형이 없는 공간은 가까운 유형으로 만들고 말한 이름을 붙인다', () => {
  for (const [t, type, name] of [
    ['공부방 하나 추가해줘', 'office', '나의 공부방'],
    ['손님방 하나 추가해줘', 'bedroom', '나의 손님방'],
    ['드레스룸 하나 추가해줘', 'bedroom', '나의 드레스룸'],
    ['침실 하나 추가해줘', 'bedroom', '나의 침실'],
    ['서재 옆에 손님방 하나 추가해줘', 'bedroom', '나의 손님방'],
  ]) {
    const s = freshState(),
      p = planTurn(t, { state: s, target: room });
    ops.addSpace(s, p.changes.addSpace, null, { room: p.changes.room, label: p.changes.label });
    assert.equal(s.room.type, type, t);
    assert.equal(s.name, name, t);
  }
  const s = freshState();
  ops.addSpace(s, 'bedroom', null, { label: '드레스룸' });
  ops.addSpace(s, 'bedroom', null, { label: '드레스룸' });
  assert.equal(s.name, '나의 드레스룸 2');
});

test('아직 없는 공간 종류는 가구 목록이 아니라 공간 종류에 없다고 답한다', () => {
  const kinds = ['현관', '베란다', '발코니', '다용도실', '팬트리', '복도', '창고', '테라스'];
  for (const name of kinds)
    for (const form of ['%s 만들어줘', '%s 하나 추가해줘', '%s도 붙여줘']) {
      const t = form.replace('%s', name);
      for (const p of [
        planTurn(t, ctx()),
        planFromModel(model({ room_type: 'bathroom' }), t, ctx()),
      ]) {
        assert.match(p.reply, /공간 종류에 없어요/, t);
        assert.doesNotMatch(p.reply, /가구 목록/, t);
        assert.deepEqual(p.changes ?? {}, {}, t);
      }
    }
  // 자리를 가리킨 이름은 공간 요청이 아니다.
  assert.equal(planTurn('현관 옆에 신발장 놔줘', ctx()).changes.draft.type, 'shoe_cabinet');
});

test('방을 추가하고 고치는 어떤 순서에서도 공간이 겹치지 않는다', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    pick = (a) => a[Math.floor(rnd() * a.length)],
    types = Object.keys(ROOM_TYPES),
    sides = [null, 'left', 'right', 'back', 'front'];
  for (let run = 0; run < 150; run++) {
    const s = freshState(),
      log = [];
    for (let step = 0; step < 10; step++) {
      const list = spaces(s),
        op = pick(['add', 'add', 'add', 'resize', 'resize', 'rotate', 'switch', 'delete', 'move']);
      try {
        if (op === 'add') ops.addSpace(s, pick(types), pick(sides), { strict: false });
        if (op === 'resize')
          ops.setRoom(s, {
            ...s.room,
            w: 1 + Math.round(rnd() * 16) / 2,
            d: 1 + Math.round(rnd() * 16) / 2,
          });
        if (op === 'rotate') ops.rotateSpace(s);
        if (op === 'switch' && list.length > 1) ops.switchSpace(s, pick(list).roomId);
        if (op === 'delete' && list.length > 1) ops.deleteSpace(s);
        if (op === 'move' && list.length > 1)
          ops.moveSpace(s, s.roomId, Math.round(rnd() * 20 - 10), Math.round(rnd() * 20 - 10));
        log.push(op);
      } catch {
        // 앱이 거절한 조작은 배치를 바꾸지 않는다.
        continue;
      }
      const now = spaces(s);
      assert.equal(
        floorplanWarnings(now, normalizeFloorplan(s.floorplan, now)).size,
        0,
        log.join(' → '),
      );
    }
  }
});

test('자리를 가리킨 공간의 별명은 새 공간 이름에 쓰지 않는다', () => {
  const s = freshState();
  ops.addSpace(s, 'office', null, { label: '공부방' });
  const p = planTurn('공부방 옆에 침실 하나 추가해줘', { state: s, target: room });
  assert.equal(p.changes.addSpace, 'bedroom');
  assert.equal(p.changes.label, null);
});

test('공간을 지우자고 하면 바로 지우지 않고 그 공간을 지우는 확인 단추를 준다', () => {
  const s = freshState(),
    first = s.roomId;
  ops.addSpace(s, 'bedroom');
  ops.addSpace(s, 'office');
  ops.switchSpace(s, first);
  const bed = spaces(s).find((r) => r.room.type === 'bedroom');
  const ask = (t) => [
    planTurn(t, { state: s, target: room }),
    planFromModel(model({ intent: 'action', action: 'delete' }), t, { state: s, target: room }),
  ];
  for (const [t, id] of [
    ['이 방 지워줘', first],
    ['침실 삭제해줘', bed.roomId],
    ['나의 서재 없애줘', spaces(s).find((r) => r.room.type === 'office').roomId],
  ])
    for (const p of ask(t)) {
      assert.equal(p.ask, 'delete-space', t);
      assert.deepEqual(p.changes ?? {}, {}, t);
      assert.equal(p.suggestions[0].action, 'delete-space', t);
      assert.equal(p.suggestions[0].arg, id, t);
    }
  // 대상이 없거나 같은 유형이 없으면 지우지 않고 공간 목록을 권한다.
  for (const t of ['공간 삭제', '화장실 지워줘']) {
    const p = planTurn(t, { state: s, target: room });
    assert.equal(p.ask, 'delete-space', t);
    assert.equal(p.suggestions[0].arg, 'spaces', t);
  }
  // 가구를 지우자는 말은 공간 삭제가 아니다.
  for (const t of ['침대 지워줘', '침실에 있는 의자 지워줘', '이 방 가구 다 지워줘'])
    assert.notEqual(planTurn(t, { state: s, target: room }).ask, 'delete-space', t);
  // 마지막 공간은 지울 수 없다고 답한다.
  const one = planTurn('이 방 지워줘', ctx());
  assert.match(one.reply, /마지막 공간/);
  assert.equal(one.suggestions.length, 0);
});
