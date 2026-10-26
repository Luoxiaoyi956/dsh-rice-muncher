// 给已有的逐帧 PNG 补"封闭的透明小洞"（用周围颜色填实），原地覆盖。
// 用法：node tools/patch-holes.mjs frames-idle 8
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "./png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirName = process.argv[2] ?? "frames-idle";
const maxArea = Number(process.argv[3] ?? "8");
const dir = join(ROOT, dirName);
const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .sort();

let patched = 0;
let pixels = 0;

for (const name of files) {
  const { width, height, rgba } = decodePNG(readFileSync(join(dir, name)));
  const size = width * height;
  const opaqueOf = () => {
    const map = new Uint8Array(size);
    for (let i = 0; i < size; i++) map[i] = rgba[i * 4 + 3] > 8 ? 1 : 0;
    return map;
  };
  let opaque = opaqueOf();

  // 从画布边缘能连到的透明区域 = 外部
  const reached = new Uint8Array(size);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (reached[idx] || opaque[idx]) return;
    reached[idx] = 1;
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

  const visited = new Uint8Array(size);
  let touchedThis = 0;
  for (let start = 0; start < size; start++) {
    if (opaque[start] || reached[start] || visited[start]) continue;
    const region = [];
    const local = [start];
    visited[start] = 1;
    while (local.length) {
      const idx = local.pop();
      region.push(idx);
      if (region.length > maxArea) break;
      const x = idx % width;
      const y = (idx - x) / width;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (opaque[nIdx] || reached[nIdx] || visited[nIdx]) continue;
        visited[nIdx] = 1;
        local.push(nIdx);
      }
    }
    if (region.length > maxArea) continue;

    let sr = 0;
    let sg = 0;
    let sb = 0;
    let count = 0;
    for (const idx of region) {
      const x = idx % width;
      const y = (idx - x) / width;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (!opaque[nIdx]) continue;
          sr += rgba[nIdx * 4];
          sg += rgba[nIdx * 4 + 1];
          sb += rgba[nIdx * 4 + 2];
          count++;
        }
      }
    }
    if (count === 0) continue;
    for (const idx of region) {
      rgba[idx * 4] = Math.round(sr / count);
      rgba[idx * 4 + 1] = Math.round(sg / count);
      rgba[idx * 4 + 2] = Math.round(sb / count);
      rgba[idx * 4 + 3] = 255;
    }
    touchedThis += region.length;
  }

  if (touchedThis > 0) {
    opaque = opaqueOf();
    writeFileSync(join(dir, name), encodePNG(width, height, rgba));
    patched += 1;
    pixels += touchedThis;
  }
}

console.log(`${dirName}: 补了 ${patched} 帧 / ${pixels} 个像素`);
