# Extending

Adding a unit kind or a structure kind touches only a few registries.

## Adding a unit kind

The simulation tick, network layer, and HUD don't change.

1. **`packages/shared/src/kinds.ts`**: register stats in `UNIT_KIND_META`.
2. **`packages/server/src/behaviors.ts`**: register a behavior in `kindBehaviors`.
3. **`packages/client/src/render/units.ts`**: add a `case` in `createUnitView`.
4. Bind a key in `game.ts` (`net.spawnUnit("yourkind")`).

`pnpm test && pnpm typecheck && pnpm lint` should stay green.

## Adding a structure kind

Mirrors the unit pattern. Check `STRUCTURE_KIND_META` (base, supply,
turret, wall, medbay) for the available fields: `colliderShape`,
`maxPerPlayer`, `healHps`/`healRange`, `abilityRange`/`abilityDamage`/
`abilityCooldownSeconds` are all optional toggles, so most structures
are a few lines of config plus a render `case` in
`packages/client/src/render/structures.ts`. Wire a placement key in
`game.ts` (the existing pattern is one `input.onKeyTap` per kind that
flips the `placing` mode).
