import benchmark from './model-benchmark.json' with { type: 'json' };
export const MODEL_USAGE = {
  large: '가구와 방 편집, 분위기 해석, 집 전체 초안, 대화 답문',
  light: '가구와 방 편집, 분위기 해석, 집 전체 초안, 대화 답문',
  qwen: '가구와 방 편집, 분위기 해석, 집 전체 초안, 앱이 답문 작성',
  balanced: '가구와 방 편집, 분위기 해석, 집 전체 초안, 대화 답문',
};
export function modelEvidence(key) {
  const row = benchmark.models[key];
  if (!row) return '이 버전의 실제 모델 검증 전';
  if (!row.total) return row.status;
  return `실제 요청 ${row.passed}/${row.total} 확인, 앱 보정 ${row.corrected}건, 응답 중앙값 ${row.medianSeconds}초`;
}
export const MODEL_EVIDENCE_CONTEXT =
  '2026-11-17에 f16을 지원하는 평가 기기에서 앱 보정을 포함해 쟀어요. 같은 6문장을 비교했으며 분위기는 샌드 벽과 월넛 바닥 기준이에요. 기기와 문장에 따라 결과가 달라요.';

export function modelCoverage(key) {
  const row = benchmark.models[key];
  if (!row?.total) return '지원 도구는 같아요. 실제 준비와 추론은 아직 확인하지 못했어요';
  const score = (r) => `${r.passed}/${r.total}`;
  return `가구, 방, 복수 요청 ${score(row.basic)}, 분위기 ${score(row.atmosphere)}, 집 전체 ${score(row.house)}`;
}
export function modelCaution(key) {
  const row = benchmark.models[key];
  return row?.atmosphere?.passed < row?.atmosphere?.total
    ? '분위기 요청이 기준 색과 달랐어요. 색 이름을 구체적으로 정해 주세요.'
    : '';
}
