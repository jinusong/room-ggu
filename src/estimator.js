import { UI_SURFACES } from './ui-schema.js';
import { TYPES, makeItem, DEFAULT_SOURCE } from './data.js';
import { sizeFields } from './dimensions.js';
import { josa } from './app/text.js';
export const aliases = {
  office_chair: /사무용\s*의자|사무\s*의자|컴퓨터\s*의자|오피스\s*체어|office\s*chair/i,
  stool: /스툴|바\s*의자|stool/i,
  ottoman: /오토만|풋스툴|발받침|ottoman/i,
  vanity: /화장대|vanity/i,
  hanger: /행거|옷걸이|옷\s*걸이|clothes\s*rack/i,
  mirror: /(?:전신\s*)?거울|mirror/i,
  kitchen_counter: /주방\s*조리대|조리대|싱크대|kitchen\s*counter/i,
  island: /아일랜드(?:\s*(?:식탁|테이블))?|island/i,
  dishwasher: /식기\s*세척기|식세기|dishwasher/i,
  dryer: /(?<!빨래\s)건조기|dryer/i,
  air_purifier: /공기\s*청정기|air\s*purifier/i,
  fan: /선풍기|서큘레이터|\bfan\b/i,
  standing_ac: /(?:스탠드\s*)?에어컨|air\s*conditioner/i,
  piano: /(?:디지털\s*)?피아노|piano/i,
  treadmill: /러닝\s*머신|런닝\s*머신|워킹패드|트레드밀|treadmill/i,
  cat_tower: /캣\s*타워|cat\s*tower/i,
  drying_rack: /빨래\s*건조대|건조대|drying\s*rack/i,

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
  toilet: /변기|toilet/i,
  basin: /세면대|세면기|wash\s*basin|basin/i,
  shower: /샤워\s*(?:부스|기|실|박스|공간)|shower/i,
  sofa: /[소쇼]\s*파|sofa|couch/i,
  bed: /침\s*[대데]|매트리스|bed|mattress/i,
  desk: /책\s*상|테이블|desk|table/i,
  chair: /의자|chair|stool/i,
  wardrobe: /옷장|장롱|wardrobe|closet/i,
  shelf: /선반|책장|shelf|bookcase|bookshelf/i,
  cabinet: /수납장|cabinet/i,
};
export function detectType(t) {
  return Object.entries(aliases).find(([, r]) => r.test(t))?.[0] || null;
}
// 문장에 나온 가구 이름을 나온 순서대로 찾는다. 긴 이름("소파 테이블")이 먼저 잡히면 그 자리는 가린다.
// ref는 "침대 옆에", "책상에 놓을"처럼 자리나 짝을 가리킬 뿐 새로 놓을 가구가 아닌 이름이다.
const FURNITURE_REF =
  /^\s*(?:바로\s*)?(?:옆|앞|뒤|위|밑|아래|맞은\s*편|근처|쪽|용(?![가-힣])|(?:이랑|랑|과|와|하고)\s*(?:어울|맞는|맞춰|같은|비슷|세트)|에\s*(?:맞|어울|놓|올려|올릴|둘|두는))/;
