import { freshState, makeItem, validateState } from '../../src/data.js';
import { makeRoom } from '../../src/catalog.js';

// 기대하는 배치 상태. tuning은 원인 분석, holdout은 수정 뒤 확인에 사용한다.
// dims: 가로·높이·깊이(cm), 방 치수: 가로·세로·높이(m).
export const cases = {
  tuning: [
    {
      id: 'mixed-units',
      turns: [
        {
          text: '침대 깊이 2050mm, 높이 0.52m에 가로 158.5센치로 해죠',
          expect: { draft: ['bed', 158.5, 52, 205] },
          model: { intent: 'furniture', furniture: 'bed' },
        },
      ],
    },
    {
      id: 'decimal-compound',
      turns: [
        {
          text: '방 세로 4.2m 가로 520cm로 바꾸고, 책상 하나 깊이 0.65m 가로 125.5cm로 추가해줘',
          expect: { room: [5.2, 4.2, 2.5], draft: ['desk', 125.5, null, 65] },
        },
      ],
    },
    {
      id: 'negative-room-and-followup',
      seed: 'beds',
      turns: [
        {
          text: '안방 침대 말고 작은방 침대 가로 180cm로 해줘',
          expect: { bed: ['small-bed', 180, 55, 210], active: 'small', kept: ['main-bed'] },
          model: { intent: 'furniture', furniture: 'bed' },
        },
        {
          text: '아니, 180 말고 160',
          expect: { bed: ['small-bed', 160, 55, 210], active: 'small', kept: ['main-bed'] },
          model: { intent: 'furniture' },
        },
        {
          text: '아까 그거 10cm만 줄여줘',
          expect: { bed: ['small-bed', 150, 55, 210], active: 'small', kept: ['main-bed'] },
          model: { intent: 'furniture' },
        },
      ],
    },
    {
      id: 'duplicate-target',
      seed: 'double',
      turns: [
        { text: '안방 침대 너비 155cm로 바꿔줘', expect: { unchanged: true, ask: '고르|골라' } },
      ],
    },
    {
      id: 'room-switch',
      seed: 'beds',
      turns: [
        {
          text: '작은방으로 이동해줘',
          expect: { active: 'small', unchanged: true },
          model: { action: 'switch_space' },
        },
        {
          text: '침대 높이는 61로 해줘',
          expect: { bed: ['small-bed', 140, 61, 210], kept: ['main-bed'] },
          model: { intent: 'furniture', furniture: 'bed' },
        },
      ],
    },
    {
      id: 'preserve-and-count',
      seed: 'sofa',
      turns: [
        {
          text: '소파는 그대로 두고 책상 두 개만 추가해줘',
          expect: { kept: ['sofa'], draft: ['desk'], queue: ['desk'] },
          place: { count: { desk: 2, sofa: 1 }, undo: true },
        },
      ],
    },
    {
      id: 'clear-plus-ambiguous',
      seed: 'sofa',
      turns: [
        {
          text: '바닥은 월넛으로 하고 좀 더 아늑하게 해줘',
          expect: { floor: '#93785c', room: [5, 5, 2.5], kept: ['sofa'], ask: '벽|가구|조명' },
        },
        { text: '침대 옆을 넓게', expect: { unchanged: true, ask: '어느|어떤|통로' } },
      ],
    },
    {
      id: 'area',
      turns: [
        { text: '방 5.5평쯤 되게 해줘', expect: { area: 18.1819 }, model: { intent: 'room' } },
      ],
    },
    {
      id: 'conflicting-units',
      seed: 'beds',
      turns: [
        {
          text: '안방 침대 가로 160cm, 같은 가로 1.8m',
          expect: { unchanged: true, ask: '어느|어떤|하나' },
        },
      ],
    },
    {
      id: 'impossible-batch',
      seed: 'tight',
      turns: [
        {
          text: '책상 두 개만 추가해줘',
          expect: { draft: ['desk'], queue: ['desk'] },
          place: { unchanged: true },
        },
      ],
    },
  ],
  holdout: [
    {
      id: 'reordered',
      turns: [
        {
          text: '쇼파 높이 740밀리미터 세로 0.92미터 너비 181.5 cm면 돼',
          expect: { draft: ['sofa', 181.5, 74, 92] },
          model: { intent: 'furniture', furniture: 'sofa' },
        },
      ],
    },
    {
      id: 'equivalent-units',
      seed: 'beds',
      turns: [
        {
          text: '안방 침대 가로 1.65미터, 너비 1650mm 맞춰주라',
          expect: { bed: ['main-bed', 165, 55, 210], kept: ['small-bed'] },
        },
      ],
    },
    {
      id: 'cross-target',
      seed: 'beds',
      turns: [
        {
          text: '작은방 침대 말구 안방 침대 세로를 2200mm로',
          expect: { bed: ['main-bed', 160, 55, 220], active: 'main', kept: ['small-bed'] },
        },
        {
          text: '앗 2200 말고 2150이야',
          expect: { bed: ['main-bed', 160, 55, 215], kept: ['small-bed'] },
        },
      ],
    },
    {
      id: 'keep-protected',
      seed: 'sofa',
      turns: [
        {
          text: '소파 건들지 말고 의자 3개만 들여줘',
          expect: { kept: ['sofa'], draft: ['chair'], queue: ['chair', 'chair'] },
          place: { count: { chair: 3, sofa: 1 }, undo: true },
        },
      ],
    },
    {
      id: 'ambiguous-axis',
      seed: 'beds',
      turns: [
        { text: '안방 침대 5cm만 줄여줘', expect: { unchanged: true, ask: '어느 치수|중 어느' } },
      ],
    },
    {
      id: 'ambiguous-layout',
      seed: 'beds',
      turns: [
        {
          text: '침대 옆 좀 널찍했으면 좋겠어',
          expect: { unchanged: true, ask: '어느|어떤|통로' },
        },
      ],
    },
  ],
};

const item = (type, id, dims, x, z) => ({ ...makeItem(type), id, dims, x, z });

export function seed(mode) {
  const state = {
    ...freshState(),
    roomId: 'main',
    name: '안방',
    roomOrder: ['main'],
    items: [],
    otherRooms: [],
    view: '3d',
    scope: 'room',
    room: { ...makeRoom('bedroom'), w: 5, d: 5, h: 2.5 },
    floorplan: { positions: { main: { x: 0, z: 0 } } },
  };
  if (mode === 'beds' || mode === 'double') {
    state.items = [item('bed', 'main-bed', [160, 55, 210], -1.1, 0)];
    if (mode === 'double') state.items.push(item('bed', 'second-bed', [135, 60, 210], 1.3, 0));
    state.otherRooms = [
      {
        roomId: 'small',
        name: '작은방',
        room: { ...state.room },
        items: [item('bed', 'small-bed', [140, 55, 210], 0, 0)],
      },
    ];
    state.roomOrder.push('small');
    state.floorplan.positions.small = { x: 5, z: 0 };
  }
  if (mode === 'sofa') state.items = [item('sofa', 'sofa', [180, 80, 85], 0, -1.75)];
  if (mode === 'tight') Object.assign(state.room, { w: 1.6, d: 1, h: 2.5 });
  return validateState(state);
}
