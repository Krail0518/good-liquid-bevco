-- Rotate gl_notify_secret to a value generated INSIDE the database.
--
-- Apply ONLY after: (a) 20260730001000 (triggers read the Vault value live),
-- (b) the notify-deal deploy that validates Vault-first, and (c) the frontend
-- that no longer embeds the secret. Once applied, the old value that shipped
-- in the public page HTML ('gl-notify-2026-abc123') stops working everywhere:
-- notify-deal ignores its env fallback whenever a Vault value exists, and the
-- triggers pick the new value up automatically on their next firing.
do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'gl_notify_secret';
  if sid is null then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'gl_notify_secret',
      'notify-deal shared secret. Generated in-db; never exported.'
    );
  else
    perform vault.update_secret(
      sid,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    );
  end if;
end $$;
