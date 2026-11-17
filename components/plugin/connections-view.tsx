"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  pluginConnectionSchema,
  pluginConnectionsSchema,
  type PluginConnectionResponse,
} from "@/lib/schemas/plugin-auth"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const revokeSchema = pluginConnectionSchema.pick({ id: true })

export function ConnectionsView({
  email,
  initialConnections,
}: {
  email: string
  initialConnections: PluginConnectionResponse[] | null
}) {
  const [connections, setConnections] = useState(initialConnections ?? [])
  const [loadError, setLoadError] = useState(initialConnections === null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<PluginConnectionResponse | null>(
    null
  )
  const [message, setMessage] = useState("")
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const form = useForm({
    resolver: zodResolver(revokeSchema),
    defaultValues: { id: "" },
  })
  const pending = form.formState.isSubmitting

  async function reload() {
    setLoading(true)
    try {
      const response = await fetch("/api/plugin/connections", {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("load")
      setConnections(
        pluginConnectionsSchema.parse(await response.json()).connections
      )
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }
  async function revoke({ id }: { id: string }) {
    form.clearErrors("root")
    try {
      const response = await fetch(
        `/api/plugin/connections/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      )
      if (!response.ok) throw new Error("revoke")
      setConnections((rows) => rows.filter((row) => row.id !== id))
      setMessage(
        `Se revocó el acceso de ${selected?.clientName || "el asistente"}.`
      )
      setSelected(null)
    } catch {
      form.setError("root", {
        message:
          "No pudimos revocar el acceso. Inténtalo de nuevo. Si tu sesión venció, vuelve a ingresar a Luca Plan.",
      })
    }
  }
  return (
    <>
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-title font-semibold outline-none"
      >
        Conexiones del plugin
      </h2>
      <p className="mt-1 text-ink-2">
        Controla qué asistentes pueden usar tus datos de Luca Plan.
      </p>
      <p
        id="plugin-user-email"
        className="mt-4 text-callout break-all text-ink-3"
      >
        {email}
      </p>
      {loadError ? (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p
            id="plugin-connections-error"
            role="alert"
            className="w-full rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
          >
            No pudimos cargar tus conexiones. Inténtalo de nuevo.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={reload}
            disabled={loading}
          >
            {loading ? "Cargando…" : "Reintentar"}
          </Button>
        </div>
      ) : connections.length ? (
        <div
          id="plugin-connection-list"
          className="mt-6 flex flex-col gap-3"
        >
          {connections.map((connection) => (
            <article
              key={connection.id}
              className="flex flex-col gap-2 rounded-xl bg-card p-(--pad-card)"
              aria-labelledby={`plugin-client-${connection.id}`}
            >
              <h3
                id={`plugin-client-${connection.id}`}
                className="text-title font-semibold"
              >
                {connection.clientName || "Asistente conectado"}
              </h3>
              {connection.scopes.includes("finance:read") && (
                <p className="text-callout">
                  Consultar tus cuentas, saldos, movimientos, categorías y
                  presupuestos.
                </p>
              )}
              {connection.scopes.includes("finance:write") && (
                <p className="text-callout">
                  Crear, editar y eliminar datos financieros.
                </p>
              )}
              {(connection.scopes.includes("openid") ||
                connection.scopes.includes("email")) && (
                <p className="text-callout text-ink-2">
                  Perfil y correo de Luca Plan.
                </p>
              )}
              {connection.scopes.includes("offline_access") && (
                <p className="text-callout text-ink-2">
                  Conexión persistente hasta que revoques el acceso.
                </p>
              )}
              <p className="text-caption text-ink-3">
                Autorizado el{" "}
                {new Intl.DateTimeFormat("es-CL", {
                  dateStyle: "long",
                  timeZone: "America/Santiago",
                }).format(new Date(connection.createdAt))}
              </p>
              <Button
                type="button"
                variant="destructive"
                className="mt-2 w-full"
                onClick={(event) => {
                  returnFocus.current = event.currentTarget
                  form.reset({ id: connection.id })
                  setSelected(connection)
                }}
              >
                Revocar acceso
                <span className="sr-only">
                  {" "}
                  de {connection.clientName || "este asistente"}
                </span>
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div
          id="plugin-empty-state"
          className="mt-6 flex flex-col gap-1 rounded-xl bg-card p-(--pad-card)"
        >
          <p className="font-semibold">No tienes conexiones activas</p>
          <p className="text-callout text-ink-2">
            Para conectar un asistente, inicia la conexión desde el plugin Luca
            Plan en ChatGPT o Codex.
          </p>
        </div>
      )}
      {message && (
        <p
          id="plugin-connections-result"
          role="status"
          className="mt-4 rounded-md bg-primary-soft px-3 py-2.5 text-callout text-primary"
        >
          {message}
        </p>
      )}
      <Button asChild variant="secondary" className="mt-6 w-full">
        <Link href="/dashboard">Volver a Luca Plan</Link>
      </Button>
      <AlertDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setSelected(null)
        }}
      >
        <AlertDialogContent
          id="plugin-revoke-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus()
            else heading.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Revocar el acceso de {selected?.clientName || "este asistente"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El asistente dejará de consultar y modificar tus datos. Tus
              cuentas y movimientos se conservan. Para volver a usarlo tendrás
              que conectar tu cuenta otra vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form id="plugin-revoke-form" onSubmit={form.handleSubmit(revoke)}>
            <input type="hidden" {...form.register("id")} />
            {form.formState.errors.root && (
              <p
                id="plugin-revoke-error"
                role="alert"
                className="text-callout text-destructive"
              >
                {form.formState.errors.root.message}
              </p>
            )}
          </form>
          <AlertDialogFooter>
            <AlertDialogCancel
              id="plugin-revoke-cancel"
              type="button"
              className="h-11"
              disabled={pending}
            >
              Cancelar
            </AlertDialogCancel>
            <Button
              id="plugin-revoke-confirm"
              type="submit"
              form="plugin-revoke-form"
              variant="destructive"
              className="h-11"
              disabled={pending}
            >
              {pending ? "Revocando…" : "Revocar acceso"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
