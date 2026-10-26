// 检查逐帧 PNG 里的"内部空洞"：不透明的身体中间被抠穿的透明洞。
// 用法：node tools/check-holes.mjs frames-idle
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG } from "./png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirName = process.argv[2] ?? "frames-idle";
const dir = join(ROOT, dirName);
const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .sort();

let worst = { name: "", holes: 0 };
const rows = [];
for (const name of files) {
  const { width, height, rgba } = decodePNG(readFileSync(join(dir, name)));
  const total = width * height;
  const opaque = new Uint8Array(total);
  for (let i = 0; i < total; i++) opaque[i] = rgba[i * 4 + 3] > 8 ? 1 : 0;

  // 从画面边缘出发，把"连通的透明区"标成外部
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

  // 既不是外部、也不是不透明 → 内部空洞
  let holes = 0;
  for (let i = 0; i < total; i++) if (!opaque[i] && !outside[i]) holes++;
  rows.push({ name, holes });
  if (holes > worst.holes) worst = { name, holes };
}

const clean = rows.filter((r) => r.holes === 0);
const dirty = rows.filter((r) => r.holes > 0);
console.log(`${dirName}: ${files.length} 帧，干净 ${clean.length} 帧，有洞 ${dirty.length} 帧`);
if (dirty.length) {
  console.log(`最严重：${worst.name} 有 ${worst.holes} 个内部透明像素`);
  console.log(
    "有洞的帧：" +
      dirty
        .sort((a, b) => b.holes - a.holes)
        .slice(0, 12)
        .map((r) => `${r.name.replace(/^\D+/, "").replace(/\.png$/, "")}(${r.holes})`)
        .join(" "),
  );
  process.exit(1);
}
