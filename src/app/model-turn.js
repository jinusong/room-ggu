// 로컬 모델이 쓴 답 문장을 화면에 보여도 되는지 거른다.

// 사용자 문장을 6글자 이상 그대로 되풀이하면 새 정보가 없는 답으로 본다.
export function echoes(reply, userText) {
  const norm = (x) => String(x).replace(/[\s.,!?~"'“”‘’]/g, '');
  const r = norm(reply),
    u = norm(userText);
  for (let i = 0; i + 6 <= u.length; i++) if (r.includes(u.slice(i, i + 6))) return true;
  return false;
}
// 프롬프트의 예시 답을 그대로 가져온 문장은 지금 대화와 맞지 않을 수 있다.
const PROMPT_EXAMPLES = [
  '둘이 앉는 낮은 소파로 잡았어요. 앉는 깊이도 중요한가요?',
  '벽은 따뜻한 샌드, 바닥은 짙은 월넛으로 맞췄어요. 가구 색도 맞춰 볼까요?',
  '의자를 뺐어요.',
];
const SEATS = /([1-4])\s*인|([한두세네])\s*명|(혼자|둘이|셋이|넷이)/;
function seatCount(text) {
  const m = String(text).match(SEATS);
  if (!m) return null;
  if (m[1]) return +m[1];
  return { 한: 1, 두: 2, 세: 3, 네: 4, 혼자: 1, 둘이: 2, 셋이: 3, 넷이: 4 }[m[2] || m[3]];
}
export function usableReply(reply, userText) {
  if (typeof reply !== 'string') return null;
  if (PROMPT_EXAMPLES.some((ex) => echoes(reply, ex))) return null;
  const seats = seatCount(reply);
  if (seats !== null && seats !== seatCount(userText)) return null;
  const r = reply.trim();
  if (!r || r === String(userText).trim() || !/[가-힣]/.test(r)) return null;
  if (echoes(r, userText)) return null;
  // 모델 문장에 숫자 치수가 있으면 앱이 계산한 값과 어긋날 수 있어 쓰지 않는다.
  if (/[0-9]\s*(?:cm|mm|m\b|미터|센티|평|m²)/i.test(r)) return null;
  if (/[<>{}]/.test(r)) return null;
  return r.slice(0, 280);
}
