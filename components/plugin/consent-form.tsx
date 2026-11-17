"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"
import {
  pluginConsentSchema,
  type PluginConsentInput,
} from "@/lib/schemas/plugin-auth"
import { Button } from "@/components/ui/button"

export function ConsentForm({
  email,
  clientName,
  scopes,
  oauthQuery,
}: {
  email: string
  clientName: string
  scopes: string[]
  oauthQuery: string
}) {
  const form = useForm<PluginConsentInput>({
    resolver: zodResolver(pluginConsentSchema),
    defaultValues: { accept: true, oauth_query: oauthQuery },
  })
  const pending = form.formState.isSubmitting
  async function submit(values: PluginConsentInput) {
    form.clearErrors("root")
    try {
      const result = await authClient.oauth2.consent(values)
      if (result.error || !result.data?.redirect || !result.data.url) {
        form.setError("root", {
          message:
            "No pudimos completar la conexión. El enlace puede haber vencido. Vuelve al asistente e inicia la conexión de nuevo.",
        })
        return
      }
      // El destino proviene de la respuesta validada por el proveedor, nunca del query del navegador.
      window.location.assign(result.data.url)
    } catch {
      form.setError("root", {
        message:
          "No pudimos conectar con Luca Plan. Revisa tu conexión e inténtalo de nuevo.",
      })
    }
  }
  return (
    <>
      <h2
        id="plugin-consent-title"
        className="text-title font-semibold"
      >
        Conectar {clientName} con Luca Plan
      </h2>
      <p className="mt-1 text-ink-2">
        {clientName} solicita acceso a tu cuenta.
      </p>
      <div className="mt-6 flex flex-col gap-0.5 rounded-lg bg-secondary px-4 py-3">
        <p className="text-caption text-ink-3">Cuenta de Luca Plan</p>
        <p id="plugin-user-email" className="font-semibold break-all">
          {email}
        </p>
      </div>
      <form
        id="plugin-consent-form"
        className="mt-6 flex flex-col gap-4"
        aria-labelledby="plugin-consent-title"
        onSubmit={form.handleSubmit(submit)}
      >
        <p className="font-semibold">Permisos solicitados</p>
        <ul
          id="plugin-permissions"
          className="flex flex-col gap-3 rounded-xl bg-card p-(--pad-card) text-callout text-ink-2 [&_strong]:font-semibold [&_strong]:text-foreground"
        >
          {scopes.includes("finance:read") && (
            <li>
              <strong>Consultar tus finanzas.</strong> Ver cuentas, saldos,
              movimientos, categorías y presupuestos.
            </li>
          )}
          {scopes.includes("finance:write") && (
            <li>
              <strong>Modificar tus finanzas.</strong> Crear, editar y eliminar
              datos financieros mediante las herramientas de Luca Plan.
            </li>
          )}
          {(scopes.includes("openid") || scopes.includes("email")) && (
            <li>
              <strong>Identificar tu cuenta.</strong> Acceder a tu perfil y
              correo de Luca Plan.
            </li>
          )}
          {scopes.includes("offline_access") && (
            <li>
              <strong>Mantener la conexión.</strong> Conservar el acceso hasta
              que lo revoques.
            </li>
          )}
        </ul>
        <p className="text-callout text-ink-2">
          El acceso corresponde solo a tu cuenta. No permite mover dinero en tu
          banco ni acceder a las claves bancarias.
        </p>
        {(form.formState.errors.root || form.formState.errors.oauth_query) && (
          <p
            id="plugin-consent-error"
            role="alert"
            className="rounded-md bg-destructive-soft px-3 py-2.5 text-callout text-destructive"
          >
            {form.formState.errors.root?.message ??
              "El enlace de conexión no es válido. Inicia la conexión de nuevo desde el asistente."}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button
            id="plugin-authorize"
            className="w-full"
            type="submit"
            form="plugin-consent-form"
            disabled={pending}
            onClick={() => form.setValue("accept", true)}
          >
            {pending ? "Procesando…" : "Autorizar acceso"}
          </Button>
          <Button
            id="plugin-cancel"
            variant="secondary"
            className="w-full"
            type="submit"
            form="plugin-consent-form"
            disabled={pending}
            onClick={() => form.setValue("accept", false)}
          >
            Cancelar
          </Button>
        </div>
      </form>
      <p className="mt-6 text-callout text-ink-3">
        Puedes revocar este acceso desde{" "}
        <Link
          href="/plugin"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Conexiones del plugin
        </Link>{" "}
        en Luca Plan.
      </p>
    </>
  )
}
