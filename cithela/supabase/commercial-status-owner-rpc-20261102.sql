-- CITHELA: authenticated read-only subscription status, server authoritative.
-- The public RPC is SECURITY DEFINER because the entitlement ledger must stay
-- private. Strictly require auth.uid() and owner/admin membership before reading.
-- No private provider identifiers, payment IDs, patient information, or writes.
CREATE OR REPLACE FUNCTION public.cithela_commercial_status(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  ent jsonb;
  exp_at timestamptz;
  left_days integer;
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','unauthenticated');
  END IF;
  IF p_tenant_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.cithela_tenant_memberships m
    WHERE m.user_id=actor AND m.tenant_id=p_tenant_id
      AND m.role IN ('owner','admin')
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','forbidden');
  END IF;
  -- Same server-side evaluator used by the booking guard. Never read browser
  -- dates, user metadata or payment redirect parameters for authorization.
  ent := cithela_private.commercial_entitlement_snapshot(
    p_tenant_id, statement_timestamp()
  );
  exp_at := (ent->>'trial_ends_at')::timestamptz;
  IF ent->>'status'='trialing' AND exp_at IS NOT NULL THEN
    left_days:=GREATEST(0,CEIL(EXTRACT(EPOCH FROM
      (exp_at-statement_timestamp()))/86400))::integer;
  END IF;
  RETURN jsonb_build_object(
    'ok',true,
    'status',ent->>'status',
    'can_book',coalesce((ent->>'can_book')::boolean,false),
    'trial_ends_at',ent->>'trial_ends_at',
    'current_period_end',ent->>'current_period_end',
    'days_remaining',left_days,
    'server_checked_at',statement_timestamp()
  );
END
$function$;
REVOKE ALL ON FUNCTION public.cithela_commercial_status(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_commercial_status(uuid)
  TO authenticated;
