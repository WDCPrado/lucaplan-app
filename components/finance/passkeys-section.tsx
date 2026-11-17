"use client"

import { useState, useSyncExternalStore } from "react"
import { Fingerprint, Loader, Plus } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { APP_TZ } from "@/lib/finance-format"
import { addPasskeyMessage, passkeyDeviceName } from "@/lib/passkey"
import { IconTile, InlineNotice, ListRow, SectionAction, SectionCard } from "./blocks"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type Passkey = { id: string; name?: string | null; createdAt: Date | string }

const noSubscribe = () => () => {}
const hasWebAuthn = () => typeof window.PublicKeyCredential === "function"
const addedFmt = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: APP_TZ,
})
const nameOf = (p: Passkey) => p.name || "Aparato sin nombre"

/**
 * Los aparatos con que la cuenta entra con biometría (passkeys del plugin de Better Auth). Sin
 * límite; se puede quitar el último porque el código por correo sigue. La lista es un atom del
 * cliente: se refresca sola al agregar o quitar.
 */
export function PasskeysSection() {
  const passkeys = authClient.useListPasskeys()
  const supported = useSyncExternalStore(noSubscribe, hasWebAuthn, () => false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Passkey | null>(null)
  const [removePending, setRemovePending] = useState(false)

  async function add() {
    setAdding(true)
    setAddError(null)
    try {
      const { error } = await authClient.passkey.addPasskey({
        name: passkeyDeviceName(navigator.userAgent),
      })
      if (error) setAddError(addPasskeyMessage(error))
      else toast.success("Listo: este aparato ya puede entrar con biometría.")
    } catch {
      setAddError(addPasskeyMessage(null))
    } finally {
      setAdding(false)
    }
  }

  async function remove(passkey: Passkey) {
    setRemovePending(true)
    try {
      const { error } = await authClient.passkey.deletePasskey({ id: passkey.id })
      if (error) throw error
      toast.success(`Quitaste «${nameOf(passkey)}».`)
      setRemoving(null)
    } catch {
      toast.error("No se pudo quitar el aparato. Inténtalo de nuevo.")
    } finally {
      setRemovePending(false)
    }
  }

  const list: Passkey[] = passkeys.data ?? []

  return (
    <SectionCard
      title="Biometría"
      action={
        <SectionAction
          onClick={add}
          disabled={!supported || adding}
          aria-busy={adding || undefined}
          aria-describedby={supported ? undefined : "passkeys-unsupported"}
        >
          {adding ? (
            <Loader aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Plus aria-hidden />
          )}
          {adding ? "Agregando…" : "Agregar este aparato"}
        </SectionAction>
      }
    >
      <div className="flex flex-1 flex-col gap-2">
        {addError && <InlineNotice tone="alert" wrap label={addError} />}
        {passkeys.isPending ? (
          <div aria-busy className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : passkeys.error ? (
          <InlineNotice
            tone="alert"
            label="No se pudieron cargar tus aparatos."
            value="Reintentar"
            onClick={() => passkeys.refetch()}
          />
        ) : list.length === 0 ? (
          <p className="text-callout text-ink-2">
            Todavía no tienes aparatos. Agrega este para entrar sin código la
            próxima vez.
          </p>
        ) : (
          list.map((p) => (
            <ListRow
              key={p.id}
              icon={
                <IconTile>
                  <Fingerprint />
                </IconTile>
              }
              title={nameOf(p)}
              meta={`Agregado el ${addedFmt.format(new Date(p.createdAt))}`}
              value={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="font-semibold text-destructive hover:text-destructive"
                  aria-label={`Quitar ${nameOf(p)}`}
                  onClick={() => setRemoving(p)}
                >
                  Quitar
                </Button>
              }
            />
          ))
        )}
      </div>
      <div className="mt-3 text-caption text-pretty text-ink-3">
        {supported ? (
          <p>
            Entra sin código con la huella, la cara o el PIN de tu teléfono o
            computador.
          </p>
        ) : (
          <p id="passkeys-unsupported">
            Este navegador no permite entrar con biometría. Prueba desde tu
            celular o con Chrome, Safari o Edge al día.
          </p>
        )}
      </div>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && !removePending && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar este aparato</AlertDialogTitle>
            <AlertDialogDescription>
              {removing &&
                `«${nameOf(removing)}» ya no podrá entrar con biometría. Puedes volver a agregarlo desde ese aparato.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removePending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removePending}
              onClick={(event) => {
                // Se cierra al terminar, no antes: si falla, la persona sigue ahí.
                event.preventDefault()
                if (removing) void remove(removing)
              }}
            >
              {removePending ? "Quitando…" : "Quitar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  )
}
