import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { affectedServices, deploy } from "./deploy-local.mjs"

const before = "a".repeat(40)
const after = "b".repeat(40)

test("watch paths separan app, cron y dependencias compartidas", () => {
  assert.deepEqual(affectedServices(["app/page.tsx", "public/icon.png"]), ["app"])
  assert.deepEqual(affectedServices(["scripts/local-cron.mjs", "scripts/sync-email.ts"]), ["cron"])
  for (const path of ["arch/v1/domain/x.ts", "lib/money.ts", "prisma/schema.prisma", "Dockerfile", "pnpm-lock.yaml", ".dockerignore"]) {
    assert.deepEqual(affectedServices([path]), ["app", "cron"])
  }
  assert.deepEqual(affectedServices(["docs/self-hosting.md", "README.md", "scripts/local-cron.test.ts", ".github/workflows/validate-pr.yml", "scripts/deploy-local.mjs"]), [])
  // --no-renames entrega ruta borrada y agregada, incluso al mover código a documentación.
  assert.deepEqual(affectedServices(["app/old.ts", "docs/old.ts"]), ["app"])
  assert.throws(() => affectedServices(["compose.production.yml"]), /sincroniza/)
})

function fixture(paths: string[], fail = "") {
  const runtimeDir = mkdtempSync(join(tmpdir(), "lucaplan-deploy-"))
  writeFileSync(join(runtimeDir, "last-deploy.json"), JSON.stringify({ commit: before, image: "old-image" }))
  const calls: string[][] = []
  const execute = (command: string, args: string[]) => {
    calls.push([command, ...args])
    if (fail && args.includes(fail)) throw new Error(`simulated ${fail}`)
    if (command === "git") {
      if (args[0] === "ls-remote") return `${after}\trefs/heads/master`
      if (args[0] === "rev-parse") return after
      if (args[0] === "diff") return paths.join("\0") + "\0"
      return ""
    }
    if (args[0] === "inspect" || args[0] === "image") return "sha256:old"
    if (args.includes("ps")) return `container-${args.at(-1)}`
    if (args.includes("json")) return JSON.stringify({ services: { app: { environment: { NEXT_PUBLIC_LANDING_ONLY: "true" } } } })
    return ""
  }
  return { runtimeDir, calls, execute, cleanup: () => rmSync(runtimeDir, { recursive: true, force: true }) }
}

test("cron solo construye y recrea cron sin detener app, DB ni túnel", () => {
  const f = fixture(["scripts/local-cron.mjs"])
  try {
    assert.deepEqual(deploy({ sha: after, ...f }), { services: ["cron"] })
    const updates = f.calls.filter((call) => call.includes("up"))
    assert.equal(updates.length, 1)
    assert.equal(updates[0].at(-1), "cron")
    assert.ok(updates[0].includes("--no-deps"))
    assert.ok(!f.calls.some((call) => call.includes("stop") || call.includes("pg_dump")))
    const state = JSON.parse(readFileSync(join(f.runtimeDir, "deploy-state.json"), "utf8"))
    assert.equal(state.app.image, "old-image")
    assert.equal(state.cron.image, `lucaplan-local:${after}`)
  } finally { f.cleanup() }
})

test("UI sola no reinicia cron; migraciones lo paran antes de reemplazar app", () => {
  for (const paths of [["app/page.tsx"], ["prisma/migrations/new/migration.sql"]]) {
    const f = fixture(paths)
    try {
      deploy({ sha: after, ...f })
      const build = f.calls.findIndex((call) => call.includes("build"))
      const backup = f.calls.findIndex((call) => call.includes("pg_dump"))
      const upApp = f.calls.findIndex((call) => call.includes("up") && call.at(-1) === "app")
      assert.ok(build < backup && backup < upApp)
      if (paths[0].startsWith("prisma/")) {
        const stop = f.calls.findIndex((call) => call.includes("stop"))
        assert.ok(backup < stop && stop < upApp)
        assert.equal(f.calls.filter((call) => call.includes("up")).at(-1)?.at(-1), "cron")
      } else {
        assert.ok(!f.calls.some((call) => call.includes("stop")))
        assert.equal(f.calls.filter((call) => call.includes("up")).length, 1)
      }
    } finally { f.cleanup() }
  }
})

test("build fallido conserva contenedores y estado; salud fallida no confirma SHA", () => {
  for (const fail of ["build", "--wait"]) {
    const f = fixture(["app/page.tsx"], fail)
    try {
      assert.throws(() => deploy({ sha: after, ...f }), /simulated/)
      assert.ok(!existsSync(join(f.runtimeDir, "deploy-state.json")))
      assert.ok(!existsSync(join(f.runtimeDir, "deploy-images.json")))
      assert.ok(!existsSync(join(f.runtimeDir, "deploy.lock")))
      if (fail === "build") assert.ok(!f.calls.some((call) => call.includes("up") || call.includes("stop")))
    } finally { f.cleanup() }
  }
})

test("docs solas no construyen; SHA viejo, lock o baseline divergente bloquean el reemplazo", () => {
  const f = fixture(["docs/self-hosting.md"])
  try {
    assert.deepEqual(deploy({ sha: before, ...f }), { skipped: true })
    assert.deepEqual(deploy({ sha: after, ...f }), { services: [] })
    assert.ok(!f.calls.some((call) => call.includes("build")))
    writeFileSync(join(f.runtimeDir, "deploy.lock"), "active")
    assert.throws(() => deploy({ sha: after, ...f }), /deploy.lock/)
    rmSync(join(f.runtimeDir, "deploy.lock"))
    const execute = (command: string, args: string[]) => args[0] === "inspect" ? "sha256:other" : f.execute(command, args)
    assert.throws(() => deploy({ ...f, sha: after, execute }), /imagen real/)
  } finally { f.cleanup() }
})

test("backup fallido no toca servicios y fallo de cron tras app no confirma el estado", () => {
  for (const fail of ["pg_dump", "pg_restore"]) {
    const f = fixture(["prisma/migrations/new/migration.sql"], fail)
    try {
      assert.throws(() => deploy({ sha: after, ...f }), /simulated/)
      assert.ok(!f.calls.some((call) => call.includes("up") || call.includes("stop")))
      assert.ok(!existsSync(join(f.runtimeDir, "deploy-state.json")))
    } finally { f.cleanup() }
  }
  const f = fixture(["arch/shared.ts"])
  try {
    const execute = (command: string, args: string[]) => {
      if (args.includes("up") && args.at(-1) === "cron") throw new Error("cron failed")
      return f.execute(command, args)
    }
    assert.throws(() => deploy({ ...f, sha: after, execute }), /cron failed/)
    assert.ok(f.calls.some((call) => call.includes("up") && call.at(-1) === "app"))
    assert.ok(!existsSync(join(f.runtimeDir, "deploy-state.json")))
    assert.ok(!existsSync(join(f.runtimeDir, "deploy-images.json")))
    assert.ok(existsSync(join(f.runtimeDir, "deploy-previous.json")))
    assert.ok(existsSync(join(f.runtimeDir, "deploy-previous-state.json")))
    assert.ok(existsSync(join(f.runtimeDir, "deploy-candidate.json")))
  } finally { f.cleanup() }
})
