import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ToolSession } from '../a2ui.js';
import { A2UI_VERSION } from '../a2ui-catalog.js';
import { NativeTool, surfaceSummary } from './surfaces.jsx';

export function A2uiSurface({ spec, live, onOpen }) {
  const open = useRef(onOpen);
  open.current = onOpen;
  const [attempt, retry] = useState(0);
  const session = useMemo(() => {
    try {
      return new ToolSession(spec, () => open.current?.());
    } catch {
      return null;
    }
  }, [spec.id, attempt]);
  useEffect(() => () => session?.dispose(), [session]);
  let tool;
  try {
    tool = session?.update(spec, live, surfaceSummary(spec));
  } catch {
    /* 이 카드의 오류가 대화와 방 편집을 막지 않게 한다. */
  }
  if (!tool)
    return (
      <section class="surface" role="alert" aria-label="도구 오류">
        <p class="msg-note">도구를 준비하지 못했어요. 입력한 내용과 배치는 그대로예요.</p>
        <button class="chip" onClick={() => retry((n) => n + 1)}>
          도구 다시 열기
        </button>
      </section>
    );
  return (
    <NativeTool
      spec={tool.spec}
      live={tool.expanded}
      summary={tool.summary}
      onOpen={tool.onOpen}
      protocol={{
        'data-a2ui-version': A2UI_VERSION,
        'data-a2ui-surface': tool.surfaceId,
        'data-a2ui-component': tool.component,
      }}
    />
  );
}
