-- Memoria de correcciones de categorización ("aprende de ti"): texto normalizado del movimiento
-- → categoría elegida por el usuario + nota "porqué". Contexto para la IA; no entra en cálculos.

-- CreateTable
CREATE TABLE "categorization_correction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "sampleText" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorization_correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorization_correction_userId_direction_normalizedText_key" ON "categorization_correction"("userId", "direction", "normalizedText");

-- CreateIndex
CREATE INDEX "categorization_correction_userId_direction_idx" ON "categorization_correction"("userId", "direction");

-- AddForeignKey: borrar la categoría se lleva sus correcciones.
ALTER TABLE "categorization_correction" ADD CONSTRAINT "categorization_correction_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
