// Check ejecutable de la PWA: manifest coherente, iconos presentes con las dimensiones
// declaradas, y service worker dentro de su política de seguridad (allowlist = solo el
// fallback offline público; nunca guarda respuestas).
// Corre con: node --test scripts/check-pwa.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "../app/manifest.ts";

const ROOT = join(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");

// Dimensiones reales de un PNG desde su cabecera IHDR (bytes 16..24).
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${path} no es un PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("manifest: identidad instalable completa", () => {
  const m = manifest();
  assert.equal(m.start_url, "/dashboard");
  assert.equal(m.display, "standalone");
  assert.equal(m.id, "/");
  assert.equal(m.scope, "/");
  assert.ok(m.name && m.short_name);
  assert.match(m.background_color ?? "", /^#[0-9a-f]{6}$/i);
  assert.match(m.theme_color ?? "", /^#[0-9a-f]{6}$/i);
});

test("manifest: iconos 192, 512 y maskable declarados y con dimensiones reales correctas", () => {
  const icons = manifest().icons ?? [];
  for (const wanted of ["192x192", "512x512"]) {
    assert.ok(icons.some((i) => i.sizes === wanted), `falta icono ${wanted}`);
  }
  assert.ok(
    icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"),
    "falta el icono maskable 512",
  );
  for (const icon of icons) {
    const { width, height } = pngSize(join(PUBLIC, icon.src as string));
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src}: dimensiones no calzan`);
  }
});

test("iconos de plataforma: favicon 32 y Apple Touch Icon 180 existen", () => {
  assert.deepEqual(pngSize(join(PUBLIC, "icons/icon-32.png")), { width: 32, height: 32 });
  assert.deepEqual(pngSize(join(PUBLIC, "icons/apple-touch-icon.png")), { width: 180, height: 180 });
});

test("service worker: solo precachea el fallback offline público y nunca guarda respuestas", () => {
  const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
  // Allowlist de UN elemento: el documento offline público.
  assert.match(sw, /addAll\(\[OFFLINE_URL\]\)/);
  assert.match(sw, /OFFLINE_URL = "\/offline\.html"/);
  // Nada se escribe al cache fuera del install (ni put ni add sueltos).
  assert.ok(!/cache\.put|caches\.put/.test(sw), "el SW no debe guardar respuestas");
  assert.equal(sw.match(/\.addAll\(/g)?.length, 1, "una sola precarga permitida");
  // No intercepta /api ni requests que no sean navegaciones GET.
  assert.match(sw, /request\.method !== "GET" \|\| request\.mode !== "navigate"/);
  assert.match(sw, /pathname\.startsWith\("\/api"\)/);
  // El fallback offline existe.
  assert.ok(readFileSync(join(PUBLIC, "offline.html"), "utf8").includes("Sin conexión"));
});
