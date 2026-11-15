import { useEffect, useRef, useState } from 'preact/hooks';
import * as store from '../app/store.js';
import { app } from '../app/store.js';
import { sizeText } from '../app/models.js';
import { Icon } from './icons.js';

// 모델 파일을 내려받는 동안 띄우는 안내. 받는 중에도 앱은 규칙으로 계속 쓸 수 있으므로
// "계속 쓰기"를 누르면 방 위의 작은 진행 표시로 줄어든다. 보관해 둔 모델을 불러올 때는 뜨지 않는다.
const STALL_MS = 60000;
const TITLES = {
  text: {
    fetch: '상담 모델을 내려받는 중',
    init: '받은 모델을 준비하는 중',
    done: '상담 모델이 준비됐어요',
    error: '상담 모델을 준비하지 못했어요',
  },
  vision: {
    fetch: '사진 판별 모델을 내려받는 중',
    init: '받은 모델을 준비하는 중',
    done: '사진 판별 모델이 준비됐어요',
    error: '사진 판별 모델을 준비하지 못했어요',
  },
};

export function ModelDownload() {
  const d = app.ai.download,
    open = !!d && app.view.downloadOpen;
  const primary = useRef(null);
  // 받는 중에는 몇 초마다 다시 그려, 받은 양이 한동안 늘지 않으면 알린다.
  const [, tick] = useState(0);
  useEffect(() => {
    if (d?.phase !== 'fetch' && d?.phase !== 'init') return;
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [d?.phase]);
  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        d.phase === 'fetch' || d.phase === 'init'
          ? store.setDownloadOpen(false)
          : store.closeDownload();
      }
      // 다이얼로그가 떠 있는 동안 Tab은 그 안의 버튼만 돈다.
      if (e.key === 'Tab') {
        const buttons = [...document.querySelectorAll('#download-dialog button')];
        if (!buttons.length) return;
        const at = buttons.indexOf(document.activeElement),
          next = (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        e.preventDefault();
        buttons[at < 0 ? 0 : next].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, d?.phase]);
  if (!d) return null;
  const stalled =
    (d.phase === 'fetch' || d.phase === 'init') && d.at && Date.now() - d.at > STALL_MS;
  const busy = d.phase === 'fetch' || d.phase === 'init',
    percent = Math.round((d.progress || 0) * 100),
    title = TITLES[d.task][d.phase];
  if (!open)
    return busy ? (
      <button
        class="download-pill"
        id="download-pill"
        aria-label={`${title} ${percent}% · 자세히 보기`}
        onClick={() => store.setDownloadOpen(true)}
      >
        <Icon name="loader-circle" size={14} className="spin" />
        <span>{d.phase === 'fetch' ? `${d.name} 내려받는 중` : `${d.name} 준비하는 중`}</span>
        {d.phase === 'fetch' && <b class="mono">{percent}%</b>}
      </button>
    ) : null;
  return (
    <div class="download-scrim">
      <div
        class={`download-dialog is-${d.phase}`}
        id="download-dialog"
        role={d.phase === 'error' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="download-title"
        aria-describedby="download-desc"
      >
        <header>
          <span class="download-icon">
            <Icon
              name={
                d.phase === 'done'
                  ? 'check'
                  : d.phase === 'error'
                    ? 'circle-alert'
                    : d.phase === 'init'
                      ? 'loader-circle'
                      : 'download'
              }
              className={d.phase === 'init' ? 'spin' : ''}
            />
          </span>
          <div>
            <h2 id="download-title">{title}</h2>
            <p class="download-model">
              {d.name}
              {d.totalMB ? ` · 약 ${sizeText(d.totalMB)}` : ''} · 이 기기에서 실행
            </p>
          </div>
        </header>
        {busy && (
          <>
            <div
              class="tape-progress"
              role="progressbar"
              aria-label={title}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={percent}
            >
              <span style={{ width: `${Math.max(2, percent)}%` }} />
            </div>
            <div class="download-numbers mono">
              <span>
                {d.phase === 'fetch'
                  ? `${sizeText(d.mb || 0)} / 약 ${sizeText(d.totalMB || 0)}`
                  : '내려받기 완료 · 기기에 맞게 준비 중'}
              </span>
              <b>{percent}%</b>
            </div>
          </>
        )}
        <p id="download-desc" class="download-desc">
          {d.phase === 'error'
            ? `${d.error || '알 수 없는 오류예요.'} 모델 없이도 규칙으로 상담과 배치를 계속할 수 있어요.`
            : d.phase === 'done'
              ? d.task === 'text'
                ? '이제 문장을 모델이 먼저 해석하고, 숫자와 범위는 앱이 확인해요.'
                : '올린 사진의 가구 종류를 이 기기에서 판별해요.'
              : '처음 한 번만 받아 이 브라우저에 보관해요. 받는 동안에도 규칙으로 답하니 방은 계속 꾸밀 수 있어요. 대화와 사진은 기기 밖으로 보내지 않아요.'}
        </p>
        {stalled && (
          <p class="download-stalled" role="status">
            {d.phase === 'fetch'
              ? '한동안 받은 양이 늘지 않았어요. 네트워크를 확인해 주세요. 취소한 뒤 다시 켜면 받은 데서 이어서 받아요.'
              : '준비가 평소보다 오래 걸려요. 계속 기다리거나, 취소한 뒤 다른 탭을 닫고 다시 켜 보세요.'}
          </p>
        )}
        <footer>
          {busy && (
            <button class="btn" id="download-cancel" onClick={() => store.cancelDownload()}>
              {d.task === 'text' ? '취소하고 모델 끄기' : '내려받기 취소'}
            </button>
          )}
          {d.phase === 'error' && (
            <button class="btn" onClick={() => store.retryDownload()}>
              다시 시도
            </button>
          )}
          <button
            class="btn primary"
            id="download-continue"
            ref={primary}
            onClick={() => (busy ? store.setDownloadOpen(false) : store.closeDownload())}
          >
            {busy ? '계속 쓰기' : '확인'}
          </button>
        </footer>
      </div>
    </div>
  );
}
