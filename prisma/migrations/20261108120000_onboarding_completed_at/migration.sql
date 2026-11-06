-- Onboarding terminado (WDC-181). Las cuentas que ya existían no lo ven: quedan marcadas.
ALTER TABLE "user" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

UPDATE "user" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP;
