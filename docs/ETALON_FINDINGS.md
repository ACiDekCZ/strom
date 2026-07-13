# Etalon Findings

Layout defects surfaced by the synthetic etalon fixtures (see `docs/ETALON.md`)
when run through the full-pipeline invariant harness
(`src/layout/__tests__/allPersonsFull.test.ts`, both `standard` and `expanded`
modes, every person as focus).

All findings below have since been **RESOLVED** (2026-07-11) — either fixed in
the layout engine or proven topologically inherent; each entry carries its
resolution note. The single exception, scenario K, reproduces the pre-existing
in-law-column knot and is documented at the bottom as a known limitation.
Each finding cites the fixture, a representative focus + mode, the violation
type taken verbatim from `test/failures-full-<fixture>.txt`, and a rendered
SVG in `docs/etalon-findings/`.

Regenerate the SVGs with `npx tsx scripts/render-etalon-findings.ts`.

---

## Finding 1 — Deep binary ancestor tree: crossings & overlaps between grandparent couples

- **Fixture:** `etalon-ancestors-binary5` (also reproduced by the `NB` block of `etalon-stress-all`)
- **Representative run:** focus `eB_F`, mode `standard`
- **Failing runs:** 28 of 126 (every ancestor with 3+ generations of forebears above them, both modes)
- **Violation types:** `Crossing`, `Overlap`, `Validation: Card overlap`, `Geometry: [crossing]`, `Geometry: [collinear]`, `Geometry: [t-touch]`
- **SVG:** `docs/etalon-findings/B-ancestors-binary5.svg`

When a person carries a full binary ancestor tree (each parent with two parents,
recursively), the Phase-B ancestor placement lets adjacent grandparent /
great-grandparent couples collide: their bus connectors run along the same Y and
merge, one couple's child-drop crosses a neighbouring couple's connector, and at
the deepest visible band cards overlap outright. Example from the report:

```
Crossing: connector-union_eB_FMF_eB_FMM crosses drop-union_eB_MFF_eB_MFM-eB_MF at (1552, 453)
Geometry: [collinear] connector-union_eB_FMFF_eB_FMFM and connector-union_eB_MFFF_eB_MFFM merge at Y=316
```

This is the highest-volume finding and the main reason the etalon replaces
`real-large.json` as the ancestor-density stress reference.

**RESOLVED (2026-07-11).** Phase B generalized: independent compact ancestor
trees are now built above EVERY gen -1 anchor couple (focus parents first,
then the spouse's parents and all other parent couples), with shared ancestors
(pedigree collapse) claimed by the first tree, followed by a deterministic
two-sided cluster sweep around the focus cluster (anchor order preserved,
left clusters pushed only left, right ones only right). The full binary
ancestor tree now renders as a clean symmetric fan.

---

## Finding 2 — Second-degree cousin marriage: lineage collision

- **Fixture:** `etalon-cousin-marriage` (`d2_` block; also `NH` in `etalon-stress-all`)
- **Representative run:** focus `eH_d2_cc1`, mode `standard`
- **Failing runs:** 4 (`eH_d2_cc1`, `eH_d2_cc2`, both modes)
- **Violation types:** `Overlap`, `Crossing`, `Validation: Card overlap`, `Geometry: [collinear] / [t-touch] / [crossing]`
- **SVG:** `docs/etalon-findings/H-cousin-2nd-degree.svg`

The **first-degree** cousin marriage (pedigree collapse) lays out cleanly. The
**second-degree** variant does not: the two second-cousin lineages share
great-grandparents four generations up, and when the couple is reunited at the
bottom their independently-placed parent columns overlap —
`eH_d2_b1` and `eH_d2_b2_sp` land on the same rect, and the `a1` couple's stem
crosses the `a2` couple's connector.

**RESOLVED (2026-07-11).** Three fixes: `recenterSiblingFamilyParents` skips
children hosted in a block claimed by another parent; `shiftAncestorComponent`
stops its upward walk before a shared ancestor whose subtree contains the block
being pushed away from; `placeAncestorChain` anchors a parent block whose
children are all claimed elsewhere over its specific person.

---

## Finding 3 — Double in-law (two brothers × two sisters): child drop crosses the other couple's bus

- **Fixture:** `etalon-double-inlaw` (also `NI` in `etalon-stress-all`)
- **Representative run:** focus `eI_bro1`, mode `standard`
- **Failing runs:** 16 (all 8 persons in the two intermarried families, both modes)
- **Violation types:** `Crossing`, `Geometry: [crossing]`
- **SVG:** `docs/etalon-findings/I-double-inlaw.svg`

Two brothers from family A marry two sisters from family B. The two separate
parent couples sit side by side; a brother's child-drop from family A passes
straight through family B's sibling bus:

```
Crossing: drop-union_eI_a_fa_eI_a_mo-eI_bro1 crosses bus-union_eI_c_fa_eI_c_mo at (407, 163)
```

---

## Finding 4 — In-law loop (sibling marries partner's sibling): same bus crossing

- **Fixture:** `etalon-inlaw-loop`
- **Representative run:** focus `eJ_focus`, mode `standard`
- **Failing runs:** 12 (all 6 involved persons, both modes)
- **Violation types:** `Crossing`, `Geometry: [crossing]`
- **SVG:** `docs/etalon-findings/J-inlaw-loop.svg`

Focus's sibling marries the focus partner's sibling, closing a loop between two
parent couples. Same geometric failure class as Finding 3 — the focus's own
child-drop crosses the partner-family's sibling bus:

```
Crossing: drop-union_eJ_f_fa_eJ_f_mo-eJ_focus crosses bus-union_eJ_p_fa_eJ_p_mo at (402, 163)
```

Findings 3 and 4 together show the defect is not specific to the sibling
relationship: any time two side-by-side parent couples are cross-linked by
marriage below them, the descendant drop is routed across the neighbour's bus.

**RESOLVED as topologically inherent (2026-07-11).** Enumeration proof: with
atomic couples on one generation row, the two unions' drop targets can only
INTERLEAVE (1,3)/(2,4) or NEST (2,3)/(1,4) — never separate. With single-bus
perpendicular T-routing, every lane assignment then forces either one union's
stem, or one of its drops, through the other union's horizontal run (verified
for all member orders, couple orders, parent placements and lane orders). One
clean perpendicular crossing is exactly how genealogists draw double in-law on
paper. The geometry audit now classifies crossings between CROSS-MARRIED unions
(a child of one partnered with a child of the other, both unions with 2+ drops)
as `inherent-crossing`; the harness logs them (`INHERENT` in the report) without
failing. Avoidable crossings (single-drop unions, e.g. pedigree collapse) keep
failing hard. The only rendering that removes the crossing entirely would be
duplicating the in-law parent cards (MyHeritage-style) — a possible future
feature, not a layout defect.

