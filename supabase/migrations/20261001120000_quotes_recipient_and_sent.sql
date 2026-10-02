-- ════════════════════════════════════════════════════════════════
-- Quotes remember who they were for, and when they were sent
-- ════════════════════════════════════════════════════════════════
-- The only list of saved quotes was the panel inside a client's Edit
-- modal, filtered by client_id. The Pipeline's "Quote Builder" button
-- opens the builder with no client and no deal, and a typed company name
-- links to a client only when it matches one exactly — so 8 of the first
-- 9 production quotes had client_id AND deal_id null and appeared nowhere.
-- The company name and email existed only inside the rendered pdf_html.
--
-- Sending a quote also never changed its status, so three quotes that
-- the email log shows went out still read "draft".
--
-- This adds the four facts the new all-quotes list (Pipeline → 🗂 Quotes)
-- needs, and backfills them:
--   client_name / client_email  from the "Prepared For" block of pdf_html
--                               (both the old and the invoice-style layout)
--   sent_at / sent_to           the most recent send in email_log, matched on
--                               the quote number in the builder's subject line
--                               (the builder overwrites both on every re-send)
-- Draft quotes found in email_log become 'sent'. Accepted/declined quotes
-- keep their status (gl_guard_accepted_quote would refuse the change anyway).
--
-- No policy, grant or function ACL changes. The new columns are covered by
-- the existing quotes policies: "quotes staff all" plus the RESTRICTIVE
-- tenant/viewer/warehouse guards. Portal customers and strangers still
-- read nothing from this table.
--
-- ROLLBACK:
--   alter table public.quotes
--     drop column if exists client_name,
--     drop column if exists client_email,
--     drop column if exists sent_at,
--     drop column if exists sent_to;
--   The backfilled draft→sent status changes are not reverted by this; to
--   undo them: update public.quotes set status = 'draft'
--   where status = 'sent' and updated_at::date = '2026-10-01';  (check first)

alter table public.quotes
  add column if not exists client_name  text,
  add column if not exists client_email text,
  add column if not exists sent_at      timestamptz,
  add column if not exists sent_to      text;

create index if not exists quotes_sent_at_idx on public.quotes (sent_at desc);

-- pdf_html is built with esc(); undo the five entities it produces.
create or replace function pg_temp.gl_unesc(s text) returns text
language sql immutable as $$
  select nullif(btrim(replace(replace(replace(replace(replace(s,
    '&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&')), '')
$$;

-- Recipient, from whichever layout the PDF was rendered in.
update public.quotes q set
  client_name = coalesce(q.client_name, pg_temp.gl_unesc(coalesce(
    (regexp_match(q.pdf_html, '<div class="client-name">([^<]*)</div>'))[1],
    (regexp_match(q.pdf_html, 'Prepared For</h4><p><strong>([^<]*)</strong>'))[1]
  ))),
  client_email = coalesce(q.client_email, pg_temp.gl_unesc(coalesce(
    (regexp_match(q.pdf_html, '<div class="client-name">[^<]*</div><div style="font-size:12px;color:#4a5568;margin-top:3px">([^<]*)</div>'))[1],
    (regexp_match(q.pdf_html, 'Prepared For</h4><p>.*?<span style="color:#666;font-size:12px">([^<]*@[^<]*)</span>'))[1]
  )))
where q.pdf_html is not null
  and (q.client_name is null or q.client_email is null);

-- Sent, from the outbound email log. The builder's subject is always
-- 'Good Liquid Production Quote — <number> — <company>'.
with sends as (
  select (regexp_match(e.subject, 'Production Quote — (GLQ-[0-9]+-[0-9]+)'))[1] as quote_number,
         max(e.created_at) as last_sent,
         (array_agg(e.to_email order by e.created_at desc))[1] as to_email
  from public.email_log e
  where e.subject like 'Good Liquid Production Quote — %'
  group by 1
)
update public.quotes q set
  sent_at = s.last_sent,
  sent_to = s.to_email,
  status  = case when q.status = 'draft' then 'sent' else q.status end
from sends s
where s.quote_number = q.quote_number
  and q.sent_at is null;

notify pgrst, 'reload schema';
