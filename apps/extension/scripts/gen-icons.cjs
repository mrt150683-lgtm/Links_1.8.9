const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function createPNG(size, r, g, b) {
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (const b of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 0xFF];
    return (crc ^ 0xFFFFFFFF);
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = crc32(Buffer.concat([Buffer.from(type), data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y++) {
    const off = y * rowSize;
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      raw[off + 1 + x*3] = r;
      raw[off + 1 + x*3 + 1] = g;
      raw[off + 1 + x*3 + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(raw);
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, chunk('IHDR', ihdr), idat, iend]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  // Dark bg-0 color (#10141A) as placeholder — run generate-icons.mjs with sharp for real logo
  const png = createPNG(size, 16, 20, 26);
  const outPath = path.join(outDir, 'icon' + size + '.png');
  fs.writeFileSync(outPath, png);
  console.log('Created ' + outPath + ' (' + png.length + ' bytes)');
}
console.log('Placeholder icons created. Run scripts/generate-icons.mjs with sharp for real logo icons.');
