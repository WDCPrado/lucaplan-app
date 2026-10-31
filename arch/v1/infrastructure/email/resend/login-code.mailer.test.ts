import assert from "node:assert/strict"
import test from "node:test"
import { createResendLoginCodeMailer } from "./login-code.mailer.ts"

test("envía HTML y texto locales Luca por Resend, sin plantilla externa", async () => {
  let called = false
  const mailer = createResendLoginCodeMailer({
    apiKey: "dummy-key",
    transport: async (url, init) => {
      called = true
      assert.equal(url, "https://api.resend.com/emails")
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer dummy-key"
      )
      assert.equal(init?.method, "POST")
      assert.ok(init?.signal)
      const body = JSON.parse(String(init?.body))
      assert.equal(body.from, "Luca Plan <no-reply@lucaplan.cl>")
      assert.equal(body.to, "test@example.com")
      assert.equal(body.template, undefined)
      assert.match(body.html, /123456/)
      assert.match(body.text, /10 minutos/)
      assert.match(body.subject, /Luca Plan/)
      return new Response("{}", { status: 200 })
    },
  })
  await mailer.send("test@example.com", "123456")
  assert.equal(called, true)
})

test("normaliza el remitente opcional sin perder un remitente personalizado", async () => {
  for (const [from, expected] of [
    [undefined, "Luca Plan <no-reply@lucaplan.cl>"],
    ["", "Luca Plan <no-reply@lucaplan.cl>"],
    [" \t ", "Luca Plan <no-reply@lucaplan.cl>"],
    ["Mi Plan <acceso@example.com>", "Mi Plan <acceso@example.com>"],
    ["  Mi Plan <acceso@example.com>  ", "Mi Plan <acceso@example.com>"],
  ]) {
    let sentFrom: string | undefined
    const mailer = createResendLoginCodeMailer({
      apiKey: "dummy-key",
      from,
      transport: async (_url, init) => {
        sentFrom = JSON.parse(String(init?.body)).from
        return new Response("{}", { status: 200 })
      },
    })
    await mailer.send("test@example.com", "123456")
    assert.equal(sentFrom, expected)
  }
})

test("no propaga secretos, correo ni bodies de error del proveedor", async () => {
  for (const transport of [
    async () =>
      new Response("dummy-key test@example.com 123456", { status: 403 }),
    async () => {
      throw new Error("dummy-key test@example.com 123456")
    },
  ]) {
    const mailer = createResendLoginCodeMailer({
      apiKey: "dummy-key",
      transport,
    })
    await assert.rejects(mailer.send("test@example.com", "123456"), {
      message: "No se pudo enviar el código de acceso.",
    })
  }
})

test("sin configuración o código inválido no hace IO", async () => {
  const transport: typeof fetch = async () => {
    assert.fail("no debe enviar")
  }
  await assert.rejects(
    createResendLoginCodeMailer({ transport }).send(
      "test@example.com",
      "123456"
    ),
    /no está configurado/
  )
  await assert.rejects(
    createResendLoginCodeMailer({ apiKey: "dummy-key", transport }).send(
      "test@example.com",
      "<script>"
    ),
    /inválido/
  )
})
