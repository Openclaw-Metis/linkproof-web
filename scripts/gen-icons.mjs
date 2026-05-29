// Generates the PWA app icons: a full-bleed teal (#0B6E69) square (maskable-safe)
// with a paper-white check mark — "點開前，先查證 / check before the tap".
// Self-contained PNG encoder (no image deps); uses Node's zlib for IDAT + CRC.

import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(outDir, { recursive: true });

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  const cx = a[0] + t * vx;
  const cy = a[1] + t * vy;
  return Math.hypot(px - cx, py - cy);
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const teal = [0x0b, 0x6e, 0x69];
  const paper = [0xf7, 0xf4, 0xec];
  // Check mark polyline (normalized), kept inside the central maskable safe zone.
  const pts = [
    [0.28, 0.54],
    [0.44, 0.70],
    [0.74, 0.32],
  ].map(([x, y]) => [x * size, y * size]);
  const hw = 0.072 * size; // half stroke width
  const aa = Math.max(1, size / 256); // anti-alias band

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.min(
        distToSegment(x + 0.5, y + 0.5, pts[0], pts[1]),
        distToSegment(x + 0.5, y + 0.5, pts[1], pts[2]),
      );
      // alpha of the white stroke over the teal background
      let strokeA = 0;
      if (d <= hw) strokeA = 1;
      else if (d <= hw + aa) strokeA = 1 - (d - hw) / aa;
      rgba[i] = Math.round(teal[0] + (paper[0] - teal[0]) * strokeA);
      rgba[i + 1] = Math.round(teal[1] + (paper[1] - teal[1]) * strokeA);
      rgba[i + 2] = Math.round(teal[2] + (paper[2] - teal[2]) * strokeA);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

for (const { size, name } of [
  { size: 512, name: "icon-512.png" },
  { size: 192, name: "icon-192.png" },
  { size: 180, name: "apple-touch-icon.png" },
]) {
  const png = encodePNG(size, size, render(size));
  writeFileSync(join(outDir, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
