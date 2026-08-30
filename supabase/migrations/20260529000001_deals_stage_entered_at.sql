-- Add stage_entered_at to deals so we can show how long a deal has been
-- in its current pipeline stage on the kanban card.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz;