export function furnitureMentions(t) {
  let rest = String(t);
  const found = [];
  for (const [type, re] of Object.entries(aliases)) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of rest.matchAll(g)) {
      const end = m.index + m[0].length;
      found.push({
        type,
        index: m.index,
        end,
        ref: FURNITURE_REF.test(String(t).slice(end, end + 16)),
      });
    }
    rest = rest.replace(g, (word) => ' '.repeat(word.length));
  }
  return found.sort((a, b) => a.index - b.index);
}
export function furnitureSubjects(text) {
  return [
    ...new Set(
      furnitureMentions(text)
        .filter((m) => !m.ref)
        .map((m) => m.type),
    ),
  ];
}
// 목록에 없다고 알려진 물건. 목록에 없는 물건은 이 표에 없어도 없다고 답한다(planner.js의 unlistedPlan).
// 이 표는 이름을 바로잡고 성질을 더할 때만 쓴다: "안마의자"를 의자로 읽지 않고,
// on은 보통 다른 가구 위에 두는 물건, alt는 대신 권할 목록의 가구다.
const UNLISTED = [
  ['컴퓨터', /컴퓨터|데스크\s*톱|데스크\s*탑|본체|\bpc\b/i, { on: true, alt: ['desk'] }],
  ['모니터', /모니터|monitor/i, { on: true, alt: ['desk'] }],
  ['노트북', /노트북|랩\s*탑|laptop/i, { on: true, alt: ['desk'] }],
  ['프린터', /프린터|printer/i, { on: true, alt: ['cabinet'] }],
  ['TV', /(?:TV|티비|텔레비전)(?!\s*(?:장|stand))/i, { on: true, alt: ['tvstand'] }],
  ['게임기', /게임기|플스|닌텐도|엑스박스/, { on: true, alt: ['tvstand'] }],
  ['스피커', /스피커|speaker/i, { on: true, alt: ['shelf'] }],
  ['전자레인지', /전자\s*레인지|microwave/i, { on: true, alt: ['cabinet'] }],
  ['안마의자', /안마\s*의자|마사지\s*체어/, { alt: ['armchair'] }],
  ['가습기', /가습기/, { alt: [] }],
  ['정수기', /정수기/, { alt: [] }],
  ['자전거', /자전거|bicycle/i, { alt: [] }],
  ['커튼', /커튼|블라인드/, { alt: [] }],
  ['액자', /액자|포스터/, { alt: [] }],
  ['어항', /어항|수족관/, { alt: ['cabinet'] }],
];
// 목적어 하나가 목록에 없는 물건으로 알려진 이름인지 본다. 아니면 null.
// 이름이 낱말 끝까지 닿을 때만 본다: "컴퓨터책상"은 책상, "안마의자"는 안마의자다.
export function unlistedInfo(word) {
  for (const [name, re, info] of UNLISTED) {
    const m = String(word).match(re);
    if (m && m.index + m[0].length === word.length) return { name, ...info };
  }
  return null;
}

export function extractDimensions(t) {
  return Object.fromEntries(Object.entries(sizeFields(t).values).map(([key, x]) => [key, x.value]));
}
export function consult(text, previous, caption = '', { keepType = false } = {}) {
  const a = structuredClone(previous || makeItem());
  const type = keepType ? null : detectType(text) || (!previous ? detectType(caption) : null);
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
      if (p.test(text) && !a.sources[0].startsWith('사용자')) {
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
  // 규격·자세에서 가늠한 값은 직접 정한 값보다 우선하지 않는다.
  for (const i of updated) {
    if (
      previous?.type !== a.type ||
      !previous.sources[i].startsWith('사용자') ||
      !a.sources[i].startsWith('대화 추정')
    )
      continue;
    a.dims[i] = previous.dims[i];
    a.sources[i] = previous.sources[i];
  }
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
      ? `${josa(TYPES[a.type].name, '을/를')} 기준으로 시작할게요. 가로 ${a.dims[0]}, 깊이 ${a.dims[2]}, 전체 높이 ${a.dims[1]}cm는 유형별 기본값이에요.`
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
    proposals[0] = [0, 90, 170, 220, 270][v.seats];
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

// 카탈로그와 상담이 같은 별칭을 쓴다. 공백·영문 대소문자도 맞춰 검색한다.
export function catalogMatches(type, query) {
  const q = String(query).trim();
  if (!q) return true;
  const normalize = (s) => s.normalize('NFKC').toLowerCase().replace(/\s/g, '');
  return (
    normalize(TYPES[type].name).includes(normalize(q)) ||
    aliases[type]?.test(q) ||
    TYPES[type].presets.some((p) => normalize(p.label).includes(normalize(q)))
  );
}
