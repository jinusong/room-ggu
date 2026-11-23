import { TYPES } from '../catalog.js';
import { spaces } from '../data.js';
import { furnitureMentions } from '../estimator.js';
import { NOT_THIS, lengthCm, numericCorrection, relativeSize, sizeFields } from '../dimensions.js';

const separator = /[!?\n]|\.(?!\d)|,\s*|\s+그리고\s+/g;
const protection =
  /^\s*(?:은|는|이|가|을|를)?\s*(?:그대로\s*(?:두|놔\s*두|유지하)고|건[들드]리지\s*말고|건들지\s*말고|손대지\s*말고)/u;
const exception = new RegExp(`^\\s*(?:은|는|이|가|을|를)?\\s*${NOT_THIS}\\s*`, 'u');
const reference = /^\s*(?:의?\s*(?:옆|앞|뒤|맞은\s*편|근처|쪽)|처럼)/;
const editWords = /가로|세로|높이|너비|폭|깊이|치수|줄여|늘려|넓혀|좁혀|낮춰|높여|색|벽|바닥/;
const label = { width: '가로', depth: '깊이', height: '높이' };
const keys = { width: 'w', depth: 'd', height: 'h' };
const index = { width: 0, depth: 2, height: 1 };
const numberText = (n) => String(Math.round(n * 1000) / 1000);
const ask = (reply) => ({
  reply,
  intent: 'chat',
  ask: 'constraint',
  surfaces: [],
  suggestions: [],
});

export function roomNameSpan(text, name) {
  const chars = [...name.replace(/\s+/g, '')];
  if (chars.length < 2) return null;
  const pattern = chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(pattern, 'u').exec(text);
}

// 긍정 목적어가 뒤에 나오거나 앞 가구를 그대로 두라는 문장이면 그 마디를 제외한다.
export function requestedText(text, state) {
  const names = spaces(state)
    .map((r) => r.name)
    .filter((n) => n.length >= 2);
  let changed = false;
  const clauses = text.split(separator);
  const result = clauses
    .map((clause, i) => {
      const mentions = [
        ...furnitureMentions(clause),
        ...names.flatMap((name) => {
          const hit = roomNameSpan(clause, name);
          return hit ? [{ index: hit.index, end: hit.index + hit[0].length }] : [];
        }),
      ].sort((a, b) => b.end - a.end);
      for (const m of mentions) {
        const tail = clause.slice(m.end);
        const keep = tail.match(protection);
        if (keep) {
          changed = true;
          return clause.slice(m.end + keep[0].length);
        }
        const no = tail.match(exception);
        if (!no) continue;
        const yes = tail.slice(no[0].length);
        const next = yes.trim() || clauses[i + 1] || '';
        if (
          furnitureMentions(next).some((m) => !m.ref) ||
          names.some((n) => roomNameSpan(next, n))
        ) {
          changed = true;
          return yes;
        }
      }
      return clause;
    })
    .filter((s) => s.trim())
    .join(', ')
    .trim();
  return changed && result ? result : text;
}

export function namedEdit(text, state) {
  if (/새\s*(?:방|공간)|붙여|붙이/.test(text)) return null;
  const editing = editWords.test(text);
  const names = spaces(state)
    .filter((r) => r.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);
  let rest = text;
  const hits = [];
  for (const room of names) {
    const hit = roomNameSpan(rest, room.name);
    if (!hit) continue;
    const end = hit.index + hit[0].length;
    const tail = rest.slice(end);
    if (reference.test(tail) || exception.test(tail)) continue;
    hits.push({ room, at: hit.index, end, tail });
    rest = rest.slice(0, hit.index) + ' '.repeat(hit[0].length) + rest.slice(end);
  }
  if (hits.length > 1 && !editing) return null;
  if (hits.length > 1) return { guard: ask('어느 방부터 바꿀까요? 방 이름을 하나 골라 주세요.') };
  if (hits.length) {
    const { room, at, end, tail } = hits[0];
    const literal = (text.slice(0, at) + ' ' + text.slice(end))
      .replace(/^\s*(?:의|에서|은|는)(?:\s+|$)/, '')
      .trim();
    if (!editing) {
      const mentions = furnitureMentions(literal);
      const m = mentions.length === 1 && mentions[0];
      if (
        !m ||
        m.ref ||
        !/^\s*(?:의\s*)?$/.test(literal.slice(0, m.index)) ||
        !/^\s*(?:로|으로|을|를|이|가)?\s*(?:선택(?:해\s*줘|해)?|골라\s*줘|요)?[.!?]?\s*$/.test(
          literal.slice(m.end),
        )
      )
        return null;
      return { room, text: literal, focusType: m.type };
    }
    return {
      room,
      text:
        furnitureMentions(literal).length || /벽|바닥|천장/.test(tail) ? literal : `방 ${literal}`,
    };
  }
  return null;
}

