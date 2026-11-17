"use client"

import { useEffect, useRef, useState } from "react"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { Loader } from "lucide-react"
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
import { finishSignIn } from "./finish-sign-in"
import { GmailIcon, OutlookIcon } from "./mail-app-icons"
import { PasskeySignIn } from "./passkey-sign-in"

const STEP_CLASS =
  "flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-4 duration-200 motion-reduce:animate-none"

// Con el registro cerrado, un correo nuevo no recibe código: el texto no lo promete.
// `codeInConsole`: el servidor imprime el código en vez de enviarlo (printsLoginCodeLocally).
export function EmailCodeForm({
  signupOpen,
  codeInConsole,
}: {
  signupOpen: boolean
  codeInConsole: boolean
}) {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  return sent ? (
    <CodeStep
      email={email}
      signupOpen={signupOpen}
      codeInConsole={codeInConsole}
      onChangeEmail={() => setSent(false)}
    />
  ) : (
    <>
      <EmailStep
        email={email}
        signupOpen={signupOpen}
        onSent={(value) => {
          setEmail(value)
          setSent(true)
        }}
      />
      <PasskeySignIn />
    </>
  )
}

function EmailStep({
  email,
  signupOpen,
  onSent,
}: {
  email: string
  signupOpen: boolean
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
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
        >
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
          autoComplete="username webauthn"
          autoFocus
          defaultValue={email}
          maxLength={254}
          required
          disabled={pending}
          aria-invalid={!!fieldError}
          aria-describedby={
            fieldError ? "login-email-error" : "login-email-hint"
          }
        />
        {fieldError && (
          <p
            id="login-email-error"
            role="alert"
            className="text-callout text-destructive"
          >
            {fieldError}
          </p>
        )}
        <p id="login-email-hint" className="text-callout text-ink-2">
          {signupOpen
            ? "Te mandamos un código de 6 dígitos. Si no tienes cuenta, la creamos con ese mismo código."
            : "Te mandamos un código de 6 dígitos para entrar sin contraseña."}
        </p>
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && (
          <Loader
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
  signupOpen,
  codeInConsole,
  onChangeEmail,
}: {
  email: string
  signupOpen: boolean
  codeInConsole: boolean
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
      const blocked = finishSignIn(response.data)
      if (blocked) setError(blocked)
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
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
        >
          {error}
        </p>
      )}
      <p className="text-callout break-words text-ink-2">
        {signupOpen ? "Te enviamos" : "Si tienes cuenta, te enviamos"} un
        código a{" "}
        <span className="font-semibold text-foreground">{maskEmail(email)}</span>.
        Vale 10 minutos.
      </p>
      {codeInConsole && (
        <p className="text-caption text-ink-3">
          En local, el código aparece en la consola del servidor.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="login-code">Código</Label>
        {/* 6 casillas de 44 + separador: 280 px, caben en la tarjeta de 296 a 360 px. */}
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
                className="h-14 w-11 font-semibold sm:w-12"
              />
            ))}
          </InputOTPGroup>
          <InputOTPSeparator className="text-ink-3" />
          <InputOTPGroup>
            {[3, 4, 5].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className="h-14 w-11 font-semibold sm:w-12"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {codeError && (
          <p
            id="login-code-error"
            role="alert"
            className="text-callout text-destructive"
          >
            {codeError}
          </p>
        )}
        {pending === "verify" && (
          <p role="status" className="text-callout text-ink-2">
            Entrando…
          </p>
        )}
        {resent && (
          <p role="status" className="text-callout text-ink-2">
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
            className="pointer-coarse:h-11 sm:flex-1"
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
      <Button
        type="submit"
        size="lg"
        disabled={!!pending || code.length !== 6}
        className="w-full"
      >
        {pending === "verify" ? "Entrando…" : "Entrar"}
      </Button>
      {/* Secundarias en callout; a 360 px se parten en dos líneas en vez de desbordar. */}
      <div className="-mx-3 -mb-1 flex flex-wrap items-center justify-between gap-x-2">
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={resend}
          disabled={!!pending || wait > 0}
          className="tabular"
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
          size="sm"
          onClick={onChangeEmail}
          disabled={!!pending}
        >
          Usar otro correo
        </Button>
      </div>
    </form>
  )
}
