# Layout Pipeline: Current Implementation

This document describes the actual behavior of the layout pipeline as currently implemented.

**Last updated:** 2026-01

---

## 1. Pipeline Overview

The layout pipeline consists of 8 sequential steps:

```
1. selectSubgraph     — select persons and partnerships into subgraph
2. buildLayoutModel   — construct UnionNode/PersonNode/Edge model
3. assignGenerations  — assign generations (0 = focus person)
4. measureSubtrees    — build FamilyBlock tree, measure widths, branch structure
5. placeX             — initial X position placement (envelope-based)
6. applyConstraints   — iterative conflict resolution (2 phases: A/B)
7. routeEdges         — bus routing for connection lines
8. emitLayoutResult   — final positions, normalization, diagnostics
```

---

## 2. Step Details

### Step 1: selectSubgraph

**Input:** StromData, focusPersonId, ancestorDepth, descendantDepth, flags
**Output:** GraphSelection (sets of PersonId and PartnershipId)

Selects a subset of persons from the database based on:
- `ancestorDepth` generations upward
- `descendantDepth` generations downward
- `includeSpouseAncestors` — ancestors of focus person's spouse
- `includeParentSiblings` — siblings of parents (aunts/uncles)
- `includeParentSiblingDescendants` — cousins

---

### Step 2: buildLayoutModel

**Input:** StromData + GraphSelection
**Output:** LayoutModel (persons, unions, edges, personToUnion, childToParentUnion)

Creates a graph of UnionNode (atomic unit = couple + children) and PersonNode.

Each UnionNode has:
- `partnerA` (always left, typically male)
- `partnerB` (right, female, may be null)
- `childIds` (sorted by birthDate, then ID)

Key maps:
- `personToUnion`: which union a person is a partner in
- `childToParentUnion`: parent union of a given person

---

### Step 3: assignGenerations

**Input:** LayoutModel + focusPersonId
**Output:** GenerationalModel (personGen, unionGen, genBands, minGen, maxGen)

Focus person = gen 0. Parents = gen -1. Children = gen +1.
Unions receive generation based on partners (both assigned same generation).

---

### Step 4: measureSubtrees (FamilyBlock Construction)

**Input:** GenerationalModel + LayoutConfig
**Output:** BranchModel (extends FamilyBlockModel extends MeasuredModel)

This step BUILDS the FamilyBlock tree:

1. **Focus block** (gen=0, side='BOTH') — root node
2. **Descendant blocks** — recursively via childIds of each union
3. **Focus parents block** (gen=-1, side='BOTH') — the anchor couple for H/W separation
4. **Ancestor blocks** — H-side ancestors (father's line), W-side ancestors (mother's line)

**Side Assignment (H/W Separation):**

The `side` attribute determines whether a block belongs to:
- `'BOTH'`: Focus block, its descendants, and focus parents
- `'HUSBAND'`: Focus person's father's ancestors and father's siblings (paternal line)
- `'WIFE'`: Focus person's mother's ancestors and mother's siblings (maternal line)

When building ancestors from focus parents (gen -1):
- Father (partnerA) ancestors and siblings → `side='HUSBAND'`
- Mother (partnerB) ancestors and siblings → `side='WIFE'`

This ensures aunts/uncles from father's side stay on the left (HUSBAND) and aunts/uncles from mother's side stay on the right (WIFE).

**Width measurement (bottom-up):**
- `coupleWidth` = 2*cardWidth + partnerGap (or cardWidth for singles)
- `childrenWidth` = sum(child.width) + (n-1)*gap
- `width` = max(coupleWidth, childrenWidth)

---

### Step 5: placeX (Envelope-Based Tree Geometry)

**Input:** BranchModel + LayoutConfig
**Output:** PlacedModel (personX, unionX maps)

Two phases:

**Phase A (Descendants, top-down):**
1. Focus block placed at x=0
2. Children distributed left-right using `envelopeWidth`
3. Children shifted so parent is centered above them
4. Recurse into grandchildren

