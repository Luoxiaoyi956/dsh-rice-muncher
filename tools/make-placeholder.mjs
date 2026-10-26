// 临时占位素材：一条抱着饭碗的小鱼，12 帧，每帧 32×32，横排拼成雪碧图。
// 正式美术到位后，这个脚本就可以删掉，改用 tools/build.mjs 读真图。
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "./png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAME = 32;
const COUNT = 12;
const SCALE = 6;

const C = {
  ink: "#2b2422",
  body: "#86b8d9",
  belly: "#cfe4f0",
  fin: "#5f9ec7",
  bowl: "#cf8f4f",
  bowlDark: "#a9713a",
  rice: "#f5f1e4",
  riceShade: "#ded6c0",
  spoon: "#cdd5dd",
  mouth: "#8a4a4a",
  eyeWhite: "#fbfbf6",
};

function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
    255,
  ];
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x, y, color) {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = color[3] ?? 255;
  }
  clearPixel(x, y) {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i + 3] = 0;
  }
  alphaAt(x, y) {
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, color);
      }
    }
  }
  rect(x0, y0, x1, y1, color) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, color);
  }
  line(x0, y0, x1, y1, color) {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x, y, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }
  /** Paint a 1px ink outline around the current silhouette (4-neighbourhood). */
  outline(color) {
    const marks = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alphaAt(x, y) !== 0) continue;
        const near =
          this.alphaAt(x - 1, y) !== 0 ||
          this.alphaAt(x + 1, y) !== 0 ||
          this.alphaAt(x, y - 1) !== 0 ||
          this.alphaAt(x, y + 1) !== 0;
        if (near) marks.push([x, y]);
      }
    }
    for (const [x, y] of marks) this.set(x, y, color);
  }
  /** Nearest-neighbour copy of another canvas. */
  blit(src, destX) {
    for (let y = 0; y < src.h && y < this.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (src.data[i + 3] === 0) continue;
        const t = (y * this.w + destX + x) * 4;
        this.data[t] = src.data[i];
        this.data[t + 1] = src.data[i + 1];
        this.data[t + 2] = src.data[i + 2];
        this.data[t + 3] = src.data[i + 3];
      }
    }
  }
  /** Integer nearest-neighbour upscale, for a human-inspectable preview. */
  upscale(factor, background) {
    const out = new Canvas(this.w * factor, this.h * factor);
    if (background) out.rect(0, 0, out.w - 1, out.h - 1, hex(background));
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if (this.data[i + 3] === 0) continue;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            out.set(x * factor + dx, y * factor + dy, [
              this.data[i],
              this.data[i + 1],
              this.data[i + 2],
              this.data[i + 3],
            ]);
          }
        }
      }
    }
    return out;
  }
}

// 一勺饭的 12 个节拍：勺子位置 / 嘴型(0闭 1半张 2张开) / 身体下沉 / 尾巴摆动。
const SHOTS = [
  { sx: 10, sy: 20, mouth: 0, bob: 0, wag: 0 },
  { sx: 10, sy: 19, mouth: 0, bob: 0, wag: 1 },
  { sx: 11, sy: 17, mouth: 0, bob: 0, wag: 0 },
  { sx: 13, sy: 16, mouth: 1, bob: 0, wag: 1 },
  { sx: 15, sy: 16, mouth: 2, bob: 0, wag: 0 },
  { sx: 15, sy: 17, mouth: 1, bob: 0, wag: 1 },
  { sx: 13, sy: 19, mouth: 2, bob: 1, wag: 0 },
  { sx: 11, sy: 20, mouth: 1, bob: 1, wag: 1 },
  { sx: 10, sy: 20, mouth: 0, bob: 0, wag: 0 },
  { sx: 10, sy: 21, mouth: 0, bob: 0, wag: 1 },
  { sx: 10, sy: 20, mouth: 0, bob: 0, wag: 0 },
  { sx: 10, sy: 19, mouth: 0, bob: 0, wag: 1 },
];

