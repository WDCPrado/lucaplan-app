"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import {
  SnapshotForm,
  type CardForm,
  type CheckingForm,
} from "@/components/finance/outlook-bank-connection"

// Mock funcional del paso "revisar candidatos + snapshot" de la conexión Outlook: mismas
// tarjetas editables y validación que el flujo real, con datos en memoria (sin API).
export default function EmailSnapshotMock() {
  const [open, setOpen] = useState(true)
  const [snapshotAt, setSnapshotAt] = useState("2026-07-15T00:39")
  const [checking, setChecking] = useState<CheckingForm | null>({
    ref: "8900",
    cash: 0,
    hasOverdraft: true,
    overdraftLimit: 1_000_000,
    overdraftAvailable: 886_453,
    movementCount: 31,
  })
  const [cards, setCards] = useState<CardForm[]>([
    {
      id: "mock-2120",
      last4: "2120",
      national: true,
      nationalLimit: 3_272_200,
      nationalAvailable: 992_926,
      international: true,
      internationalLimit: 2_100,
      internationalAvailable: 1_694.62,
      movementCount: 74,
    },
  ])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <Button onClick={() => setOpen(true)} className="h-11 rounded-full">
        Abrir revisión de Outlook
      </Button>
      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="Conectar banco"
      >
        <div className="space-y-5 px-6 pb-6">
          <div className="rounded-xl bg-muted/50 p-3 text-sm">
            <span className="font-medium">105 gastos detectados</span>
            <span className="text-muted-foreground">
              {" "}
              · 6 ajustes internos · 12 omitidos
            </span>
          </div>
          <SnapshotForm
            bankName="Banco de Chile"
            snapshotAt={snapshotAt}
            setSnapshotAt={setSnapshotAt}
            checking={checking}
            setChecking={setChecking}
            cards={cards}
            setCards={setCards}
          />
          <Button
            onClick={() => setOpen(false)}
            className="h-12 w-full rounded-full"
          >
            Validar e importar movimientos
          </Button>
        </div>
      </ResponsiveModal>
    </main>
  )
}
