-- CreateTable
CREATE TABLE "budget_alert" (
    "id" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_alert_percent_key" ON "budget_alert"("percent");

-- Umbrales por defecto: los mismos que estaban fijos en el código antes de ser configurables.
INSERT INTO "budget_alert" ("id", "percent") VALUES
    (gen_random_uuid(), 80),
    (gen_random_uuid(), 100);
