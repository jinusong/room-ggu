import { useEffect, useRef } from 'preact/hooks';
import { ROOM_TYPES } from '../catalog.js';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { isExampleLike } from '../app/ops.js';
import { STARTERS, EXAMPLE_PROMPTS } from '../app/planner.js';
import { Icon } from './icons.js';
import { Surface } from './surfaces.jsx';

const STARTER_ICONS = { 'room-size': 'ruler', catalog: 'armchair', finishes: 'paint-roller' };

function Welcome({ mobile }) {
  const example = isExampleLike(app.state);
  return (
    <div class="welcome">
      <p class="welcome-kicker mono">
        {ROOM_TYPES[app.state.room.type].name} · {app.state.room.w} × {app.state.room.d}m
      </p>
      <h1>어떤 방을 꾸밀까요?</h1>
      <p class="welcome-lede">
        방 크기나 놓고 싶은 가구를 편하게 말해 주세요. 필요한 도구가 대화 안에 나타나고,{' '}
        {mobile ? '위' : '옆'}의 방에 바로 반영돼요.
      </p>
      {example && (
        <p class="welcome-note">
          지금 보이는 방은 예시예요.
          <button class="link" onClick={() => store.send('빈 방으로 시작할래')}>
            빈 방으로 시작
          </button>
        </p>
      )}
      <div class="starters">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            class="starter"
            onClick={() => (s.action === 'photo' ? store.pickPhoto() : store.openTool(s.arg))}
          >
            <Icon name={s.action === 'photo' ? 'image-plus' : STARTER_ICONS[s.arg]} />
            <span>
              <strong>{s.label}</strong>
              <small>{s.detail}</small>
            </span>
          </button>
        ))}
      </div>
      <div class="prompt-examples">
        <span>이렇게 말해도 돼요</span>
        {EXAMPLE_PROMPTS.map((p) => (
          <button key={p} class="chip" onClick={() => store.send(p)}>
            “{p}”
          </button>
        ))}
      </div>
    </div>
  );
}

const FALLBACK = {
  loading: '상담 모델 준비 중이라',
  off: '상담 모델을 꺼 둬서',
  unsupported: '이 브라우저에서 상담 모델을 쓸 수 없어',
  error: '상담 모델 준비에 실패해서',
  timeout: '모델 답이 늦어서',
  invalid: '모델 답을 쓸 수 없어서',
  cancelled: '모델 답을 취소해서',
  'model-chat': '모델이 바꿀 내용을 찾지 못해서',
};
// 답마다 무엇이 해석했는지 밝힌다. 모델이 기본이고 규칙은 대체 경로다.
function engineLabel(turn) {
  if (turn.uiBy === 'user') return '직접 연 도구';
  if (turn.engine === 'siglip') return 'SigLIP 사진 판별 · 이 기기에서 실행';
  const model = turn.engine === 'gemma' ? 'Gemma' : turn.engine === 'qwen' ? 'Qwen' : null;
  if (model)
    return turn.fixes?.length
      ? `${model}가 해석 · 앱이 ${turn.fixes.length}곳 바로잡음`
      : `${model}가 해석 · 앱이 숫자·범위 확인`;
  return turn.fallback ? `${FALLBACK[turn.fallback]} 규칙으로 처리` : '규칙으로 처리';
}

function Receipt({ turn, canUndo }) {
  if (!turn.receipt?.length) return null;
  const undoable = canUndo && turn.receipt.some((r) => r.tag !== '초안' && r.label !== '새 초안');
  return (
    <div class="receipt" aria-label="바뀐 내용">
      <ul>
        {turn.receipt.map((r, i) => (
          <li key={i}>
            <span class="receipt-label">{r.label}</span>
            {r.from && <span class="receipt-from">{r.from}</span>}
            {r.from && <Icon name="arrow-right" size={14} />}
            {r.swatch && <span class="dot" style={{ background: r.swatch }} />}
            <span class="receipt-to">{r.to}</span>
            {r.tag && <span class="receipt-tag">{r.tag}</span>}
          </li>
        ))}
      </ul>
      {undoable && (
        <button class="link" onClick={() => store.undo()}>
          <Icon name="undo-2" size={14} />
          되돌리기
        </button>
      )}
    </div>
  );
}