function dimensionSubject(ctx) {
  if (ctx.target.type === 'draft') return ctx.draft;
  if (ctx.target.type === 'item') return ctx.state.items.find((i) => i.id === ctx.target.id);
  return null;
}

function focusValue(ctx, focus) {
  if (!focus || focus.roomId !== ctx.state.roomId) return undefined;
  if (focus.id) {
    const item = dimensionSubject(ctx);
    if (item?.id === focus.id) return item.dims[index[focus.axis]];
  } else if (ctx.target.type === 'room') return ctx.state.room[keys[focus.axis]];
  return undefined;
}

// 이전 턴에서 실제로 반영한 한 축만 후속 정정에 쓴다. 방·가구나 값이 달라졌으면 되묻는다.
export function followupSize(text, ctx, focus) {
  const correction = numericCorrection(text);
  const relative = relativeSize(text);
  if (!correction && !relative) return { text };
  const validFocus = focus && focusValue(ctx, focus) === focus.value ? focus : null;
  const explicitType = furnitureMentions(text).find((m) => !m.ref)?.type;
  const matching = explicitType ? ctx.state.items.filter((i) => i.type === explicitType) : [];
  const selected = dimensionSubject(ctx);
  const item =
    explicitType && selected?.type !== explicitType
      ? matching.length === 1
        ? matching[0]
        : null
      : selected;
  if (explicitType && !item)
    return {
      text,
      guard: ask(
        `어느 ${TYPES[explicitType].name}를 고칠까요? 도면이나 가구 목록에서 골라 주세요.`,
      ),
    };
  const axis = relative?.axis || validFocus?.axis;
  if (!axis) return { text, guard: ask('가로, 깊이, 높이 중 어느 치수를 바꿀까요?') };
  const room = !item;
  if (correction) {
    const oldCm = lengthCm(correction.from, correction.fromUnit || validFocus?.unit);
    if (!validFocus || Math.abs(oldCm - (room ? validFocus.value * 100 : validFocus.value)) > 0.051)
      return { text, guard: ask('어느 치수를 고칠까요? 가구나 방 이름과 바꿀 값을 알려 주세요.') };
    return {
      text: `${label[axis]} ${correction.to}${correction.unit || validFocus.unit}로 바꿔줘`,
    };
  }
  const old = room ? ctx.state.room[keys[axis]] * 100 : item.dims[index[axis]];
  if (!relative.unit && room)
    return { text, guard: ask('줄이거나 늘릴 길이에 cm나 m를 붙여 주세요.') };
  const prefix = explicitType
    ? text.slice(0, furnitureMentions(text)[0].end) + ' '
    : room
      ? '방 '
      : '';
  return { text: `${prefix}${label[axis]} ${numberText(old + relative.delta)}cm로 바꿔줘` };
}

export function appliedSize(text, plan, app) {
  const c = plan.changes;
  if (!c || c.addSpace || plan.action || plan.intent === 'compound') return null;
  const room = !!c.room;
  const item = c.item
    ? app.state.items.find((i) => i.id === c.item.id)
    : c.draft
      ? app.draft
      : null;
  if (!room && !item) return null;
  const entries = Object.entries(sizeFields(text, room).values);
  if (entries.length !== 1) return null;
  const [[key, m]] = entries;
  const value = room ? app.state.room[key] : item.dims[key];
  if (value !== m.value) return null;
  return { roomId: app.state.roomId, id: item?.id, axis: m.axis, value, unit: m.unit };
}

export function photoCaption(text, type) {
  let next = text;
  for (const m of furnitureMentions(text).reverse())
    if (!m.ref && m.type !== type) next = next.slice(0, m.index) + ' ' + next.slice(m.end);
  return next.trim();
}
