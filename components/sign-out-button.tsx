"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={pending} className="h-11">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Cerrar sesión
    </Button>
  );
}
