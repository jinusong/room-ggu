import { TYPES } from '../catalog.js';
import { furnitureMentions } from '../estimator.js';

// The same catalogue descriptions are shown on the comparison cards and supplied to the local model.
export const uses = {
  bed: '밤새 누워 잘 자리',
  armchair: '혼자 등받이에 기대 책 읽기',
  sofa: '여럿이 나란히 앉아 쉬기',
  desk: '노트북과 책을 펼쳐 공부하기',
  dining: '마주 앉아 식사하기',
  chair: '식탁이나 작은 책상 앞에 앉기',
  office_chair: '오래 앉아 컴퓨터로 일하기',
  bench: '둘 이상 나란히 걸터앉기',
  stool: '잠깐 걸터앉았다 치우기',
  ottoman: '앉아서 다리나 발 올리기',
  coffee: '소파 앞 낮은 곳에 찻잔 놓기',
  side: '잠자리 옆에 안경이나 휴대폰 놓기',
  tvstand: '화면과 게임기 받치기',
  wardrobe: '긴 옷을 걸어 문 안에 보관하기',
  hanger: '외투를 걸어 바로 꺼내 입기',
  dresser: '접은 옷을 서랍에 나눠 담기',
  cabinet: '생활용품을 문 안에 감춰 두기',
  shelf: '책을 꽂거나 소품 진열하기',
  shoe_cabinet: '현관에서 신발 정리하기',
  rug: '바닥에 깔아 발밑을 부드럽게 하기',
  lamp: '읽을 자리만 환하게 비추기',
  plant: '실내에서 초록 식물 기르기',
  fridge: '음식과 음료를 차갑게 보관하기',
  washer: '옷과 침구 세탁하기',
  toilet: '앉아서 용변 보기',
  basin: '손이나 얼굴 씻기',
  shower: '서서 샤워하기',
  vanity: '앉아서 화장하고 화장품 정리하기',
  mirror: '외출 전 옷차림 전체 확인하기',
  kitchen_counter: '서서 재료를 썰고 손질하기',
  island: '음식 준비와 간단한 식사를 한곳에서 하기',
  dishwasher: '그릇을 기계로 씻기',
  dryer: '젖은 옷을 기계로 말리기',
  drying_rack: '빨래를 널어 자연 건조하기',
  air_purifier: '실내 먼지를 걸러내기',
  fan: '바람을 쐬며 더위 식히기',
  standing_ac: '실내 온도 낮추기',
  piano: '건반 연습하기',
  treadmill: '실내에서 걷거나 달리기',
  cat_tower: '고양이가 높은 곳에 오르고 쉬기',
};

