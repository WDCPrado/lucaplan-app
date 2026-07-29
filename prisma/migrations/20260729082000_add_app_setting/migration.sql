-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- Anticipación por defecto del aviso de vencimientos: la que estaba fija en el código.
INSERT INTO "app_setting" ("key", "value", "updatedAt") VALUES ('due_days', '2', CURRENT_TIMESTAMP);
