-- Make double-booking impossible at the database, not just unlikely in the app.
--
-- ROLLBACK:
--   alter table public.bookings drop constraint if exists bookings_no_overlap;
--   -- btree_gist is left installed; dropping an extension other objects may
--   -- later depend on is not worth the tidiness.
--
-- WHY
-- ---
-- supabase/functions/booking-confirm checks for a conflicting booking and then
-- inserts, as two separate statements with nothing between them:
--
--     const { data: conflicts } = await supa.from('bookings').select('id')...
--     if (conflicts && conflicts.length > 0) return errorResponse(...)
--     ...
--     await supa.from('bookings').insert([{ ... }])
--
-- Two requests for the same slot can both run the SELECT before either runs the
-- INSERT, and both are then told the slot is free. This is the classic
-- check-then-act race, and the endpoint is PUBLIC — anyone can drive it.
--
-- The function does throttle (3 per email per day, 20 site-wide per hour), so
-- this is not an easy mass-booking hole. But two ordinary visitors clicking the
-- same slot within the same second is not adversarial, it is Tuesday.
--
-- An exclusion constraint is the right shape rather than a unique key: slots
-- are RANGES, and the failure is overlap, not exact equality. A 2pm-2.30pm and
-- a 2.15pm-2.45pm booking do not collide on any single column.
--
-- Pre-flight against production before writing this: 7 bookings, 0 overlapping
-- pairs, so the constraint applies to existing data cleanly.
--
-- The predicate deliberately covers only the statuses that OCCUPY a slot.
-- 'declined' and 'cancelled' rows must be free to overlap anything — refusing
-- to record a declined request because the slot was later taken would be
-- absurd, and 'declined' is a status already in live use.

create extension if not exists btree_gist;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    page_id with =,
    tstzrange(start_at, end_at) with &&
  )
  where (status in ('pending', 'confirmed'));

comment on constraint bookings_no_overlap on public.bookings is
  'Two pending/confirmed bookings on the same page cannot overlap in time. '
  'booking-confirm checks for conflicts and inserts as separate statements, so '
  'concurrent public requests could both pass the check; this makes the second '
  'insert fail instead. declined/cancelled rows are exempt.';