// Offline search terms describe activities, including activities served by more than one item.
const activities = [
  [
    /잠(?:을)?\s*(?:자|잘|청)|잠자리|숙면|수면|밤에.{0,7}누울|(?:^|\s)잘\s*(?:가구|곳|자리)|밤새.{0,10}(?:눕|누[울워])|누워.{0,8}(?:자|잘)|자고\s*싶/,
    ['bed'],
  ],
  [/공부|필기|숙제|재택\s*근무|노트북.{0,6}펼|컴퓨터로\s*(?:일|작업)/, ['desk']],
  [/식사|밥.{0,8}먹|둘러앉.{0,12}먹/, ['dining']],
  [/책.{0,6}읽|독서|기대.{0,8}(?:앉|쉬)|앉아.{0,6}쉬|영화.{0,5}보/, ['armchair', 'sofa']],
  [/외투|겉옷|코트|옷.{0,6}(?:걸|거는)/, ['hanger', 'wardrobe']],
  [/접은\s*옷|속옷/, ['dresser']],
  [/책.{0,6}(?:꽂|보관|정리|진열)/, ['shelf']],
  [/신발.{0,6}(?:보관|정리|넣)/, ['shoe_cabinet']],
  [/수납|물건.{0,8}(?:보관|정리)|소품.{0,5}정리/, ['cabinet', 'shelf', 'dresser']],
  [/음식.{0,5}(?:차갑|냉장)|음료.{0,5}(?:차갑|시원)/, ['fridge']],
  [/빨래.{0,8}(?:말리|말릴|건조)|젖은\s*옷.{0,6}말/, ['drying_rack', 'dryer']],
  [/빨래.{0,5}(?:널|너는)/, ['drying_rack']],
  [/재료.{0,8}(?:썰|손질)|음식.{0,6}준비/, ['kitchen_counter', 'island']],
  [/안경.{0,6}(?:놓|두)|머리맡.{0,10}(?:두|놓)/, ['side']],
  [/고양이.{0,15}(?:높|오르|올라|놀)/, ['cat_tower']],
  [/달리기|실내.{0,8}(?:걷|걸을|달릴)/, ['treadmill']],
  [/건반.{0,6}(?:연습|치|칠)/, ['piano']],
  [/화장(?:을|하고|할)|메이크업|화장품.{0,8}정리/, ['vanity']],
  [/식기.{0,8}(?:닦|씻)|설거지/, ['dishwasher']],
  [/빨래.{0,5}(?:빨|세탁)|옷.{0,4}세탁/, ['washer']],
  [/불빛|자리.{0,8}(?:밝힐|비출)|읽을.{0,5}밝|조도를/, ['lamp']],
  [/손.{0,5}씻|세수/, ['basin']],
  [/샤워(?:하|할)|몸.{0,5}씻/, ['shower']],
  [/바람.{0,6}(?:쐬|쐴)|더위.{0,5}식/, ['fan', 'standing_ac']],
  [/찻잔|커피잔/, ['coffee', 'side']],
  [/게임기.{0,6}(?:받치|놓|둘)|(?:티비|TV).{0,6}(?:받치|올려|올릴)/i, ['tvstand']],
  [/식물.{0,6}(?:기르|키울)|꽃.{0,6}(?:기르|심을|키우)/, ['plant']],
  [/발밑|바닥.{0,8}(?:부드럽|푹신)/, ['rug']],
  [/용변|볼일.{0,4}(?:보|볼)/, ['toilet']],
  [/오래.{0,8}앉|허리.{0,6}받쳐/, ['office_chair', 'armchair']],
  [/걸터앉|잠깐.{0,5}앉/, ['stool', 'bench']],
  [/옷차림|전신.{0,6}(?:확인|보)/, ['mirror']],
  [/발.{0,5}(?:올려|올릴|받치)/, ['ottoman']],
  [/공기.{0,6}(?:맑|깨끗)|미세\s*먼지/, ['air_purifier']],
];

export function activityTypes(text) {
  return [
    ...new Set(activities.filter(([pattern]) => pattern.test(text)).flatMap(([, types]) => types)),
  ];
}

