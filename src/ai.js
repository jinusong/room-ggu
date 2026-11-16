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
export async function imageData(file) {
  if (!file.type.startsWith('image/')) throw Error('사진 파일을 선택해주세요.');
  if (file.size > 20 * 1024 * 1024) throw Error('사진은 20MB 이하로 선택해주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * scale));
    c.height = Math.max(1, Math.round(bitmap.height * scale));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}
