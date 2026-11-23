import {
  MODEL_USAGE,
  modelEvidence,
  MODEL_EVIDENCE_CONTEXT,
  modelCoverage,
  modelCaution,
} from '../app/model-capabilities.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { sizeText, TEXT_MODELS } from '../app/models.js';
import { Icon } from './icons.js';

// 화면 위 가운데에 뜨는 모델 아일랜드. 모델을 내려받거나 준비하는 동안 진행 상황을 한 줄로 보여 주고,
// 누르면 아래로 펼쳐져 크기·받은 양·취소를 보여 준다. 화면을 막지 않으므로 그동안에도 상담은 계속된다.
// 처음 내려받을 때는 펼쳐진 채 나타났다가 잠시 뒤 스스로 접히고, 준비가 끝나면 완료를 알리고 사라진다.
const STALL_MS = 60000;
const AUTO_FOLD_MS = 7000;
const TITLES = {
  text: {
    connect: '상담 모델 연결 중',
    fetch: '상담 모델 받는 중',
    init: '상담 모델 준비 중',
    done: '상담 모델 준비 완료',
    error: '상담 모델 준비 실패',
  },
  vision: {
    fetch: '사진 판별 모델 받는 중',
    init: '사진 판별 모델 준비 중',
    done: '사진 판별 모델 준비 완료',
    error: '사진 판별 모델 준비 실패',
  },
};

// 받은 비율을 따라 차오르는 작은 고리.
function Ring({ value }) {
  const r = 7,
    c = 2 * Math.PI * r;
  return (
    <svg class="island-ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} />
      <circle
        cx="9"
        cy="9"
        r={r}
        style={{ strokeDasharray: c, strokeDashoffset: c * (1 - value) }}
      />
    </svg>
  );
}

// 휴대 기기에서 모델을 받기 전에 묻는 팝업. 아일랜드와 같은 자리, 같은 재질로 뜨고, 받겠다고 누르면
// 그 자리에서 받는 중 안내로 이어진다. 누르기 전에는 아무것도 받지 않는다.
function ModelAsk({ ask }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const before = document.activeElement;
    const background = [...document.querySelectorAll('.stage,.sheet')].map((node) => [
      node,
      node.inert,
    ]);
    for (const [node] of background) node.inert = true;
    // 초점은 팝업 자체에 둔다. 단추에 두면 Enter 한 번에 큰 파일을 받기 시작할 수 있다.
    ref.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        store.declineModel();
      }
      // 팝업이 떠 있는 동안 모델 선택과 두 단추 사이에서만 초점이 돈다.
      if (e.key === 'Tab') {
        const list = [...ref.current.querySelectorAll('button,select')],
          i = list.indexOf(document.activeElement),
          next = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : i + (e.shiftKey ? -1 : 1);
        e.preventDefault();
        list[(next + list.length) % list.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      for (const [node, inert] of background) node.inert = inert;
      if (before && before !== document.body && before.isConnected)
        before.focus?.({ preventScroll: true });
    };
  }, []);
  const size = `약 ${sizeText(ask.mb)}`;
  return (
    <div
      class="island-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && store.declineModel()}
    >
      <div
        ref={ref}
        id="model-ask"
        class="island is-ask is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        aria-describedby="ask-desc"
        tabIndex={-1}
      >
        <div class="ask-head">
          <span class="island-icon">
            <Icon name="download" size={16} />
          </span>
          <h2 id="ask-title">상담 모델을 먼저 받아야 해요</h2>
        </div>
        <div class="island-panel">
          <div class="ask-content">
            <p id="ask-desc" class="island-desc">
              {ask.partial
                ? '받다 만 모델이 있어요. 남은 만큼만 이어서 받으면 돼요. 대화는 서버로 보내지 않고 이 기기에서 해석해요.'
                : '룸꾸는 대화를 서버로 보내지 않고 이 기기에서 해석해요. 그래서 처음 한 번 모델을 받아 둬야 해요.'}
            </p>
            <label class="ask-model-choice">
              상담 모델
              <select
                id="ask-model-select"
                aria-label="받을 상담 모델"
                value={app.ai.choice}
                onChange={(e) => store.setModelChoice(e.currentTarget.value)}
              >
                {Object.values(TEXT_MODELS).map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name} · 약 {sizeText(m.downloadMB)}
                  </option>
                ))}
              </select>
            </label>
            <div class="ask-capabilities" role="status" aria-live="polite">
              <strong>이 모델로 하는 일</strong>
              <p>{MODEL_USAGE[app.ai.choice]}</p>
              <p>{modelCoverage(app.ai.choice)}</p>
              <p>{modelEvidence(app.ai.choice)}</p>
              {modelCaution(app.ai.choice) && <p>{modelCaution(app.ai.choice)}</p>}
              {TEXT_MODELS[app.ai.choice]?.f32Note && <p>{TEXT_MODELS[app.ai.choice].f32Note}</p>}
              <small>{MODEL_EVIDENCE_CONTEXT}</small>
            </div>
            <dl class="ask-facts">
              <div>
                <dt>모델</dt>
                <dd>{ask.name}</dd>
              </div>
              <div>
                <dt>{ask.partial ? '남은 크기' : '크기'}</dt>
                <dd class="is-size">{size}</dd>
              </div>
              <div>
                <dt>보관</dt>
                <dd>이 브라우저</dd>
              </div>
            </dl>
            <p class="ask-note">
              Wi-Fi에서 받기를 권해요. 받지 않아도 “소파 놓아줘” 같은 정해진 표현은 알아들어요.
            </p>
          </div>
          <footer>
            <button class="island-btn" id="ask-later" onClick={() => store.declineModel()}>
              나중에
            </button>
            <button class="island-btn is-primary" id="ask-go" onClick={() => store.acceptModel()}>
              {ask.partial ? '이어서 받기' : '모델 받기'} · {size}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

