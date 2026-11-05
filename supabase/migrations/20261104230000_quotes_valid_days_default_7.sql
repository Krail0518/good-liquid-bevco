-- ROLLBACK: alter table public.quotes alter column valid_days set default 30;
--
-- Quotes are good for 7 days only. This changes the default for new rows and
-- leaves existing quotes untouched, since some were already sent with terms.
alter table public.quotes alter column valid_days set default 7;
