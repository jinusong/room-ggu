import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, spaces } from '../data.js';
import { connections, floorplanWarnings, normalizeFloorplan } from '../floorplan.js';
import { buildDesign } from './ops.js';
import { designRequest, templateDesign } from './design.js';
import { roomRole } from './house-layout.js';

// 평수와 침실·화장실 개수를 조합해 집 전체 초안을 만들고, 배치가 지켜야 할 규칙만 확인한다.
const AREAS = [15, 18, 20, 24, 28, 32, 40, 50, 60, 85, 120];
const EXTRAS = ['', ' 침실 2개', ' 침실 3개', ' 침실 3개 화장실 2개', ' 서재 1개'];
const SOCIAL = new Set(['living', 'dining', 'kitchen']);
function designs() {
  const out = [];
  for (const area of AREAS)
    for (const extra of EXTRAS) {
      const text = `${area}평 집 새로 꾸며줘${extra}`;
      try {
        out.push({ text, ...buildDesign(freshState(), templateDesign(designRequest(text))) });
      } catch (e) {
        out.push({ text, error: e.message });
      }
    }
  return out;
}
const all = designs();

test('흔한 구성은 모두 만들어지고 못 만드는 경우는 이유를 말한다', () => {
  for (const d of all.filter((x) => x.error)) assert.match(d.error, /면적|공간/, d.text);
  for (const text of [
    '24평 집 새로 꾸며줘',
    '24평 집 새로 꾸며줘 침실 3개 화장실 2개',
    '18평 집 새로 꾸며줘 침실 2개',
    '32평 집 새로 꾸며줘 침실 3개 화장실 2개',
  ])
    assert.ok(!all.find((d) => d.text === text).error, text);
  assert.ok(all.filter((d) => !d.error).length >= all.length - 2);
});

test('모든 방은 거실에서 열린 문만으로 갈 수 있고 침실끼리는 문이 없다', () => {
  for (const d of all.filter((x) => !x.error)) {
    const list = spaces(d.state),
      plan = normalizeFloorplan(d.state.floorplan, list),
      open = connections(list, plan).filter((c) => !c.closed),
      byId = Object.fromEntries(list.map((r) => [r.roomId, r])),
      role = (id) => roomRole({ type: byId[id].room.type, name: byId[id].name }),
      master = list.find((r) => r.room.type === 'bedroom')?.roomId,
      commonBath = list.find((r) => r.room.type === 'bathroom')?.roomId;
    assert.equal(floorplanWarnings(list, plan).size, 0, d.text);
    for (const { ids } of open) {
      const [a, b] = ids.map(role);
      if (SOCIAL.has(a) || SOCIAL.has(b)) {
        // 주방에서 바로 침실이나 욕실로 들어가지 않는다.
        if (a === 'kitchen' || b === 'kitchen')
          assert.ok(!['private', 'bath', 'closet'].includes(a === 'kitchen' ? b : a), d.text);
        continue;
      }
      // 공용 공간이 아닌 두 방 사이의 문은 안방의 드레스룸이나 전용 욕실뿐이다.
      assert.ok(ids.includes(master), `${d.text}: ${ids.map((id) => byId[id].name).join('↔')}`);
      const other = ids.find((id) => id !== master);
      assert.ok(
        role(other) === 'closet' || (role(other) === 'bath' && other !== commonBath),
        d.text,
      );
    }
    // 공용 욕실은 공용 공간에서 바로 들어간다.
    assert.ok(
      open.some((c) => c.ids.includes(commonBath) && c.ids.some((id) => SOCIAL.has(role(id)))),
      d.text,
    );
    const root = list.find((r) => r.room.type === 'living').roomId,
      seen = new Set([root]);
    for (let grew = true; grew;) {
      grew = false;
      for (const { ids } of open)
        if (seen.has(ids[0]) !== seen.has(ids[1])) {
          ids.forEach((id) => seen.add(id));
          grew = true;
        }
    }
    assert.equal(seen.size, list.length, d.text);
  }
});

test('방은 가구를 둘 수 있는 폭이고 복도처럼 길지 않으며 면적을 그대로 나눈다', () => {
  for (const d of all.filter((x) => !x.error)) {
    const list = spaces(d.state),
      area = designRequest(d.text).areaM2;
    for (const r of list) {
      const short = Math.min(r.room.w, r.room.d),
        ratio = Math.max(r.room.w, r.room.d) / short,
        small = ['bath', 'closet', 'service', 'entry'].includes(
          roomRole({ type: r.room.type, name: r.name }),
        );
      assert.ok(short >= 1.5, `${d.text}: ${r.name} ${r.room.w}x${r.room.d}`);
      assert.ok(ratio <= (small ? 2.9 : 2.6), `${d.text}: ${r.name} ${r.room.w}x${r.room.d}`);
    }
    const sum = list.reduce((n, r) => n + r.room.w * r.room.d, 0);
    assert.ok(Math.abs(sum - area) / area < 0.002, d.text);
  }
});

test('면적이 모자라면 말하지 않은 드레스룸과 다용도실만 빼고 알려 준다', () => {
  const small = all.find((d) => d.text === '18평 집 새로 꾸며줘 침실 3개 화장실 2개');
  assert.deepEqual(small.skipped, ['드레스룸', '다용도실']);
  assert.ok(
    spaces(small.state).filter((r) => r.room.type === 'bedroom').length === 3 &&
      spaces(small.state).filter((r) => r.room.type === 'bathroom').length === 2,
  );
  // 직접 말한 공간은 빼지 않는다.
  const asked = templateDesign(designRequest('18평 집 새로 꾸며줘 침실 3개 화장실 2개 드레스룸도'));
  assert.ok(asked.rooms.some((r) => r.name === '드레스룸' && !r.optional));
  // 넉넉한 집은 아무것도 빼지 않는다.
  assert.deepEqual(all.find((d) => d.text === '40평 집 새로 꾸며줘').skipped, []);
});

test('같은 요청은 같은 배치를 만든다', () => {
  const once = (t) =>
    spaces(buildDesign(freshState(), templateDesign(designRequest(t))).state).map((r) => [
      r.name,
      r.room.w,
      r.room.d,
    ]);
  const t = '32평 집 새로 꾸며줘 침실 3개 화장실 2개';
  assert.deepEqual(once(t), once(t));
});
