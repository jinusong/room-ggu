import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolSession, toolCatalog } from './a2ui.js';
import { A2UI_VERSION, CATALOG_ID, TOOL_CATALOG, TOOL_COMPONENTS } from './a2ui-catalog.js';
import { SURFACE_KINDS } from './ui-schema.js';

const spec = (kind = 'room-size', target = { type: 'room', roomId: 'room-1' }) => ({
  id: 'tool-1',
  kind,
  target,
});

test('공식 A2UI 코어가 19개 카탈로그 컴포넌트를 1.0 메시지로 검증·해석한다', () => {
  assert.deepEqual(toolCatalog.toJson(), TOOL_CATALOG);
  assert.equal(toolCatalog.id, CATALOG_ID);
  assert.equal(toolCatalog.protocolVersion, A2UI_VERSION);
  assert.equal(toolCatalog.components.size, 19);
  for (const kind of Object.keys(SURFACE_KINDS)) {
    const session = new ToolSession(spec(kind));
    try {
      const view = session.update(spec(kind), true, '지금 값');
      assert.equal(view.component, TOOL_COMPONENTS[kind]);
      assert.deepEqual(view.spec, spec(kind));
      assert.equal(view.expanded, true);
      assert.equal(view.summary, '지금 값');
    } finally {
      session.dispose();
    }
  }
});

test('데이터 갱신은 같은 surface의 바인딩을 바꾸고 컴포넌트를 다시 만들지 않는다', () => {
  const session = new ToolSession(spec());
  try {
    session.update(spec(), true, '4 × 5m');
    const root = session.resolver.rootNode.value;
    session.update(spec(), false, '6 × 5m');
    assert.equal(session.resolver.rootNode.value, root);
    assert.equal(session.read().expanded, false);
    assert.equal(session.read().summary, '6 × 5m');
    assert.equal(session.processor.getSurfaces().size, 1);
  } finally {
    session.dispose();
  }
});

test('room/item/draft 대상과 종류가 바뀌어도 SDK가 최신 컴포넌트 명세로 교체한다', () => {
  const session = new ToolSession(spec());
  try {
    for (const target of [
      { type: 'item', id: 'bed-1' },
      { type: 'draft', id: 'draft-1' },
      { type: 'room', roomId: 'room-2' },
    ]) {
      const next = spec('furniture-dims', target);
      assert.deepEqual(session.update(next, true, '').spec, next);
    }
  } finally {
    session.dispose();
  }
});

test('카드 다시 열기는 공식 action의 출처·시간·문맥을 포함하고 닫힌 카드는 이벤트를 보내지 않는다', async () => {
  const actions = [],
    session = new ToolSession(spec(), (message) => actions.push(message));
  const view = session.update(spec(), false, '접힘');
  await view.onOpen();
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], {
    version: '1.0',
    action: {
      name: 'open_tool',
      surfaceId: session.id,
      sourceComponentId: 'root',
      timestamp: actions[0].action.timestamp,
      context: { toolId: 'tool-1' },
    },
  });
  assert.ok(Number.isFinite(Date.parse(actions[0].action.timestamp)));
  session.dispose();
  await view.onOpen();
  assert.equal(actions.length, 1);
});

test('알 수 없는 도구·과한 ID·다른 카드 갱신은 거절하고 HTML·JS 속성은 버린다', () => {
  for (const kind of ['iframe', '__proto__', 'constructor', '<script>'])
    assert.throws(() => new ToolSession(spec(kind)));
  assert.throws(() => new ToolSession({ ...spec(), id: 'x'.repeat(101) }));
  const session = new ToolSession(spec());
  try {
    const clean = session.update(
      { ...spec(), html: '<script>', onClick: 'alert(1)' },
      true,
      'x'.repeat(10000),
    );
    assert.deepEqual(clean.spec, spec());
    assert.equal(clean.summary.length, 200);
    assert.throws(() => session.update({ ...spec(), id: 'different' }, true, ''));
    assert.deepEqual(session.read().spec, spec());
  } finally {
    session.dispose();
  }
});

test('카탈로그 밖의 컴포넌트는 표시하지 않고 다른 버전·금지된 경로는 거절한다', () => {
  const unknown = new ToolSession(spec());
  try {
    unknown.update(spec(), true, '');
    unknown.processor.processMessages({
      version: '1.0',
      updateComponents: {
        surfaceId: unknown.id,
        components: [{ id: 'root', component: 'iframe', src: 'javascript:alert(1)' }],
      },
    });
    assert.equal(unknown.resolver.rootNode.value.state, 'unknown-type');
    assert.throws(() => unknown.read());
  } finally {
    unknown.dispose();
  }
  const session = new ToolSession(spec());
  try {
    session.update(spec(), true, '');
    for (const message of [
      { version: '9.0', deleteSurface: { surfaceId: session.id } },
      {
        version: '1.0',
        updateDataModel: { surfaceId: session.id, path: '/__proto__/polluted', value: true },
      },
    ])
      assert.throws(() => session.processor.processMessages(message));
    assert.equal({}.polluted, undefined);
    assert.equal(session.read().spec.kind, 'room-size');
  } finally {
    session.dispose();
  }
});

test('대화에서 카드를 제거하면 resolver·surface가 정리되고 중복 해제도 안전하다', () => {
  for (let i = 0; i < 100; i++) {
    const session = new ToolSession({ ...spec(), id: `card-${i}` });
    session.update({ ...spec(), id: `card-${i}` }, true, '');
    session.dispose();
    session.dispose();
    assert.equal(session.resolver.disposed, true);
    assert.equal(session.processor.getSurfaces().size, 0);
    assert.throws(() => session.update({ ...spec(), id: `card-${i}` }, true, ''));
  }
});