export function ModelIsland() {
  const d = app.ai.download,
    open = !!d && app.view.downloadOpen;
  const ref = useRef(null);
  const inside = useRef(false);
  const [, tick] = useState(0);
  const busy = ['connect', 'fetch', 'init'].includes(d?.phase);
  // 받는 중에는 몇 초마다 다시 그려, 받은 양이 한동안 늘지 않으면 알린다.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [busy]);
  // 이어서 실패하면 다시 시도까지 남은 시간을 센다.
  useEffect(() => {
    if (d?.phase !== 'error' || !(d.retryAt > Date.now())) return;
    const id = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= d.retryAt) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [d?.phase, d?.retryAt]);
  // 저절로 펼쳐진 안내는 읽을 시간을 준 뒤 접는다. 포인터나 초점이 안에 있으면 그대로 둔다.
  useEffect(() => {
    if (!open || !busy || !app.view.downloadAuto) return;
    const id = setTimeout(() => {
      if (!inside.current && !ref.current?.contains(document.activeElement))
        store.setDownloadOpen(false);
    }, AUTO_FOLD_MS);
    return () => clearTimeout(id);
  }, [open, busy, app.view.downloadAuto]);
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      // Safari는 버튼을 눌러도 초점을 주지 않는다. 초점이 안에 있을 때뿐 아니라 포인터가 올라와 있거나
      // 초점이 어디에도 없을 때도 Esc로 접는다. 입력창에 글을 쓰는 중에는 건드리지 않는다.
      const at = document.activeElement,
        here = ref.current?.contains(at) || inside.current || !at || at === document.body;
      if (e.key !== 'Escape' || !here) return;
      e.stopPropagation();
      if (busy) store.setDownloadOpen(false);
      else store.closeDownload();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, busy]);
  // 화면 낭독기가 놓치지 않게 알림 자리는 늘 깔아 두고, 단계가 바뀔 때만 글을 바꾼다. 받은 비율은 진행 막대가 알린다.
  const live = (
    <span class="sr-only" id="island-live" role="status" aria-live="polite">
      {d ? TITLES[d.task][d.phase] : ''}
    </span>
  );
  if (!d && app.view.modelAsk)
    return (
      <>
        {live}
        <ModelAsk ask={app.view.modelAsk} />
      </>
    );
  if (!d) return live;
  const title = TITLES[d.task][d.phase],
    percent = Math.round((d.progress || 0) * 100),
    stalled = busy && d.at && Date.now() - d.at > STALL_MS,
    wait = d.phase === 'error' ? Math.max(0, Math.ceil((d.retryAt - Date.now()) / 1000)) || 0 : 0;
  return (
    <>
      {live}
      <div
        ref={ref}
        id="model-island"
        class={`island is-${d.phase} ${open ? 'is-open' : ''}`}
        data-phase={d.phase}
        data-task={d.task}
        onPointerEnter={() => (inside.current = true)}
        onPointerLeave={() => (inside.current = false)}
      >
        <button
          class="island-bar"
          id="island-toggle"
          aria-expanded={open}
          aria-controls={open && d.phase !== 'done' ? 'island-panel' : undefined}
          aria-label={`${title}${d.phase === 'fetch' ? ` ${percent}%` : ''} · ${open ? '접기' : '자세히 보기'}`}
          onClick={() =>
            d.phase === 'done' ? store.closeDownload() : store.setDownloadOpen(!open)
          }
        >
          <span class="island-icon">
            {d.phase === 'fetch' ? (
              <Ring value={d.progress || 0} />
            ) : (
              <Icon
                name={
                  d.phase === 'done'
                    ? 'check'
                    : d.phase === 'error'
                      ? 'circle-alert'
                      : 'loader-circle'
                }
                size={16}
                // 한참 멈춰 있으면 도는 표시도 멈춘다. 그때는 글로 알린다.
                className={d.phase !== 'fetch' && busy && !stalled ? 'spin' : ''}
              />
            )}
          </span>
          <span class="island-title">
            {title}
            {stalled && !open && <small> · 멈춘 것 같아요</small>}
          </span>
          {d.phase === 'fetch' && <b class="island-value mono">{percent}%</b>}
          {d.phase !== 'done' && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />}
        </button>
        {open && d.phase !== 'done' && (
          <div class="island-panel" id="island-panel" role="group" aria-label={title}>
            <p class="island-model">
              {d.name}
              {d.totalMB ? ` · 약 ${sizeText(d.totalMB)}` : ''} · 이 기기에서 실행
            </p>
            {busy && (
              <>
                <div
                  class="tape-progress"
                  role="progressbar"
                  aria-label={title}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={d.phase === 'fetch' ? percent : undefined}
                >
                  <span
                    class={d.phase !== 'fetch' ? 'is-waiting' : ''}
                    style={{ width: `${d.phase !== 'fetch' ? 100 : Math.max(2, percent)}%` }}
                  />
                </div>
                <div class="island-numbers mono">
                  <span>
                    {d.phase === 'fetch'
                      ? `${sizeText(d.mb || 0)} / 약 ${sizeText(d.totalMB || 0)}`
                      : d.phase === 'connect'
                        ? '모델 파일에 연결하는 중'
                        : d.cached
                          ? '보관해 둔 모델을 불러오는 중'
                          : '다 받았어요 · 기기에 맞게 준비하는 중'}
                  </span>
                  {d.phase === 'fetch' && <b>{percent}%</b>}
                </div>
              </>
            )}
            <p
              id="island-desc"
              class="island-desc"
              role={d.phase === 'error' ? 'alert' : undefined}
            >
              {d.phase === 'error'
                ? `${d.error || '알 수 없는 오류예요.'} ${
                    d.attempts >= 3
                      ? `${d.attempts}번 이어서 실패했어요. 잠시 뒤에 다시 시도하거나 모델 없이 계속해 주세요.`
                      : '모델 없이도 규칙으로 상담과 배치를 계속할 수 있어요.'
                  }`
                : d.task === 'text'
                  ? '처음 한 번만 받아 이 브라우저에 보관해요. 받는 동안에도 규칙으로 답하니 상담은 계속할 수 있어요. 대화는 기기 밖으로 보내지 않아요.'
                  : '처음 한 번만 받아 이 브라우저에 보관해요. 사진은 기기 밖으로 보내지 않아요.'}
            </p>
            {stalled && (
              <p class="island-stalled" role="status">
                {d.phase === 'fetch' || d.phase === 'connect'
                  ? '한동안 받은 양이 늘지 않았어요. 네트워크를 확인해 주세요. 취소한 뒤 다시 켜면 받은 데서 이어서 받아요.'
                  : '준비가 평소보다 오래 걸려요. 계속 기다리거나, 취소한 뒤 다른 탭을 닫고 다시 켜 보세요.'}
              </p>
            )}
            <footer>
              {d.task === 'text' && (
                <button
                  class="island-btn"
                  onClick={() => {
                    store.setDownloadOpen(false);
                    store.openTool('ai');
                  }}
                >
                  모델 바꾸기
                </button>
              )}
              {busy && (
                <button
                  class="island-btn"
                  id="island-cancel"
                  onClick={() => store.cancelDownload()}
                >
                  {d.task === 'text' ? '취소하고 모델 끄기' : '받기 취소'}
                </button>
              )}
              {d.phase === 'error' && (
                <button
                  class="island-btn"
                  id="island-retry"
                  aria-disabled={wait > 0}
                  onClick={() => store.retryDownload()}
                >
                  {wait > 0 ? `다시 시도 · ${wait}초 뒤` : '다시 시도'}
                </button>
              )}
              <button
                class="island-btn is-primary"
                id="island-close"
                onClick={() => (busy ? store.setDownloadOpen(false) : store.closeDownload())}
              >
                {busy ? '접기' : '닫기'}
              </button>
            </footer>
          </div>
        )}
      </div>
    </>
  );
}
