-- CITHELA / Mercado Pago: signed webhook inbox only.
-- No checkout, external API calls, active subscriptions or payments.
-- Use service_role only from a verified server-side webhook handler.
-- Never grant client roles to mutate or read external payment identifiers.
CREATE TABLE IF NOT EXISTS cithela_private.cithela_mp_webhook_inbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 120),
  topic text NOT NULL CHECK (topic IN
    ('subscription_preapproval','subscription_authorized_payment','payment')),
  resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 200),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  merchant_user_id text NOT NULL CHECK (merchant_user_id ~ '^[0-9]{1,30}$'),
  live_mode boolean NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','reconciled','ignored','failed')),
  -- Billing remains disabled; this table does not map an event to any tenant.
  UNIQUE(event_id)
);
ALTER TABLE cithela_private.cithela_mp_webhook_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_mp_webhook_inbox FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cithela_mp_record_signed_event(
  p_event_id text,
  p_topic text,
  p_resource_id text,
  p_request_id text,
  p_merchant_user_id text,
  p_live_mode boolean,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id bigint;
  v_previous cithela_private.cithela_mp_webhook_inbox%ROWTYPE;
BEGIN
  -- Grant only to the server credential, not to user JWT roles.
  IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 120
    OR p_topic IS NULL OR p_topic NOT IN
      ('subscription_preapproval','subscription_authorized_payment','payment')
    OR p_resource_id IS NULL OR length(p_resource_id) NOT BETWEEN 1 AND 200
    OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 200
    OR p_merchant_user_id IS NULL OR p_merchant_user_id !~ '^[0-9]{1,30}$'
    OR p_live_mode IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_event');
  END IF;
  INSERT INTO cithela_private.cithela_mp_webhook_inbox
   (event_id,topic,resource_id,request_id,merchant_user_id,live_mode,occurred_at)
  VALUES
   (p_event_id,p_topic,p_resource_id,p_request_id,p_merchant_user_id,p_live_mode,p_occurred_at)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'code','recorded');
  END IF;
  SELECT * INTO v_previous
  FROM cithela_private.cithela_mp_webhook_inbox i
  WHERE i.event_id=p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','retry');
  END IF;
  -- Distinguish legitimate delivery retry from conflicting replay.
  IF v_previous.topic IS DISTINCT FROM p_topic
    OR v_previous.resource_id IS DISTINCT FROM p_resource_id
    OR v_previous.merchant_user_id IS DISTINCT FROM p_merchant_user_id
    OR v_previous.live_mode IS DISTINCT FROM p_live_mode THEN
    RETURN jsonb_build_object('ok',false,'code','event_id_conflict');
  END IF;
  RETURN jsonb_build_object('ok',true,'code','duplicate');
END
$function$;
REVOKE ALL ON FUNCTION public.cithela_mp_record_signed_event(
 text,text,text,text,text,boolean,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_mp_record_signed_event(
 text,text,text,text,text,boolean,timestamptz) TO service_role;
-- Intentionally no UPDATE of cithela_private.cithela_commercial_entitlements.
