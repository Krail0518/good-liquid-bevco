-- One-off data fix (not schema): the Drink iO2 pipeline deal was backdated to
-- first contact (2026-02-13). The kanban loads the 500 newest deals ordered by
-- created_at desc, so an old date sorts the card to the bottom of Negotiation —
-- or truncates it out of the load entirely once there are 500+ deals. Bump
-- created_at / stage_entered_at to now so it loads and appears at the top. The
-- real first-contact date and full timeline remain in the deal's notes.
-- ROLLBACK: n/a (data fix).
update public.deals
   set created_at = now(), stage_entered_at = now(), updated_at = now()
 where id = '9edc135e-c277-435f-9ba5-f068ac574fcf';
