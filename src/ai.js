let worker = null,
  serial = 0;
const pending = new Map();
let listener = () => {};
export function onAIStatus(fn) {
  listener = fn;
}
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.event) {
      listener(data);
      return;
    }
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
  };
  worker.onerror = () =>
    stopAI('AI 작업을 시작하지 못했어요. 브라우저를 새로 열고 다시 시도해주세요.');
  return worker;
}
export function runAI(task, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, task, payload });
  });
}
// 진행 중인 답 생성만 멈춘다. 모델은 메모리에 남는다.
export function interruptAI() {
  worker?.postMessage({ task: 'interrupt' });
}
export function stopAI(message = 'AI 작업을 취소했어요.') {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(Error(message));
  pending.clear();
  listener({ event: 'reset' });
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
