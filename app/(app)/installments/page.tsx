import { redirect } from "next/navigation"

// Cuotas es una sección de Recurrentes: la ruta vieja queda por los enlaces guardados, la PWA y
// las notificaciones de pagos por vencer.
export default function InstallmentsPage() {
  redirect("/recurring#cuotas")
}
