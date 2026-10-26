// 把美术资源打成插件本体：读雪碧图（或逐帧目录）→ 内联 base64 → 写 lib/client.js
//
//   node tools/build.mjs            默认读 assets/rice-sheet.png，每帧 100ms
//   node tools/build.mjs --ms 120   改单帧时长
//   node tools/build.mjs --frames   改从 frames/*.png 逐帧拼接
//
// 规则：每个画格必须是正方形，画格边长 = 图片高度，帧数 = 宽度 / 高度。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "./png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const frameMs = Number(flag("ms", "100"));
const render = flag("render", "auto");
const fromFrames = args.includes("--frames");

if (!Number.isFinite(frameMs) || frameMs < 20 || frameMs > 500) {
  throw new Error(`--ms ${frameMs} 不合理：建议 40–150`);
}

function composeFrames() {
  const dir = join(ROOT, "frames");
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();
  if (files.length < 2) throw new Error("frames/ 里至少要 2 张 PNG");
  const decoded = files.map((f) => ({ name: f, ...decodePNG(readFileSync(join(dir, f))) }));
  const { width, height } = decoded[0];
  if (width !== height) throw new Error(`每帧必须是正方形：${decoded[0].name} 是 ${width}×${height}`);
  for (const d of decoded) {
    if (d.width !== width || d.height !== height) {
      throw new Error(`帧尺寸不一致：${d.name} 是 ${d.width}×${d.height}，应为 ${width}×${height}`);
    }
  }
  const count = decoded.length;
  const rgba = Buffer.alloc(width * count * height * 4);
  decoded.forEach((d, index) => {
    for (let y = 0; y < height; y++) {
      const from = y * width * 4;
      const to = (y * width * count + index * width) * 4;
      d.rgba.copy(rgba, to, from, from + width * 4);
    }
  });
  return { width: width * count, height, rgba, count, size: width, source: `frames/ (${count} 张)` };
}

function readSheet() {
  const path = join(ROOT, "assets", "rice-sheet.png");
  if (!existsSync(path)) throw new Error("找不到 assets/rice-sheet.png；先运行 node tools/make-placeholder.mjs 或者用 --frames");
  const decoded = decodePNG(readFileSync(path));
  const size = decoded.height;
  if (decoded.width % size !== 0) {
    throw new Error(`雪碧图 ${decoded.width}×${decoded.height} 不能被高度整除：每格必须是 ${size}×${size} 的正方形`);
  }
  return { ...decoded, count: decoded.width / size, size, source: "assets/rice-sheet.png" };
}

const sheet = fromFrames ? composeFrames() : readSheet();
if (sheet.count < 2) throw new Error("至少需要 2 帧");
if (sheet.size < 4) throw new Error("画格太小了");

const sheetPng = encodePNG(sheet.width, sheet.height, sheet.rgba);
const sprite = `data:image/png;base64,${sheetPng.toString("base64")}`;

const template = readFileSync(join(ROOT, "tools", "client.template.js"), "utf8");
const client = template
  .replaceAll("__FRAME_COUNT__", String(sheet.count))
  .replaceAll("__FRAME_SIZE__", String(sheet.size))
  .replaceAll("__FRAME_MS__", String(frameMs))
  .replaceAll("__RENDER__", render)
  .replace("__SPRITE_BASE64__", sprite);

if (client.includes("__SPRITE_BASE64__")) throw new Error("模板占位符没替换成功");

mkdirSync(join(ROOT, "lib"), { recursive: true });
writeFileSync(join(ROOT, "lib", "client.js"), client);

// 同步一份雪碧图到 assets（从 frames/ 拼出来时用得上）
if (fromFrames) writeFileSync(join(ROOT, "assets", "rice-sheet.png"), sheetPng);

const cycle = (sheet.count * frameMs) / 1000;
console.log(`来源      ${sheet.source}`);
console.log(`帧数      ${sheet.count}`);
console.log(`每帧      ${sheet.size}×${sheet.size}`);
console.log(`雪碧图    ${sheet.width}×${sheet.height}  ${(sheetPng.length / 1024).toFixed(1)} KB`);
console.log(`节奏      ${frameMs}ms/帧 → 循环 ${cycle.toFixed(2)}s`);
console.log(`输出      lib/client.js  ${(Buffer.byteLength(client) / 1024).toFixed(1)} KB`);
