import { TYPES, ROOM_TYPES, CATEGORIES, WALL_COLORS, FLOOR_COLORS } from './catalog.js';
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const ic = (n) => `<i data-lucide="${n}" aria-hidden="true"></i>`;
export function roomPanel(s) {
  const r = s.room;
  return `
 <div class="panel-title"><div><span class="eyebrow">01 / SPACE</span><h2>공간부터 정해볼까요</h2></div><span class="count-pill">${s.otherRooms.length + 1}개 공간</span></div>
 <p class="panel-description">유형을 고르고 치수를 조절해보세요.<br>바꾸는 즉시 도면에 반영돼요.</p>
 <h3 class="small-title">어떤 공간인가요?</h3><div class="room-types">${Object.entries(ROOM_TYPES)
   .map(
     ([k, t]) =>
       `<button data-room-type="${k}" aria-pressed="${r.type === k}" class="${r.type === k ? 'active' : ''}">${ic(t.icon)}<span>${t.name}</span>${r.type === k ? ic('check') : ''}</button>`,
   )
   .join('')}</div>
 <div class="section-heading"><h3>크기 초안</h3><span class="unit-note">직접 조절할 수 있어요</span></div><div class="room-presets">${ROOM_TYPES[r.type].sizes.map(([w, d], i) => `<button data-room-size="${i}" class="${r.w === w && r.d === d ? 'active' : ''}"><span>${['아담하게', '기본 크기', '넉넉하게'][i]}</span><strong>${w} × ${d}<small> m</small></strong></button>`).join('')}</div>
 <form id="room-form"><label class="text-field">공간 이름<input name="name" maxlength="100" value="${esc(s.name)}" required></label><div class="room-form-fields">${[
   ['w', '가로'],
   ['d', '세로'],
   ['h', '천장 높이'],
 ]
   .map(
     ([k, l]) =>
       `<label>${l}<div class="number-unit"><input aria-label="방 ${l}" name="${k}" data-room-dim="${k}" type="number" step="0.1" min="1" max="15" value="${r[k]}" required><span>m</span></div><small class="room-source">${esc(r.sources[k])}</small></label>`,
   )
   .join(
     '',
   )}</div><div class="room-area">${ic('ruler')}<span>바닥 면적</span><strong id="room-area">${(r.w * r.d).toFixed(1)} m² <small>· ${((r.w * r.d) / 3.3058).toFixed(1)}평</small></strong></div><button class="outline full">${ic('check')} 현재 치수로 정리</button></form>
 <div class="panel-divider"></div><h3 class="small-title">벽과 바닥</h3>${[
   ['wallColor', '벽 색상', WALL_COLORS],
   ['floorColor', '바닥 색상', FLOOR_COLORS],
 ]
   .map(
     ([key, label, colors]) =>
       `<div class="finish-row"><span>${label}</span><div>${colors.map(([name, c]) => `<button data-finish="${key}" data-value="${c}" style="--swatch:${c}" class="swatch ${r[key] === c ? 'active' : ''}" aria-label="${label} ${name}" title="${name}" aria-pressed="${r[key] === c}"></button>`).join('')}<input type="color" data-room-color="${key}" value="${r[key]}" aria-label="사용자 ${label}"></div></div>`,
   )
   .join('')}
 <button id="room-consult" class="consult-link">${ic('message-circle')}<span><strong>어떤 방인지 말로 알려주세요</strong><small>“거실 가로 5m, 세로 4m로 바꿔줘”</small></span>${ic('arrow-up-right')}</button>
 <div class="panel-divider"></div><div class="room-management"><button id="add-room" class="outline">${ic('plus')} 공간 추가</button><button id="delete-room" class="text-button danger" ${s.otherRooms.length ? '' : 'disabled'}>${ic('trash-2')} 이 공간 삭제</button></div><button id="load-example" class="text-button">예시 배치로 시작하기</button><button id="clear-room" class="text-button danger">이 공간의 가구 비우기</button>`;
}
export function catalogGrid(category, search) {
  const list = Object.entries(TYPES).filter(
    ([, t]) => (category === 'all' || t.category === category) && t.name.includes(search.trim()),
  );
  return list.length
    ? list
        .map(
          ([k, t]) =>
            `<button class="catalog-card" data-quick="${k}"><span class="catalog-visual visual-${t.category}">${ic(t.icon)}<small>${t.presets.length}가지 크기</small></span><strong>${t.name}</strong><span>${t.dims[0]} × ${t.dims[2]} × ${t.dims[1]} cm</span></button>`,
        )
        .join('')
    : '<p class="empty-list">찾는 가구가 없어요.<br>다른 이름으로 검색해보세요.</p>';
}
export function catalogPanel(category, search) {
  return `<div class="panel-title"><div><span class="eyebrow">02 / FURNITURE</span><h2>가구 라이브러리</h2></div><span class="count-pill">20종</span></div><p class="panel-description">${Object.values(TYPES).reduce((n, t) => n + t.presets.length, 0)}가지 치수 초안에서 시작해요.<br>우리 집 가구에 맞게 바꿔서 놓아보세요.</p><label class="catalog-search">${ic('search')}<input id="catalog-search" aria-label="가구 검색" placeholder="소파, 식탁, 책장…" value="${esc(search)}"></label><div class="category-tabs">${Object.entries(
    CATEGORIES,
  )
    .map(
      ([k, v]) =>
        `<button data-category="${k}" class="${category === k ? 'active' : ''}" aria-pressed="${category === k}">${v}</button>`,
    )
    .join(
      '',
    )}</div><div class="catalog-grid" id="catalog-grid">${catalogGrid(category, search)}</div><p class="estimate-note">${ic('info')} 제품 규격이 아닌 배치용 예시 치수예요.</p>`;
}
export function furniturePicker(a) {
  const t = TYPES[a.type];
  return `<label class="text-field">가구 종류<select id="furniture-type">${Object.entries(TYPES)
    .map(([k, t]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${t.name}</option>`)
    .join(
      '',
    )}</select></label><div class="size-presets"><span class="field-label">${t.name} 크기 초안</span><div>${t.presets.map((p, i) => `<button data-furniture-size="${i}" class="${p.dims.every((n, i) => n === a.dims[i]) ? 'active' : ''}"><strong>${p.label}</strong><small>${p.dims[0]} × ${p.dims[2]} × ${p.dims[1]}</small></button>`).join('')}</div></div>`;
}
