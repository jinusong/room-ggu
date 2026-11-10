// 치수 순서: 가로, 전체 높이, 깊이(cm). 시뮬레이션용 초안이며 제품 규격이 아니다.
const type = (name, icon, category, presets) => ({
  name,
  icon,
  category,
  dims: presets[Math.min(1, presets.length - 1)][1],
  presets: presets.map(([label, dims]) => ({ label, dims })),
});
export const CATEGORIES = {
  all: '전체',
  living: '거실',
  bedroom: '침실',
  work: '작업',
  dining: '다이닝',
  storage: '수납',
  decor: '소품',
  appliance: '가전',
};
export const TYPES = {
  sofa: type('소파', 'sofa', 'living', [
    ['컴팩트 2인', [140, 78, 80]],
    ['기본 2인', [180, 82, 90]],
    ['넉넉한 3인', [220, 85, 95]],
    ['와이드 4인', [270, 85, 100]],
  ]),
  armchair: type('라운지체어', 'armchair', 'living', [
    ['작은 1인', [65, 75, 70]],
    ['기본 1인', [80, 85, 80]],
    ['넉넉한 1인', [95, 90, 95]],
  ]),
  bed: type('침대', 'bed-double', 'bedroom', [
    ['싱글', [100, 55, 200]],
    ['퀸', [150, 55, 200]],
    ['슈퍼싱글', [110, 55, 200]],
    ['더블', [140, 55, 200]],
    ['킹', [180, 55, 210]],
  ]),
  desk: type('책상', 'monitor', 'work', [
    ['노트북 책상', [90, 74, 50]],
    ['기본 책상', [120, 74, 60]],
    ['넓은 책상', [160, 74, 80]],
  ]),
  dining: type('식탁', 'utensils', 'dining', [
    ['2인 식탁', [80, 74, 80]],
    ['4인 식탁', [140, 74, 80]],
    ['6인 식탁', [180, 74, 90]],
  ]),
  chair: type('의자', 'armchair', 'dining', [
    ['작은 의자', [40, 76, 43]],
    ['기본 의자', [48, 82, 50]],
    ['넉넉한 의자', [60, 90, 60]],
  ]),
  coffee: type('소파테이블', 'rectangle-horizontal', 'living', [
    ['작은 테이블', [70, 35, 45]],
    ['기본 테이블', [100, 40, 60]],
    ['넓은 테이블', [120, 40, 70]],
  ]),
  side: type('협탁', 'square', 'bedroom', [
    ['미니 협탁', [30, 45, 30]],
    ['기본 협탁', [45, 50, 40]],
    ['넓은 협탁', [60, 55, 45]],
  ]),
  tvstand: type('TV장', 'tv', 'living', [
    ['작은 TV장', [120, 45, 35]],
    ['기본 TV장', [160, 45, 40]],
    ['와이드 TV장', [200, 50, 45]],
  ]),
  wardrobe: type('옷장', 'door-closed', 'storage', [
    ['1도어', [60, 200, 55]],
    ['2도어', [100, 200, 60]],
    ['와이드', [160, 220, 60]],
  ]),
  dresser: type('서랍장', 'rows-3', 'storage', [
    ['슬림 3단', [60, 75, 40]],
    ['기본 4단', [90, 100, 45]],
    ['와이드 3단', [120, 80, 45]],
  ]),
  cabinet: type('수납장', 'archive', 'storage', [
    ['슬림 수납장', [60, 80, 35]],
    ['기본 수납장', [100, 80, 40]],
    ['와이드 수납장', [140, 90, 45]],
  ]),
  shelf: type('책장·선반', 'library', 'storage', [
    ['낮은 선반', [60, 90, 30]],
    ['기본 책장', [90, 160, 35]],
    ['높은 책장', [120, 200, 35]],
  ]),
  shoe_cabinet: type('신발장', 'archive', 'storage', [
    ['슬림 신발장', [60, 100, 25]],
    ['기본 신발장', [80, 120, 35]],
    ['높은 신발장', [100, 180, 35]],
  ]),
  bench: type('벤치', 'rectangle-horizontal', 'dining', [
    ['1인 벤치', [70, 43, 35]],
    ['2인 벤치', [110, 45, 38]],
    ['3인 벤치', [150, 45, 40]],
  ]),
  rug: type('러그', 'grid-2x2', 'decor', [
    ['작은 러그', [100, 1, 150]],
    ['기본 러그', [160, 1, 230]],
    ['큰 러그', [200, 2, 300]],
  ]),
  lamp: type('스탠드조명', 'lamp-floor', 'decor', [
    ['작은 스탠드', [30, 120, 30]],
    ['기본 스탠드', [40, 160, 40]],
    ['큰 스탠드', [50, 180, 50]],
  ]),
  plant: type('화분', 'sprout', 'decor', [
    ['작은 화분', [25, 50, 25]],
    ['중간 화분', [40, 100, 40]],
    ['큰 화분', [65, 160, 65]],
  ]),
  fridge: type('냉장고', 'refrigerator', 'appliance', [
    ['미니 냉장고', [48, 85, 50]],
    ['기본 냉장고', [70, 175, 70]],
    ['양문형', [91, 180, 85]],
  ]),
  washer: type('세탁기', 'washing-machine', 'appliance', [
    ['소형 드럼', [55, 85, 50]],
    ['기본 드럼', [60, 85, 65]],
    ['대형 드럼', [70, 98, 83]],
  ]),
};
export const ROOM_TYPES = {
  studio: {
    name: '원룸',
    icon: 'house',
    sizes: [
      [3, 3, 2.4],
      [4, 4, 2.4],
      [5, 4.5, 2.5],
    ],
  },
  living: {
    name: '거실',
    icon: 'sofa',
    sizes: [
      [4, 3.5, 2.4],
      [5.5, 4.5, 2.5],
      [7, 5, 2.7],
    ],
  },
  bedroom: {
    name: '침실',
    icon: 'bed-double',
    sizes: [
      [3, 3, 2.4],
      [4, 3.5, 2.4],
      [5, 4, 2.5],
    ],
  },
  office: {
    name: '서재',
    icon: 'monitor',
    sizes: [
      [2.5, 2.5, 2.4],
      [3.5, 3, 2.4],
      [4.5, 4, 2.5],
    ],
  },
  dining: {
    name: '다이닝룸',
    icon: 'utensils',
    sizes: [
      [3, 3, 2.4],
      [4, 3.6, 2.5],
      [5, 4.5, 2.5],
    ],
  },
  kitchen: {
    name: '주방',
    icon: 'refrigerator',
    sizes: [
      [2.5, 2.5, 2.4],
      [3.5, 3.2, 2.4],
      [4.5, 4, 2.5],
    ],
  },
  kids: {
    name: '아이 방',
    icon: 'blocks',
    sizes: [
      [3, 2.8, 2.4],
      [3.5, 3.5, 2.4],
      [4.5, 4, 2.5],
    ],
  },
};
export const WALL_COLORS = [
  ['아이보리', '#faf9f5'],
  ['웜그레이', '#d5d2cb'],
  ['세이지', '#c0cbbb'],
  ['샌드', '#e0cfb9'],
  ['블루그레이', '#bfcbd1'],
];
export const FLOOR_COLORS = [
  ['내추럴 오크', '#e0d4bf'],
  ['라이트 오크', '#eee4ce'],
  ['월넛', '#93785c'],
  ['그레이', '#babbb6'],
];
export function makeRoom(type = 'studio', size = 1) {
  const [w, d, h] = ROOM_TYPES[type].sizes[size];
  return {
    type,
    w,
    d,
    h,
    wallColor: WALL_COLORS[0][1],
    floorColor: FLOOR_COLORS[0][1],
    sources: { w: '공간 유형 기본값', d: '공간 유형 기본값', h: '공간 유형 기본값' },
  };
}
