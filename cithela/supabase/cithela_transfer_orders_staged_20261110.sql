-- CITHELA / transfer orders, pre-production phase 2026-11-10.
-- Creates pending payment requests ONLY: no collection, account grants, paid
-- entitlements, bank details, or provider callbacks.
-- Requires commercial price and entitlement schemas already installed.
-- CRITICAL: cithela_price_options currently has CHECK(is_published=false).
-- Do not relax this until signed terms, support, settlement and QA are ready.
BEGIN;
CREATE TABLE cithela_private.cithela_transfer_orders (
  order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.cithela_tenants(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  price_id uuid NOT NULL REFERENCES cithela_private.cithela_price_options(price_id)
    ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 100 AND 100000000000),
  currency_id text NOT NULL DEFAULT 'ARS' CHECK (currency_id='ARS'),
  terms_version text NOT NULL CHECK (terms_version='cithela-billing-20261110'),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^CIT-[A-F0-9]{16}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','expired','rejected','credited')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '4 days'),
  CHECK (status<>'credited') -- activation is deliberately NOT implemented
);
CREATE UNIQUE INDEX cithela_one_pending_transfer_per_tenant
  ON cithela_private.cithela_transfer_orders(tenant_id)
  WHERE status='pending';
CREATE INDEX cithela_transfer_orders_owner_idx
  ON cithela_private.cithela_transfer_orders(owner_user_id,created_at DESC);
ALTER TABLE cithela_private.cithela_transfer_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_transfer_orders FROM PUBLIC,anon,authenticated;
-- Belt-and-braces protection: even service_role cannot mark credited while
-- the paid-ledger review flow is missing.
CREATE OR REPLACE FUNCTION cithela_private.transfer_order_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $guard$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending' THEN
      RAISE EXCEPTION 'transfer_order_invalid_initial_status';
    END IF;
  ELSE
    IF (NEW.order_id,NEW.tenant_id,NEW.owner_user_id,NEW.price_id,
        NEW.amount_minor,NEW.currency_id,NEW.terms_version,
        NEW.reference,NEW.created_at,NEW.expires_at)
       IS DISTINCT FROM
       (OLD.order_id,OLD.tenant_id,OLD.owner_user_id,OLD.price_id,
        OLD.amount_minor,OLD.currency_id,OLD.terms_version,
        OLD.reference,OLD.created_at,OLD.expires_at)
       OR NOT (OLD.status='pending' AND NEW.status IN ('expired','rejected'))
    THEN
       RAISE EXCEPTION 'transfer_order_mutation_not_allowed';
    END IF;
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION cithela_private.transfer_order_write_guard()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cithela_transfer_order_guard
 BEFORE INSERT OR UPDATE ON cithela_private.cithela_transfer_orders
 FOR EACH ROW EXECUTE FUNCTION cithela_private.transfer_order_write_guard();

CREATE OR REPLACE FUNCTION public.cithela_prepare_transfer_order(
  p_actor uuid,
  p_tenant_id uuid,
  p_consent boolean,
  p_terms_version text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $request$
DECLARE
  v_status text;
  v_provider text;
  v_price RECORD;
  v_current RECORD;
  v_new_id uuid;
  v_ref text;
  v_time timestamptz:=statement_timestamp();
BEGIN
  -- service_role only. Edge must resolve bearer JWT to p_actor before calling.
  IF p_actor IS NULL OR p_tenant_id IS NULL
    OR p_consent IS DISTINCT FROM true
    OR p_terms_version IS DISTINCT FROM 'cithela-billing-20261110'
  THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.cithela_tenant_memberships m ON m.user_id=u.id
    WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL
      AND m.tenant_id=p_tenant_id AND m.role='owner'
  ) THEN RETURN jsonb_build_object('ok',false,'code','not_owner'); END IF;

  SELECT e.status,e.provider INTO v_status,v_provider
    FROM cithela_private.cithela_commercial_entitlements e
    WHERE e.tenant_id=p_tenant_id AND e.owner_user_id=p_actor
    FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN
      ('trialing','payment_pending','past_due','canceled','active')
     OR (v_status='active' AND v_provider IS NOT NULL
         AND v_provider<>'bank_transfer')
  THEN RETURN jsonb_build_object('ok',false,'code','not_eligible'); END IF;

  -- Published offer is a hard server-side gate. Currently permanently false.
  SELECT p.price_id,p.amount_minor,p.currency_id INTO v_price
    FROM cithela_private.cithela_price_options p
    WHERE p.plan_code='cithela_monthly'
      AND p.is_selected=true AND p.is_published=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','offer_not_published');
  END IF;

  SELECT o.order_id,o.reference,o.amount_minor,o.expires_at
    INTO v_current
    FROM cithela_private.cithela_transfer_orders o
    WHERE o.tenant_id=p_tenant_id AND o.status='pending'
    FOR UPDATE;
  IF FOUND THEN
    IF v_current.expires_at>v_time THEN
      RETURN jsonb_build_object('ok',true,'code','already_pending',
        'order_id',v_current.order_id,'reference',v_current.reference,
        'amount_minor',v_current.amount_minor,'currency','ARS',
        'expires_at',v_current.expires_at,'paid',false);
    END IF;
    UPDATE cithela_private.cithela_transfer_orders SET status='expired'
      WHERE order_id=v_current.order_id AND status='pending';
  END IF;

  v_new_id:=gen_random_uuid();
  v_ref:='CIT-'||upper(substr(replace(v_new_id::text,'-',''),1,16));
  INSERT INTO cithela_private.cithela_transfer_orders(
     order_id,tenant_id,owner_user_id,price_id,amount_minor,
     terms_version,reference,created_at,expires_at
  ) VALUES (
     v_new_id,p_tenant_id,p_actor,v_price.price_id,v_price.amount_minor,
     p_terms_version,v_ref,v_time,v_time+interval '72 hours'
  );
  RETURN jsonb_build_object('ok',true,'code','transfer_order_pending',
    'order_id',v_new_id,'reference',v_ref,
    'amount_minor',v_price.amount_minor,'currency','ARS',
    'expires_at',v_time+interval '72 hours','paid',false);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'code','order_already_pending');
END
$request$;
REVOKE ALL ON FUNCTION public.cithela_prepare_transfer_order(uuid,uuid,boolean,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_prepare_transfer_order(uuid,uuid,boolean,text)
 TO service_role;

COMMIT;
