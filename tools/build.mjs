// 把美术资源打成插件本体：读两套雪碧图 → 内联 base64 → 写 lib/client.js
//
//   node tools/build.mjs                          默认 assets/rice-sheet.png + assets/idle-sheet.png
//   node tools/build.mjs --ms 66 --idle-ms 83     分别指定两套动画的单帧时长
//   node tools/build.mjs --frames                 改为从 frames/*.png 逐帧拼接干饭动画
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
const runMs = Number(flag("ms", "66"));
const idleMs = Number(flag("idle-ms", "83"));
const render = flag("render", "auto");
const fromFrames = args.includes("--frames");

/** 模板里需要被替换掉的占位符（只查这些，避免误判注释里的示例）。 */
const PLACEHOLDERS = new Set([
  "__SPRITE_BASE64__",
  "__FRAME_COUNT__",
  "__FRAME_SIZE__",
  "__FRAME_MS__",
  "__IDLE_SPRITE_BASE64__",
  "__IDLE_FRAME_COUNT__",
  "__IDLE_FRAME_SIZE__",
  "__IDLE_FRAME_MS__",
  "__RENDER__",
]);

for (const [label, value] of [["--ms", runMs], ["--idle-ms", idleMs]]) {
  if (!Number.isFinite(value) || value < 20 || value > 500) throw new Error(`${label} ${value} 不合理：建议 40–150`);
}

/** 从逐帧目录拼横排雪碧图。 */
function composeFrames(dirName, name) {
  const dir = join(ROOT, dirName);
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();
  if (files.length < 2) throw new Error(`${dirName}/ 里至少要 2 张 PNG`);
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
  return { width: width * count, height, rgba, count, size: width, source: `${dirName}/ (${count} 张)`, name };
}

/** 读一张横排雪碧图。 */
function readSheet(fileName) {
  const path = join(ROOT, "assets", fileName);
  if (!existsSync(path)) throw new Error(`找不到 assets/${fileName}；先用 tools/video-to-frames.mjs 生成`);
  const decoded = decodePNG(readFileSync(path));
  const size = decoded.height;
  if (decoded.width % size !== 0) {
    throw new Error(`${fileName} ${decoded.width}×${decoded.height} 不能被高度整除：每格必须是 ${size}×${size} 的正方形`);
  }
  return { ...decoded, count: decoded.width / size, size, source: `assets/${fileName}`, name: fileName };
}

const runSheet = fromFrames ? composeFrames("frames", "rice") : readSheet("rice-sheet.png");
const idleSheet = readSheet("idle-sheet.png");

for (const sheet of [runSheet, idleSheet]) {
  if (sheet.count < 2) throw new Error(`${sheet.source} 至少需要 2 帧`);
  if (sheet.size < 4) throw new Error(`${sheet.source} 画格太小了`);
}

const runPng = encodePNG(runSheet.width, runSheet.height, runSheet.rgba);
const idlePng = encodePNG(idleSheet.width, idleSheet.height, idleSheet.rgba);

const template = readFileSync(join(ROOT, "tools", "client.template.js"), "utf8");
const client = template
  .replaceAll("__IDLE_FRAME_COUNT__", String(idleSheet.count))
  .replaceAll("__IDLE_FRAME_SIZE__", String(idleSheet.size))
  .replaceAll("__IDLE_FRAME_MS__", String(idleMs))
  .replace("__IDLE_SPRITE_BASE64__", `data:image/png;base64,${idlePng.toString("base64")}`)
  .replaceAll("__FRAME_COUNT__", String(runSheet.count))
  .replaceAll("__FRAME_SIZE__", String(runSheet.size))
  .replaceAll("__FRAME_MS__", String(runMs))
  .replaceAll("__RENDER__", render)
  .replace("__SPRITE_BASE64__", `data:image/png;base64,${runPng.toString("base64")}`);

if (/__[A-Z_]+__/.test(client)) {
  const left = client.match(/__[A-Z_]+__/g).filter((name) => PLACEHOLDERS.has(name));
  if (left.length > 0) throw new Error(`模板占位符没替换干净：${[...new Set(left)].join(", ")}`);
}

mkdirSync(join(ROOT, "lib"), { recursive: true });
writeFileSync(join(ROOT, "lib", "client.js"), client);

// 从逐帧目录拼出来时，把雪碧图回写到 assets
if (fromFrames) writeFileSync(join(ROOT, "assets", "rice-sheet.png"), runPng);

const line = (sheet, ms, label) => {
  const cycle = (sheet.count * ms) / 1000;
  return (
    `${label}\n` +
    `  来源    ${sheet.source}\n` +
    `  帧数    ${sheet.count} 帧 ${sheet.size}×${sheet.size}\n` +
    `  雪碧图  ${sheet.width}×${sheet.height}  ${(encodePNG(sheet.width, sheet.height, sheet.rgba).length / 1024).toFixed(1)} KB\n` +
    `  节奏    ${ms}ms/帧 → 一轮 ${cycle.toFixed(2)}s`
  );
};

console.log(line(runSheet, runMs, "干饭（思考中）"));
console.log(line(idleSheet, idleMs, "待机"));
console.log(`输出      lib/client.js  ${(Buffer.byteLength(client) / 1024).toFixed(1)} KB`);
