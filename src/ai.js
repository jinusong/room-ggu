let serial = 0;
const workers = new Map();
const pending = new Map();
let listener = () => {};
export function onAIStatus(fn) {
  listener = fn;
}
function getWorker(lane) {
  if (workers.has(lane)) return workers.get(lane);
  // 같은 실행 코드를 쓰되 큐와 메모리는 나눈다. Gemma를 받는 동안에도 SigLIP을 실행한다.
  const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  workers.set(lane, worker);
  worker.onmessage = ({ data }) => {
    if (workers.get(lane) !== worker) return;
    if (data.event) {
      listener(data);
      return;
    }
    const p = pending.get(data.id);
    if (!p || p.lane !== lane) return;
    pending.delete(data.id);
    data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
  };
  worker.onerror = () => {
    if (workers.get(lane) !== worker) return;
    stopAI('AI 작업을 시작하지 못했어요. 브라우저를 새로 열고 다시 시도해주세요.', lane, {
      failed: true,
    });
  };
  return worker;
}
export function runAI(task, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const lane = task === 'classify' ? 'vision' : 'text';
    pending.set(id, { resolve, reject, lane });
    try {
      getWorker(lane).postMessage({ id, task, payload });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}
// 진행 중인 답 생성만 멈춘다. 모델은 메모리에 남는다.
export function interruptAI() {
  workers.get('text')?.postMessage({ task: 'interrupt' });
}
export function stopAI(message = 'AI 작업을 취소했어요.', task, { failed = false } = {}) {
  for (const lane of task ? [task] : ['text', 'vision']) {
    workers.get(lane)?.terminate();
    workers.delete(lane);
    for (const [id, p] of pending)
      if (p.lane === lane) {
        pending.delete(id);
        p.reject(Error(message));
      }
  }
  listener({ event: 'reset', task, failed, error: failed ? message : undefined });
}
export { imageData } from './photo-input.js';
