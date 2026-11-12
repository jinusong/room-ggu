// 로컬 모델 응답을 앱 상태에 합친다. 모델은 단서와 UI 선택만 제안하고,
// 숫자·범위·사용자 설정 보존은 estimator/room-consult의 검증 함수가 맡는다.
import { TYPES, ROOM_TYPES } from '../catalog.js';
import { applyModelResult } from '../estimator.js';
import { applyRoomModel, detectRoomType } from '../room-consult.js';
import { surfaceKind } from '../ui-schema.js';

// 모델 문장에 숫자 치수가 있으면 앱이 계산한 값과 어긋날 수 있어 쓰지 않는다.
export function usableReply(reply, userText) {
  if (typeof reply !== 'string') return null;
  const r = reply.trim();
  if (!r || r === String(userText).trim() || !/[가-힣]/.test(r)) return null;
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
