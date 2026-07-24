"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMoneyInput } from "@/hooks/use-money-input"
import { variantForType } from "@/lib/bank-cards"
import { AccountCard } from "./account-card"
import { Chip } from "./transaction-modal"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type { AccountDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

// Alta manual = bancos/medios sin conexión automática (los conectados llegan por correo).
const BANKS = [
  "Mercado Pago",
  "Tenpo",
  "MACH",
  "Racional",
  "Hapi",
  "Banco Falabella",
  "Banco Ripley",
  "Coopeuch",
  "Efectivo",
]

// Alta manual = tarjetas (solo tipos con tarjeta).
const TYPES: { value: string; label: string }[] = [
  { value: "checking", label: "Tarjeta de débito" },
  { value: "credit_card", label: "Tarjeta de crédito" },
]

export function AccountModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [bankName, setBankName] = useState(BANKS[0] ?? "")
  const [name, setName] = useState("")
  const [accountType, setAccountType] = useState("checking")
  const [currency, setCurrency] = useState<CurrencyCode>("CLP")
  const [color, setColor] = useState("#1e3a8a")
  const [cardLast4, setCardLast4] = useState("")
  const [saving, setSaving] = useState(false)
  const balance = useMoneyInput(currency, 0)

  // Solo los tipos con tarjeta (corriente = débito, crédito) exigen los últimos 4 dígitos.
  const hasCard = variantForType(accountType) !== null
  const cardOk = !hasCard || cardLast4.length === 4
  const canSave = !!bankName.trim() && !!name.trim() && cardOk && !saving

  // Cuenta ficticia para el preview en vivo (reacciona a banco, tipo, saldo y dígitos).
  const preview: AccountDTO = {
    id: "preview",
    bankId: "preview",
    bankName,
    name: name || "Nueva tarjeta",
    accountType,
    currency,
    balance: balance.value,
    color,
    cardLast4: hasCard && cardLast4 ? cardLast4 : null,
    provider: "manual",
    lastSyncedAt: null,
  }

  async function save() {
    if (!canSave) return
    setSaving(true)
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bankName: bankName.trim(),
        name: name.trim(),
        accountType,
        currency,
        balance: balance.value,
        color,
        cardLast4: hasCard ? cardLast4 : null,
      }),
    })
    setSaving(false)
    if (res.ok) {
      setName("")
      setCardLast4("")
      balance.reset()
      onOpenChange(false)
      router.refresh()
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Nueva tarjeta"
      className="sm:max-w-3xl"
    >
      <div className="px-4">
        <div className="md:grid md:grid-cols-2 md:gap-6">
          {/* Columna izquierda: tarjeta grande + banco + tipo (+ dígitos) */}
          <div className="flex flex-col gap-4">
            <div className="md:sticky md:top-0">
              <AccountCard account={preview} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Banco</Label>
              <div className="flex flex-wrap gap-2">
                {BANKS.map((b) => (
                  <Chip
                    key={b}
                    active={bankName === b}
                    onClick={() => setBankName(b)}
                  >
                    {b}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                El alta manual es para bancos/medios sin conexión automática.
                Banco de Chile se conecta por correo desde “Conectar banco”.
              </p>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Tipo de cuenta</Label>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <Chip
                    key={t.value}
                    active={accountType === t.value}
                    onClick={() => setAccountType(t.value)}
                  >
                    {t.label}
                  </Chip>
                ))}
              </div>
            </div>
            {hasCard && (
              <div>
                <Label className="mb-1 block text-xs">
                  Últimos 4 dígitos de la tarjeta
                </Label>
                <Input
                  inputMode="numeric"
                  value={cardLast4}
                  onChange={(e) =>
                    setCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="8821"
                  className="tabular h-11 tracking-widest"
                />
              </div>
            )}
          </div>

          {/* Columna derecha: nombre, moneda, saldo, color */}
          <div className="mt-4 flex flex-col gap-4 md:mt-0">
            <div>
              <Label className="mb-1 block text-xs">Nombre de la tarjeta</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tarjeta débito CLP"
                className="h-11"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Moneda</Label>
              <div className="flex gap-2">
                {(["CLP", "USD"] as const).map((c) => (
                  <Chip
                    key={c}
                    active={currency === c}
                    onClick={() => setCurrency(c)}
                  >
                    {c}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Saldo inicial</Label>
              <Input
                inputMode="numeric"
                value={balance.display}
                onChange={(e) => balance.onChange(e.target.value)}
                placeholder="0"
                className="tabular h-11"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">
                Color (fallback sin arte)
              </Label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-11 w-full rounded-md border bg-transparent"
              />
            </div>
          </div>
        </div>

        <ModalFooter className="mt-4">
          <Button
            onClick={save}
            disabled={!canSave}
            className="h-12 flex-1 rounded-full text-base"
          >
            {saving ? "Guardando…" : "Crear tarjeta"}
          </Button>
        </ModalFooter>
      </div>
    </ResponsiveModal>
  )
}
