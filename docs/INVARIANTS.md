# Layout Invariants

This document describes the invariants enforced by the Strom layout algorithm.

**Last updated:** 2026-10-17 — invariants are machine-enforced by the
all-persons harness + strict geometry audit (see "Testing" in `CLAUDE.md`).
The line rules (no line crossings; bus routing standard) now hold strictly: a line
that cannot be drawn without a crossing, a collinear run or a T-touch is left
out by step 7 and its cards link to each other (see "Line Invariants"). The
former relaxations — `inherent-crossing` (a crossing between cross-married
unions forced by the topology) and the `KNOWN_LINE_KNOTS` class (in-law column
inside a sibling bus span) — are now omitted edges instead of drawn knots;
the audit no longer has an `inherent-crossing` class and `KNOWN_LINE_KNOTS`
is empty. Partner-chain invariants added 2026-07-13.

---

## Overview

The layout algorithm maintains strict invariants to ensure a clean, readable family tree visualization. These invariants are enforced in two phases:

- **Phase A**: Focus parents + descendants (gen >= -1)
- **Phase B**: Extended ancestors only (gen <= -2)

---

## Phase A Invariants (gen >= -1)

### 1. No Card Overlap

**Rule:** No two person cards may visually overlap.

```
For any two persons A, B:
  overlap = min(rightA, rightB) - max(leftA, leftB)
  overlap <= 0 (with tolerance)
```

Partners in a union are allowed closer spacing (`partnerGap`) than unrelated persons (`horizontalGap`).

---

### 2. Parent-Children Centering

**Rule:** Parents are centered above their children.

```
For each union with children (gen >= -1 only):
  |parentCenterX - childrenCenterX| <= tolerance
```

This ensures visual balance in the descendant tree.

---

### 3. Branch Cluster Order (BCO)

**Rule:** Sibling family branches maintain consistent left-to-right order.

For unions with 2+ children who have their own families:
- Branches are ordered by sibling index (birth order)
- `branch[i].maxX + minGap <= branch[i+1].minX`

---

### 4. Cousin Separation Priority (CSP)

**Rule:** Cousin branches (children of aunts/uncles) must not intrude into the focus sibling span.

The focus person's siblings form a protected horizontal interval. Cousin branches are pushed outward to respect this boundary.

---

### 5. Sibling Branch Anchor Consistency (SBAC)

**Rule:** Each aunt/uncle (gen -1 sibling of parent) is positioned within their branch span.

The couple (aunt/uncle + spouse) must lie horizontally within the extent of their descendants.

---

### 6. Sibling Family Non-Interleaving (SFNI)

**Rule:** Sibling family clusters at gen -1 must not interleave.

For each pair of sibling families (clusters containing gen -1 parent + all descendants):
```
familyA.maxX + gap <= familyB.minX
```

This applies to siblings of **both** parents (father AND mother).

---

## Phase B Invariants (gen <= -2)

### 7. Locked Descendants

**Rule:** Phase B must NEVER modify positions of gen >= -1 (focus parents + descendants).

Positions are captured after Phase A and verified unchanged after Phase B.

---

### 8. No Ancestor Overlap

**Rule:** No two ancestor cards may overlap.

Same as invariant #1, but applied specifically to gen <= -2 blocks.

---

### 9. H/W Boundary Separation (Per-Couple)

**Rule:** For EVERY couple in the ancestor tree, subtrees respect partner boundaries.

```
For each couple (husband H, wife W):
  - H-subtree (husband's ancestors): right edge <= H's right card edge
  - W-subtree (wife's ancestors): left edge >= W's left card edge
```

This is enforced **recursively** for all couples in the tree, not just the root.

**Key insight:** Using card EDGES (not centers) as boundaries allows subtrees to be aligned with their parent cards, saving horizontal space.

---

### 10. Tree Non-Crossing

**Rule:** The H-tree (ancestors of focus father) and W-tree (ancestors of focus mother) must not cross each other.

```
H-tree.maxX + gap <= W-tree.minX
```

---

### 11. Compact Ancestor Trees

**Rule:** Ancestor trees should be as compact as possible while respecting all other invariants.

- Trees are built with minimum necessary width
- No unnecessary gaps between ancestor blocks
- Subtrees are placed adjacent to their parent cards

---

## Partner Chain Invariants (expanded display mode)

### 12. Chain Block Atomicity

