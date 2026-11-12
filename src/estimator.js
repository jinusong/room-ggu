import { UI_SURFACES } from './ui-schema.js';
import { TYPES, makeItem, DEFAULT_SOURCE } from './data.js';
const aliases = {
  armchair: /라운지체어|암체어|1인용\s*안락|armchair/i,
  coffee: /소파\s*테이블|커피\s*테이블|coffee\s*table/i,
  side: /협탁|사이드\s*테이블|nightstand|side\s*table/i,
  dining: /식탁|다이닝\s*테이블|dining\s*table/i,
  tvstand: /TV\s*장|티비\s*장|거실장|tv\s*stand/i,
  shoe_cabinet: /신발장|shoe\s*cabinet/i,
  dresser: /서랍장|dresser/i,
  bench: /벤치|bench/i,
  rug: /러그|카펫|rug|carpet/i,
  lamp: /조명|스탠드|lamp/i,
  plant: /화분|식물|plant/i,
  fridge: /냉장고|fridge|refrigerator/i,
  washer: /세탁기|washer|washing\s*machine/i,
  sofa: /소파|쇼파|sofa|couch/i,
  bed: /침대|매트리스|bed|mattress/i,
  desk: /책상|테이블|desk|table/i,
  chair: /의자|chair|stool/i,
  wardrobe: /옷장|장롱|wardrobe|closet/i,
  shelf: /선반|책장|shelf|bookcase|bookshelf/i,
  cabinet: /수납장|cabinet/i,
};
export function detectType(t) {
  return Object.entries(aliases).find(([, r]) => r.test(t))?.[0] || null;
}
export function extractDimensions(t) {
  const out = {},
    axes = {
      0: '(?:가로|너비|폭|길이|width|length)',
      1: '(?:전체\\s*높이|높이|height)',
      2: '(?:깊이|세로|depth)',
    };
  const factor = (u) =>
    /^(?:m|미터)$/.test(u || '') ? 100 : /^(?:mm|밀리미터)$/.test(u || '') ? 0.1 : 1;
  for (const [i, name] of Object.entries(axes)) {
    const r = new RegExp(
      name +
        '(?:는|가|를|은|이|:|\\s)*([0-9]+(?:\\.[0-9]+)?)\\s*(mm|cm|m|밀리미터|센티미터|센치|센티|미터)?',
      'ig',
    );
    for (const m of t.matchAll(r)) {
      const n = +m[1] * factor(m[2]?.toLowerCase());
      if (n >= 1 && n <= 1500) out[i] = Math.round(n * 10) / 10;
    }
  }
  const triple = t.match(
    /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(cm|m)?/i,
  );
  if (triple) {
    const f = factor(triple[4]);
    for (const [i, n] of [
      [0, +triple[1] * f],
      [2, +triple[2] * f],
      [1, +triple[3] * f],
    ])
      if (n >= 1 && n <= 1500 && out[i] === undefined) out[i] = n;
  }
  return out;
}
export function consult(text, previous, caption = '') {
  const a = structuredClone(previous || makeItem());
  const type = detectType(text) || (!previous ? detectType(caption) : null);
  if (type && type !== a.type) {
    const id = a.id;
    Object.assign(a, makeItem(type), { id });
  }
  const explicit = extractDimensions(text),
    updated = [];
  const set = (i, n, src) => {
    a.dims[i] = n;
    a.sources[i] = src;
    updated.push(i);
  };
  if (a.type === 'sofa') {
    if (/1인|한\s*명|혼자/.test(text)) set(0, 90, '대화 추정 · 1인용');
    if (/2인|두\s*명|둘이|둘은/.test(text))
      set(0, /넉넉|여유/.test(text) ? 190 : 170, '대화 추정 · 2인용');
    if (/3인|세\s*명|셋이/.test(text)) set(0, 220, '대화 추정 · 3인용');
    if (/4인|네\s*명/.test(text)) set(0, 270, '대화 추정 · 4인용');
    if (/깊은|깊어|깊고|깊었|깊게|깊숙|푹\s*(?:앉|파묻)|깊이도 꽤/.test(text) && !/얕/.test(text))
      set(2, 100, '대화 추정 · 깊은 좌석');
  }
  if (a.type === 'bed')
    for (const [p, w] of [
      [/슈퍼\s*싱글/, 110],
      [/싱글/, 100],
      [/더블/, 140],
      [/퀸/, 150],
      [/킹/, 180],
    ])
      if (p.test(text)) {
        set(0, w, '대화 추정 · 침대 규격 가정');
        break;
      }
  for (const [p, i] of [
    [/(?:가로|너비|폭|길이)[^.!?\n]{0,12}(?:더\s*크게|더\s*길게|조금\s*늘려)/, 0],
    [/높이[^.!?\n]{0,12}(?:더\s*높게|늘려)/, 1],
    [/(?:깊이|세로)[^.!?\n]{0,12}(?:늘려|더\s*깊게)/, 2],
  ])
    if (p.test(text) && explicit[i] === undefined)
      set(i, Math.min(1500, a.dims[i] + 10), '사용자 요청 · 10cm 증가');
  for (const [p, i] of [
    [/(?:가로|너비|폭|길이)[^.!?\n]{0,12}(?:더\s*작게|줄여|짧게)|^(?:조금\s*)?(?:더\s*)?작게/, 0],
    [/높이[^.!?\n]{0,12}(?:더\s*낮게|낮춰|줄여)/, 1],
    [/(?:깊이|세로)[^.!?\n]{0,12}(?:줄여|더\s*얕게)/, 2],
  ])
    if (p.test(text.trim()) && explicit[i] === undefined && !updated.includes(i))
      set(i, Math.max(1, a.dims[i] - 10), '사용자 요청 · 10cm 감소');
  for (const [i, n] of Object.entries(explicit)) set(+i, n, '사용자 설정');
  if (/무릎/.test(text) && explicit[1] === undefined)
    return {
      item: a,
      reply:
        '무릎까지 오는 부분이 앉는 면인가요, 등받이 맨 위인가요? 전체 높이와 좌판 높이는 달라서 구분하면 좋아요. 현재 높이는 기본값으로 남겨둘게요.',
      changed: [...new Set(updated)],
    };
  const allDefault = a.sources.every((x) => x === DEFAULT_SOURCE);
  let reply = updated.length
    ? `${TYPES[a.type].name} 치수 초안을 바꿨어요. 가로 ${a.dims[0]}, 깊이 ${a.dims[2]}, 전체 높이 ${a.dims[1]}cm예요.`
    : allDefault
      ? `${TYPES[a.type].name}를 기준으로 시작할게요. 가로 ${a.dims[0]}, 깊이 ${a.dims[2]}, 전체 높이 ${a.dims[1]}cm는 유형별 기본값이에요.`
      : `지금 ${TYPES[a.type].name} 초안은 가로 ${a.dims[0]}, 깊이 ${a.dims[2]}, 전체 높이 ${a.dims[1]}cm예요. 바꿀 치수를 알려주세요.`;
  if (a.type === 'sofa' && !updated.includes(0) && a.sources[0] === DEFAULT_SOURCE)
    reply += ' 보통 몇 명이 앉나요?';
  else if (a.type === 'bed' && !updated.includes(0) && a.sources[0] === DEFAULT_SOURCE)
    reply += ' 싱글·슈퍼싱글·퀸 중 어느 크기에 가까운가요?';
  else if (allDefault || (updated.length && a.sources[2] === DEFAULT_SOURCE))
    reply += ' 깊이를 알면 “깊이 80cm”처럼 알려주세요. 모르면 이 값으로 먼저 배치해도 돼요.';
  else reply += ' 아래 도구에서 더 조절할 수 있어요.';
  return { item: a, reply, changed: [...new Set(updated)] };
}
const limits = {
  sofa: [
    [60, 450],
    [40, 160],
    [45, 200],
  ],
  bed: [
    [60, 300],
    [15, 180],
    [100, 320],
  ],
  desk: [
    [40, 350],
    [30, 150],
    [25, 180],
  ],
  chair: [
    [20, 160],
    [30, 200],
    [20, 180],
  ],
  wardrobe: [
    [20, 400],
    [50, 350],
    [15, 160],
  ],
  shelf: [
    [15, 400],
    [20, 350],
    [10, 160],
  ],
  cabinet: [
    [20, 400],
    [20, 250],
    [15, 160],
  ],
};
export function applyModelResult(raw, previous, options = {}) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw Error('모델 응답을 확인하지 못했어요.');
  const v = JSON.parse(match[0]),
    a = structuredClone(previous);
  if (typeof v.reply !== 'string' || !v.reply.trim()) throw Error('모델 응답이 비어 있어요.');
  if (typeof options.text === 'string') {
    const text = options.text;
    if (!/명|인용|혼자|둘|셋|넷|함께|식구|people|seat|person|two|three/i.test(text)) v.seats = null;
    if (!/작|아담|좁|컴팩트|크|넓|넉넉|여유|큰|보통|compact|large/i.test(text)) v.size = 'unknown';
    if (!/깊|얕|푹|depth|deep|shallow/i.test(text)) v.depth_profile = 'unknown';
    if (!/낮|높|키가|로우|하이|등받이|허리|무릎|height|low|tall/i.test(text))
      v.height_profile = 'unknown';
  }
  const proposals = {};
  if (a.type === 'sofa' && [1, 2, 3, 4].includes(v.seats))
    proposals[0] = [0, 90, 180, 220, 270][v.seats];
  if (v.size === 'compact')
    proposals[0] = {
      sofa: 140,
      bed: 100,
      desk: 90,
      chair: 40,
      wardrobe: 70,
      shelf: 60,
      cabinet: 60,
    }[a.type];
  if (v.size === 'large')
    proposals[0] = {
      sofa: 240,
      bed: 180,
      desk: 160,
      chair: 65,
      wardrobe: 160,
      shelf: 140,
      cabinet: 140,
    }[a.type];
  if (v.depth_profile === 'deep')
    proposals[2] = {
      sofa: 100,
      bed: 210,
      desk: 80,
      chair: 65,
      wardrobe: 70,
      shelf: 45,
      cabinet: 55,
    }[a.type];
  if (v.depth_profile === 'shallow')
    proposals[2] = {
      sofa: 75,
      bed: 190,
      desk: 45,
      chair: 40,
      wardrobe: 45,
      shelf: 25,
      cabinet: 30,
    }[a.type];
  if (v.height_profile === 'low')
    proposals[1] = {
      sofa: 65,
      bed: 35,
      desk: 55,
      chair: 65,
      wardrobe: 120,
      shelf: 90,
      cabinet: 55,
    }[a.type];
  if (v.height_profile === 'tall')
    proposals[1] = {
      sofa: 100,
      bed: 75,
      desk: 100,
      chair: 110,
      wardrobe: 220,
      shelf: 200,
      cabinet: 120,
    }[a.type];
  if (!limits[a.type]) {
    const presets = TYPES[a.type].presets;
    if (['compact', 'large'].includes(v.size))
      proposals[0] = presets[v.size === 'compact' ? 0 : presets.length - 1].dims[0];
    for (const [i, key, small, large] of [
      [1, 'height_profile', 'low', 'tall'],
      [2, 'depth_profile', 'shallow', 'deep'],
    ])
      if ([small, large].includes(v[key]))
        proposals[i] = Math.max(1, Math.round(a.dims[i] * (v[key] === small ? 0.8 : 1.2)));
  }
  for (const [key, i] of [
    ['width', 0],
    ['height', 1],
    ['depth', 2],
  ]) {
    const n = v[key];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      const [min, max] = (limits[a.type] || [
        [TYPES[a.type].dims[0] * 0.4, TYPES[a.type].dims[0] * 2],
        [Math.max(1, TYPES[a.type].dims[1] * 0.4), TYPES[a.type].dims[1] * 2],
        [TYPES[a.type].dims[2] * 0.4, TYPES[a.type].dims[2] * 2],
      ])[i];
      if (n < min || n > max) throw Error('AI가 제안한 치수가 가구 범위를 벗어났어요.');
      proposals[i] = n;
    }
  }
  for (const [key, n] of Object.entries(proposals)) {
    const i = +key;
    if (!Number.isFinite(n)) continue;
    if (!a.sources[i].startsWith('사용자') && !a.sources[i].startsWith('대화 추정')) {
      a.dims[i] = Math.round(n);
      a.sources[i] = 'AI 단서 · 유형별 추정';
    }
  }
  return {
    item: a,
    reply: v.reply.slice(0, 700),
    ui: UI_SURFACES.furniture.includes(v.ui) ? v.ui : null,
  };
}
