"use client"

import { useEffect, useRef, useState } from "react"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { Loader2 } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { mailAppsFor, maskEmail } from "@/lib/mail-apps"
import {
  loginCodeSchema,
  loginEmailSchema,
  loginErrorMessage,
} from "@/lib/schemas/login-code"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { GmailIcon, OutlookIcon } from "./mail-app-icons"

const STEP_CLASS =
  "flex flex-col gap-5 animate-in fade-in-0 slide-in-from-right-4 duration-200 motion-reduce:animate-none"

export function EmailCodeForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  return sent ? (
    <CodeStep email={email} onChangeEmail={() => setSent(false)} />
  ) : (
    <EmailStep
      email={email}
      onSent={(value) => {
        setEmail(value)
        setSent(true)
      }}
    />
  )
}

function EmailStep({
  email,
  onSent,
}: {
  email: string
  onSent: (email: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const busy = useRef(false)

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    const parsed = loginEmailSchema.safeParse(
      new FormData(event.currentTarget).get("email")
    )
    setFieldError(parsed.success ? null : "Escribe un correo válido.")
    setError(null)
    if (!parsed.success) return
    busy.current = true
    setPending(true)
    try {
      const response = await authClient.emailOtp.sendVerificationOtp({
        email: parsed.data,
        type: "sign-in",
      })
      if (response.error) setError(loginErrorMessage(response.error.status))
      else onSent(parsed.data)
    } catch {
      setError(loginErrorMessage(undefined))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <form
      id="login-email-form"
      onSubmit={send}
      noValidate
      aria-busy={pending}
      className={STEP_CLASS}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="login-email">Correo</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          defaultValue={email}
          maxLength={254}
          required
          disabled={pending}
          aria-invalid={!!fieldError}
          aria-describedby={
            fieldError ? "login-email-error" : "login-email-hint"
          }
          className="h-11 text-base"
        />
        {fieldError && (
          <p
            id="login-email-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {fieldError}
          </p>
        )}
        <p id="login-email-hint" className="text-sm text-muted-foreground">
          Te mandamos un código de 6 dígitos para entrar sin contraseña.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="h-11 text-base">
        {pending && (
          <Loader2
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        )}
        {pending ? "Enviando…" : "Enviar código"}
      </Button>
    </form>
  )
}

function CodeStep({
  email,
  onChangeEmail,
}: {
  email: string
  onChangeEmail: () => void
}) {
  const [code, setCode] = useState("")
  const [wait, setWait] = useState(60)
  const [pending, setPending] = useState<"verify" | "resend" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const busy = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (wait === 0) return
    const timer = setTimeout(() => setWait((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  async function verify(value: string) {
    if (busy.current) return
    setCodeError(null)
    setError(null)
    if (!loginCodeSchema.safeParse(value).success) {
      setCodeError("Escribe los 6 dígitos del código.")
      return
    }
    busy.current = true
    setPending("verify")
    try {
      const response = await authClient.signIn.emailOtp({ email, otp: value })
      if (response.error) {
        if ([400, 401, 403].includes(response.error.status)) {
          setCodeError(loginErrorMessage(response.error.status, true))
          setCode("")
          input.current?.focus()
        } else setError(loginErrorMessage(response.error.status, true))
        return
      }
      // oauthProviderClient envía oauth_query; el servidor verifica la firma y devuelve el destino.
      if (
        response.data &&
        "url" in response.data &&
        typeof response.data.url === "string"
      ) {
        window.location.assign(response.data.url)
        return
      }
      const query = new URLSearchParams(window.location.search)
      if (query.has("sig") && query.has("ba_param")) {
        setError(
          "No pudimos continuar la conexión. Vuelve al asistente e inicia la conexión de nuevo."
        )
        return
      }
      // Recarga el documento para aplicar tema y preferencias antes del primer pintado.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- documento nuevo intencional
      window.location.assign("/dashboard")
    } catch {
      setError(loginErrorMessage(undefined, true))
    } finally {
      busy.current = false
      setPending(null)
    }
  }

  async function resend() {
    if (busy.current || wait > 0) return
    busy.current = true
    setPending("resend")
    setError(null)
    setResent(false)
    try {
      const response = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      })
      if (response.error) setError(loginErrorMessage(response.error.status))
      else {
        setCode("")
        setCodeError(null)
        setWait(60)
        setResent(true)
        input.current?.focus()
      }
    } catch {
      setError(loginErrorMessage(undefined))
    } finally {
      busy.current = false
      setPending(null)
    }
  }

  return (
    <form
      id="login-code-form"
      onSubmit={(event) => {
        event.preventDefault()
        void verify(code)
      }}
      noValidate
      aria-busy={!!pending}
      className={STEP_CLASS}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-sm break-words text-muted-foreground">
        Si tienes cuenta, te enviamos un código a{" "}
        <span className="font-medium text-foreground">{maskEmail(email)}</span>.
        Vale 10 minutos.
      </p>
      <div className="flex flex-col items-center gap-2">
        <Label htmlFor="login-code" className="self-start">
          Código
        </Label>
        <InputOTP
          ref={input}
          id="login-code"
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          containerClassName="justify-center"
          value={code}
          onChange={setCode}
          onComplete={(value) => void verify(value)}
          disabled={!!pending}
          aria-invalid={!!codeError}
          aria-describedby={codeError ? "login-code-error" : undefined}
        >
          <InputOTPGroup>
            {[0, 1, 2].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className="size-11 text-lg"
              />
            ))}
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            {[3, 4, 5].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className="size-11 text-lg"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {codeError && (
          <p
            id="login-code-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {codeError}
          </p>
        )}
        {pending === "verify" && (
          <p role="status" className="text-sm text-muted-foreground">
            Entrando…
          </p>
        )}
        {resent && (
          <p role="status" className="text-sm text-muted-foreground">
            Enviamos un nuevo código. Usa el último correo.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {mailAppsFor(email).map((app) => (
          <Button
            key={app.label}
            variant="outline"
            asChild
            className="h-11 sm:flex-1"
          >
            <a href={app.href} target="_blank" rel="noopener noreferrer">
              {app.icon === "gmail" ? (
                <GmailIcon aria-hidden />
              ) : (
                <OutlookIcon aria-hidden />
              )}
              Abrir {app.label}
            </a>
          </Button>
        ))}
      </div>
      <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="link"
          onClick={resend}
          disabled={!!pending || wait > 0}
          className="h-11"
        >
          {pending === "resend"
            ? "Reenviando…"
            : wait > 0
              ? `Reenviar código en ${wait} s`
              : "Reenviar código"}
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={onChangeEmail}
          disabled={!!pending}
          className="h-11"
        >
          Usar otro correo
        </Button>
      </div>
      <Button
        type="submit"
        disabled={!!pending || code.length !== 6}
        className="h-11 text-base"
      >
        {pending === "verify" ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  )
}
