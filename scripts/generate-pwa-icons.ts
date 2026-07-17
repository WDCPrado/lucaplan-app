// Genera los iconos PWA de Luca Plan de forma DETERMINISTA y sin dependencias: rasteriza la "L"
// geométrica de la marca (dos barras con esquinas redondeadas, SDF con antialias) sobre el
// gradiente azul de marca (el de las tarjetas débito/login) y escribe los PNG a mano (zlib).
// Correr con: node scripts/generate-pwa-icons.ts  →  public/icons/*.png
// Es la única fuente de los iconos: para cambiarlos, edita aquí y regenera.
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// --- Escritor PNG mínimo (RGBA 8-bit, filtro 0) ---

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "ascii")
  const body = Buffer.concat([head.subarray(4), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, data, crc])
}

function writePng(path: string, size: number, rgba: Uint8Array): void {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filtro 0 por scanline
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v
    })
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ])
  writeFileSync(path, png)
  console.log(`✓ ${path} (${size}x${size}, ${png.length} bytes)`)
}

// --- Arte: gradiente de marca + "L" geométrica (SDF de rounded-rects) ---

const GRAD_A = [0x0a, 0x2a, 0x6b] // #0a2a6b
const GRAD_B = [0x08, 0x50, 0xc0] // #0850c0

// Distancia con signo a un rounded-rect (centro cx,cy; medio-ancho hx,hy; radio r), en espacio unitario.
function sdRoundRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  r: number
): number {
  const dx = Math.abs(px - cx) - hx + r
  const dy = Math.abs(py - cy) - hy + r
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r
}

// La "L": barra vertical + barra horizontal, unión de dos rounded-rects (fracciones del lienzo).
function sdL(u: number, v: number): number {
  const r = 0.035
  const vertical = sdRoundRect(u, v, 0.415, 0.5, 0.07, 0.26, r)
  const horizontal = sdRoundRect(u, v, 0.51, 0.69, 0.165, 0.07, r)
  return Math.min(vertical, horizontal)
}

// contentScale: 1 para iconos normales; 0.8 en maskable (el arte queda dentro de la zona segura).
function render(size: number, contentScale: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * (size - 1)) // gradiente diagonal ↘ (135deg)
      const bg = GRAD_A.map((a, i) => a + (GRAD_B[i] - a) * t)
      // Escala del arte alrededor del centro; d vuelve a unidades reales para el antialias.
      const u = 0.5 + (x / (size - 1) - 0.5) / contentScale
      const v = 0.5 + (y / (size - 1) - 0.5) / contentScale
      const d = sdL(u, v) * contentScale
      const alpha = Math.min(1, Math.max(0, 0.5 - (d * size) / 1.5))
      const o = (y * size + x) * 4
      for (let i = 0; i < 3; i++)
        rgba[o + i] = Math.round(bg[i] * (1 - alpha) + 255 * alpha)
      rgba[o + 3] = 255 // siempre opaco (requisito maskable/Apple)
    }
  }
  return rgba
}

const OUT = join(import.meta.dirname, "..", "public", "icons")
mkdirSync(OUT, { recursive: true })
writePng(join(OUT, "icon-32.png"), 32, render(32, 1))
writePng(join(OUT, "apple-touch-icon.png"), 180, render(180, 1))
writePng(join(OUT, "icon-192.png"), 192, render(192, 1))
writePng(join(OUT, "icon-512.png"), 512, render(512, 1))
writePng(join(OUT, "icon-512-maskable.png"), 512, render(512, 0.8))
