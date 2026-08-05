import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import { prDemoAccount } from "./pr-demo.ts"

const original = process.env.RAILWAY_ENVIRONMENT_NAME

function withEnv(name: string | undefined) {
  if (name === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME
  else process.env.RAILWAY_ENVIRONMENT_NAME = name
  return prDemoAccount()
}

afterEach(() => {
  if (original === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME
  else process.env.RAILWAY_ENVIRONMENT_NAME = original
})

describe("prDemoAccount", () => {
  it("reconoce el entorno de PR con y sin el prefijo del servicio", () => {
    assert.equal(withEnv("pr-2")?.env, "pr-2")
    assert.equal(withEnv("lucaplan-app-pr-2")?.env, "pr-2")
    assert.equal(withEnv("lucaplan-app-pr-137")?.env, "pr-137")
  })

  it("NO siembra en producción: 'production' contiene 'pr'", () => {
    assert.equal(withEnv("production"), null)
    assert.equal(withEnv("preview"), null)
  })

  it("no siembra sin variable ni con un nombre sin número de PR", () => {
    assert.equal(withEnv(undefined), null)
    assert.equal(withEnv(""), null)
    assert.equal(withEnv("pr-staging"), null)
    assert.equal(withEnv("pr-2-old"), null)
  })
})
