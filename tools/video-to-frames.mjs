// 视频帧 → 透明像素动画：抠黑底、统一裁切、预乘缩放，输出逐帧 PNG + 雪碧图。
//
//   node tools/video-to-frames.mjs                默认 64×64、自动找循环
//   node tools/video-to-frames.mjs --size 48
//   node tools/video-to-frames.mjs --tol 30 --step 4 --start 0 --end 120
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "./png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const RAW = flag("raw", join(ROOT, "frames-raw", "video-960x540.rgb"));
const SRC_W = Number(flag("w", "960"));
const SRC_H = Number(flag("h", "540"));
const SIZE = Number(flag("size", "64"));
const TOL = Number(flag("tol", "30"));
const ERODE = Number(flag("erode", "1"));
const EVERY = Math.max(1, Number(flag("every", "2")));
// 源自带 alpha（WebM/VP9、ProRes、APNG、带透明的 GIF 都行）时不抠图，直接用 alpha 通道
const HAS_ALPHA = args.includes("--alpha") || flag("bpp", "3") === "4";
const BPP = HAS_ALPHA ? 4 : 3;

const raw = readFileSync(RAW);
const frameBytes = SRC_W * SRC_H * BPP;
const total = Math.floor(raw.length / frameBytes);
if (total === 0) throw new Error("raw 视频是空的");

// ---------- 1. 估背景色 + 统计 ----------
function pixel(frame, x, y) {
  const i = frame * frameBytes + (y * SRC_W + x) * BPP;
  return [raw[i], raw[i + 1], raw[i + 2]];
}
function cornerMedian() {
  const samples = [[], [], []];
  const patches = [
    [0, 0],
    [SRC_W - 16, 0],
    [0, SRC_H - 16],
    [SRC_W - 16, SRC_H - 16],
  ];
  for (const [px, py] of patches) {
    for (let y = py; y < py + 16; y++) {
      for (let x = px; x < px + 16; x++) {
        const [r, g, b] = pixel(0, x, y);
        samples[0].push(r);
        samples[1].push(g);
        samples[2].push(b);
      }
    }
  }
  return samples.map((list) => {
    list.sort((a, b) => a - b);
    return list[Math.floor(list.length / 2)];
  });
}
const BG = HAS_ALPHA ? [0, 0, 0] : cornerMedian();
const dist = (r, g, b) => Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]);
console.log(`帧数      ${total}`);
console.log(`抠图方式  ${HAS_ALPHA ? "源自带 alpha，直接读取" : `边缘洪水填充，背景色 rgb(${BG.join(", ")})`}`);

