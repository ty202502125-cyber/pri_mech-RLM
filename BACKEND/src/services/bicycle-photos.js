const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const privateBicyclePhotoDirectory = path.resolve(__dirname, '../../private-uploads/bicycle-photos');
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function parseBicyclePhotoDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) return null;
  const validSignature = match[1] === 'image/jpeg'
    ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : match[1] === 'image/png'
      ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!validSignature || !allowedTypes.has(match[1])) return null;
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1] === 'image/png' ? 'png' : 'webp';
  return { buffer, contentType: match[1], extension };
}

async function saveBicyclePhoto(photo) {
  await fs.mkdir(privateBicyclePhotoDirectory, { recursive: true });
  const filename = `${crypto.randomUUID()}.${photo.extension}`;
  const fullPath = path.join(privateBicyclePhotoDirectory, filename);
  await fs.writeFile(fullPath, photo.buffer, { flag: 'wx' });
  return { filename, fullPath };
}

module.exports = { privateBicyclePhotoDirectory, parseBicyclePhotoDataUrl, saveBicyclePhoto, MAX_PHOTO_BYTES };
