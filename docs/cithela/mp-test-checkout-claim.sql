-- Alma y Pampa only. Apply before deploying the checkout worker.
-- Only a committed `claimed` response permits a provider POST.
-- On a timeout or `recover_only`, search Mercado Pago by external reference.
create table if not exists cithela_private.cithela_mp_checkout_claims (
  intent_id uuid primary key references cithela_private.cithela_mp_subscription_intents(intent_id),
  claimed_at timestamptz not null default statement_timestamp()
);
alter table cithela_private.cithela_mp_checkout_claims enable row level security;
revoke all on cithela_private.cithela_mp_checkout_claims from public, anon, authenticated;

create or replace function public.cithela_mp_claim_test_checkout(p_intent_id uuid, p_owner_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pilot constant uuid := 'e680ebd3-a031-4968-905a-e829ab3b5dfe';
  intent cithela_private.cithela_mp_subscription_intents%rowtype;
  preflight jsonb;
begin
  preflight := public.cithela_mp_test_preflight(pilot, p_owner_user_id);
  if (preflight->>'code') is distinct from 'eligible' then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;

  select i.* into intent
  from cithela_private.cithela_mp_subscription_intents i
  where i.intent_id = p_intent_id and i.tenant_id = pilot
    and i.owner_user_id = p_owner_user_id and i.live_mode = false
    and i.currency_id = 'ARS' and i.terms_version = 'internal-test-only-v1'
    and i.stage = 'prepared' and i.provider_subscription_id is null
    and i.opted_in_at is not null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'intent_not_prepared');
  end if;

  insert into cithela_private.cithela_mp_checkout_claims (intent_id)
  values (intent.intent_id) on conflict (intent_id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'recover_only', 'external_reference', intent.external_reference);
  end if;
  return jsonb_build_object('ok', true, 'code', 'claimed', 'external_reference', intent.external_reference);
end;
$$;

revoke all on function public.cithela_mp_claim_test_checkout(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cithela_mp_claim_test_checkout(uuid, uuid) to service_role;