// ---------- 2. mask：0..255 的覆盖率 ----------
function maskOf(frame) {
  const mask = new Uint8Array(SRC_W * SRC_H);

  if (HAS_ALPHA) {
    // 源本身有透明通道：原样保留软边
    for (let i = 0; i < mask.length; i++) {
      mask[i] = raw[frame * frameBytes + i * BPP + 3];
    }
    return mask;
  }

  const bg = new Uint8Array(SRC_W * SRC_H);
  const seen = new Uint8Array(SRC_W * SRC_H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= SRC_W || y >= SRC_H) return;
    const idx = y * SRC_W + x;
    if (seen[idx]) return;
    seen[idx] = 1;
    const i = frame * frameBytes + idx * BPP;
    if (dist(raw[i], raw[i + 1], raw[i + 2]) > TOL) return;
    bg[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < SRC_W; x++) {
    push(x, 0);
    push(x, SRC_H - 1);
  }
  for (let y = 0; y < SRC_H; y++) {
    push(0, y);
    push(SRC_W - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % SRC_W;
    const y = (idx - x) / SRC_W;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  // 前景 = 没被洪水填充到的像素；再腐蚀掉 ERODE 圈，磨掉压缩噪点造成的黑边
  let fg = new Uint8Array(SRC_W * SRC_H);
  for (let i = 0; i < fg.length; i++) fg[i] = bg[i] ? 0 : 255;
  for (let e = 0; e < ERODE; e++) {
    const next = new Uint8Array(fg.length);
    for (let y = 1; y < SRC_H - 1; y++) {
      for (let x = 1; x < SRC_W - 1; x++) {
        const idx = y * SRC_W + x;
        if (!fg[idx]) continue;
        next[idx] = fg[idx - 1] && fg[idx + 1] && fg[idx - SRC_W] && fg[idx + SRC_W] ? 255 : 0;
      }
    }
    fg = next;
  }
  return fg;
}

// ---------- 3. 只处理抽到的帧，顺便求统一 bbox ----------
const picked = [];
for (let f = 0; f < total; f += EVERY) picked.push(f);

process.stdout.write("抠背景…");
const masks = new Map();
let minX = SRC_W;
let minY = SRC_H;
let maxX = -1;
let maxY = -1;
for (const f of picked) {
  const mask = maskOf(f);
  masks.set(f, mask);
  for (let y = 0; y < SRC_H; y++) {
    for (let x = 0; x < SRC_W; x++) {
      if (mask[y * SRC_W + x] < 128) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log(` 完成`);
if (maxX < 0) throw new Error("整段都没抠出前景，阈值可能太严");

// 正方形裁切，居中，略留边
const bw = maxX - minX + 1;
const bh = maxY - minY + 1;
const margin = Math.round(Math.max(bw, bh) * 0.02);
const side = Math.max(bw, bh) + margin * 2;
const cropX = Math.round((minX + maxX + 1) / 2 - side / 2);
const cropY = Math.round((minY + maxY + 1) / 2 - side / 2);
console.log(`人物范围  x ${minX}–${maxX}  y ${minY}–${maxY}  (${bw}×${bh})`);
console.log(`裁切方框  ${side}×${side} @ (${cropX}, ${cropY})`);

// ---------- 4. 预乘面积平均缩放到 SIZE ----------
function renderFrame(frame, mask) {
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const scale = side / SIZE;
  for (let oy = 0; oy < SIZE; oy++) {
    for (let ox = 0; ox < SIZE; ox++) {
      const sx0 = cropX + ox * scale;
      const sy0 = cropY + oy * scale;
      let r = 0;
      let g = 0;
      let b = 0;
      let coverage = 0;
      let n = 0;
      const xEnd = Math.min(Math.floor(sx0 + scale), SRC_W);
      const yEnd = Math.min(Math.floor(sy0 + scale), SRC_H);
      for (let sy = Math.floor(sy0); sy < yEnd; sy++) {
        for (let sx = Math.floor(sx0); sx < xEnd; sx++) {
          n++;
          if (sx < 0 || sy < 0) continue;
          const a = mask[sy * SRC_W + sx];
          if (a === 0) continue;
          const w = a / 255;
          const i = frame * frameBytes + (sy * SRC_W + sx) * BPP;
          r += raw[i] * w;
          g += raw[i + 1] * w;
          b += raw[i + 2] * w;
          coverage += w;
        }
      }
      const o = (oy * SIZE + ox) * 4;
      if (coverage === 0 || n === 0) continue;
      // 预乘：颜色按覆盖率加权平均，alpha 按覆盖率占比
      out[o] = Math.round(r / coverage);
      out[o + 1] = Math.round(g / coverage);
      out[o + 2] = Math.round(b / coverage);
      out[o + 3] = Math.round((coverage / n) * 255);
    }
  }
  return out;
}

process.stdout.write("缩放…");
const frames = new Map();
for (const f of picked) frames.set(f, renderFrame(f, masks.get(f)));
console.log(` 完成`);

// ---------- 5. 检查循环接缝 ----------
function diff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
  }
  return sum;
}
const first = picked[0];
const last = picked[picked.length - 1];
const seam = diff(frames.get(first), frames.get(last));
const typical = diff(frames.get(picked[0]), frames.get(picked[1]));
console.log(`抽帧      每 ${EVERY} 帧取一张 → ${picked.length} 帧`);
console.log(`接缝差    ${(seam / 1e6).toFixed(2)}  (相邻帧差 ${(typical / 1e6).toFixed(2)}，越接近相邻帧越顺)`);

// ---------- 6. 写逐帧 + 雪碧图 ----------
const framesDir = join(ROOT, "frames");
mkdirSync(framesDir, { recursive: true });
const sheet = Buffer.alloc(SIZE * picked.length * SIZE * 4);
picked.forEach((f, index) => {
  const buf = frames.get(f);
  writeFileSync(join(framesDir, `rice-${String(index).padStart(3, "0")}.png`), encodePNG(SIZE, SIZE, buf));
  for (let y = 0; y < SIZE; y++) {
    buf.copy(sheet, (y * SIZE * picked.length + index * SIZE) * 4, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
});
mkdirSync(join(ROOT, "assets"), { recursive: true });
const sheetPath = join(ROOT, "assets", "rice-sheet.png");
writeFileSync(sheetPath, encodePNG(SIZE * picked.length, SIZE, sheet));

// ---------- 7. 预览：抽样排成网格 + 深浅底 ----------
const SCALE = Math.max(1, Math.round(260 / SIZE));
const pad = 6;
const cols = 10;
const stride = Math.max(1, Math.ceil(picked.length / 50));
const sampled = [];
for (let f = 0; f < picked.length; f += stride) sampled.push(picked[f]);
const rows = Math.ceil(sampled.length / cols);
const cell = SIZE * SCALE + pad;
const previewW = cols * cell + pad;
const previewH = rows * cell * 2 + pad * 3;
const preview = Buffer.alloc(previewW * previewH * 4);
const put = (x, y, [r, g, b, a]) => {
  const o = (y * previewW + x) * 4;
  const src = preview[o + 3] / 255;
  const dst = a / 255;
  const out = src + dst * (1 - src);
  if (out === 0) return;
  preview[o] = Math.round((r * dst + preview[o] * src * (1 - dst)) / out);
  preview[o + 1] = Math.round((g * dst + preview[o + 1] * src * (1 - dst)) / out);
  preview[o + 2] = Math.round((b * dst + preview[o + 2] * src * (1 - dst)) / out);
  preview[o + 3] = Math.round(out * 255);
};
const fill = (x0, y0, x1, y1, color) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, color);
};
const LIGHT = [255, 255, 255, 255];
const DARK = [27, 27, 28, 255];
fill(0, 0, previewW, previewH, LIGHT);
fill(0, rows * cell + pad * 2, previewW, previewH, DARK);
for (let si2 = 0; si2 < sampled.length; si2++) {
  const f = sampled[si2];
  const cx = pad + (si2 % cols) * cell;
  const cy = pad + Math.floor(si2 / cols) * cell;
  for (let y = 0; y < SIZE * SCALE; y++) {
    for (let x = 0; x < SIZE * SCALE; x++) {
      const si = (Math.floor(y / SCALE) * SIZE + Math.floor(x / SCALE)) * 4;
      const f32 = frames.get(f);
      const color = [f32[si], f32[si + 1], f32[si + 2], f32[si + 3]];
      put(cx + x, cy + y, color);
      put(cx + x, cy + rows * cell + pad * 2 + y, color);
    }
  }
}
writeFileSync(join(ROOT, "assets", `preview-${SIZE}.png`), encodePNG(previewW, previewH, preview));

console.log(`输出      frames/ ${picked.length} 帧 ${SIZE}×${SIZE}`);
console.log(`雪碧图    assets/rice-sheet.png  ${SIZE * picked.length}×${SIZE}`);
console.log(`预览      assets/preview-${SIZE}.png`);
