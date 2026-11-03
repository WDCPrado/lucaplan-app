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
        className="font-heading text-2xl font-semibold tracking-tight"
      >
        Conectar {clientName} con Luca Plan
      </h2>
      <p className="mt-2 text-base text-muted-foreground">
        {clientName} solicita acceso a tu cuenta.
      </p>
      <p className="mt-6 text-sm text-muted-foreground">Cuenta de Luca Plan</p>
      <p id="plugin-user-email" className="mt-1 font-medium break-all">
        {email}
      </p>
      <form
        id="plugin-consent-form"
        className="mt-6 space-y-4"
        aria-labelledby="plugin-consent-title"
        onSubmit={form.handleSubmit(submit)}
      >
        <p className="font-medium">Permisos solicitados</p>
        <ul id="plugin-permissions" className="space-y-4 text-sm leading-6">
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
        <p className="text-sm leading-6 text-muted-foreground">
          El acceso corresponde solo a tu cuenta. No permite mover dinero en tu
          banco ni acceder a las claves bancarias.
        </p>
        {(form.formState.errors.root || form.formState.errors.oauth_query) && (
          <p
            id="plugin-consent-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {form.formState.errors.root?.message ??
              "El enlace de conexión no es válido. Inicia la conexión de nuevo desde el asistente."}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button
            id="plugin-authorize"
            className="h-11 w-full text-base"
            type="submit"
            form="plugin-consent-form"
            disabled={pending}
            onClick={() => form.setValue("accept", true)}
          >
            {pending ? "Procesando…" : "Autorizar acceso"}
          </Button>
          <Button
            id="plugin-cancel"
            variant="outline"
            className="h-11 w-full text-base"
            type="submit"
            form="plugin-consent-form"
            disabled={pending}
            onClick={() => form.setValue("accept", false)}
          >
            Cancelar
          </Button>
        </div>
      </form>
      <p className="mt-6 text-sm leading-6 text-muted-foreground">
        Puedes revocar este acceso desde{" "}
        <Link href="/plugin" className="underline underline-offset-4">
          Conexiones del plugin
        </Link>{" "}
        en Luca Plan.
      </p>
    </>
  )
}
