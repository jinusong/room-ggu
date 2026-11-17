// 파일 선택·드롭·붙여넣기가 같은 검증과 전처리를 쓴다.
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 80 * 1000 * 1000;
export const PHOTO_EDGE = 768;
export function isPhotoFile(file) {
  return (
    !!file &&
    (/^image\//i.test(file.type || '') ||
      (!file.type && /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || '')))
  );
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* 일부 브라우저는 Image로만 읽는다. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(Error('decode'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageData(file) {
  if (!isPhotoFile(file)) throw Error('사진 파일을 선택해 주세요. JPG·PNG·WebP를 권장해요.');
  if (!file.size) throw Error('비어 있는 사진이에요. 다른 파일을 선택해 주세요.');
  if (file.size > MAX_PHOTO_BYTES) throw Error('사진은 20MB 이하로 선택해 주세요.');
  let bitmap;
  try {
    bitmap = await decodeImage(file);
  } catch {
    throw Error(
      '사진을 읽지 못했어요. 파일이 손상됐거나 지원하지 않는 형식이에요. JPG·PNG·WebP로 바꿔 다시 올려 주세요.',
    );
  }
  try {
    const w = bitmap.naturalWidth || bitmap.width,
      h = bitmap.naturalHeight || bitmap.height;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w * h > MAX_PHOTO_PIXELS)
      throw Error('사진 해상도가 너무 크거나 올바르지 않아요. 8천만 화소 이하로 줄여 주세요.');
    const scale = Math.min(1, PHOTO_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('사진을 처리할 화면을 준비하지 못했어요. 브라우저를 다시 열어 주세요.');
    // 투명 PNG·WebP가 JPEG로 바뀌며 검은 배경이 되는 것을 막는다.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    if (!data.startsWith('data:image/jpeg'))
      throw Error('사진을 변환하지 못했어요. 다른 사진을 선택해 주세요.');
    return data;
  } finally {
    bitmap.close?.();
  }
}
