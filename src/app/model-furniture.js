import { furnitureMentions, unlistedInfo } from '../estimator.js';

// 번역할 이름만 제공한다. 모델 스키마·응답과 기존 배치 검증은 그대로 사용한다.
export function furnitureNameEvidence(text) {
  const targets = new Map();
  const references = new Map();
  for (const { type, index, end, ref } of furnitureMentions(text)) {
    const name = text.slice(index, end);
    // 단독 “테이블”, “스탠드”는 여러 종류로 쓰인다. 구체적인 이름이 없으면 모델이 용도를 읽는다.
    if (/^(?:테이블|table|스탠드)$/i.test(name)) continue;
    // 이름이 미지원 가구에 들어 있는 경우도 있다(“안마의자”의 “의자”).
    if (unlistedInfo(text.slice(Math.max(0, index - 8), end))) continue;
    const group = ref ? references : targets;
    if (!group.has(type)) group.set(type, ref ? name : `"${type}" (${name})`);
  }
  if (!targets.size) return null;
  return { targets: [...targets.values()], references: [...references.values()] };
}

// 기존 스키마의 필드와 선택지를 같은 순서로 쓰고, JSON 구조 사이의 공백만 뺀다.
export function compactConsultationGrammar(schema) {
  const terminal = (value) => JSON.stringify(value);
  const quoted = String.raw`json-string ::= "\"" ([^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]))* "\""`;
  const fields = schema.required.map((key) => {
    const choices = schema.properties[key].enum;
    const value = choices
      ? `(${choices.map((choice) => terminal(JSON.stringify(choice))).join(' | ')})`
      : 'json-string';
    return `${terminal(JSON.stringify(key) + ':')} ${value}`;
  });
  return `root ::= "{" ${fields.join(' "," ')} "}"\n${quoted}`;
}
