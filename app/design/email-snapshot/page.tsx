"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import {
  ScanGuidance,
  ScanSummary,
  SnapshotForm,
  type CardForm,
  type CheckingForm,
} from "@/components/finance/outlook-bank-connection"
import {
  confirmBlocker,
  proposedChecking,
  type ScanCandidate,
} from "@/lib/bank-setup-guidance"

// Mock funcional del paso "revisar candidatos + snapshot" de la conexión Outlook: mismas tarjetas,
// mismos avisos y misma validación que el flujo real, con datos en memoria (sin API ni buzón).
//
// Los tres escenarios existen porque el flujo real NO se puede mirar en el entorno de PR: el
// escaneo consulta Microsoft Graph con el token del buzón, que ahí no existe. Este mock es dónde se
// revisa cómo se ve cada resultado del escaneo, incluido el que llega sin nada que proponer.
//
// Cada escenario declara lo que DEVUELVE EL ESCANEO, no el formulario resultante: la cuenta sale de
// proposedChecking igual que en producción, así que lo que se mira acá ejercita ese camino en vez
// de imitar su salida.

type Escenario = {
  slug: string
  label: string
  desc: string
  bankName: string
  scan: {
    candidates: ScanCandidate[]
    totalMessages: number
    expenseCount: number
    internalCount: number
    primaryCheckingCount: number
    skippedCount: number
    since: string
  }
}

const ESCENARIOS: Escenario[] = [
  {
    slug: "candidatos",
    label: "Con candidatos",
    desc: "El escaneo propone la cuenta y la tarjeta: no hace falta ningún aviso.",
    bankName: "Banco de Chile",
    scan: {
      candidates: [
        { kind: "checking", ref: "8900", last4: "8900", movementCount: 31 },
        {
          kind: "credit_card",
          last4: "2120",
          currencies: ["CLP", "USD"],
          movementCount: 74,
        },
      ],
      totalMessages: 123,
      expenseCount: 105,
      internalCount: 6,
      primaryCheckingCount: 0,
      skippedCount: 12,
      since: "2026-07-01T00:00:00.000Z",
    },
  },
  {
    slug: "cuenta-principal",
    label: "Solo cuenta principal",
    desc: "MACHBANK no numera la cuenta en sus transferencias: la cuenta se propone vacía.",
    bankName: "MACHBANK",
    scan: {
      candidates: [],
      totalMessages: 19,
      expenseCount: 7,
      internalCount: 0,
      primaryCheckingCount: 7,
      skippedCount: 12,
      since: "2026-07-01T00:00:00.000Z",
    },
  },
  {
    slug: "sin-nada",
    label: "Sin nada que proponer",
    desc: "Correos del banco que no identifican ningún instrumento.",
    bankName: "MACHBANK",
    scan: {
      candidates: [],
      totalMessages: 14,
      expenseCount: 0,
      internalCount: 0,
      primaryCheckingCount: 0,
      skippedCount: 14,
      since: "2026-07-01T00:00:00.000Z",
    },
  },
  {
    slug: "sin-avisos",
    label: "Sin avisos del banco",
    desc:
      "Ni un correo del banco elegido: el banco equivocado, o uno recién " +
      "activado. El aviso no se apaga al llenar el formulario.",
    bankName: "Banco BICE",
    scan: {
      candidates: [],
      totalMessages: 0,
      expenseCount: 0,
      internalCount: 0,
      primaryCheckingCount: 0,
      skippedCount: 0,
      since: "2026-08-01T00:00:00.000Z",
    },
  },
]

// El mismo armado que hace `detect()` con la respuesta del escaneo: la cuenta la decide
// proposedChecking y las tarjetas salen de los candidatos de crédito.
function formularioDe(escenario: Escenario): {
  checking: CheckingForm | null
  cards: CardForm[]
} {
  const propuesta = proposedChecking(escenario.scan)
  return {
    checking: propuesta
      ? {
          ref: propuesta.ref,
          cash: 0,
          hasOverdraft: false,
          overdraftLimit: 0,
          overdraftAvailable: 0,
          movementCount: propuesta.movementCount,
        }
      : null,
    cards: escenario.scan.candidates
      .filter((c) => c.kind === "credit_card")
      .map((c) => ({
        id: `mock-${c.last4}`,
        last4: c.last4,
        national: c.currencies.includes("CLP"),
        nationalLimit: 0,
        nationalAvailable: 0,
        international: c.currencies.includes("USD"),
        internationalLimit: 0,
        internationalAvailable: 0,
        movementCount: c.movementCount,
      })),
  }
}

const INICIAL = ESCENARIOS[1] // el caso de la tarjeta: la revisión que llegaba vacía

export default function EmailSnapshotMock() {
  const [open, setOpen] = useState(true)
  const [escenario, setEscenario] = useState(INICIAL)
  const [snapshotAt, setSnapshotAt] = useState("2026-07-15T00:39")
  const inicial = formularioDe(INICIAL)
  const [checking, setChecking] = useState<CheckingForm | null>(
    inicial.checking
  )
  const [cards, setCards] = useState<CardForm[]>(inicial.cards)

  const elegir = (siguiente: Escenario) => {
    const form = formularioDe(siguiente)
    setEscenario(siguiente)
    setChecking(form.checking)
    setCards(form.cards)
    setOpen(true)
  }

  const blocker = confirmBlocker({
    checkingRef: checking ? checking.ref : null,
    cards: cards.map((card) => ({
      ref: card.last4,
      national: card.national,
      international: card.international,
    })),
  })

  return (
    <main className="min-h-dvh bg-background p-6 text-foreground">
      <div className="mx-auto max-w-md space-y-3">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Outlook · Revisión y snapshot
        </h1>
        <p className="text-sm text-muted-foreground">
          Qué muestra la revisión según lo que el escaneo haya encontrado.
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {ESCENARIOS.map((e) => (
            <Button
              key={e.slug}
              variant={e.slug === escenario.slug ? "default" : "outline"}
              onClick={() => elegir(e)}
              className="h-11 shrink-0 rounded-full"
            >
              {e.label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{escenario.desc}</p>
      </div>

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="Conectar banco"
      >
        <div className="space-y-5 px-6 pb-6">
          <ScanSummary scan={escenario.scan} bankName={escenario.bankName} />
          <ScanGuidance
            scan={escenario.scan}
            bankName={escenario.bankName}
            checking={checking}
            cards={cards}
          />
          <SnapshotForm
            bankName={escenario.bankName}
            snapshotAt={snapshotAt}
            setSnapshotAt={setSnapshotAt}
            checking={checking}
            setChecking={setChecking}
            cards={cards}
            setCards={setCards}
          />
          <div className="space-y-2">
            <Button
              onClick={() => setOpen(false)}
              disabled={Boolean(blocker)}
              className="h-12 w-full rounded-full"
            >
              Validar e importar movimientos
            </Button>
            {blocker && <p className="text-center text-sm">{blocker}</p>}
          </div>
        </div>
      </ResponsiveModal>
    </main>
  )
}
