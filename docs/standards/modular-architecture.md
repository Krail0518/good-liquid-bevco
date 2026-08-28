# Modular Architecture Rules

Each major business capability should have a clear owning module.

Avoid:
- Hidden dependencies
- Circular dependencies
- Shared mutable global state
- Direct manipulation of another module's internals
- Duplicated business logic

Document every cross-module dependency that a feature introduces.
