-- Server-only atomic linking of a verified Mercado Pago test preapproval.
-- The trusted Edge Function MUST first GET the subscription from Mercado Pago,
-- verify the external_reference, seller, amount, currency and test mode.
-- This RPC does not verify payment or grant an entitlement.
create or replace function public.cithela_mp_link_verified_test_subscription(
 p_intent_id uuid,p_tenant_id uuid,p_owner_user_id uuid,
 p_external_reference text,p_provider_subscription_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v cithela_private.cithela_mp_subscription_intents%rowtype;
begin
 if p_provider_subscription_id is null or
    p_provider_subscription_id !~ '^[A-Za-z0-9_-]{1,120}$'
 then return jsonb_build_object('ok',false,'code','invalid_provider_id'); end if;
 select * into v from cithela_private.cithela_mp_subscription_intents
 where intent_id=p_intent_id and tenant_id=p_tenant_id
 and owner_user_id=p_owner_user_id and external_reference=p_external_reference
 and live_mode=false and currency_id='ARS'
 and terms_version='internal-test-only-v1'
 for update;
 if not found then return jsonb_build_object('ok',false,'code','intent_mismatch'); end if;
 if v.stage='linked' and v.provider_subscription_id=p_provider_subscription_id
 then return jsonb_build_object('ok',true,'code','already_linked'); end if;
 if v.stage<>'prepared' or v.provider_subscription_id is not null
 then return jsonb_build_object('ok',false,'code','intent_not_prepared'); end if;
 update cithela_private.cithela_mp_subscription_intents
 set stage='linked',provider_subscription_id=p_provider_subscription_id,
 linked_at=statement_timestamp()
 where intent_id=v.intent_id;
 return jsonb_build_object('ok',true,'code','linked_without_entitlement');
exception when unique_violation then
 return jsonb_build_object('ok',false,'code','provider_id_conflict');
end $$;
revoke all on function public.cithela_mp_link_verified_test_subscription(uuid,uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.cithela_mp_link_verified_test_subscription(uuid,uuid,uuid,text,text)
 to service_role;