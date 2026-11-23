import { useEffect, useRef } from 'preact/hooks';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { isExampleLike } from '../app/ops.js';
import { STARTERS, EXAMPLE_PROMPTS } from '../app/planner.js';
import { Icon } from './icons.js';
import { A2uiSurface } from './A2uiSurface.jsx';
import { BrandMark } from './widgets.jsx';

const STARTER_ICONS = {
  'room-size': 'ruler',
  catalog: 'armchair',
  finishes: 'paint-roller',
  avatar: 'person-standing',
  floorplan: 'house',
};

// 상담은 룸꾸의 인사로 시작한다. 대화가 비어 있을 때는 시작점과 예시 문장을 답 고르기처럼 붙이고,
// 대화가 시작되면 인사 한 줄만 맨 위에 남긴다.
function Greeting({ mobile, full }) {
  const example = isExampleLike(app.state);
  return (
    <div class={`greet ${full ? 'is-full' : ''}`}>
      <span class="msg-who">
        <BrandMark />
        <span class="msg-name">룸꾸</span>
      </span>
      <div class="msg-body">
        <p class="bubble" id="greeting">
          안녕하세요, 방 꾸미기를 돕는 룸꾸예요. 방 크기나 놓고 싶은 가구를 편하게 말해 주세요.
          {!mobile && ' 필요한 도구를 대화 안에 꺼내 드리고, 옆의 방에 바로 반영할게요.'}
        </p>
        {full && example && (
          <p class="bubble">
            지금 보이는 방은 예시예요.
            <button class="link" onClick={() => store.send('빈 방으로 시작할래')}>
              빈 방으로 시작
            </button>
          </p>
        )}
        {full && (
          <>
            <p class="greet-label">무엇부터 할까요?</p>
            <div class="starters">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  class="starter"
                  data-starter={s.arg || s.action}
                  onClick={() =>
                    s.action === 'photo'
                      ? store.pickPhoto()
                      : s.arg === 'avatar' && !store.avatarHere()
                        ? store.toggleAvatar()
                        : store.openTool(s.arg)
                  }
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
          </>
        )}
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
  if (turn.engine === 'siglip') return 'SigLIP 사진 판별, 이 기기에서 실행';
  const model = turn.engine === 'gemma' ? 'Gemma' : turn.engine === 'qwen' ? 'Qwen' : null;
  if (model)
    return turn.fixes?.length
      ? `${model}가 해석, 앱이 ${turn.fixes.length}곳 바로잡음`
      : `${model}가 해석, 앱이 숫자와 범위 확인`;
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

// 답을 쓰는 중임을 알리는 말풍선.
function Thinking() {
  return (
    <div class="thinking bubble" role="status">
      <span class="typing" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{store.modelName(app.ai.model)}가 이 기기에서 문장을 해석하는 중</span>
      <button class="link" onClick={() => store.cancelModel()}>
        취소
      </button>
    </div>
  );
}

function Turn({ turn, live, latest, canUndo, showMeta }) {
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
      <span class="msg-who">
        <BrandMark />
        <span class="msg-name">룸꾸</span>
      </span>
      <div class="msg-body">
        {turn.text && <p class="msg-text bubble">{turn.text}</p>}
        {turn.note && <p class="msg-note">{turn.note}</p>}
        {turn.photoScores && (
          <p class="vision-caption">
            <span>SigLIP 후보</span>
            {turn.photoScores}
          </p>
        )}
        {turn.status === 'thinking' && <Thinking />}
        {turn.surfaces?.map((s) => (
          <A2uiSurface
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
        {/* 답을 쓰는 중에는 무엇이 처리했는지 아직 정해지지 않았다. */}
        {!showMeta ? null : turn.fixes?.length > 0 ? (
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
      </div>
    </article>
  );
}

export function Thread({ mobile }) {
  const ref = useRef(null);
  const thread = app.thread;
  const lastLen = useRef(0);
  const restoring = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (thread.length !== lastLen.current) {
      // 저장해 둔 대화를 처음 펼칠 때만 맨 아래로 바로 간다. 그 뒤로는 새 질문을 위쪽에 둔다.
      const first = restoring.current;
      lastLen.current = thread.length;
      const users = el.querySelectorAll('.msg.user');
      const last = users[users.length - 1];
      const lastTurn = el.lastElementChild;
      // 새 질문을 화면 위쪽에 두고 답과 도구가 그 아래로 펼쳐지게 한다.
      const top =
        !first && last && last.nextElementSibling === lastTurn
          ? last.offsetTop - 12
          : el.scrollHeight;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ top, behavior: first || reduced ? 'auto' : 'smooth' });
    }
  }, [thread.length, app.rev]);
  useEffect(() => {
    restoring.current = false;
  }, []);
  if (!thread.length)
    return (
      <div class="thread is-empty" ref={ref} role="log" aria-label="상담 대화">
        <Greeting mobile={mobile} full />
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
  // 무엇이 처리했는지는 바뀔 때만 적는다. 모델을 꺼 둔 동안 답마다 같은 말이 붙지 않게 한다.
  // 앱이 바로잡은 내용(fixes)이 있으면 펼쳐 볼 수 있게 늘 남긴다.
  const showMeta = new Set();
  let previous = null;
  for (const t of thread) {
    if (t.role !== 'assistant' || t.engine === 'app' || t.status === 'thinking') continue;
    const label = engineLabel(t);
    if (label !== previous || t.fixes?.length) showMeta.add(t.id);
    previous = label;
  }
  return (
    <div class="thread" ref={ref} role="log" aria-live="polite" aria-label="상담 대화">
      <Greeting mobile={mobile} />
      {thread.map((t) => (
        <Turn
          key={t.id}
          turn={t}
          live={live}
          latest={t === lastAssistant}
          canUndo={t === lastReceipt && t === lastAssistant && app.history.length > 0}
          showMeta={showMeta.has(t.id)}
        />
      ))}
    </div>
  );
}
