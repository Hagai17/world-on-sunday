// world-on-sunday — entry program for make.fun's news-image-20261122.
//
// The repository holds one image, entry.png, a newspaper front page that sums
// up the world news of Sunday 22 November 2026. This program checks the file
// against the competition's gate (a whole PNG or JPEG, at most 1 MiB and at
// most 1024x1024 pixels) and then copies it, byte for byte, to
// /output/entry.png. Node 22, standard library only, no network.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1_048_576; // 1 MiB
const MAX_SIDE = 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fail(message: string): never {
  throw new Error(`entry.png rejected: ${message}`);
}

function detectFormat(bytes: Buffer): 'png' | 'jpeg' {
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return fail('first bytes are neither the PNG signature nor the JPEG SOI marker');
}

// CRC-32 (ISO 3309, the PNG polynomial), table-driven, no dependencies.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Walk every PNG chunk: verify each CRC, take the picture size from IHDR,
// and require the stream to end exactly with IEND.
function pngSize(bytes: Buffer): { width: number; height: number } {
  let offset = PNG_SIGNATURE.length;
  let size: { width: number; height: number } | undefined;
  for (;;) {
    if (offset + 12 > bytes.length) fail('PNG chunk header runs past the end of the file');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail(`PNG chunk ${type} runs past the end of the file`);
    const storedCrc = bytes.readUInt32BE(dataEnd);
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== storedCrc) {
      fail(`PNG chunk ${type} has a bad CRC`);
    }
    if (type === 'IHDR') {
      if (length !== 13) fail('IHDR chunk is not 13 bytes');
      size = { width: bytes.readUInt32BE(dataStart), height: bytes.readUInt32BE(dataStart + 4) };
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (offset !== bytes.length) fail('bytes follow the IEND chunk');
  if (!size) fail('PNG has no IHDR chunk');
  return size;
}

// Walk JPEG markers to the start of scan, taking the picture size from the
// first SOF0/SOF2 segment met on the way.
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let offset = 2; // skip the SOI marker
  let size: { width: number; height: number } | undefined;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) fail(`JPEG marker expected at byte ${offset}`);
    const marker = bytes[offset + 1];
    if (marker === 0xda) break; // SOS: the compressed data follows
    if (marker === 0xd9) break; // EOI before any scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // standalone markers carry no length
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      fail('JPEG segment runs past the end of the file');
    }
    if ((marker === 0xc0 || marker === 0xc2) && !size) {
      size = {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  if (!size) fail('JPEG has no SOF0 or SOF2 segment before the scan data');
  return size;
}

function checkWhole(bytes: Buffer, format: 'png' | 'jpeg'): { width: number; height: number } {
  if (format === 'jpeg' && (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)) {
    fail('JPEG does not end with the EOI marker');
  }
  const size = format === 'png' ? pngSize(bytes) : jpegSize(bytes);
  if (size.width < 1 || size.height < 1 || size.width > MAX_SIDE || size.height > MAX_SIDE) {
    fail(`picture is ${size.width}x${size.height}, outside the 1024x1024 cap`);
  }
  return size;
}

const here = dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(join(here, 'entry.png'));

if (bytes.length === 0 || bytes.length > MAX_BYTES) {
  fail(`size is ${bytes.length} bytes, over the 1 MiB cap`);
}

const format = detectFormat(bytes);
const { width, height } = checkWhole(bytes, format);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), bytes);
console.log(`wrote ${bytes.length} bytes (${format}, ${width}x${height}) to ${join(outDir, 'entry.png')}`);
