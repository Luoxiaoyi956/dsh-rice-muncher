// 读 MP4 的 box 结构，拿到分辨率 / 编码 / 帧率 / 时长。够用来决定拆帧参数。
import { readFileSync } from "node:fs";

const path = process.argv[2];
const buf = readFileSync(path);

function walk(start, end, depth, out) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header) break;
    out.push({ type, pos, header, size, depth });
    const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta", "mvex", "moof", "traf"]);
    if (containers.has(type)) walk(pos + header, pos + size, depth + 1, out);
    pos += size;
  }
  return out;
}

const boxes = walk(0, buf.length, 0, []);
const types = boxes.map((b) => b.type);

function find(type) {
  return boxes.find((b) => b.type === type);
}
function payload(box) {
  return buf.subarray(box.pos + box.header, box.pos + box.size);
}

const mvhd = find("mvhd");
if (mvhd) {
  const d = payload(mvhd);
  const version = d[0];
  const timescale = version === 1 ? Number(d.readBigUInt64BE(16)) : d.readUInt32BE(12);
  const duration = version === 1 ? Number(d.readBigUInt64BE(24)) : d.readUInt32BE(16);
  console.log(`时长      ${(duration / timescale).toFixed(2)} s  (timescale ${timescale})`);
}

for (const trak of boxes.filter((b) => b.type === "trak")) {
  const inner = boxes.filter((b) => b.type === "tkhd" && b.pos > trak.pos && b.pos < trak.pos + trak.size);
  const stsd = boxes.filter((b) => b.type === "stsd" && b.pos > trak.pos && b.pos < trak.pos + trak.size);
  const handler = boxes.filter((b) => b.type === "hdlr" && b.pos > trak.pos && b.pos < trak.pos + trak.size);
  const kind = handler.length ? payload(handler[0]).toString("ascii", 8, 12) : "?";
  let dims = "";
  if (stsd.length) {
    const d = payload(stsd[0]);
    const entry = d.subarray(8);
    const codec = entry.toString("ascii", 4, 8);
    const width = entry.readUInt16BE(32);
    const height = entry.readUInt16BE(34);
    dims = `${codec} ${width}×${height}`;
  }
  let trackDur = "";
  if (inner.length) {
    const d = payload(inner[0]);
    const v = d[0];
    const dur = v === 1 ? Number(d.readBigUInt64BE(28)) : d.readUInt32BE(20);
    trackDur = `duration ${dur}`;
  }
  console.log(`轨道      ${kind}  ${dims}  ${trackDur}`);
}

const stts = boxes.filter((b) => b.type === "stts");
if (stts.length) {
  const d = payload(stts[0]);
  const count = d.readUInt32BE(4);
  let total = 0;
  let samples = 0;
  for (let i = 0; i < count && i < 8; i++) {
    const n = d.readUInt32BE(8 + i * 8);
    const delta = d.readUInt32BE(12 + i * 8);
    total += n * delta;
    samples += n;
  }
  const mvhd2 = find("mvhd");
  const ts = mvhd2 ? payload(mvhd2)[0] === 1 ? Number(payload(mvhd2).readBigUInt64BE(16)) : payload(mvhd2).readUInt32BE(12) : 1000;
  if (count > 0 && samples > 0) {
    const firstDelta = d.readUInt32BE(12);
    console.log(`帧        ${samples} 帧（前 ${count} 组） 帧时长 ${firstDelta}/${ts} → ${(ts / firstDelta).toFixed(2)} fps`);
  }
}
console.log(`顶层 box  ${[...new Set(types)].join(" ")}`);