export function purposeRequest(text) {
  if (
    /되돌|삭제|비워|회전|복제|치워|(?:이|그|저)\s*가구.{0,15}(?:고쳐|수정|옮|바꾸|줄|늘|바꿔)|(?:가구|배치)(?:를|들)?\s*(?:정리하|저장|불러)|로\s*바꿔|(?:방|공간)(?:을|으로)?\s*(?:꾸며|꾸미|만들|추가|추천)|(?:공부|독서|작업|운동|수면)할\s*(?:방|공간)|아바타/.test(
      text,
    )
  )
    return null;
  if (/^(?:어떤\s*)?가구(?:를|나)?\s*(?:놓을까|고르기|목록|보여\s*줘)[?.!]*$/.test(text.trim()))
    return null;
  const excluded = [];
  for (const mention of furnitureMentions(text)) {
    if (mention.ref) continue;
    if (/^\s*(?:은|는|이|가)?\s*(?:말고|빼고|제외)/.test(text.slice(mention.end)))
      excluded.push(mention.type);
    else return null;
  }
  // Ignore a rejected activity ("공부 말고 식사할 …") when building the shortlist.
  const parts = text.split(/말고|빼고|대신(?:에)?/);
  const tail = parts.at(-1);
  const positive = parts.length > 1 && activityTypes(tail).length ? tail : text;
  const matched = activityTypes(positive);
  // Limit suggestions to catalogue uses we can explain to the user, including terms in card copy.
  const evidence = Object.entries(uses)
    .filter(([, description]) =>
      description.split(/\s+/).some((word) => {
        const stem = word.replace(/(?:에서|으로|이나|하고|하기|기를|을|를|에|와|과|기)$/u, '');
        return (
          stem.length >= 2 &&
          !['자리', '실내', '하나', '올리', '정리', '작은', '높은', '좋은', '전체'].includes(
            stem,
          ) &&
          positive.includes(stem)
        );
      }),
    )
    .map(([type]) => type);
  const wants =
    /추천|필요|찾[아고는]|있을까|어떤\s*(?:게|걸|가구)|원해|싶[어다은]|(?:할|둘|쓸|먹을|읽을|앉을|놓을)\s*(?:만한\s*)?(?:가구|자리|것|거|곳)/;
  if (!wants.test(text) || (!matched.length && !/가구|살림살이/.test(text))) return null;
  return {
    matched: matched.filter((k) => !excluded.includes(k)),
    excluded,
    evidence: evidence.filter((k) => !excluded.includes(k)),
    hasActivity:
      (!matched.length || matched.some((k) => !excluded.includes(k))) &&
      !!positive
        .replace(
          /가구(?:를|가|는|로|나)?|하나|추천|해\s*(?:줘|주세요)|주세요|부탁해|좋은|괜찮은|어떤|아무(?:거나)?|뭐가|필요해|[^\p{L}]/gu,
          '',
        )
        .trim(),
  };
}

// For unfamiliar wording the model first identifies a household activity, then compares its furniture.
export const purposeGroups = {
  잠자기: ['bed'],
  '책상에서 공부하거나 일하기': ['desk'],
  식사: ['dining'],
  '앉아서 쉬기': ['armchair', 'sofa'],
  걸터앉기: ['stool', 'bench', 'chair'],
  '의류 정리': ['wardrobe', 'hanger', 'dresser'],
  '신발 정리': ['shoe_cabinet'],
  '수납과 진열': ['shelf', 'cabinet', 'dresser'],
  '음식 손질': ['kitchen_counter', 'island'],
  '빨래 말리기': ['dryer', 'drying_rack'],
  '읽을 곳 비추기': ['lamp'],
  '화장과 단장': ['vanity', 'mirror'],
  '물건 받치기': ['side', 'coffee', 'tvstand'],
  '발 받치기': ['ottoman'],
  '옷 빨기': ['washer'],
  '그릇 씻기': ['dishwasher'],
  운동: ['treadmill'],
  '악기 연주': ['piano'],
  '냉장 보관': ['fridge'],
  '욕실 위생': ['basin', 'shower', 'toilet'],
  '온도와 공기': ['fan', 'standing_ac', 'air_purifier'],
  '반려묘 놀이터': ['cat_tower'],
  '바닥 깔개': ['rug'],
  '식물 키우기': ['plant'],
};

export function purposePrompt(text, pool) {
  return {
    prompt:
      'Choose furniture for the activity in the Korean request. Return up to three different catalogue IDs in order of suitability. Use "none" for unused slots. If one item clearly serves the request, give only one. For an unclear or unsupported activity use none. Do not suggest furniture merely mentioned as a location.\n' +
      pool.map((k) => k + ' = ' + TYPES[k].name + ' · ' + uses[k]).join('\n') +
      '\nRequest: ' +
      text,
    pool,
  };
}

export function recommendedTypes(request, raw) {
  const inferred =
    raw && Object.hasOwn(purposeGroups, raw.activity) ? purposeGroups[raw.activity] : [];
  const allowed = request.matched.length
    ? request.matched
    : request.evidence.length
      ? request.evidence
      : inferred;
  const ranked = raw ? [raw.first, raw.second, raw.third] : request.evidence;
  const backed = request.matched.length
    ? request.matched
    : request.evidence.length === 1
      ? request.evidence
      : [];
  return [...new Set([...ranked, ...backed])]
    .filter((k) => request.hasActivity && allowed.includes(k) && !request.excluded.includes(k))
    .slice(0, 3);
}
