// 사용자 문장의 단위와 축을 읽는다. 모델 출력에는 치수 값을 맡기지 않는다.
export const AXES = {
  width: '가로|너비|폭|길이|width|length',
  depth: '깊이|세로|depth',
  height: '전체\\s*높이|천장\\s*높이|천장|높이|height',
};
export const NUMBER = '-?\\d+(?:\\.\\d+)?';
export const UNIT = '밀리미터|센티미터|센티|센치|미터|mm|cm|m(?![²2a-z])';
export const NOT_THIS = '(?:말고|말구|대신|아니(?:라|고))';
const valuePattern = `(${NUMBER})\\s*(${UNIT})?`;
const axisPattern = `(${Object.values(AXES).join('|')})`;
const particles = '[는은가이을를:\\s]*';
const absoluteField = `${axisPattern}${particles}${valuePattern}`;
const SPACE_SIZE_ANSWER = new RegExp(
  String.raw`^${absoluteField}(?:[\s,]+${absoluteField})*\s*(?:으로|로)?\s*(?:해\s*(?:줘요?|주세요)|할게요?)?[.!?]?$`,
  'iu',
);
export const isSpaceSizeAnswer = (text) => SPACE_SIZE_ANSWER.test(text);
const lengthCm = (n, unit) => {
  if (/^(?:m|미터)$/i.test(unit)) return n * 100;
  if (/^(?:mm|밀리미터)$/i.test(unit)) return n / 10;
  return n;
};
export const axisKey = (label) =>
  Object.keys(AXES).find((axis) => new RegExp(`^(?:${AXES[axis]})$`, 'i').test(label));

export function sizeFields(text, room = false) {
  const values = {},
    keys = room ? { width: 'w', depth: 'd', height: 'h' } : { width: 0, height: 1, depth: 2 };
  let issue = null;
  const put = (axis, number, explicitUnit) => {
    const n = +number;
    const unit = explicitUnit?.toLowerCase() || (room && n <= 15 ? 'm' : 'cm');
    if (!room && !explicitUnit && axis !== 'height' && n > 0 && n < 10) {
      issue ||= { kind: 'unit', axis };
      return;
    }
    const cm = lengthCm(n, unit);
    const value = room ? Math.round(cm) / 100 : Math.round(cm * 10) / 10;
    const key = keys[axis];
    if (room ? cm < 100 || cm > 1500 : cm < 1 || cm > 1500) {
      issue ||= { kind: 'range', axis };
      return;
    }
    if (values[key] && values[key].value !== value) issue ||= { kind: 'conflict', axis };
    else values[key] = { value, number: n, unit, axis };
  };
  const abs = new RegExp(`${absoluteField}(?![\\d.])`, 'gi');
  const correction = new RegExp(
    `^\\s*(?:은|는|이|가|이건)?\\s*${NOT_THIS}\\s*(?:${axisPattern}${particles})?${valuePattern}`,
    'i',
  );
  for (const m of text.matchAll(abs)) {
    const after = text.slice(m.index + m[0].length);
    if (/^\s*(?:평|m²|m2|제곱미터|만\s*(?:줄|늘)|(?:정도\s*)?(?:줄여|늘려))/.test(after)) continue;
    const fix = after.match(correction);
    if (fix && (!fix[1] || axisKey(fix[1]) === axisKey(m[1]))) {
      // 명시한 치수 뒤에 단위 없이 정정하면 앞 숫자의 단위를 이어 받는다.
      if (!fix[1]) put(axisKey(m[1]), fix[2], fix[3] || m[3] || (room && +m[2] <= 15 ? 'm' : 'cm'));
    } else put(axisKey(m[1]), m[2], m[3]);
  }
  const tuple = text.match(
    new RegExp(`${valuePattern}\\s*[x×*]\\s*${valuePattern}(?:\\s*[x×*]\\s*${valuePattern})?`, 'i'),
  );
  if (tuple) {
    const defaultUnit = tuple[6] || tuple[4] || tuple[2];
    for (const [axis, n, unit] of [
      ['width', tuple[1], tuple[2]],
      ['depth', tuple[3], tuple[4]],
      ['height', tuple[5], tuple[6]],
    ])
      if (
        n !== undefined &&
        values[keys[axis]] === undefined &&
        (room || tuple[5] !== undefined || defaultUnit)
      )
        put(axis, n, unit || defaultUnit);
  }
  return { values, issue };
}

export function relativeSize(text) {
  const m = text.match(
    new RegExp(
      `${valuePattern}\\s*(?:정도|가량|만)?\\s*(줄여|줄이|줄여서|좁혀|낮춰|늘려|늘리|넓혀|높여)`,
      'i',
    ),
  );
  if (!m) return null;
  const prefix = text.slice(0, m.index);
  const axis = [...prefix.matchAll(new RegExp(axisPattern, 'gi'))].at(-1)?.[1];
  return {
    axis: axisKey(axis || ''),
    unit: m[2],
    delta: lengthCm(+m[1], m[2]) * (/^늘|^넓|^높/.test(m[3]) ? 1 : -1),
  };
}

export function numericCorrection(text) {
  const m = text.match(
    new RegExp(
      `^(?:아니|아냐|앗|아|잠깐)?[,.!\\s]*${valuePattern}\\s*(?:은|는|이|가)?\\s*${NOT_THIS}\\s*${valuePattern}(?![\\d.])(?:\\s*(?:으?로.*|이야|야|요|맞춰.*|해.*|[.!?]))?\\s*$`,
      'i',
    ),
  );
  return m && { from: +m[1], fromUnit: m[2], to: +m[3], unit: m[4] };
}
export { lengthCm };
