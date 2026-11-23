// 집 전체 초안의 방 배치. 면적을 반씩 나누는 순서를 여러 가지로 시험해 문 규칙을 지키면서 가장 반듯한 배치를 고른다.
// 근거: Marson & Musse(2010)의 squarified treemap 평면 생성은 방을 정사각형에 가깝게 나누고 거실에서 뻗는 연결 나무를
// 쓴다. Mirahmadi & Shami(arXiv 1211.5842)는 침실끼리, 침실과 주방은 잇지 않고 모양이 어색한 후보를 버린다.
// 한국 아파트에 맞춰 공용 욕실은 공용 공간에, 둘째 욕실과 드레스룸은 안방에 붙일 수 있게 했다.
import { ROOM_TYPES } from '../catalog.js';
import { connections } from '../floorplan.js';

const SOCIAL = new Set(['living', 'dining', 'kitchen']);
export function roomRole(r) {
  if (SOCIAL.has(r.type)) return r.type;
  if (/다용도|세탁/.test(r.name)) return 'service';
  if (/현관|입구/.test(r.name)) return 'entry';
  if (/수납|드레스|옷방/.test(r.name)) return 'closet';
  return r.type === 'bathroom' ? 'bath' : 'private';
}
// 짧은 변의 최소 길이. 앱의 가장 작은 규격을 따르고, 드레스룸·다용도실·현관은 화장실과 같게 본다.
function minShort(r, role) {
  if (['service', 'entry', 'closet'].includes(role)) return 1.5;
  const [w, d] = ROOM_TYPES[r.type].sizes[0];
  return Math.min(w, d);
}
// 길이 대 폭의 한계. 욕실, 드레스룸, 다용도실, 현관은 실제로도 좁고 길어 조금 더 허용한다.
const maxRatio = (role) => (['bath', 'closet', 'service', 'entry'].includes(role) ? 2.3 : 2);
// 문을 낼 수 있는 두 공간인지. master는 안방(첫 침실), commonBath는 첫 욕실이다.
function allowed(a, b, ctx) {
  const pair = (x, y) => (a.role === x && b.role === y) || (a.role === y && b.role === x);
  if (pair('living', 'living') || pair('living', 'dining') || pair('living', 'kitchen'))
    return true;
  if (pair('dining', 'kitchen') || pair('dining', 'dining')) return true;
  if (a.role === 'living' || b.role === 'living' || a.role === 'dining' || b.role === 'dining')
    return true;
  if (pair('kitchen', 'service') || pair('kitchen', 'entry')) return true;
  const master = [a, b].find((r) => r.index === ctx.master),
    other = master && (master === a ? b : a);
  if (other?.role === 'closet') return true;
  if (other?.role === 'bath' && other.index !== ctx.commonBath) return true;
  return false;
}
// 거실에서 시작해 허용된 문만으로 모든 공간에 닿는 연결 나무. 닿지 못하는 공간이 있으면 null이다.
// 공용 공간 쪽 문을 먼저 고르고, 공용 욕실은 공용 공간에서 바로 들어가야 한다.
function doorTree(rooms, links, ctx) {
  const seen = new Set([ctx.root]),
    chosen = [];
  const cost = (l) => {
    const from = rooms[seen.has(l[0]) ? l[0] : l[1]];
    return SOCIAL.has(from.role) ? 0 : 10;
  };
  while (seen.size < rooms.length) {
    const next = links
      .filter((l) => seen.has(l[0]) !== seen.has(l[1]))
      .sort((x, y) => cost(x) - cost(y))[0];
    if (!next) return null;
    chosen.push(next);
    next.forEach((i) => seen.add(i));
  }
  if (ctx.commonBath >= 0) {
    const door = chosen.find((l) => l.includes(ctx.commonBath)),
      other = door && rooms[door[0] === ctx.commonBath ? door[1] : door[0]];
    if (!other || !SOCIAL.has(other.role)) return null;
  }
  return chosen;
}
// 순서대로 늘어선 공간을 면적 비율에 맞게 반씩 나눈다. 긴 변을 자른다.
function partition(order, rooms, left, top, w, d, out, rnd) {
  if (order.length === 1) {
    out[order[0]] = { left, top, w, d };
    return;
  }
  const sum = order.reduce((n, i) => n + rooms[i].weight, 0);
  // 처음 시도는 무게가 반에 가장 가까운 곳을 긴 변 방향으로 자른다. 나머지 시도는 자를 곳과 방향을 바꿔 본다.
  const prefix = [];
  let acc = 0;
  for (const i of order) prefix.push((acc += rooms[i].weight));
  let cut = 1;
  for (let k = 1; k < order.length; k++)
    if (Math.abs(sum / 2 - prefix[k - 1]) < Math.abs(sum / 2 - prefix[cut - 1])) cut = k;
  if (rnd) cut = Math.floor(rnd() * (order.length - 1)) + 1;
  const weight = prefix[cut - 1];
  const across = rnd && w / d < 1.8 && d / w < 1.8 ? rnd() < 0.5 : w >= d;
  const [a, b] = [order.slice(0, cut), order.slice(cut)];
  if (across) {
    const first = round2((w * weight) / sum);
    partition(a, rooms, left, top, first, d, out, rnd);
    partition(b, rooms, left + first, top, round2(w - first), d, out, rnd);
  } else {
    const first = round2((d * weight) / sum);
    partition(a, rooms, left, top, w, first, out, rnd);
    partition(b, rooms, left, top + first, w, round2(d - first), out, rnd);
  }
}
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

