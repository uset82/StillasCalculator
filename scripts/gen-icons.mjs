// Temporary generator for placeholder PWA PNG icons.
// Produces solid-background icons with a centered square mark, no external deps.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(projectRoot, "public", "icons");
mkdirSync(outDir, { recursive: true });

// CRC32 implementation for PNG chunks.
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Build an RGBA PNG: dark slate background, centered light square mark.
function makeIcon(size, innerRatio) {
  const bg = [15, 23, 42, 255]; // #0f172a
  const fg = [56, 189, 248, 255]; // #38bdf8
  const inner = Math.round(size * innerRatio);
  const start = Math.round((size - inner) / 2);
  const end = start + inner;

  const bytesPerPixel = 4;
  const stride = size * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const inSquare = x >= start && x < end && y >= start && y < end;
      const color = inSquare ? fg : bg;
      const p = rowStart + 1 + x * bytesPerPixel;
      raw[p] = color[0];
      raw[p + 1] = color[1];
      raw[p + 2] = color[2];
      raw[p + 3] = color[3];
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(outDir, "icon-192.png"), makeIcon(192, 0.55));
writeFileSync(join(outDir, "icon-512.png"), makeIcon(512, 0.55));
// Maskable icon keeps the mark within the safe zone (smaller inner ratio).
writeFileSync(join(outDir, "icon-512-maskable.png"), makeIcon(512, 0.4));

console.log("Generated PWA icons in", outDir);