function drawFrame(shot) {
  const c = new Canvas(FRAME, FRAME);
  const bob = shot.bob;
  const bodyY = 17 + bob;

  // 鱼身（在碗后面）
  c.ellipse(21, bodyY, 7, 5.5, hex(C.body));
  c.ellipse(20, bodyY + 2.5, 5, 2.5, hex(C.belly));
  // 背鳍
  c.rect(21, bodyY - 7, 24, bodyY - 6, hex(C.fin));
  c.rect(22, bodyY - 8, 23, bodyY - 7, hex(C.fin));
  // 尾巴
  const tailShift = shot.wag ? 0 : 1;
  for (let i = 0; i < 5; i++) {
    const top = bodyY - 4 + i + tailShift;
    c.set(27 + Math.floor(i / 2), top, hex(C.fin));
    c.set(28 + Math.floor(i / 2), top, hex(C.fin));
    c.set(27 + Math.floor(i / 2), bodyY + 3 - i - tailShift, hex(C.fin));
    c.set(28 + Math.floor(i / 2), bodyY + 3 - i - tailShift, hex(C.fin));
  }

  // 饭碗（在前）
  for (let y = 21; y <= 30; y++) {
    const hw = Math.round(6.6 - (y - 21) * 0.28);
    for (let x = 9 - hw; x <= 9 + hw; x++) c.set(x, y, hex(C.bowl));
  }
  // 碗沿
  for (let x = 3; x <= 15; x++) c.set(x, 21, hex(C.bowlDark));
  // 碗上的高光
  c.set(6, 25, hex("#e2b184"));
  c.set(7, 25, hex("#e2b184"));
  // 米饭
  c.ellipse(9, 20, 5.6, 2.6, hex(C.rice));
  c.rect(4, 21, 14, 21, hex(C.rice));
  c.set(6, 19, hex(C.riceShade));
  c.set(11, 19, hex(C.riceShade));
  c.set(8, 18, hex(C.riceShade));

  // 嘴
  if (shot.mouth === 0) {
    c.rect(14, bodyY + 1, 15, bodyY + 1, hex(C.ink));
  } else if (shot.mouth === 1) {
    c.rect(14, bodyY, 15, bodyY + 2, hex(C.mouth));
  } else {
    c.rect(13, bodyY - 1, 15, bodyY + 2, hex(C.mouth));
  }
  // 眼睛
  c.rect(17, bodyY - 2, 18, bodyY - 1, hex(C.eyeWhite));
  c.set(18, bodyY - 2, hex(C.ink));

  // 统一描边
  c.outline(hex(C.ink));

  // 勺子和手臂画在描边之上，保证动作看得清
  const sx = shot.sx;
  const sy = shot.sy;
  c.line(sx + 2, sy, 17, bodyY + 2, hex(C.ink));
  c.line(sx + 2, sy - 1, 17, bodyY + 1, hex(C.spoon));
  c.ellipse(sx, sy, 2.3, 1.7, hex(C.ink));
  c.ellipse(sx, sy, 1.6, 1.0, hex(C.spoon));
  if (shot.sy <= 19) {
    c.rect(sx - 2, sy - 3, sx + 2, sy - 1, hex(C.ink));
    c.rect(sx - 1, sy - 3, sx + 1, sy - 1, hex(C.rice));
  }
  return c;
}

const sheet = new Canvas(FRAME * COUNT, FRAME);
const frames = [];
for (let i = 0; i < COUNT; i++) {
  const frame = drawFrame(SHOTS[i]);
  frames.push(frame);
  sheet.blit(frame, i * FRAME);
}

const assets = join(ROOT, "assets");
mkdirSync(assets, { recursive: true });
writeFileSync(join(assets, "placeholder-sheet.png"), encodePNG(sheet.w, sheet.h, sheet.data));

// 6 倍预览：浅色底一排、深色底一排，另外单独放一张动画条
const PREVIEW_GAP = 8;
const bar = new Canvas(FRAME * COUNT, FRAME);
frames.forEach((f, i) => bar.blit(f, i * FRAME));
const light = bar.upscale(SCALE, "#ffffff");
const dark = bar.upscale(SCALE, "#1b1b1c");
const preview = new Canvas(light.w, light.h + PREVIEW_GAP * SCALE + dark.h);
for (let y = 0; y < light.h; y++) {
  for (let x = 0; x < light.w; x++) {
    const i = (y * light.w + x) * 4;
    preview.set(x, y, [light.data[i], light.data[i + 1], light.data[i + 2], 255]);
  }
}
const offset = light.h + PREVIEW_GAP * SCALE;
for (let y = 0; y < dark.h; y++) {
  for (let x = 0; x < dark.w; x++) {
    const i = (y * dark.w + x) * 4;
    preview.set(x, offset + y, [dark.data[i], dark.data[i + 1], dark.data[i + 2], 255]);
  }
}
writeFileSync(join(assets, "placeholder-preview.png"), encodePNG(preview.w, preview.h, preview.data));

console.log(`sprite sheet ${sheet.w}×${sheet.h} -> assets/placeholder-sheet.png`);
console.log(`preview ${preview.w}×${preview.h} -> assets/placeholder-preview.png`);