function Thinking() {
  return (
    <div class="thinking" role="status">
      <Icon name="loader-circle" size={16} className="spin" />
      <span>
        {app.ai.model?.startsWith('gemma') ? 'Gemma' : '모델'}가 이 기기에서 문장을 해석하는 중
      </span>
      <button class="link" onClick={() => store.cancelModel()}>
        취소
      </button>
    </div>
  );
}

function Turn({ turn, live, latest, canUndo }) {
  if (turn.role === 'event')
    return (
      <div class="event" role="note">
        <span>{turn.text}</span>
      </div>
    );
  if (turn.role === 'user')
    return (
      <div class={`msg user ${turn.action ? 'is-action' : ''}`}>
        {turn.photo && <img class="msg-photo" src={turn.photo} alt="보낸 가구 사진" />}
        {!turn.photo && turn.hadPhoto && (
          <span class="photo-gone">
            <Icon name="image" size={14} />
            사진 (저장하지 않음)
          </span>
        )}
        {turn.text && <p>{turn.text}</p>}
      </div>
    );
  return (
    <article class={`msg assistant ${turn.tone === 'error' ? 'is-error' : ''}`} data-turn={turn.id}>
      {turn.text && <p class="msg-text">{turn.text}</p>}
      {turn.note && <p class="msg-note">{turn.note}</p>}
      {turn.photoScores && (
        <p class="vision-caption">
          <span>SigLIP 후보</span>
          {turn.photoScores}
        </p>
      )}
      {turn.status === 'thinking' && <Thinking />}
      {turn.surfaces?.map((s) => (
        <Surface
          key={s.id}
          spec={s}
          live={live.has(s.id)}
          onOpen={() => {
            s.open = true;
            store.emit();
          }}
        />
      ))}
      <Receipt turn={turn} canUndo={canUndo} />
      {latest && turn.suggestions?.length > 0 && (
        <div class="suggestions" aria-label="이어서 할 일">
          {turn.suggestions.map((s) => (
            <button
              key={s.label}
              class={`chip ${s.primary ? 'is-primary' : ''}`}
              onClick={() => store.runSuggestion(s)}
            >
              {s.primary && <Icon name="corner-down-right" size={14} />}
              {s.label}
            </button>
          ))}
        </div>
      )}
      {turn.note && <p class="msg-note">{turn.note}</p>}
      {turn.engine === 'app' ? null : turn.fixes?.length > 0 ? (
        <details class="msg-meta">
          <summary>{engineLabel(turn)}</summary>
          <ul>
            {turn.fixes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      ) : (
        <span class="msg-meta">{engineLabel(turn)}</span>
      )}
    </article>
  );
}

export function Thread({ mobile }) {
  const ref = useRef(null);
  const thread = app.thread;
  const lastLen = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (thread.length !== lastLen.current) {
      const first = !lastLen.current;
      lastLen.current = thread.length;
      const users = el.querySelectorAll('.msg.user');
      const last = users[users.length - 1];
      const lastTurn = el.lastElementChild;
      // 새 질문을 화면 위쪽에 두고 답과 도구가 그 아래로 펼쳐지게 한다.
      const top =
        !first && last && last.nextElementSibling === lastTurn
          ? last.offsetTop - 12
          : el.scrollHeight;
      el.scrollTo({ top, behavior: first ? 'auto' : 'smooth' });
    }
  }, [thread.length, app.rev]);
  if (!thread.length)
    return (
      <div class="thread is-empty" ref={ref}>
        <Welcome mobile={mobile} />
      </div>
    );
  const lastWithSurfaces = [...thread].reverse().find((t) => t.surfaces?.length);
  const live = new Set(
    thread.flatMap((t) => (t.surfaces || []).filter((s) => s.open).map((s) => s.id)),
  );
  for (const s of lastWithSurfaces?.surfaces || []) live.add(s.id);
  const lastAssistant = [...thread].reverse().find((t) => t.role === 'assistant');
  const lastReceipt = [...thread]
    .reverse()
    .find((t) => t.role === 'assistant' && t.receipt?.length);
  return (
    <div class="thread" ref={ref} role="log" aria-live="polite" aria-label="상담 대화">
      {thread.map((t) => (
        <Turn
          key={t.id}
          turn={t}
          live={live}
          latest={t === lastAssistant}
          canUndo={t === lastReceipt && t === lastAssistant && app.history.length > 0}
        />
      ))}
    </div>
  );
}
