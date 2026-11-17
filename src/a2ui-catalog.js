import { SURFACE_KINDS } from './ui-schema.js';

export const A2UI_VERSION = '1.0';
export const CATALOG_ID = 'https://jinusong.github.io/room-ggu/a2ui/catalog.json';
const common = 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/';

// 같은 목록으로 모델의 도구 허용 목록과 공개 A2UI 카탈로그를 유지한다.
export const TOOL_COMPONENTS = Object.fromEntries(
  Object.keys(SURFACE_KINDS).map((kind) => [
    kind,
    `RoomGgu${kind
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('')}`,
  ]),
);
export const COMPONENT_KINDS = Object.fromEntries(
  Object.entries(TOOL_COMPONENTS).map(([kind, component]) => [component, kind]),
);
const id = { type: 'string', maxLength: 100 };
const target = {
  oneOf: [
    {
      type: 'object',
      properties: { type: { const: 'room' }, roomId: id },
      required: ['type'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { type: { const: 'item' }, id },
      required: ['type', 'id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { type: { const: 'draft' }, id },
      required: ['type'],
      additionalProperties: false,
    },
  ],
};

export const TOOL_CATALOG = {
  $schema: 'https://a2ui.org/specification/v1_0/catalog_definition.json',
  catalogId: CATALOG_ID,
  protocolVersion: A2UI_VERSION,
  title: '룸꾸 상담 도구',
  instructions:
    'Use the registered RoomGgu components for room and furniture editing. Targets refer to host-owned rooms, items or drafts. The host validates dimensions, collisions and edits. Never generate HTML, CSS or scripts.',
  components: Object.fromEntries(
    Object.entries(TOOL_COMPONENTS).map(([kind, name]) => [
      name,
      {
        type: 'object',
        title: SURFACE_KINDS[kind].title,
        properties: {
          component: { const: name },
          target,
          expanded: { $ref: `${common}DynamicBoolean` },
          summary: { $ref: `${common}DynamicString` },
          onOpen: { $ref: `${common}Action` },
        },
        required: ['component', 'target', 'expanded', 'summary', 'onOpen'],
        allowedParents: ['Surface'],
      },
    ]),
  ),
  functions: {},
};
