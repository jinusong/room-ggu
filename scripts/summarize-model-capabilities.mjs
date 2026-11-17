import { readFileSync, writeFileSync } from 'node:fs';
const source = 'eval/chat/results/capabilities-v5.11.json';
const data = JSON.parse(readFileSync(source, 'utf8')),
  models = {};
for (const result of data.results) {
  const rows = result.cases;
  // 따뜻한 벽은 카탈로그의 샌드, 짙은 원목 바닥은 월넛을 기준으로 비교한다.
  for (const row of rows)
    if (row.category === '분위기') {
      row.criteria = '샌드 벽·월넛 바닥 반영';
      let raw;
      try {
        raw = JSON.parse(row.raw);
      } catch {}
      if (raw?.wall !== '샌드' || raw?.floor !== '월넛') {
        row.passed = false;
        row.error = '분위기 기준 색(샌드·월넛)과 다른 결과';
      }
    }
  if (!rows.length) {
    models[result.model] = { total: 0, status: '이번 평가에서 모델 준비 미완료' };
    continue;
  }
  const times = rows.map((c) => c.ms).sort((a, b) => a - b),
    n = times.length;
  const count = (categories) => {
    const cs = rows.filter((r) => categories.includes(r.category));
    return { passed: cs.filter((r) => r.passed).length, total: cs.length };
  };
  models[result.model] = {
    total: n,
    passed: rows.filter((c) => c.passed).length,
    corrected: rows.filter((c) => c.fixes.length).length,
    medianSeconds:
      Math.round((times[Math.floor((n - 1) / 2)] + times[Math.ceil((n - 1) / 2)]) / 200) / 10,
    basic: count(['가구', '새 가구', '방', '복수 요청']),
    atmosphere: count(['분위기']),
    house: count(['집 전체']),
  };
}
writeFileSync(source, JSON.stringify(data, null, 2) + '\n');
writeFileSync(
  'src/app/model-benchmark.json',
  JSON.stringify(
    {
      date: '2026-11-17',
      precision: 'f16',
      source,
      criteria: '앱 보정 뒤 결과. 분위기는 샌드 벽·월넛 바닥 기준.',
      models,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(models));
