create or replace function public.cithela_mp_test_preflight(p_tenant_id uuid,p_owner_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.role() <> 'service_role' then return jsonb_build_object('ok',false,'code','forbidden'); end if;
 if not exists(select 1 from public.cithela_tenant_memberships m
 join cithela_private.cithela_commercial_entitlements e on e.tenant_id=m.tenant_id
 join auth.users u on u.id=m.user_id
 where m.tenant_id=p_tenant_id and m.user_id=p_owner_user_id
 and m.role='owner' and e.owner_user_id=p_owner_user_id
 and u.email_confirmed_at is not null
 and e.status in ('trialing','payment_pending','past_due'))
 then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
 return jsonb_build_object('ok',true,'code','eligible');
end $$;
revoke all on function public.cithela_mp_test_preflight(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cithela_mp_test_preflight(uuid,uuid) to service_role;