**Phase B (Ancestors, bottom-up, anchor-based):**
1. Find direct-line child (already-placed descendant on direct line)
2. Siblings distributed around anchor child based on `siblingDirection`
3. Ancestor block centered above all children
4. Recurse upward through both partners

---

### Step 6: applyConstraints (Main Conflict Resolver)

**Input:** PlacedModel + LayoutConfig + focusPersonId
**Output:** ConstrainedModel

This is the most complex step. It operates directly on FamilyBlock objects (mutates them).

#### Phase A: Focus Parents + Descendants (gen >= -1)

```
// Initial overlap + centering loop
loop (max 10):
    resolveOverlapsDescOnly()
    recenterDescendantParents()
    break if converged

// BCO: Branch Cluster Order enforcement
loop (max 10):
    enforceBranchClusterSeparation()
    recenterDescendantParents()
    resolveOverlapsDescOnly()
    break if converged

// CSP: Cousin Separation Priority
loop (max 3):
    enforceCousinSeparation()
    resolveOverlapsDescOnly()
    recenterDescendantParents()
    break if !shifted

// BCC: Branch Cluster Compaction
compactBranchClusters()
recenterDescendantParents()
resolveOverlapsDescOnly()
compactBranchClusters()  // Pass 2

// SBAC: Recenter sibling family parents
recenterSiblingFamilyParents()

// SFNI: Sibling Family Non-Interleaving (both parents)
enforceSiblingFamilyNonInterleaving()

// SFC: Sibling Family Cluster compaction
compactSiblingFamilyClusters()

// Capture locked positions (gen >= -1)
lockedX = captureLockedPositions()
```

#### Phase B: Extended Ancestors (gen <= -2) — Independent Compact Trees

Phase B uses a completely redesigned algorithm that builds **two independent compact ancestor trees**:

```
// 1. Find anchor couple (focus parents at gen -1)
anchorUnionId = childToParentUnion.get(focusPersonId)
anchorUnion = unions.get(anchorUnionId)
{ husbandId, wifeId } = determineHusbandWife(anchorUnion)

// 2. Build independent ancestor trees
hTree = buildAncestorTree(husbandId, gen=-2)  // H-tree: husband's ancestors
wTree = buildAncestorTree(wifeId, gen=-2)     // W-tree: wife's ancestors

// 3. Compute tree widths (bottom-up)
hWidth = computeAncestorTreeWidth(hTree)
wWidth = computeAncestorTreeWidth(wTree)

// 4. Place trees with boundary constraints
// Special case: if only ONE tree exists, center it above its parent
if (hTree && !wTree) {
    // Only H-tree: center above husband
    placeAncestorTree(hTree, husbandCenterX)
} else if (wTree && !hTree) {
    // Only W-tree: center above wife
    placeAncestorTree(wTree, wifeCenterX)
} else {
    // Both trees: place so they don't cross midpoint
    placeAncestorTree(hTree, husbandRightEdge - hWidth/2)
    placeAncestorTree(wTree, wifeLeftEdge + wWidth/2)
}

// 5. Enforce H/W boundaries for ALL couples recursively
enforceAllBoundariesUntilConvergence(hTree)
enforceAllBoundariesUntilConvergence(wTree)

// 6. Resolve any overlap between H-tree and W-tree
resolveAncestorTreeOverlap(hTree, wTree)

// 7. Transfer positions to FamilyBlocks
transferAncestorTreeToBlocks(hTree)
transferAncestorTreeToBlocks(wTree)

// 8. Handle collateral ancestors
resolveOverlapsOutward()

// 9. Verify locked positions unchanged
assertLockedDescendantsUnchanged(lockedX)
```

---

## 3. Phase B Algorithm Detail: Independent Compact Ancestor Trees

### Core Data Structure