**Rule:** A chain block (one person's marriages laid out inline) moves only as
a whole; internal card order (`personOrder`) is stable and never reshuffled by
collision resolution.

### 13. Children Stay in Their Slot

**Rule:** Each chain union's children are centered on that union's SLOT center
(`personSlotCenters`), and sibling groups of different chain unions occupy
disjoint X intervals.

### 14. Card Gravitation Bounds

**Rule:** Extra-partner cards gravitate toward the primary couple but never
reorder, never overlap, and — when the partner has children — never leave
their own slot (the stem must stay above the children span). Childless extra
partners (including deep-ancestor appendage spouses) stack directly adjacent
to the previous card.

### 15. Appendage Selection Purity

**Rule:** Appendage expansion of a deep ancestor adds only the partner card
and the partnership — never the extra union's children. Ancestors with two or
more child-bearing unions in the selection are not chain-expanded at all
(their gen -1 children carry sibling-family branches anchored elsewhere).

---

## Line Invariants (step 7)

### 16. No Line Crossings, Merges or T-Touches

**Rule:** No segment of one union's line (stem, connector, bus, drops) or
partner line crosses, runs along (collinear overlap) or ends on (T-touch) a
segment of another union's. A union's own segments meet freely.

**Enforcement:** `line-geometry.ts` finds every violation (grid-indexed); step
7's `omitUnroutableDrops` removes child drops one at a time until none is
left (greedy, deterministic, at most 10 per layout, never a line of the
focus's own line when another helps; cards never move). Every line drawn is
clean; each line left out is an `OmittedEdge` in `LayoutResult.omittedEdges`
and is shown as a link on its cards (a "parents ↗" / "child ↗" branch tab on
screen, a "parents: …" label in the image export). The built-in validation
runs the same check on every layout.

### 17. Bus Routing Standard

**Rule:** Each drawn parent-child line runs stem → (connector) → bus → drops,
the bus between the parents' band bottom and the children's band top (lanes
offset it inside that gap), drops strictly vertical. A union whose drops were
all left out draws no line; a union with some drops left draws its bus over
the remaining drops only.

---

## Invariant Hierarchy

For H-side ancestor blocks (from strictest to loosest):

| Invariant | Boundary | Description |
|-----------|----------|-------------|
| H/W Boundary | `husbandRightEdge` | Subtree must stay left of husband's card edge |
| Tree Non-Crossing | `midpoint - gap` | H-tree must not overlap W-tree |
| No Overlap | `neighbor.xLeft - gap` | Must not overlap adjacent blocks |

---

## Generation Scope

| Invariant | gen < -1 | gen = -1 | gen = 0 | gen > 0 |
|-----------|----------|----------|---------|---------|
| No Overlap | YES | YES | YES | YES |
| Centering | NO | YES | YES | YES |
| BCO | YES | YES | YES | YES |
| CSP | NO | NO | YES | NO |
| SBAC | NO | NO | YES | YES |
| SFNI | NO | YES | NO | NO |
| H/W Boundary | YES | YES | NO | NO |
| Locked | NO | YES | YES | YES |

---

## Enforcement Order

### Phase A (gen >= -1)

```
1. Overlap resolution + centering loop
2. Branch Cluster Order enforcement
3. Cousin Separation Priority
4. Branch Cluster Compaction
5. Sibling Branch Anchor Consistency (recenter gen -1)
6. Sibling Family Non-Interleaving
7. Sibling Family Cluster compaction
8. Capture locked positions snapshot
```

### Phase B (gen <= -2)

```
1. Build independent H-tree and W-tree
2. Compute tree widths (bottom-up)
3. Place trees with H/W boundary constraints
4. Enforce all couple boundaries recursively (until convergence)
5. Resolve any H-tree / W-tree overlap
6. Transfer positions to FamilyBlocks
7. Handle collateral ancestors (resolveOverlapsOutward)
8. Verify locked positions unchanged
```

---

## Test Coverage

The primary enforcement is `allPersonsFull.test.ts`: the full pipeline runs
with every person of every fixture as focus, in standard and expanded modes,
against the built-in validation plus the strict geometry audit
(`helpers/geometryAudit.ts`). Per-step unit tests cover the individual
pipeline stages. `omittedEdges.test.ts` holds the line omission: which line
goes in scenario O, in the real-data knot and in the in-law cases, and that
the grid check finds exactly the violations of every pair.

**Total: 29 test files, 2556 tests, 0 failures (plus 17 Playwright e2e).**
