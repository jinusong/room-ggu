import { TYPES, ROOM_TYPES, WALL_COLORS, FLOOR_COLORS } from './catalog.js';
import { COLORS } from './data.js';
import { esc, ic, furniturePicker } from './panels.js';

function dimensionEditor(a, dimsForm) {
  return `<label class="text-field">가구 이름<input id="draft-name" maxlength="100" value="${esc(a.name)}"></label>${dimsForm(a, '등록 가구')}`;
}
function colorEditor(a) {
  return `<div class="color-row"><span>가구 색상</span><div>${COLORS.map((c) => `<button data-color="${c}" style="--swatch:${c}" class="swatch ${a.color === c ? 'active' : ''}" aria-label="${c} 색상"></button>`).join('')}<input id="custom-color" type="color" value="${a.color}" aria-label="사용자 색상"></div></div>`;
}
function roomDimensions(state) {
  const room = state.room;
  return `<div class="room-form-fields">${[
    ['w', '가로'],
    ['d', '세로'],
    ['h', '천장 높이'],
  ]
    .map(
      ([k, label]) =>
        `<label>${label}<div class="number-unit"><input data-room-dim="${k}" aria-label="방 ${label}" type="number" step="0.1" min="1" max="15" value="${room[k]}"><span>m</span></div><small class="room-source">${esc(room.sources[k])}</small></label>`,
    )
    .join('')}</div>`;
}
function roomTypes(state) {
  return `<div class="surface-room-types">${Object.entries(ROOM_TYPES)
    .map(
      ([key, t]) =>
        `<button data-room-type="${key}" class="${state.room.type === key ? 'active' : ''}" aria-pressed="${state.room.type === key}">${ic(t.icon)}${t.name}</button>`,
    )
    .join('')}</div>`;
}
function roomFinishes(state) {
  return [
    ['wallColor', '벽 색상', WALL_COLORS],
    ['floorColor', '바닥 색상', FLOOR_COLORS],
  ]
    .map(
      ([key, label, colors]) =>
        `<div class="finish-row"><span>${label}</span><div>${colors.map(([name, c]) => `<button data-finish="${key}" data-value="${c}" style="--swatch:${c}" class="swatch ${state.room[key] === c ? 'active' : ''}" aria-label="${label} ${name}" title="${name}" aria-pressed="${state.room[key] === c}"></button>`).join('')}</div></div>`,
    )
    .join('');
}
export function renderSurface({ state, a, selected, scope, surface, dimsForm, origin }) {
  const room = scope === 'room';
  const titles = room
    ? { dimensions: '우리 방 크기', types: '공간 유형 고르기', finishes: '벽과 바닥 맞추기' }
    : { dimensions: '가구 치수 맞추기', sizes: '크기 골라보기', colors: '가구 색상 고르기' };
  let fields;
  if (room)
    fields =
      surface === 'finishes'
        ? roomFinishes(state)
        : surface === 'types'
          ? roomTypes(state)
          : roomDimensions(state);
  else
    fields =
      surface === 'colors'
        ? colorEditor(a)
        : surface === 'sizes'
          ? furniturePicker(a)
          : dimensionEditor(a, dimsForm);
  return `<section class="generated-surface ${room ? 'conversation-space' : 'furniture-surface'}" data-surface="${surface}" aria-label="${titles[surface]}"><div class="surface-top"><span>${ic(room ? ROOM_TYPES[state.room.type].icon : TYPES[a.type].icon)}${room ? ROOM_TYPES[state.room.type].name : TYPES[a.type].name}</span><small>${origin === 'model' ? 'AI가 고른 편집 도구' : '대화에 맞춘 편집 도구'}</small></div><h3>${titles[surface]}</h3><p class="surface-summary">${room ? `${state.room.w} × ${state.room.d} m <span>· ${(state.room.w * state.room.d).toFixed(1)} m²</span>` : `${a.dims[0]} × ${a.dims[2]} × ${a.dims[1]} <span>cm · 가로 × 깊이 × 높이</span>`}</p>${fields}<div class="surface-switch" aria-label="편집 도구 선택">${Object.entries(
    titles,
  )
    .map(
      ([key, title]) =>
        `<button data-surface-kind="${key}" aria-pressed="${surface === key}" class="${surface === key ? 'active' : ''}">${title}</button>`,
    )
    .join(
      '',
    )}</div>${room ? `<div class="surface-footer"><span>${ic('check')} 도면에 반영됨</span><button data-panel="room" class="text-button">공간 상세 ${ic('arrow-up-right')}</button><button data-action="preview" class="mobile-preview-link">도면 보기 ${ic('arrow-up-right')}</button></div>` : `<details class="surface-details"><summary>다른 치수·색상 직접 조절 ${ic('chevron-right')}</summary>${surface !== 'sizes' ? furniturePicker(a) : ''}${surface !== 'dimensions' ? dimensionEditor(a, dimsForm) : ''}${surface !== 'colors' ? colorEditor(a) : ''}</details><div class="surface-footer"><span>${selected ? '배치된 가구를 편집 중' : '배치용 치수 초안'}</span><button id="add-item" class="primary">${ic(selected ? 'plus' : 'move-3d')}${selected ? '다른 가구 추가' : '내 방에 놓기'}</button></div>`}</section>`;
}
export function consultPanel(c) {
  const {
    state,
    a,
    selected,
    entry,
    scope,
    messagesHTML,
    hasMessages,
    photo,
    caption,
    busy,
    textReady,
    textLabel,
    progressText,
    progressValue,
    dimsForm,
    surface,
    surfaceScope,
    surfaceOrigin,
    hasSurface,
    defaultMessage,
  } = c;
  const surfaceHTML = hasSurface
    ? renderSurface({
        state,
        a,
        selected,
        scope: surfaceScope,
        surface,
        dimsForm,
        origin: surfaceOrigin,
      })
    : '';
  const status = `<span class="status-dot ${textReady ? 'ready' : ''}"></span><span>${textReady ? textLabel + ' · 기기에서 실행 중' : '기본 상담'}</span><button id="consult-ai-settings" data-action="ai-settings">${textReady ? '설정' : 'AI 켜기'}${ic('chevron-right')}</button>`;
  if (entry === 'manual')
    return `<div class="manual-header"><span class="eyebrow">직접 조절</span><h2>${esc(a.name)}</h2><button data-entry="chat" class="outline">${ic('message-circle')} 상담으로 돌아가기</button></div><div class="manual-content">${furniturePicker(a)}${dimensionEditor(a, dimsForm)}${colorEditor(a)}<button id="add-item" class="primary full">${ic('plus')}${selected ? '다른 가구 추가' : '내 방에 놓기'}</button><p class="estimate-note">${ic('info')} 구매·설치 전에 실제 치수를 확인해주세요.</p></div>`;
  return `<div class="consult-shell"><div class="consult-heading"><div><span class="eyebrow">룸꾸와 함께</span><h2>이야기하며 꾸미는 내 공간</h2></div><button data-action="preview" class="mobile-preview-link">${ic('house')} 도면 보기</button><button id="consult-new" data-action="new-conversation" class="icon-button" aria-label="새 상담">${ic('plus')}</button></div><div class="consult-context"><span>${ic(ROOM_TYPES[state.room.type].icon)}${esc(state.name)}</span><small>${state.room.w} × ${state.room.d} m</small><span class="context-saved">${ic('check')} 도면 연결됨</span></div><div class="chat-log ${!hasMessages ? 'is-empty' : ''}" id="chat-log" role="log" aria-label="공간과 가구 상담">${hasMessages ? messagesHTML : `<div class="chat-welcome"><span class="welcome-mark">${ic('house')}</span><span class="welcome-kicker">말 한마디에서 시작하는 인테리어</span><h3>어떤 공간을<br>꾸미고 싶나요?</h3><p>${selected ? esc(defaultMessage) : '방 크기나 놓고 싶은 가구를 알려주세요.<br>필요한 편집 도구가 대화 안에 나타나요.'}</p><div class="welcome-prompts"><button data-prompt="6평 원룸을 꾸미고 싶어">${ic('house')}<span><strong>우리 방부터 정해볼래요</strong><small>6평 원룸으로 시작하기</small></span>${ic('arrow-up-right')}</button><button data-prompt="두 명이 넉넉하게 앉는 소파야">${ic('sofa')}<span><strong>가구 하나를 놓고 싶어요</strong><small>2인용 소파 크기 알아보기</small></span>${ic('arrow-up-right')}</button><button data-action="attach-photo">${ic('image-plus')}<span><strong>내 가구 사진이 있어요</strong><small>사진과 설명으로 크기 가늠하기</small></span>${ic('arrow-up-right')}</button></div></div>`}${surfaceHTML}</div><div class="composer-area">${photo ? `<div class="photo-drop has-photo" id="photo-drop" tabindex="0" role="button" aria-label="가구 사진 선택 또는 파일 드롭"><img src="${photo}" alt="상담할 가구 사진"><div><strong>사진을 첨부했어요</strong><small>${caption ? esc(caption) : '사진 AI로 가구 특징을 확인할 수 있어요'}</small><button id="analyze-photo" ${busy ? 'disabled' : ''}>${ic('image')} 사진 AI 분석</button></div><button id="remove-photo" class="icon-button" aria-label="사진 삭제">${ic('x')}</button></div>` : ''}${busy ? `<div class="ai-progress" role="status"><div>${ic('loader-circle')}<span id="progress-text">${esc(progressText || '상담을 준비하고 있어요')}</span><button id="cancel-ai" aria-label="AI 작업 취소">${ic('x')}</button></div><progress id="ai-progress-bar" max="1" value="${progressValue}"></progress></div>` : ''}<form id="chat-form" class="chat-form"><label class="sr-only" for="chat-input">공간 또는 가구 설명</label><textarea id="chat-input" aria-label="공간 또는 가구 설명" placeholder="예: 침실 가로 4m, 세로 3.5m로 바꿔줘" rows="2" maxlength="1500" ${busy ? 'disabled' : ''}>${esc(c.composerDraft || '')}</textarea><div class="composer-tools"><button type="button" data-action="attach-photo" aria-label="가구 사진 첨부" title="가구 사진 첨부" ${busy ? 'disabled' : ''}>${ic('image-plus')}</button><div class="scope-tabs" aria-label="상담 대상">${[
    ['auto', '자동'],
    ['room', '방'],
    ['furniture', '가구'],
  ]
    .map(
      ([key, label]) =>
        `<button type="button" data-scope="${key}" aria-pressed="${scope === key}" class="${scope === key ? 'active' : ''}">${label}</button>`,
    )
    .join(
      '',
    )}</div><button class="send-button" aria-label="설명 보내기" ${busy ? 'disabled' : ''}>${ic('arrow-up')}</button></div></form><div class="composer-footnote"><div class="assistant-status">${status}</div><span>추정 치수는 직접 조절할 수 있어요</span></div></div></div>`;
}