```typescript
interface AncestorNode {
    husbandId: PersonId;           // Left partner (H)
    wifeId: PersonId | null;       // Right partner (W), or null if single
    unionId: UnionId;              // For updating FamilyBlocks
    generation: number;            // Negative (e.g., -2 for grandparents)
    hSubtree: AncestorNode | null; // Ancestors of husband
    wSubtree: AncestorNode | null; // Ancestors of wife
    width: number;                 // Computed bottom-up
    coupleWidth: number;           // Width of just the couple cards
    xCenter: number;               // Computed top-down
}
```

### Tree Building (Recursive)

```typescript
function buildAncestorTree(personId, generation): AncestorNode | null {
    parentUnionId = childToParentUnion.get(personId)
    if (!parentUnionId) return null  // No parents

    parentUnion = unions.get(parentUnionId)
    { husbandId, wifeId } = determineHusbandWife(parentUnion)

    return {
        husbandId,
        wifeId,
        unionId: parentUnionId,
        generation,
        hSubtree: buildAncestorTree(husbandId, generation - 1),
        wSubtree: buildAncestorTree(wifeId, generation - 1),
        width: 0,      // Computed later
        coupleWidth: 0,
        xCenter: 0
    }
}
```

### Width Computation (Bottom-Up)

```typescript
function computeAncestorTreeWidth(node): number {
    if (!node) return 0

    node.coupleWidth = node.wifeId
        ? cardWidth * 2 + partnerGap
        : cardWidth

    hWidth = computeAncestorTreeWidth(node.hSubtree)
    wWidth = computeAncestorTreeWidth(node.wSubtree)

    ancestorsWidth = hWidth + wWidth + (both > 0 ? horizontalGap : 0)
    node.width = max(coupleWidth, ancestorsWidth)

    return node.width
}
```

### Position Placement (Top-Down)

```typescript
function placeAncestorTree(node, centerX): void {
    if (!node) return

    node.xCenter = centerX

    // Compute partner positions
    husbandCenterX = centerX - partnerGap/2 - cardWidth/2
    wifeCenterX = centerX + partnerGap/2 + cardWidth/2

    // Boundaries are at card EDGES (not centers) to save space
    husbandRightEdge = husbandCenterX + cardWidth/2
    wifeLeftEdge = wifeCenterX - cardWidth/2

    // Place H-subtree: right edge at husband's right edge
    if (node.hSubtree) {
        hTreeCenterX = husbandRightEdge - hWidth/2
        placeAncestorTree(node.hSubtree, hTreeCenterX)

        // Verify boundary
        hMaxX = findTreeMaxX(node.hSubtree)
        if (hMaxX > husbandRightEdge) {
            shiftAncestorTree(node.hSubtree, -(hMaxX - husbandRightEdge))
        }
    }

    // Place W-subtree: left edge at wife's left edge
    if (node.wSubtree) {
        wTreeCenterX = wifeLeftEdge + wWidth/2
        placeAncestorTree(node.wSubtree, wTreeCenterX)

        // Verify boundary
        wMinX = findTreeMinX(node.wSubtree)
        if (wMinX < wifeLeftEdge) {
            shiftAncestorTree(node.wSubtree, wifeLeftEdge - wMinX)
        }
    }
}
```

### Recursive Boundary Enforcement

After initial placement, boundaries may be violated for nested couples. This function enforces H/W boundaries for ALL couples:

```typescript
function enforceAllCoupleBoundaries(node): boolean {
    if (!node) return false

    let changed = false

    husbandRightEdge = node.xCenter - partnerGap/2
    wifeLeftEdge = node.xCenter + partnerGap/2

    // Check H-subtree boundary
    if (node.hSubtree) {
        hMaxX = findTreeMaxX(node.hSubtree)
        if (hMaxX > husbandRightEdge) {
            shiftAncestorTree(node.hSubtree, -(hMaxX - husbandRightEdge))
            changed = true
        }
    }

    // Check W-subtree boundary
    if (node.wSubtree) {
        wMinX = findTreeMinX(node.wSubtree)
        if (wMinX < wifeLeftEdge) {
            shiftAncestorTree(node.wSubtree, wifeLeftEdge - wMinX)
            changed = true
        }
    }

    // Recurse into subtrees
    hChanged = enforceAllCoupleBoundaries(node.hSubtree)
    wChanged = enforceAllCoupleBoundaries(node.wSubtree)

    return changed || hChanged || wChanged
}

function enforceAllBoundariesUntilConvergence(tree): void {
    for (i = 0; i < 20; i++) {
        if (!enforceAllCoupleBoundaries(tree)) break
    }
}
```

