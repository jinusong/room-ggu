// 로컬 모델 응답을 앱 상태에 합친다. 모델은 단서와 UI 선택만 제안하고,
// 숫자·범위·사용자 설정 보존은 estimator/room-consult의 검증 함수가 맡는다.
import { TYPES, ROOM_TYPES } from '../catalog.js';
import { applyModelResult } from '../estimator.js';
import { applyRoomModel, detectRoomType } from '../room-consult.js';
import { surfaceKind } from '../ui-schema.js';

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
  '3인용의 낮은 소파로 가늠해볼게요. 앉는 부분도 깊은 편인가요?',
  '작은 책상을 기준으로 잡을게요. 노트북 하나를 놓는 정도인가요?',
  '작은 서재로 시작해볼게요. 책상과 책장 중 어느 가구가 중심인가요?',
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
  if (typeof reply !== 'string') return null;
  const r = reply.trim();
  if (!r || r === String(userText).trim() || !/[가-힣]/.test(r)) return null;
  if (echoes(r, userText)) return null;
  // 모델 문장에 숫자 치수가 있으면 앱이 계산한 값과 어긋날 수 있어 쓰지 않는다.
  if (/[0-9]\s*(?:cm|mm|m\b|미터|센티|평|m²)/i.test(r)) return null;
  if (/[<>{}]/.test(r)) return null;
  return r.slice(0, 280);
}

export function mergeRoomModel(raw, room, text) {
  const refined = applyRoomModel(raw, room, { text });
  if (detectRoomType(text)) refined.room.type = room.type;
  return {
    room: refined.room,
    kind: refined.ui ? surfaceKind('room', refined.ui) : null,
    reply: usableReply(refined.reply, text),
    summary: `${ROOM_TYPES[refined.room.type].name} · 가로 ${refined.room.w}m, 세로 ${refined.room.d}m, 천장 ${refined.room.h}m`,
  };
}

export function mergeFurnitureModel(raw, item, text) {
  const refined = applyModelResult(raw, item, { text });
  const a = refined.item;
  return {
    item: a,
    kind: refined.ui ? surfaceKind('furniture', refined.ui) : null,
    reply: usableReply(refined.reply, text),
    summary: `${TYPES[a.type].name} 초안 · 가로 ${a.dims[0]}, 깊이 ${a.dims[2]}, 높이 ${a.dims[1]}cm`,
  };
}

// 사진 모델 설명이 숫자·기호 반복처럼 읽을 수 없으면 보여주지 않는다.
export function usableCaption(caption) {
  const c = String(caption || '').trim();
  const words = c.match(/[A-Za-z]{3,}/g) || [];
  if (words.length < 2) return '';
  const digits = (c.match(/[0-9]/g) || []).length;
  if (digits > c.length * 0.3 || /(.)\1{7,}/.test(c)) return '';
  return c.slice(0, 300);
}
