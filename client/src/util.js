export function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (d < 365) return `${w}w`;
  return `${Math.floor(d / 365)}y`;
}

export function fullDate(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function compact(n) {
  if (Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

export const DIVISION_NAMES = { 1: 'Division I', 2: 'Division II', 3: 'Division III' };

// Re-encode photos in the browser before upload: shrinks them and drops all
// metadata (GPS, device info). The server strips metadata again regardless.
export async function prepareImage(file) {
  if (!file) return null;
  if (file.type === 'image/gif') return file;
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 1800;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const keepAlpha = file.type === 'image/png';
    const blob = await new Promise((r) => canvas.toBlob(r, keepAlpha ? 'image/png' : 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], keepAlpha ? 'image.png' : 'image.jpg', { type: blob.type });
  } catch {
    return file;
  }
}