---

## 4. Key Principles

### Boundary at Card Edge (Not Center)

The H/W boundary is at the card EDGE, not the card CENTER:

```
H-subtree right edge <= husband's RIGHT card edge
W-subtree left edge >= wife's LEFT card edge
```

This allows subtrees to be **aligned** with their parent cards, saving horizontal space compared to using the center as boundary.

### Independent Trees

H-tree and W-tree are built and placed **completely independently**:
- No shared nodes between trees
- Each tree is compact (minimum width)
- Trees are positioned to not cross the midpoint

### Recursive H/W Rule

The H/W separation rule applies to **EVERY couple** in the ancestor tree, not just the root:
- For Father+Mother: Father's ancestors LEFT, Mother's ancestors RIGHT
- For Grandfather+Grandmother (inside Father's tree): Grandfather's ancestors LEFT, Grandmother's ancestors RIGHT
- And so on recursively...

---

## 5. Conflict Resolution Directions

### Descendant blocks (gen >= -1):
- Overlap resolution: **left-to-right sweep, push RIGHT**
- Centering: **bottom-up** (deepest gen to gen -1)
- Blocks shift with entire subtree

### Ancestor blocks (gen < -1):
- Built as independent compact trees
- H/W boundaries enforced recursively
- Trees don't cross the midpoint between focus parents

---

## 6. Step 7: routeEdges

For each union with children:
- **Stem**: vertical line from couple center down
- **Bus**: horizontal line at `busY = (parentBottomY + childTopY) / 2`
- **Drops**: vertical lines from bus to children
- **Connector**: horizontal segment from stem to bus (if stem outside bus range)

Post-processing:
- `resolveBusCollisions`: lane-based bus routing for overlapping buses
- `resolveElbowClearance`: nudging drop positions for min distance

---

## 7. Step 8: emitLayoutResult

1. Computes Y positions: `y = padding + (gen - minGen) * rowHeight`
2. Normalizes X: shifts everything so minX = padding
3. Normalization includes: positions, connections, spouseLines, branch bounds

---

## 8. Testing

### Active Tests (14 files, 529 tests)

**Main invariant tests:**
- `allPersonsPhaseA.test.ts` — 190 tests, all 189 persons pass Phase A
- `allPersonsPhaseB.test.ts` — 190 tests, all 189 persons pass Phase B
- `lockedPositions.test.ts` — 20 tests, verifies Phase B doesn't modify gen >= -1

**Pipeline unit tests:**
- `buildModel.test.ts`, `assignGenerations.test.ts`, `measureSubtrees.test.ts`
- `routeEdges.test.ts`, `selectSubgraph.test.ts`
- `pipeline.test.ts`, `realData.test.ts` (snapshot regression)

---

## 9. Visual Representation

```
                [Great-grandparents H]  [Great-grandparents W]
                         |                      |
                    [Grandparents]         [Grandparents]
                         |                      |
                         v                      v
Gen -2:         [Father's Parents]      [Mother's Parents]
                         |                      |
                         +----------+-----------+
                                    |
Gen -1:                   [ Father + Mother ]    <- Anchor couple
                                    |
Gen 0:                        [ Focus ]          <- Focus person
                                    |
Gen 1:                     [ Focus's children ]
```

**H-tree** (ancestors of Father) stays LEFT of Father's card edge.
**W-tree** (ancestors of Mother) stays RIGHT of Mother's card edge.
Trees don't cross the midpoint between Father and Mother.
