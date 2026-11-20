-- Read-only status snapshot for the authenticated tenant owner.
-- Execute only through service_role after getUser(JWT) + membership verification.
create or replace function public.cithela_mp_test_subscription_snapshot(
 p_tenant_id uuid,p_owner_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v cithela_private.cithela_mp_subscription_intents%rowtype;
begin
 if not exists(select 1 from public.cithela_tenant_memberships m
 join cithela_private.cithela_commercial_entitlements e
 on e.tenant_id=m.tenant_id
 where m.tenant_id=p_tenant_id and m.user_id=p_owner_user_id
 and m.role='owner' and e.owner_user_id=p_owner_user_id)
 then return jsonb_build_object('ok',false,'code','not_tenant_owner'); end if;
 select * into v from cithela_private.cithela_mp_subscription_intents
 where tenant_id=p_tenant_id and owner_user_id=p_owner_user_id
 and stage<>'canceled' order by created_at desc limit 1;
 if not found then return jsonb_build_object('ok',true,'code','no_subscription'); end if;
 return jsonb_build_object('ok',true,'code','snapshot',
 'stage',v.stage,'external_reference',v.external_reference,
 'provider_subscription_id',v.provider_subscription_id,
 'live_mode',v.live_mode,'currency_id',v.currency_id,
 'amount_minor',v.amount_minor,'collector_id',v.collector_id);
end $$;
revoke all on function public.cithela_mp_test_subscription_snapshot(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.cithela_mp_test_subscription_snapshot(uuid,uuid) to service_role;