// 같은 요청에는 같은 배치를 내도록 고정된 씨앗을 쓴다.
function random(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function shuffled(n, rnd) {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const TRIES = 8000;
const SHAPES = [1.1, 1.25, 1.45];
// rooms: [{ type, name, weight }] (무거운 순). 돌려주는 값은 rooms와 같은 순서의 사각형과 열어 둘 문 목록이다.
export function layoutHouse(rooms, areaM2) {
  const total = rooms.reduce((n, r) => n + r.weight, 0),
    info = rooms.map((r, index) => ({ ...r, index, role: roomRole(r) })),
    ctx = {
      root: Math.max(
        0,
        info.findIndex((r) => r.role === 'living'),
      ),
      master: info.findIndex((r) => r.type === 'bedroom'),
      commonBath: info.findIndex((r) => r.role === 'bath'),
    };
  let best = null;
  for (const shape of SHAPES) {
    const width = round2(Math.sqrt(areaM2 * shape)),
      depth = round2(areaM2 / width);
    for (let t = 0; t < TRIES; t++) {
      // 첫 시도는 무거운 순서 그대로다(예전 배치와 같은 순서).
      const rnd = t ? random(7919 * t + Math.round(shape * 100)) : null,
        order = rnd ? shuffled(info.length, rnd) : [...info.keys()],
        rects = [];
      partition(order, info, -width / 2, 0, width, depth, rects, rnd);
      let score = 0,
        bad = false;
      for (const r of info) {
        const { w, d } = rects[r.index],
          short = Math.min(w, d),
          ratio = Math.max(w, d) / short;
        // 가구를 둘 수 없을 만큼 좁거나 복도처럼 긴 방은 점수와 상관없이 버린다.
        if (
          short < Math.max(1.5, minShort(r, r.role) * 0.75) ||
          Math.max(w, d) > 15 ||
          ratio > maxRatio(r.role) + 0.6
        ) {
          bad = true;
          break;
        }
        score += Math.max(0, minShort(r, r.role) - short) * 20;
        score += (ratio - 1) ** 2 + Math.max(0, ratio - maxRatio(r.role)) * 40;
      }
      if (bad || (best && score >= best.score)) continue;
      const list = info.map((r) => ({
          roomId: r.index,
          name: r.name,
          room: { w: rects[r.index].w, d: rects[r.index].d, windows: [] },
        })),
        positions = Object.fromEntries(
          info.map((r) => {
            const x = rects[r.index];
            return [r.index, { x: round3(x.left + x.w / 2), z: round3(x.top + x.d / 2) }];
          }),
        );
      const links = connections(list, { positions })
        .map((c) => c.ids)
        .filter(([a, b]) => allowed(info[a], info[b], ctx));
      const doors = doorTree(info, links, ctx);
      if (!doors) continue;
      // 다용도실은 주방 옆, 드레스룸은 안방 옆이 낫다.
      for (const [role, near] of [
        ['service', 'kitchen'],
        ['closet', 'master'],
      ])
        for (const r of info.filter((x) => x.role === role))
          if (
            !doors.some(
              (l) =>
                l.includes(r.index) &&
                l.some((i) =>
                  near === 'master' ? i === ctx.master : info[i].role === near && i !== r.index,
                ),
            )
          )
            score += 3;
      if (!best || score < best.score) best = { score, rects, positions, doors };
    }
  }
  if (!best)
    throw Error(
      '이 면적으로는 방을 반듯하게 나누고 모든 방에 문을 낼 수 없어요. 공간 수를 줄이거나 면적을 늘려 주세요.',
    );
  return {
    rooms: best.rects.map(({ w, d }, i) => ({ w, d, ...best.positions[i] })),
    doors: best.doors,
  };
}
