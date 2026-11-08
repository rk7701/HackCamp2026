/** Keep phone uploads small; the shape model ultimately consumes a 512 px image. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_TARGET_BYTES = 1024 * 1024;

export async function preparePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare this photo.');
    // Transparent cutouts must not acquire a black background when encoded as JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if ((data.length - data.indexOf(',') - 1) * 0.75 <= PHOTO_TARGET_BYTES) return data;
    }
    // High-frequency/noisy photos can still be large: reduce dimensions as well.
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(canvas.width / 2));
    small.height = Math.max(1, Math.round(canvas.height / 2));
    small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
    return small.toDataURL('image/jpeg', 0.7);
  } finally {
    bitmap.close();
  }
}
