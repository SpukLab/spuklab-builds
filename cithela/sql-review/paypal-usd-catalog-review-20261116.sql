-- REVIEW ONLY: DO NOT APPLY TO PRODUCTION BEFORE REFACTORING ADMIN RPC/UX.
-- CITHELA: prepare independent ARS/USD price options, without publishing any price.
-- This file is intentionally NOT a migration deployed in Supabase.
-- Existing ARS options and subscription entitlements must be preserved.
BEGIN;
  ALTER TABLE cithela_private.cithela_price_options
    DROP CONSTRAINT cithela_price_options_currency_id_check;
  ALTER TABLE cithela_private.cithela_price_options
    ADD CONSTRAINT cithela_price_options_currency_id_check
      CHECK(currency_id IN ('ARS','USD'));

  -- Same numerical amount in two currencies must NOT collide.
  ALTER TABLE cithela_private.cithela_price_options
    DROP CONSTRAINT cithela_price_options_plan_code_amount_minor_key;
  ALTER TABLE cithela_private.cithela_price_options
    ADD CONSTRAINT cithela_price_options_plan_currency_amount_key
      UNIQUE(plan_code,currency_id,amount_minor);

  -- At most one selected price PER currency and plan.
  DROP INDEX cithela_private.cithela_single_selected_price;
  CREATE UNIQUE INDEX cithela_single_selected_price
    ON cithela_private.cithela_price_options(plan_code,currency_id)
    WHERE is_selected;
  -- Keep is_published=false, no USD price inserted, no grants or permissions added.
COMMIT;

-- ADDITIONAL BLOCKERS (not part of this SQL):
-- 1. Update protected commercial admin RPC to require currency_id and filter
--    selection by plan + currency without changing the ARS selection.
-- 2. Approve an explicit final USD price, tax display and versioned legal terms.
-- 3. Add a private sandbox-only PayPal intent/plan mapping and durable event inbox,
--    unique by tenant and provider subscription ID, with audited transitions.
-- 4. Provider GET confirmation, payment/transaction reconciliation and cancellation
--    must exist before any paid entitlement is issued.
