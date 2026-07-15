"use client";

import { useCallback, useMemo, useState } from "react";
import { CURRENCY_DECIMALS, type CurrencyCode } from "@/arch/v1/domain/finance/money";
import { groupByCurrency } from "@/lib/finance-format";

// Hook para inputs de dinero. Entrada "cents-first": el usuario teclea dígitos y se formatean en
// vivo según la moneda (CLP sin decimales, USD con 2). Devuelve el string a mostrar y el valor
// numérico (unidad mayor) listo para enviar a la API. Usar en todo input de monto.
export function useMoneyInput(currency: CurrencyCode, initialValue = 0) {
  const decimals = CURRENCY_DECIMALS[currency];
  const scale = 10 ** decimals;
  const [minor, setMinor] = useState(() => Math.round(initialValue * scale));

  const display = useMemo(() => (minor === 0 ? "" : groupByCurrency(minor / scale, currency)), [minor, scale, currency]);

  const onChange = useCallback((raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 15);
    const nextMinor = digits ? Number(digits) : 0;
    setMinor(nextMinor);
    return nextMinor / scale;
  }, [scale]);

  const reset = useCallback((v = 0) => setMinor(Math.round(v * scale)), [scale]);

  return { display, value: minor / scale, onChange, reset };
}
