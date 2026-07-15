// Genera los iconos PWA de Luca Plan en public/icons de forma determinista, sin dependencias:
// fondo azul de marca opaco de borde a borde (sin esquinas redondeadas), "L" geométrica clara
// centrada (dos rectángulos, sin tipografías) y marca dentro del círculo seguro del 80%, por lo
// que la misma definición sirve para `any` y `maskable` (tolera máscara círculo/squircle).
// Colores derivados de los tokens de app/globals.css: --primary y --primary-foreground (light).
// Al escribir, valida cada PNG: dimensiones, RGB sin alfa (opaco), fondo en esquinas y zona segura.
// Uso: node scripts/generate-pwa-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const OUT_DIR = path.join(import.meta.dirname, "..", "public", "icons");
const OUTPUTS = [
  { file: "luca-plan-32.png", size: 32 },
  { file: "apple-touch-icon-180.png", size: 180 },
  { file: "pwa-192.png", size: 192 },
  { file: "pwa-512.png", size: 512 },
  { file: "pwa-maskable-512.png", size: 512 },
];

// Proporciones de la "L" relativas al lado del icono. Media diagonal de la caja del glifo:
// √(0.21² + 0.27²) ≈ 0.342 < 0.4 → cabe en el círculo seguro del 80% con margen.
const GLYPH_W = 0.42;
const GLYPH_H = 0.54;
const STROKE = 0.15;
const SAFE_RADIUS = 0.4;

// --- color: oklch → sRGB 8-bit (misma matemática que CSS Color 4) ---
function oklchToRgb8(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  });
}

const BG = oklchToRgb8(0.54, 0.19, 262); // --primary (azul de marca)
const FG = oklchToRgb8(0.99, 0.005, 258); // --primary-foreground

// --- render: buffer RGB con la "L" como asta vertical + pie horizontal ---
function fillRect(px, size, x0, y0, w, h, [r, g, b]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * size + x) * 3;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
}

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 3);
  fillRect(px, size, 0, 0, size, size, BG);
  const w = Math.round(GLYPH_W * size);
  const h = Math.round(GLYPH_H * size);
  const t = Math.round(STROKE * size);
  const x0 = Math.round((size - w) / 2);
  const y0 = Math.round((size - h) / 2);
  fillRect(px, size, x0, y0, t, h, FG); // asta vertical
  fillRect(px, size, x0, y0 + h - t, w, t, FG); // pie horizontal
  return px;
}

// --- PNG: encoder mínimo (color type 2 = RGB sin canal alfa → opaco por construcción) ---
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride); // byte de filtro 0 por scanline
  for (let y = 0; y < size; y++) px.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- validación: relee el archivo escrito y comprueba el contrato del icono ---
function validatePng(filePath, expectedSize) {
  const buf = readFileSync(filePath);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("firma PNG inválida");

  const idat = [];
  let ihdr;
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    if (type === "tRNS") throw new Error("tiene chunk tRNS (transparencia)");
    off += 12 + len;
  }

  const [width, height] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4)];
  if (width !== expectedSize || height !== expectedSize)
    throw new Error(`dimensiones ${width}x${height}, esperado ${expectedSize}x${expectedSize}`);
  if (ihdr[8] !== 8 || ihdr[9] !== 2)
    throw new Error(`no es RGB-8 sin alfa (bit depth ${ihdr[8]}, color type ${ihdr[9]})`);
  if (ihdr[12] !== 0) throw new Error("PNG entrelazado");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 3;
  const pixelAt = (x, y) => {
    const i = y * stride + 1 + x * 3;
    return [raw[i], raw[i + 1], raw[i + 2]];
  };
  for (let y = 0; y < height; y++)
    if (raw[y * stride] !== 0) throw new Error(`filtro ≠ 0 en scanline ${y}`);

  const isBg = ([r, g, b]) => r === BG[0] && g === BG[1] && b === BG[2];
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]])
    if (!isBg(pixelAt(x, y))) throw new Error("una esquina no es el azul de marca (fondo no llega al borde)");

  // Todo píxel que no es fondo (la marca) debe caer dentro del círculo seguro del 80%.
  const r2Max = (SAFE_RADIUS * width) ** 2;
  const center = width / 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (!isBg(pixelAt(x, y))) {
        const r2 = (x + 0.5 - center) ** 2 + (y + 0.5 - center) ** 2;
        if (r2 > r2Max) throw new Error(`marca fuera de la zona segura del 80% en (${x}, ${y})`);
      }
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`▶ Colores: fondo rgb(${BG.join(", ")}), marca rgb(${FG.join(", ")})`);
for (const { file, size } of OUTPUTS) {
  const filePath = path.join(OUT_DIR, file);
  writeFileSync(filePath, encodePng(size, renderIcon(size)));
  validatePng(filePath, size);
  console.log(`✓ ${file} — ${size}x${size}, RGB opaco, fondo al borde, marca en zona segura`);
}
console.log(`✓ ${OUTPUTS.length} iconos generados y validados en public/icons`);
