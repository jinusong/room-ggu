// 상담 모델이 고를 수 있는 동작과 도구. 앱이 이 목록으로 검증한 뒤 실제 상태에 연결한다.
export const MODEL_ACTIONS = [
  'none',
  'place',
  'undo',
  'redo',
  'rotate',
  'duplicate',
  'delete',
  'relocate',
  'clear',
  'example',
  'catalog',
  'spaces',
  'items',
  'files',
  'help',
  'ai',
  'new_space',
  'switch_space',
];
export const MODEL_UI = {
  room_size: 'room-size',
  room_type: 'room-type',
  finishes: 'finishes',
  furniture_sizes: 'furniture-size',
  furniture_dims: 'furniture-dims',
  furniture_color: 'furniture-color',
};

// 규칙 기반 대체 경로가 고르는 UI 값.
export const UI_SURFACES = {
  room: ['dimensions', 'types', 'finishes'],
  furniture: ['dimensions', 'sizes', 'colors'],
};
export function chooseSurface(text, scope) {
  if (scope === 'room') {
    if (/벽|바닥|마감|색상|색깔/.test(text)) return 'finishes';
    if (/가로|세로|천장|높이|평|m²|제곱|치수|크기/.test(text)) return 'dimensions';
    return 'types';
  }
  if (/색상|색깔|색을|컬러/.test(text)) return 'colors';
  if (/가로|세로|깊이|높이|너비|치수|\d\s*(?:cm|mm|m)/i.test(text)) return 'dimensions';
  return 'sizes';
}
export function validateSurface(value, scope, fallback = 'dimensions') {
  const allowed = Object.hasOwn(UI_SURFACES, scope) ? UI_SURFACES[scope] : [];
  return allowed.includes(value) ? value : allowed.includes(fallback) ? fallback : 'dimensions';
}

// 앱이 렌더링할 수 있는 전체 컴포넌트 목록. `model` 값이 있는 컴포넌트만 모델이 고를 수 있다.
// 나머지는 규칙 기반 상담이나 사용자의 직접 호출로만 열린다.
export const SURFACE_KINDS = {
  avatar: { scope: 'app', title: '내 키로 크기 비교', icon: 'person-standing' },
  floorplan: { scope: 'app', title: '집 전체 평면도', icon: 'house' },
  'room-size': { scope: 'room', model: 'dimensions', title: '방 크기', icon: 'ruler' },
  'room-type': { scope: 'room', model: 'types', title: '공간 유형', icon: 'layout-grid' },
  finishes: { scope: 'room', model: 'finishes', title: '벽과 바닥', icon: 'paint-roller' },
  'furniture-size': { scope: 'furniture', model: 'sizes', title: '규격 비교', icon: 'columns-3' },
  'furniture-dims': {
    scope: 'furniture',
    model: 'dimensions',
    title: '치수 직접 입력',
    icon: 'ruler',
  },
  'furniture-color': { scope: 'furniture', model: 'colors', title: '가구 색상', icon: 'palette' },
  catalog: { scope: 'app', title: '가구 고르기', icon: 'armchair' },
  impact: { scope: 'app', title: '배치 확인', icon: 'triangle-alert' },
  spaces: { scope: 'app', title: '내 공간', icon: 'layers' },
  items: { scope: 'app', title: '이 방의 가구', icon: 'list' },
  photo: { scope: 'app', title: '가구 사진', icon: 'image' },
  ai: { scope: 'app', title: '이 기기의 AI', icon: 'cpu' },
  files: { scope: 'app', title: '저장과 불러오기', icon: 'folder-open' },
  help: { scope: 'app', title: '사용 방법', icon: 'circle-help' },
};

// 모델이 고른 값(dimensions 등)을 실제 컴포넌트 이름으로 바꾼다. 허용되지 않으면 null.
export function surfaceKind(scope, value) {
  if (!Object.hasOwn(UI_SURFACES, scope) || !UI_SURFACES[scope].includes(value)) return null;
  return (
    Object.entries(SURFACE_KINDS).find(([, s]) => s.scope === scope && s.model === value)?.[0] ||
    null
  );
}

// 대화 기록·저장소에서 읽은 컴포넌트 명세를 허용된 필드만 남겨 복원한다.
export function validateSurfaceSpec(spec) {
  if (!spec || typeof spec !== 'object' || !Object.hasOwn(SURFACE_KINDS, spec.kind)) return null;
  const t = spec.target;
  let target = { type: 'room' };
  if (t && t.type === 'room' && typeof t.roomId === 'string' && t.roomId.length <= 100)
    target = { type: 'room', roomId: t.roomId };
  else if (t && t.type === 'draft')
    target =
      typeof t.id === 'string' && t.id.length <= 100
        ? { type: 'draft', id: t.id }
        : { type: 'draft' };
  else if (t && t.type === 'item' && typeof t.id === 'string' && t.id.length <= 100)
    target = { type: 'item', id: t.id };
  const id = typeof spec.id === 'string' && spec.id.length <= 100 ? spec.id : undefined;
  return { ...(id ? { id } : {}), kind: spec.kind, target };
}
