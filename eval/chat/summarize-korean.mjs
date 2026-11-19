// Pass the eight per-model JSON files from korean-qa. Console output keeps the comparison reproducible.
import { readFileSync } from 'node:fs';
import { cases, seed } from './korean-cases.mjs';

const ordered = (values) => values.slice().sort((a, b) => a - b);
function pairs(values) {
  const sorted = ordered(values);
  const n = sorted.length;
  return {
    n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
  };
}
const fixtures = new Map([...cases.tuning, ...cases.holdout].map((c) => [c.id, seed(c.seed)]));
const holdoutIds = new Set(cases.holdout.map((c) => c.id));

for (const file of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const rows = r.cases;
  const turns = rows.filter((c) => c.calls.length > 0);
  const countModel = (key) => {
    const scored = rows.filter((c) => typeof c.modelMatch?.[key] === 'boolean');
    return [scored.filter((c) => c.modelMatch[key]).length, scored.length];
  };
  const areaOrDims = rows.filter(
    (c) => c.expected.room || c.expected.bed || c.expected.area || c.expected.draft?.length > 1,
  );
  const dimensions = (c) => {
    const e = c.expected;
    const active = c.state.find((room) => room.roomId === c.active)?.room;
    const bed = c.state.flatMap((room) => room.items).find((i) => i.id === e.bed?.[0]);
    return (
      (!e.room || e.room.every((n, i) => n === [active.w, active.d, active.h][i])) &&
      (!e.area || Math.abs((active.w * active.d) / e.area - 1) < 0.02) &&
      (!e.bed || e.bed.slice(1).every((n, i) => n === bed?.dims[i])) &&
      (!e.draft || e.draft.slice(1).every((n, i) => n === null || n === c.draft?.dims[i]))
    );
  };
  const target = rows.filter((c) => c.expected.bed || c.expected.active || c.expected.draft);
  const bedIn = (rooms, id) => rooms.flatMap((r) => r.items).find((i) => i.id === id);
  const matchesBedTarget = (c) => {
    if (!c.expected.bed) return true;
    const seed = fixtures.get(c.id);
    const at = rows.indexOf(c);
    const prior =
      at > 0 && rows[at - 1].id === c.id ? rows[at - 1].state : [seed, ...seed.otherRooms];
    const id = c.expected.bed[0];
    const before = bedIn(prior, id);
    const after = bedIn(c.state, id);
    return !!after && after.dims.some((value, i) => value !== before?.dims[i]);
  };
  const matchingTarget = (c) =>
    matchesBedTarget(c) &&
    (!c.expected.active || c.active === c.expected.active) &&
    (!c.expected.draft || c.expected.draft[0] === c.draft?.type);
  const holdout = rows.filter((c) => holdoutIds.has(c.id));
  console.log(
    JSON.stringify({
      model: r.model,
      build: r.build,
      id: r.environment?.id,
      error: r.error,
      prepareMs: r.prepareMs,
      total: rows.length,
      passed: rows.filter((c) => c.passed).length,
      holdout: [holdout.filter((c) => c.passed).length, holdout.length],
      rawIntent: countModel('intent'),
      rawFurniture: countModel('furniture'),
      rawAction: countModel('action'),
      appTarget: [target.filter(matchingTarget).length, target.length],
      appDimensions: [areaOrDims.filter(dimensions).length, areaOrDims.length],
      actualModel: rows.filter((c) => ['gemma', 'qwen'].includes(c.engine)).length,
      fixed: rows.filter((c) => c.fixes.length).length,
      fallback: rows.filter((c) => c.fallback).length,
      questions: [
        rows.filter((c) => c.expected.ask && c.passed).length,
        rows.filter((c) => c.expected.ask).length,
      ],
      placement: [
        rows.filter((c) => c.placement).length,
        rows.filter((c) => c.placement !== undefined).length,
      ],
      retry: rows.reduce((n, c) => n + c.retries, 0),
      latencyMs: pairs(turns.map((c) => c.ms)),
      promptChars: pairs(turns.map((c) => c.usage?.promptChars).filter(Number.isFinite)),
      promptTokens: pairs(turns.map((c) => c.usage?.prompt_tokens).filter(Number.isFinite)),
      completionTokens: pairs(turns.map((c) => c.usage?.completion_tokens).filter(Number.isFinite)),
      gridMs: pairs(turns.map((c) => c.gridMs).filter(Number.isFinite)),
      rafMs: pairs(turns.flatMap((c) => c.frameMs || [])),
      longTasks: turns.flatMap((c) => c.longTasks || []).length,
      pageErrors: r.pageErrors.length,
    }),
  );
}
