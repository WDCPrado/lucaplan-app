-- Marca los topes que puso «Igualar al ingreso»: solo esos siguen solos al total del plan. Los que
-- ya existen quedan en false (se tratan como fijados a mano hasta que se vuelva a igualar).
ALTER TABLE "monthly_budget" ADD COLUMN "followsIncome" BOOLEAN NOT NULL DEFAULT false;
