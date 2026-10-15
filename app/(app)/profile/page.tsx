import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { ProfileView } from "@/components/finance/profile-view"

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const u = session.user
  const label = u.name || u.email || "Usuario"

  return (
    <ProfileView
      user={{
        name: u.name ?? "",
        email: u.email,
        role: (u.role ?? "USER") as string,
        initial: label.charAt(0).toUpperCase(),
      }}
    />
  )
}
