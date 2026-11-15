import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Pure Node PNG generator matching public/icon.svg aesthetic
 * (forest-slate dial background + brass bezel + 4 category arcs + ivory/brass hands).
 * Zero external dependencies.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function mixColor(c1, c2, t) {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    c1[0] + (c2[0] - c1[0]) * clamped,
    c1[1] + (c2[1] - c1[1]) * clamped,
    c1[2] + (c2[2] - c1[2]) * clamped,
    c1[3] + (c2[3] - c1[3]) * clamped,
  ];
}

function blendPixel(buf, width, x, y, color, alpha = 1) {
  if (alpha <= 0) return;
  const idx = (y * width + x) * 4;
  const a = Math.min(1, alpha) * (color[3] / 255);
  const inv = 1 - a;
  buf[idx] = Math.round(buf[idx] * inv + color[0] * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * inv + color[1] * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * inv + color[2] * a);
  buf[idx + 3] = Math.min(255, Math.round(buf[idx + 3] + (255 - buf[idx + 3]) * a));
}

function smoothStep(edge0, edge1, x) {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x1, py - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x2, py - y2);
  const b = c1 / c2;
  return Math.hypot(px - (x1 + b * vx), py - (y1 + b * vy));
}

function renderIconRgba(size, { maskable = false, rounded = true } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const bgTopLeft = [45, 52, 44, 255]; // #2D342C
  const bgBottomRight = [26, 30, 25, 255]; // #1A1E19
  const dialFill = [35, 40, 33, 255]; // #232821
  const brassStart = [212, 167, 87, 255]; // #D4A757
  const brassEnd = [140, 99, 41, 255]; // #8C6329
  const ivory = [251, 248, 241, 255]; // #FBF8F1

  const arcs = [
    { start: -0.25, end: 0.45, color: [92, 122, 94, 255] }, // #5C7A5E moss
    { start: 0.72, end: 1.32, color: [41, 128, 185, 255] }, // #2980B9 cobalt
    { start: 1.62, end: 2.18, color: [201, 138, 61, 255] }, // #C98A3D amber
    { start: 2.5, end: 3.15, color: [181, 105, 122, 255] }, // #B5697A rose
  ];

  // Maskable icons keep all key iconography inside central ~72% safe circle (14% padding each side)
  const scale = maskable ? 0.72 : 1.0;
  const cx = size / 2;
  const cy = size / 2;
  const unit = (size / 512) * scale;
  const cornerRadius = rounded && !maskable ? size * (112 / 512) : 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const gradT = (px / size + py / size) / 2;
      const bg = mixColor(bgTopLeft, bgBottomRight, gradT);

      let bgAlpha = 1;
      if (cornerRadius > 0) {
        const qx = Math.abs(px - cx) - (size / 2 - cornerRadius);
        const qy = Math.abs(py - cy) - (size / 2 - cornerRadius);
        const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cornerRadius;
        bgAlpha = 1 - smoothStep(-0.8, 0.8, sdf);
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(bg[0]);
      rgba[idx + 1] = Math.round(bg[1]);
      rgba[idx + 2] = Math.round(bg[2]);
      rgba[idx + 3] = Math.round(255 * bgAlpha);

      if (bgAlpha <= 0) continue;

      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx); // -PI..PI

      // Inner dark dial circle
      const innerDialR = 162 * unit;
      if (dist <= innerDialR + 1.5) {
        const a = 1 - smoothStep(innerDialR - 0.8, innerDialR + 0.8, dist);
        blendPixel(rgba, size, x, y, dialFill, a * 0.85 * bgAlpha);
      }

      // Outer brass dial ring
      const brassR = 180 * unit;
      const brassHalfW = 7 * unit;
      const ringDist = Math.abs(dist - brassR);
      if (ringDist <= brassHalfW + 1.2) {
        const a = 1 - smoothStep(brassHalfW - 0.8, brassHalfW + 0.8, ringDist);
        const brass = mixColor(brassStart, brassEnd, gradT);
        blendPixel(rgba, size, x, y, brass, a * 0.92 * bgAlpha);
      }

      // Category color arcs
      const arcR = 140 * unit;
      const arcHalfW = 5 * unit;
      const arcDist = Math.abs(dist - arcR);
      if (arcDist <= arcHalfW + 1.5) {
        for (const arc of arcs) {
          if (angle >= arc.start - 0.04 && angle <= arc.end + 0.04) {
            const radialA = 1 - smoothStep(arcHalfW - 0.8, arcHalfW + 0.8, arcDist);
            const angularPad = 0.03;
            const startA = smoothStep(arc.start - angularPad, arc.start + angularPad, angle);
            const endA = 1 - smoothStep(arc.end - angularPad, arc.end + angularPad, angle);
            blendPixel(rgba, size, x, y, arc.color, radialA * startA * endA * bgAlpha);
          }
        }
      }

      // Hour hand (vertical up)
      const hourDist = distToSegment(px, py, cx, cy, cx, cy - 106 * unit);
      const hourHalfW = 7 * unit;
      if (hourDist <= hourHalfW + 1.2) {
        const a = 1 - smoothStep(hourHalfW - 0.8, hourHalfW + 0.8, hourDist);
        blendPixel(rgba, size, x, y, ivory, a * bgAlpha);
      }

      // Minute hand (horizontal right)
      const minDist = distToSegment(px, py, cx, cy, cx + 80 * unit, cy);
      const minHalfW = 5 * unit;
      if (minDist <= minHalfW + 1.2) {
        const a = 1 - smoothStep(minHalfW - 0.8, minHalfW + 0.8, minDist);
        const brass = mixColor(brassStart, brassEnd, gradT);
        blendPixel(rgba, size, x, y, brass, a * bgAlpha);
      }

      // Center pivot
      const pivotOuter = 18 * unit;
      if (dist <= pivotOuter + 1.2) {
        const a = 1 - smoothStep(pivotOuter - 0.8, pivotOuter + 0.8, dist);
        const brass = mixColor(brassStart, brassEnd, gradT);
        blendPixel(rgba, size, x, y, brass, a * bgAlpha);
      }

      const pivotInner = 8 * unit;
      if (dist <= pivotInner + 1.2) {
        const a = 1 - smoothStep(pivotInner - 0.8, pivotInner + 0.8, dist);
        blendPixel(rgba, size, x, y, ivory, a * bgAlpha);
      }
    }
  }

  return rgba;
}

const targets = [
  { file: 'public/pwa-192x192.png', size: 192, maskable: false, rounded: true },
  { file: 'public/pwa-512x512.png', size: 512, maskable: false, rounded: true },
  { file: 'public/pwa-maskable-512x512.png', size: 512, maskable: true, rounded: false },
  { file: 'public/apple-touch-icon.png', size: 180, maskable: false, rounded: false },
];

for (const target of targets) {
  const outPath = resolve(process.cwd(), target.file);
  mkdirSync(dirname(outPath), { recursive: true });
  const rgba = renderIconRgba(target.size, { maskable: target.maskable, rounded: target.rounded });
  const png = encodePng(target.size, target.size, rgba);
  writeFileSync(outPath, png);
  console.log(`Generated ${target.file} (${target.size}x${target.size}, ${png.length} bytes)`);
}
