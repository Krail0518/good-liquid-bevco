-- ============================================================
-- Email templates — reusable subject + body snippets
-- ============================================================
-- A small library of email templates the user can pick from when
-- composing follow-ups, invoice sends, or other outbound messages.
--
-- Variables supported in body:
--   {{client_name}} {{invoice_number}} {{amount}} {{date}}
--   {{due_date}} {{days_late}} {{my_name}} {{my_phone}}
--
-- Seeds three starter templates:
--   - Invoice send
--   - Follow-up gentle
--   - Follow-up firm (30+ days late)
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null default 'general' check (category in ('invoice','followup','quote','general','onboarding')),
  subject     text not null,
  body        text not null,
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_email_templates_active on public.email_templates(active, category);

alter table public.email_templates enable row level security;
drop policy if exists "email_templates authed" on public.email_templates;
create policy "email_templates authed" on public.email_templates
  for all to authenticated using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    drop trigger if exists trg_email_templates_updated on public.email_templates;
    create trigger trg_email_templates_updated before update on public.email_templates
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Seed starter templates only if the table is empty
insert into public.email_templates (name, category, subject, body)
select * from (values
  ('Invoice send',
    'invoice',
    'Invoice {{invoice_number}} from Good Liquid Bev Co — {{amount}}',
    'Hi {{client_name}},

Please find Invoice {{invoice_number}} below for {{amount}}.

Payment is due {{due_date}}. Wire instructions are included at the bottom of the invoice.

Let me know if you have any questions.

Thanks,
{{my_name}}
Good Liquid Bev Co
{{my_phone}}'),
  ('Follow-up — gentle',
    'followup',
    'Friendly reminder: Invoice {{invoice_number}} — {{client_name}}',
    'Hi {{client_name}},

Just a quick reminder that Invoice {{invoice_number}} for {{amount}} is now due.

If you''ve already sent payment, please disregard this note. Otherwise, our wire instructions are on the invoice and we''re happy to answer any questions.

Thanks,
{{my_name}}
Good Liquid Bev Co
{{my_phone}}'),
  ('Follow-up — firm',
    'followup',
    'Past due: Invoice {{invoice_number}} ({{days_late}} days)',
    'Hi {{client_name}},

Invoice {{invoice_number}} for {{amount}} is now {{days_late}} days past due. We''d appreciate you bringing this current as soon as possible.

If there''s a payment issue we should know about, please reach out so we can work it out.

Thanks,
{{my_name}}
Good Liquid Bev Co
{{my_phone}}')
) as t(name, category, subject, body)
where not exists (select 1 from public.email_templates limit 1);

notify pgrst, 'reload schema';
