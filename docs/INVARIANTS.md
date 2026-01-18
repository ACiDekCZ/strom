# Layout Invariants

This document describes the invariants enforced by the Strom layout algorithm.

**Last updated:** 2026-01

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

| Test File | Tests | Description |
|-----------|-------|-------------|
| `allPersonsPhaseA.test.ts` | 190 | Phase A invariants for all 189 persons |
| `allPersonsPhaseB.test.ts` | 190 | Phase B invariants for all 189 persons |
| `lockedPositions.test.ts` | 20 | Verifies Phase B doesn't modify gen >= -1 |

**Total: 14 test files, 529 tests, 0 failures**
