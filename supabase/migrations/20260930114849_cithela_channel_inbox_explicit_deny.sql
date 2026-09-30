create policy cithela_channel_inbox_authenticated_deny
  on public.cithela_channel_inbox
  for all to authenticated
  using (false)
  with check (false);
