# Good Liquid Bev Co CRM — AI Project Scaffold

This scaffold adds an AI-ready engineering layer around the existing Good Liquid Bev Co CRM.

## Important
Do **not** replace or move working production code just to match this folder tree.
First audit the existing repository, then merge only the documentation, skills, prompts,
review workflows, and other structure that fits safely.

## AI Roles
- Claude Code: primary developer
- ChatGPT/Codex: independent reviewer
- GitHub: source of truth for code/review workflow
- Supabase: authoritative persistent data store

See:
- `CLAUDE.md`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `docs/standards/engineering-standard.md`

## Modules

### Warehouse Storage (CONRI Services)
Sidebar: Operations → Warehouse Storage (admin and sales). Tracks every pallet stored
at CONRI (empty can overflow and finished goods), generates the transfer packing
list, pallet labels and scheduling email, allocates outbound orders FEFO, and
reconciles CONRI's inventory report. Workflow, tables and the rules the database
enforces: `src/modules/warehouse/README.md`.
