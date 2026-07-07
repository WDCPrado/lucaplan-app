import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";

import { auth } from "@/arch/v1/infrastructure/auth/auth";
import { SignOutButton } from "@/components/sign-out-button";

export default async function Home() {
  // Validación real de sesión (el proxy ya hizo el chequeo optimista de cookie).
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { user } = session;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="glass w-full max-w-md rounded-3xl p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Wallet className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Hola, {user.name}</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <dl className="mb-6 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Rol</dt>
            <dd>
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                {user.role ?? "USER"}
              </span>
            </dd>
          </div>
        </dl>

        <SignOutButton />
      </div>
    </main>
  );
}
