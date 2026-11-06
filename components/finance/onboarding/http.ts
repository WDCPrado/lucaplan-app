import {
  onboardingCategory,
  onboardingStatus,
  proposeCategoriesOutput,
  type OnboardingCategory,
  type OnboardingStatus,
  type ProposeCategoriesOutput,
} from "@/lib/onboarding-schemas"
import { financeResponseError } from "../finance-form-field"

// Llamadas del onboarding contra las rutas del contrato (lib/onboarding-schemas.ts). Un error lanza
// con el mensaje de la API ({ error }) para mostrarlo tal cual; la respuesta pasa por su esquema.

// Error de la API con su status: 422 va al campo; 401 y 429, arriba del formulario.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok)
    throw new ApiError(
      await financeResponseError(res, "No se pudo completar. Vuelve a intentarlo."),
      res.status
    )
  return res.json()
}

export async function proposeCategories(
  description: string
): Promise<ProposeCategoriesOutput> {
  return proposeCategoriesOutput.parse(
    await call("/api/onboarding/categories/propose", "POST", { description })
  )
}

export async function saveCategories(
  categories: OnboardingCategory[]
): Promise<{ categories: OnboardingCategory[] }> {
  const data = await call("/api/onboarding/categories", "PUT", { categories })
  return { categories: onboardingCategory.array().parse(data.categories) }
}

export async function completeOnboarding(): Promise<OnboardingStatus> {
  return onboardingStatus.parse(await call("/api/onboarding/complete", "POST"))
}
