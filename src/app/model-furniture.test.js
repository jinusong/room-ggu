import test from 'node:test';
import assert from 'node:assert/strict';
import { compactConsultationGrammar, furnitureNameEvidence } from './model-furniture.js';

test('요청에 실제 나온 가구 이름과 위치 기준을 각각 연결한다', () => {
  assert.deepEqual(furnitureNameEvidence('책상 옆에 오피스 체어하고 선반 하나'), {
    targets: ['"office_chair" (오피스 체어)', '"shelf" (선반)'],
    references: ['책상'],
  });
});

test('같은 가구의 이름을 반복해도 프롬프트에는 한 번 기록한다', () => {
  assert.deepEqual(furnitureNameEvidence('신발장, 신발장 폭은 85cm'), {
    targets: ['"shoe_cabinet" (신발장)'],
    references: [],
  });
});

test('포괄적인 이름과 미지원 가구 이름만 있으면 이름 단서를 만들지 않는다', () => {
  for (const text of ['식사할 테이블 하나', '트램펄린 하나', '침대 옆에 맞는 걸 추천해 줘'])
    assert.equal(furnitureNameEvidence(text), null);
});

test('한 줄 양식의 가구 유형 선택지와 JSON 값 형식은 기존 스키마를 따른다', () => {
  const schema = {
    required: ['furniture', 'seats', 'reply'],
    properties: {
      furniture: { enum: ['none', 'bed', 'side', 'shoe_cabinet'] },
      seats: { enum: [1, 2, null] },
      reply: { type: 'string' },
    },
  };
  const [root, string] = compactConsultationGrammar(schema).split('\n');
  assert.equal(
    root,
    String.raw`root ::= "{" "\"furniture\":" ("\"none\"" | "\"bed\"" | "\"side\"" | "\"shoe_cabinet\"") "," "\"seats\":" ("1" | "2" | "null") "," "\"reply\":" json-string "}"`,
  );
  assert.match(string, /^json-string ::= /);
});
