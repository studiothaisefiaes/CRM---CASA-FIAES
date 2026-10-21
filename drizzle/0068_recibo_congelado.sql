-- Fase A: o recibo do pagamento da comissão congelado (linhas e lançamentos como foram pagos). Só acrescenta.
ALTER TABLE "commission_payouts" ADD COLUMN IF NOT EXISTS "receipt" jsonb;
