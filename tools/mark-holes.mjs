// 把某一帧的"内部空洞"标成品红，放大 10 倍输出，方便看漏在哪。
// 用法：node tools/mark-holes.mjs frames-idle/idle-034.png out.png
import { readFileSync, writeFileSync } from "node:fs";
import { decodePNG, encodePNG } from "./png.mjs";

const [, , input, output] = process.argv;
const frame = decodePNG(readFileSync(input));
const { width, height, rgba } = frame;
const total = width * height;

const opaque = new Uint8Array(total);
for (let i = 0; i < total; i++) opaque[i] = rgba[i * 4 + 3] > 8 ? 1 : 0;

const outside = new Uint8Array(total);
const stack = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = y * width + x;
  if (outside[idx] || opaque[idx]) return;
  outside[idx] = 1;
  stack.push(idx);
};
for (let x = 0; x < width; x++) {
  push(x, 0);
  push(x, height - 1);
}
for (let y = 0; y < height; y++) {
  push(0, y);
  push(width - 1, y);
}
while (stack.length) {
  const idx = stack.pop();
  const x = idx % width;
  const y = (idx - x) / width;
  push(x - 1, y);
  push(x + 1, y);
  push(x, y - 1);
  push(x, y + 1);
}

const S = 10;
const W = width * S;
const H = height * S;
const out = Buffer.alloc(W * H * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = y * width + x;
    const hole = !opaque[idx] && !outside[idx];
    const base = [235, 235, 238];
    if (opaque[idx]) {
      base[0] = rgba[idx * 4];
      base[1] = rgba[idx * 4 + 1];
      base[2] = rgba[idx * 4 + 2];
    } else if (hole) {
      base[0] = 255;
      base[1] = 0;
      base[2] = 255;
    }
    for (let dy = 0; dy < S; dy++) {
      for (let dx = 0; dx < S; dx++) {
        const o = ((y * S + dy) * W + x * S + dx) * 4;
        out[o] = base[0];
        out[o + 1] = base[1];
        out[o + 2] = base[2];
        out[o + 3] = 255;
      }
    }
  }
}
writeFileSync(output, encodePNG(W, H, out));
console.log("已输出", output, `${W}×${H}`);
