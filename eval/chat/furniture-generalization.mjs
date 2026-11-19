// 기대 종류를 수정 전에 정한 새 문장. 이 파일의 문장은 상담 프롬프트에 사용하지 않는다.
const cases = (entries) =>
  entries.map(([id, text, type, dims = []]) => ({
    id,
    turns: [{ text, model: { furniture: type }, expect: { draft: [type, ...dims] } }],
  }));

export const namedFurniture = cases([
  ['new-drawers', '옷장 말고 가로 105cm짜리 서랍장으로 준비해줘', 'dresser', [105]],
  ['new-side', '침대 바로 옆에 폭 36cm 사이드 테이블 하나 두고 싶어', 'side', [36]],
  ['new-shoes', '복도 쪽에 깊이가 280mm인 신발장을 보고 싶어', 'shoe_cabinet', [null, null, 28]],
  ['new-dining', '밥 먹는 다이닝 테이블 폭 1.45m로 하나 들이고 싶어', 'dining', [145]],
  ['new-office', '책상 앞에 사무용 의자, 높이는 940mm로 부탁해', 'office_chair', [null, 94]],
  ['new-coffee', '거실에 놓을 소파 테이블은 폭이 85cm쯤이면 돼', 'coffee', [85]],
  ['new-shelf', '책상 옆에 깊이 290mm 책장을 두고 싶어', 'shelf', [null, null, 29]],
  ['new-laundry', '빨래 건조대 가로 1.2m로 하나 잡아줘', 'drying_rack', [120]],
  ['new-wash', '싱크대 옆에 너비 60cm짜리 식세기가 필요해', 'dishwasher', [60]],
  ['new-rug', '침대 아래쪽에 가로 170cm 러그 하나 둘래', 'rug', [170]],
  ['new-console', '티비 장 깊이는 410mm 정도로 하나 잡아줘', 'tvstand', [null, null, 41]],
  ['new-mirror', '화장대 옆에는 높이 1.6m 전신 거울을 둘래', 'mirror', [null, 160]],
]);

export const unnamedFurniture = cases([
  ['use-sleep', '한 사람이 누워서 잘 가구 하나가 필요해', 'bed'],
  ['use-recline', '혼자 푹 기대 앉아서 책을 읽을 가구를 추천해 줘', 'armchair'],
  ['use-computer', '노트북 펼쳐서 공부할 만한 가구 하나 보여줘', 'desk'],
  ['use-dining', '여럿이 둘러앉아 같이 밥 먹을 만한 가구 하나 추천해줘', 'dining'],
]);

// 역할 단서를 수정한 뒤 확인할 별도 문장. 전에 돌린 문장과 섞어 조정하지 않는다.
export const transferFurniture = cases([
  ['transfer-side', '소파 옆엔 폭 44센티인 협탁 하나면 좋겠어', 'side', [44]],
  ['transfer-dresser', '침대 맞은편에 가로 0.9미터 서랍장 하나', 'dresser', [90]],
  ['transfer-shoes', '현관 쪽에 높이 1120mm 신발장으로 해줘', 'shoe_cabinet', [null, 112]],
  ['transfer-dining', '아일랜드 옆에 너비 1.35m 식탁을 더 두자', 'dining', [135]],
  ['transfer-fridge', '싱크대 옆에 폭 72센티 냉장고 하나 둘래', 'fridge', [72]],
  ['transfer-hanger', '거울 옆에 가로 110cm 옷걸이가 필요해', 'hanger', [110]],
  ['transfer-vanity', '서랍장 뒤쪽에 폭 78cm 화장대를 둘래', 'vanity', [78]],
  ['transfer-cat', '소파 바로 옆에 높이 1.44m 캣 타워 하나 두고 싶어', 'cat_tower', [null, 144]],
]);
