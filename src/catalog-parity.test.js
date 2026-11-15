import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SURFACE_KINDS, MODEL_UI, MODEL_ACTIONS, validateSurfaceSpec } from './ui-schema.js';

// 카탈로그(SURFACE_KINDS)는 모델·대화 기록과 화면 구성요소 사이의 계약이다.
// 한쪽에만 있는 이름이 생기면 저장된 대화의 도구가 빈 칸으로 열리므로 소스끼리 맞는지 검사한다.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const keysOf = (source, name) => {
  const body = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`))?.[1];
  assert.ok(body, `${name} 정의를 찾지 못했어요`);
  return [...body.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_][\w]*))\s*:/gm)].map((m) => m[1] || m[2]);
};
const surfaces = read('./ui/surfaces.jsx'),
  store = read('./app/store.js'),
  icons = read('./ui/icons.js'),
  composer = read('./ui/Composer.jsx');
const kinds = Object.keys(SURFACE_KINDS);

test('카탈로그의 모든 도구에 화면 구성요소가 있고 남는 구성요소가 없다', () => {
  assert.deepEqual(keysOf(surfaces, 'BODIES').sort(), [...kinds].sort());
});
test('모든 도구에 제목·아이콘이 있고 아이콘은 실제로 등록돼 있다', () => {
  for (const [kind, meta] of Object.entries(SURFACE_KINDS)) {
    assert.ok(meta.title && meta.icon && ['app', 'room', 'furniture'].includes(meta.scope), kind);
    assert.ok(
      icons.includes(`'${meta.icon}':`) || new RegExp(`\\b${meta.icon}:`).test(icons),
      `${kind} 아이콘 ${meta.icon}`,
    );
  }
});
test('직접 여는 도구에는 안내 문장이 있고 + 메뉴는 카탈로그에 있는 도구만 연다', () => {
  const texts = keysOf(store, 'TOOL_TEXT');
  for (const kind of kinds) assert.ok(texts.includes(kind), `${kind} 안내 문장`);
  const menu = [...composer.matchAll(/\['([a-z-]+)', '[^']+', '[a-z0-9-]+'\]/g)].map((m) => m[1]);
  assert.ok(menu.length >= 12);
  for (const kind of menu) assert.ok(kind === 'photo' || kinds.includes(kind), `메뉴 항목 ${kind}`);
});
test('모델이 고를 수 있는 값은 카탈로그 안에만 있고 그 밖의 이름은 버린다', () => {
  for (const kind of Object.values(MODEL_UI)) assert.ok(kinds.includes(kind), kind);
  assert.equal(new Set(MODEL_ACTIONS).size, MODEL_ACTIONS.length);
  for (const kind of ['script', 'html', '__proto__', 'constructor', 'Avatar'])
    assert.equal(validateSurfaceSpec({ kind, target: { type: 'room' } }), null);
  assert.deepEqual(validateSurfaceSpec({ kind: 'avatar', target: { type: 'room' }, html: '<b>' }), {
    kind: 'avatar',
    target: { type: 'room' },
  });
});
