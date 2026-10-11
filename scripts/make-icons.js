import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = join(fileURLToPath(import.meta.url), '..', '..', 'packages', 'extension', 'icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function pixelAt(x, y, size) {
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const corner = 0.18;
  const dx = Math.max(corner - u, u - (1 - corner), 0);
  const dy = Math.max(corner - v, v - (1 - corner), 0);
  if (dx * dx + dy * dy > corner * corner) return [0, 0, 0, 0];
  const inShield = Math.abs(u - 0.5) < 0.28 - Math.max(0, v - 0.55) * 0.75 && v > 0.2 && v < 0.85;
  return inShield ? [255, 255, 255, 255] : [15, 118, 110, 255];
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) row.push(...pixelAt(x, y, size));
    rows.push(Buffer.from(row));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(join(outDir, `icon${size}.png`), png(size));
console.log(`wrote icons to ${outDir}`);
