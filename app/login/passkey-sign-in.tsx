"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Fingerprint, Loader } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { signInPasskeyMessage } from "@/lib/passkey"
import { Button } from "@/components/ui/button"
import { finishSignIn } from "./finish-sign-in"

const noSubscribe = () => () => {}
const hasWebAuthn = () => typeof window.PublicKeyCredential === "function"

/**
 * «Entrar con biometría» bajo el correo, sin pedirlo (la passkey es residente). Sin WebAuthn no
 * aparece. Además arma el autocompletado del correo (`username webauthn`) si el navegador lo tiene:
 * el teclado ofrece la passkey sin abrir nada. Cancelar el diálogo del sistema no dice nada.
 */
export function PasskeySignIn() {
  const supported = useSyncExternalStore(noSubscribe, hasWebAuthn, () => false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `autoFill` deja la ceremonia esperando en el autocompletado; una nueva (el botón) la corta.
  // `chosen` se sabe cuando sale la verificación: fetchOptions solo va a verify-authentication.
  async function attempt(autoFill: boolean) {
    let chosen = false
    let response: Awaited<ReturnType<typeof authClient.signIn.passkey>>
    try {
      response = await authClient.signIn.passkey({
        autoFill,
        fetchOptions: {
          onRequest: () => {
            chosen = true
            setPending(true)
            setError(null)
          },
        },
      })
    } catch {
      // Sin red el fetch rechaza: el autocompletado se queda callado; el botón (o una passkey ya
      // elegida en el autocompletado) dice qué pasó y se suelta.
      if (autoFill && !chosen) return
      setError("No se pudo entrar. Revisa la conexión e intenta de nuevo.")
      setPending(false)
      return
    }
    if (!response.error) {
      const blocked = finishSignIn(response.data)
      if (blocked) {
        setError(blocked)
        setPending(false)
      }
      return
    }
    // Esperando en el autocompletado nadie pidió nada: un fallo antes de elegir no se muestra
    // ni se vuelve a armar (se repetiría en bucle).
    if (autoFill && !chosen) return
    setError(signInPasskeyMessage(response.error, chosen))
    setPending(false)
    void arm()
  }

  async function arm() {
    try {
      if (await PublicKeyCredential.isConditionalMediationAvailable?.())
        await attempt(true)
    } catch {
      // Sin autocompletado queda el botón.
    }
  }

  useEffect(() => {
    if (hasWebAuthn()) void arm()
    // Solo al montar: después se rearma al terminar cada intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!supported) return null

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div aria-hidden className="flex items-center gap-3 text-caption text-ink-3">
        <span className="h-px flex-1 bg-border" />o
        <span className="h-px flex-1 bg-border" />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
        >
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={pending}
        aria-busy={pending || undefined}
        className="w-full"
        onClick={() => {
          setError(null)
          setPending(true)
          void attempt(false)
        }}
      >
        {pending ? (
          <Loader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Fingerprint aria-hidden />
        )}
        {pending ? "Entrando…" : "Entrar con biometría"}
      </Button>
    </div>
  )
}
