import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ROOM_TYPES } from '../catalog.js';
import * as store from '../app/store.js';
import { Icon } from './icons.js';

export function RoomEditor({ room, name }) {
  const [error, setError] = useState('');
  const [type, setType] = useState(room.type);
  const field = useRef(null);
  useLayoutEffect(() => field.current?.focus({ preventScroll: true }), []);
  const close = () => {
    store.setRoomEditor(false);
    document.getElementById('edit-space')?.focus();
  };
  const submit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const error = store.updateSpace({
      name: data.get('name'),
      type,
      dims: Object.fromEntries(['w', 'd', 'h'].map((key) => [key, Number(data.get(key))])),
    });
    if (error) setError(error);
    else close();
  };
  return (
    <form class="editor-pop room-form" aria-label="방 편집" onSubmit={submit}>
      <div class="editor-pop-head">
        <strong>방 편집</strong>
        <button class="icon-btn" type="button" aria-label="방 편집 닫기" onClick={close}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="editor-fields">
        <label>
          방 이름
          <input ref={field} name="name" defaultValue={name} maxLength={100} required />
        </label>
        <label>
          방 종류
          <select name="type" value={type} onChange={(event) => setType(event.currentTarget.value)}>
            {Object.entries(ROOM_TYPES).map(([key, info]) => (
              <option key={key} value={key}>
                {info.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="editor-measures">
        {[
          ['w', '가로'],
          ['d', '세로'],
          ['h', '천장 높이'],
        ].map(([key, label]) => (
          <label key={key}>
            {label} (m)
            <input
              name={key}
              type="number"
              min="1"
              max="15"
              step={room[key] === Number(room[key].toFixed(2)) ? '0.01' : 'any'}
              defaultValue={room[key]}
              required
            />
          </label>
        ))}
      </div>
      {error && (
        <p class="warn-text" role="alert">
          {error}
        </p>
      )}
      <div class="editor-pop-foot">
        <button
          class="btn small"
          type="button"
          data-room-turn
          aria-label="선택한 방 90도 돌리기"
          onClick={() => {
            store.rotateSpace();
            store.setRoomEditor(false);
          }}
        >
          <Icon name="rotate-cw" size={16} />
          회전
        </button>
        <button
          class="btn small"
          type="button"
          onClick={() => {
            store.setRoomEditor(false);
            if (store.app.view.sheet === 'peek') store.setSheet('half');
            store.openTool('windows');
          }}
        >
          창문
        </button>
        <button class="btn primary small" type="submit">
          저장
        </button>
      </div>
    </form>
  );
}
