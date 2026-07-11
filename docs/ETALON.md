# Etalon — Synthetic Layout Test Set

A systematically designed set of family-tree fixtures that cover known and
conceivable constellations for the layout engine, in depth and in breadth. The
etalon replaces the reliance on real family data as the primary correctness
reference for rendering. (`test/real-large.json` is the author's family data —
anonymized, kept LOCAL ONLY and gitignored; the harness skips it when absent.)

## Generating

```bash
npm run gen:etalon      # writes test/etalon-*.json (deterministic, idempotent)
```

The generator is `scripts/generate-etalon.ts`: fully deterministic (no
`Math.random` / `Date.now`), builder-style API, byte-identical output across
runs. IDs follow `e<scenario>_<role>` (e.g. `eK_uncle`); union IDs follow
`u_<person1>_<person2>` with the male partner as `person1` (rendered left).

## Wiring

All fixtures are registered in `DEFAULT_FIXTURES` in
`src/layout/__tests__/allPersonsFull.test.ts` and run through the full pipeline
with every person as focus, in both `standard` and `expanded` modes. Defects
surfaced by the set are catalogued in `docs/ETALON_FINDINGS.md` (with SVGs in
`docs/etalon-findings/`).

## Scenarios

| ID | Fixture | Persons | Covers |
|----|---------|--------:|--------|
| A | `etalon-line-10gen` | 20 | Pure 10-generation line (direct ancestors/descendants + partners only). |
| B | `etalon-ancestors-binary5` | 63 | Full binary ancestor tree, depth 5 (31 couples) above one focus. |
| C | `etalon-wide-12` | 56 | Wide family: 12 children, each with a partner and 1–4 children. |
| D | `etalon-deep-both` | 52 | Deep up + down (5+5 generations) with a side branch at every level. |
| E | `etalon-multi-partners` | 29 | One person with 2 / 3 / 4 partners; children per union; grandchildren under middle unions. |
| F | `etalon-merged-chain` | 11 | Merged chains: transitive union chain P1–P2–P3–P4–P5, children per union. |
| G | `etalon-ancestor-chain` | 13 | Chains in the ancestor role: focus parents with extra partners + half-siblings with own families. |
| H | `etalon-cousin-marriage` | 22 | First-degree cousin marriage (pedigree collapse) + a second-degree variant. |
| I | `etalon-double-inlaw` | 12 | Two brothers marry two sisters (double in-law); interleaved children. |
| J | `etalon-inlaw-loop` | 10 | In-law loop: focus's sibling marries focus's partner's sibling. |
| K | `etalon-inlaw-column` | 24 | Minimal reproduction of the in-law-column knot (married-in ancestor column inside the grandparents' bus span). |
| L | `etalon-descendant-partner-ancestors` | 12 | A descendant's partner carries 2 full generations of ancestors. |
| M | `etalon-incomplete-data` | 12 | Placeholder/single parents at several levels; missing surnames; missing birthdates; mixed sibling ordering. |
| N | `etalon-stress-all` | 258 | Stress: representative scenarios combined into one graph, joined by bridge marriages (replaces `real-large.json`). |

Total across scenarios A–N: **394 persons** in 14 fixtures.

## Data model reminders

- `person2Id` is never null. A single/unknown parent is modelled either as a
  person with `childIds` and **no** partnership (child has one `parentId`), or
  as a placeholder person (`isPlaceholder: true`, `firstName: "?"`) joined by a
  partnership. Both forms appear in scenario M.
- Sibling order is deterministic (birthDate → id). Scenario M deliberately mixes
  dated and undated siblings to exercise the tie-break.
