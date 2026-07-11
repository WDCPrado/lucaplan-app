-- CreateTable
CREATE TABLE "bank_credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "passEnc" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_credential_userId_provider_key" ON "bank_credential"("userId", "provider");
