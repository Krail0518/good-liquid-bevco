# Architecture

High-level architecture map for the Good Liquid Bev Co CRM.

## Principles
- Major capabilities should be modular.
- Modules communicate through explicit interfaces/services/APIs.
- Supabase is the authoritative persistent datastore.
- Shared functionality belongs in deliberate shared services, not copied logic.
- Architecture decisions should be recorded under `docs/architecture/decisions/`.

## Next step
Audit the existing CRM and document the real module boundaries in:
- `docs/architecture/system-map.md`
- `docs/architecture/module-map.md`
- `docs/architecture/data-flow.md`
- `docs/architecture/integrations.md`
