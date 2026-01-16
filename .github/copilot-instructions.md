# Copilot Instructions

## LEARNINGS

### Testing: Prefer Single Inline Snapshots Over Multiple Expects

When writing tests, avoid scattering multiple `expect()` calls to verify different aspects of the same result. Instead:

1. **Use a single inline snapshot** - Map/transform the result to the shape you care about, then snapshot it
2. **Bad**: Multiple expects checking nullness, length, finding elements, checking properties
3. **Good**: `expect(result?.elements.map(e => e.kind)).toMatchInlineSnapshot(...)`

Benefits:
- Single source of truth for expected behavior
- Easier to update when behavior changes
- More readable - shows entire expected output at once
- Fails fast with complete context