---

## Finding 5 — Merged transitive chain (expanded mode): collinear stem merge

- **Fixture:** `etalon-merged-chain`
- **Representative run:** focus `eF_p2`, mode `expanded`
- **Failing runs:** 1 (`eF_p2`, expanded only)
- **Violation types:** `Geometry: [collinear]`, `Geometry: [t-touch]`
- **SVG:** `docs/etalon-findings/F-merged-chain.svg`

In the transitive partner chain P1–P2–P3–P4–P5, viewing `eF_p2` as focus in
expanded (partner-chain) mode places two adjacent chain unions' stems on the
same X so they visually merge, and a connector endpoint lands on the neighbour
stem:

```
Geometry: [collinear] stem-union_eF_p2_eF_p3 and stem-union_eF_p3_eF_p4 merge at X=399 over Y=[115,155]
```

Only `eF_p2` trips it, which isolates the case to a chain member that is
simultaneously the shared spouse of one union and an extra partner of the next.

**RESOLVED (2026-07-11).** `findChainExtraPartner`: for a transitive chain link
whose BOTH partners are outside the primary couple, the stem now belongs to the
person FARTHER out in the chain order (the closer one already carries the stem
of the previous link).

---

## Finding 6 — Stress bridges: marriage stem through an unrelated card

- **Fixture:** `etalon-stress-all`
- **Representative run:** focus `eNI_k1b`, mode `standard`
- **Also:** `eNC_gk10_1`, `eNE_v2_gk1` (both modes)
- **Violation types:** `Geometry: [line-through-card]` (plus the inherited `NB`/`NH`/`NI` findings above)
- **SVG:** `docs/etalon-findings/N-stress-bridge.svg`

The stress graph joins its sub-scenarios with a handful of "bridge" marriages
between single childless leaves of different components. Where two bridged
components are placed close together, a bridge union's stem is routed through a
card that belongs to neither family:

```
Geometry: [line-through-card] stem-union_eNE_v2_k1_eNE_v2_k1_sp passes through card of eNI_sis2
Geometry: [line-through-card] stem-union_eNI_bro2_eNI_sis2 passes through card of eNE_v2_k1_sp
```

Aside from these bridge artifacts, `etalon-stress-all` reproduces exactly the
same finding classes as the standalone scenarios (`NB` → Finding 1, `NH` →
Finding 2, `NI` → Finding 3), confirming the defects survive at ~250-person
scale.

**RESOLVED (2026-07-11)** — with one exception. The bridge stems-through-cards
disappeared with the claimed-children anchoring fix plus a "tethered candidate"
guard in `relocateSplitSiblingSubtrees` (a block whose union has a child hosted
outside its own subtree must not be relocated — the parent-child bond outranks
sibling contiguity). The one remaining case, focus `eNC_gk10_1`: the bridge
spouse's parents anchor above the spouse INSIDE the 12-child `NC` sibling bus
span — the drop to them crosses that bus at every lane order. This is the same
knot class as scenario K and is tolerated in `KNOWN_LINE_KNOTS`; a real fix
needs couple re-orientation planning (place the married-in spouse on the outer
side of the focus couple so the in-law column lands outside the sibling span)
or duplicated in-law cards.

---

## Known limitation (not a new finding) — Scenario K reproduces the in-law-column knot

- **Fixture:** `etalon-inlaw-column`
- **Runs:** `eK_focus` (standard + expanded)
- **Violation types:** `Crossing`, `Geometry: [crossing]`

With `eK_focus` as focus, the husband's paternal-grandparent stem must cross the
focus's paternal-grandparent bus, because the married-in ancestor column stands
inside that sibling-group bus span:

```
Crossing: stem-union_eK_h_pgf_eK_h_pgm crosses bus-union_eK_pgf_eK_pgm at (692, 155)
```

This is the same cyclic-lane knot already tolerated for `real-large` (see the
`KNOWN_LINE_KNOTS` comment in `allPersonsFull.test.ts`). Per the assignment,
scenario K exists to hold this knot in isolated, minimal form; its two runs are
added to `KNOWN_LINE_KNOTS`. If the knot is ever solved, these runs will start
passing and can be removed from that set.
