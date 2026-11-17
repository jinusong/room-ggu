import { Catalog } from '@a2ui/web_core/catalog';
import { MessageProcessor } from '@a2ui/web_core/processing';
import { NodeResolver, ResolvedBinding } from '@a2ui/web_core/resolution';
import { validateSurfaceSpec } from './ui-schema.js';
import {
  A2UI_VERSION,
  CATALOG_ID,
  TOOL_CATALOG,
  TOOL_COMPONENTS,
  COMPONENT_KINDS,
} from './a2ui-catalog.js';

export const toolCatalog = Catalog.fromJson(TOOL_CATALOG);
const valueOf = (value) => (value instanceof ResolvedBinding ? value.value : value);

// 한 카드의 수명 동안 공식 코어가 생성·갱신·바인딩·이벤트·삭제를 처리한다.
// 외부 wire JSON은 받지 않는다. 검증한 모델 계획/사용자 도구만 이 어댑터에 들어온다.
export class ToolSession {
  constructor(spec, onOpen = () => {}) {
    this.spec = this.clean(spec);
    this.id = `tool-${this.spec.id}`;
    this.closed = false;
    this.lastData = '';
    this.lastComponent = '';
    this.processor = new MessageProcessor(
      [toolCatalog],
      (action) => {
        if (
          !this.closed &&
          action.name === 'open_tool' &&
          action.surfaceId === this.id &&
          action.sourceComponentId === 'root' &&
          action.context.toolId === this.spec.id
        )
          return onOpen({ version: A2UI_VERSION, action });
      },
      { version: A2UI_VERSION },
    );
    this.processor.processMessages({
      version: A2UI_VERSION,
      createSurface: { surfaceId: this.id, catalogId: CATALOG_ID, sendDataModel: false },
    });
    this.resolver = new NodeResolver(this.processor.getSurface(this.id));
  }

  clean(spec) {
    const clean = validateSurfaceSpec(spec);
    if (!clean?.id) throw Error('도구 정보를 읽지 못했어요. 도구를 다시 열어 주세요.');
    return clean;
  }

  update(spec, expanded, summary) {
    if (this.closed) throw Error('닫힌 도구예요. 도구를 다시 열어 주세요.');
    const clean = this.clean(spec);
    if (clean.id !== this.spec.id) throw Error('다른 도구의 정보를 적용할 수 없어요.');
    const component = {
      id: 'root',
      component: TOOL_COMPONENTS[clean.kind],
      target: clean.target,
      expanded: { '@path': '/expanded' },
      summary: { '@path': '/summary' },
      onOpen: { event: { name: 'open_tool', context: { toolId: clean.id } } },
    };
    const data = { expanded: !!expanded, summary: String(summary || '').slice(0, 200) };
    const componentJSON = JSON.stringify(component),
      dataJSON = JSON.stringify(data);
    // 상한이 있는 앱 생성 메시지만 SDK의 스키마 검증으로 전달한다.
    const messages = [];
    if (dataJSON !== this.lastData)
      messages.push({
        version: A2UI_VERSION,
        updateDataModel: { surfaceId: this.id, value: data },
      });
    if (componentJSON !== this.lastComponent)
      messages.push({
        version: A2UI_VERSION,
        updateComponents: { surfaceId: this.id, components: [component] },
      });
    if (messages.length) this.processor.processMessages(messages);
    this.spec = clean;
    this.lastComponent = componentJSON;
    this.lastData = dataJSON;
    return this.read();
  }

  read() {
    const node = this.resolver.rootNode.value;
    if (!node || node.state !== 'resolved' || !Object.hasOwn(COMPONENT_KINDS, node.type))
      throw Error('도구를 준비하지 못했어요. 다시 열어 주세요.');
    const props = node.props.value;
    return {
      spec: { id: this.spec.id, kind: COMPONENT_KINDS[node.type], target: props.target },
      expanded: valueOf(props.expanded),
      summary: valueOf(props.summary),
      onOpen: props.onOpen,
      component: node.type,
      surfaceId: this.id,
    };
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.resolver.dispose();
    this.processor.processMessages({
      version: A2UI_VERSION,
      deleteSurface: { surfaceId: this.id },
    });
    this.processor.dispose();
  }
}
