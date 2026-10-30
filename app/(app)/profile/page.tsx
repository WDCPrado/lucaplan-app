import { redirect } from "next/navigation"

// El perfil ahora es una hoja que se abre desde Ajustes (móvil) o el menú de la cuenta
// (escritorio). La ruta queda para no romper enlaces guardados.
export default function ProfilePage() {
  redirect("/settings")
}
