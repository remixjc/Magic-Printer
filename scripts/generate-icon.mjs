import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const size = 512;
const scale = 2;
const width = size * scale;
const pixels = Buffer.alloc(width * width * 4, 0);

const setPixel = (x, y, color) => {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3] ?? 255;
};

const insideRoundRect = (x, y, left, top, right, bottom, radius) => {
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

const fillRoundRect = (left, top, right, bottom, radius, color) => {
  for (let y = Math.floor(top); y <= Math.ceil(bottom); y += 1) {
    for (let x = Math.floor(left); x <= Math.ceil(right); x += 1) {
      if (insideRoundRect(x, y, left, top, right, bottom, radius)) setPixel(x, y, color);
    }
  }
};

const fillRect = (left, top, right, bottom, color) => {
  for (let y = Math.floor(top); y <= Math.ceil(bottom); y += 1) {
    for (let x = Math.floor(left); x <= Math.ceil(right); x += 1) setPixel(x, y, color);
  }
};

const fillCircle = (cx, cy, radius, color) => {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(x, y, color);
    }
  }
};

const strokeLine = (x1, y1, x2, y2, thickness, color) => {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    fillCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thickness / 2, color);
  }
};

const S = (value) => value * scale;
fillRoundRect(0, 0, width - 1, width - 1, S(128), [15, 17, 24, 255]);
fillRoundRect(S(36), S(36), S(476), S(476), S(108), [43, 39, 86, 255]);

fillRect(S(164), S(58), S(348), S(212), [250, 250, 255, 255]);
for (let x = S(164); x <= S(348); x += 1) {
  strokeLine(x, S(58), x, S(63), 1, [184, 183, 255, 255]);
  strokeLine(x, S(207), x, S(212), 1, [184, 183, 255, 255]);
}
strokeLine(S(164), S(58), S(348), S(58), S(10), [184, 183, 255, 255]);
strokeLine(S(164), S(212), S(348), S(212), S(10), [184, 183, 255, 255]);
strokeLine(S(164), S(58), S(164), S(212), S(10), [184, 183, 255, 255]);
strokeLine(S(348), S(58), S(348), S(212), S(10), [184, 183, 255, 255]);

fillRoundRect(S(58), S(188), S(454), S(372), S(68), [36, 38, 58, 255]);
strokeLine(S(126), S(188), S(386), S(188), S(10), [155, 145, 255, 255]);
strokeLine(S(58), S(256), S(58), S(372), S(10), [155, 145, 255, 255]);
strokeLine(S(454), S(256), S(454), S(372), S(10), [155, 145, 255, 255]);
strokeLine(S(126), S(372), S(386), S(372), S(10), [155, 145, 255, 255]);

fillRect(S(144), S(314), S(368), S(440), [250, 250, 255, 255]);
strokeLine(S(144), S(314), S(368), S(314), S(10), [155, 145, 255, 255]);
strokeLine(S(144), S(440), S(368), S(440), S(10), [155, 145, 255, 255]);
strokeLine(S(144), S(314), S(144), S(440), S(10), [155, 145, 255, 255]);
strokeLine(S(368), S(314), S(368), S(440), S(10), [155, 145, 255, 255]);
strokeLine(S(184), S(350), S(328), S(350), S(12), [183, 185, 215, 255]);
strokeLine(S(184), S(382), S(290), S(382), S(12), [183, 185, 215, 255]);
fillCircle(S(370), S(246), S(32), [74, 214, 160, 42]);
fillCircle(S(370), S(246), S(18), [74, 214, 160, 255]);

const downsample = () => {
  const output = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let oy = 0; oy < scale; oy += 1) for (let ox = 0; ox < scale; ox += 1) {
        const offset = ((y * scale + oy) * width + x * scale + ox) * 4;
        for (let channel = 0; channel < 4; channel += 1) sum[channel] += pixels[offset + channel];
      }
      const target = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[target + channel] = Math.round(sum[channel] / (scale * scale));
    }
  }
  return output;
};

const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, crc]);
};
const png = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const image = downsample();
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    image.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
};

const output = png();
for (const target of ["assets/magic-printer-icon.png", "apps/desktop/build/icon.png", "website/assets/magic-printer-icon.png"]) {
  const path = resolve(process.cwd(), target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
}
