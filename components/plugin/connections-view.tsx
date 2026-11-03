"use client"

import { Button } from "glisse"
import { Button as SlotButton } from "@/components/ui/button"

import { useRef, useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  pluginConnectionSchema,
  pluginConnectionsSchema,
  type PluginConnectionResponse,
} from "@/lib/schemas/plugin-auth"

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
        className="font-heading text-2xl font-semibold tracking-tight outline-none"
      >
        Conexiones del plugin
      </h2>
      <p className="mt-2 text-base text-muted-foreground">
        Controla qué asistentes pueden usar tus datos de Luca Plan.
      </p>
      <p
        id="plugin-user-email"
        className="mt-6 text-sm break-all text-muted-foreground"
      >
        {email}
      </p>
      {loadError ? (
        <div className="mt-6 space-y-3">
          <p
            id="plugin-connections-error"
            role="alert"
            className="text-sm text-destructive"
          >
            No pudimos cargar tus conexiones. Inténtalo de nuevo.
          </p>
          <Button
            type="button"
            className="h-11"
            onClick={reload}
            disabled={loading}
          >
            {loading ? "Cargando…" : "Reintentar"}
          </Button>
        </div>
      ) : connections.length ? (
        <div
          id="plugin-connection-list"
          className="mt-6 divide-y divide-border"
        >
          {connections.map((connection) => (
            <article
              key={connection.id}
              className="space-y-4 py-4"
              aria-labelledby={`plugin-client-${connection.id}`}
            >
              <h3
                id={`plugin-client-${connection.id}`}
                className="text-lg font-medium"
              >
                {connection.clientName || "Asistente conectado"}
              </h3>
              {connection.scopes.includes("finance:read") && (
                <p className="text-sm leading-6">
                  Consultar tus cuentas, saldos, movimientos, categorías y
                  presupuestos.
                </p>
              )}
              {connection.scopes.includes("finance:write") && (
                <p className="text-sm leading-6">
                  Crear, editar y eliminar datos financieros.
                </p>
              )}
              {(connection.scopes.includes("openid") ||
                connection.scopes.includes("email")) && (
                <p className="text-sm text-muted-foreground">
                  Perfil y correo de Luca Plan.
                </p>
              )}
              {connection.scopes.includes("offline_access") && (
                <p className="text-sm text-muted-foreground">
                  Conexión persistente hasta que revoques el acceso.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Autorizado el{" "}
                {new Intl.DateTimeFormat("es-CL", {
                  dateStyle: "long",
                  timeZone: "America/Santiago",
                }).format(new Date(connection.createdAt))}
              </p>
              <Button
                type="button"
                className="h-11 w-full text-base"
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
        <div id="plugin-empty-state" className="mt-6 space-y-2">
          <p className="font-medium">No tienes conexiones activas</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Para conectar un asistente, inicia la conexión desde el plugin Luca
            Plan en ChatGPT o Codex.
          </p>
        </div>
      )}
      {message && (
        <p
          id="plugin-connections-result"
          role="status"
          className="mt-4 text-sm text-muted-foreground"
        >
          {message}
        </p>
      )}
      <SlotButton
        asChild
        variant="outline"
        className="mt-6 h-11 w-full text-base"
      >
        <Link href="/dashboard">Volver a Luca Plan</Link>
      </SlotButton>
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
                className="text-sm text-destructive"
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
              destructive
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
