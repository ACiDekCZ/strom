# Layout Pipeline: Current Implementation

This document describes the actual behavior of the layout pipeline as currently implemented.

**Last updated:** 2026-01 — **PARTIALLY OUTDATED as of 2026-07-11.**
Phase B was rewritten (independent compact ancestor trees above EVERY gen -1
anchor couple, shared-ancestor claiming, V-fan side ownership above the focus
couple, deterministic two-sided cluster sweep) and bus lane allocation is now
a topological assignment over a constraint graph. For the current behavior see
the "Layout Algorithm Reference" and "Testing" sections in `CLAUDE.md`, the
`SPEC.md` changelog entries from 2026-07-11, and `docs/ETALON_FINDINGS.md`.

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

In expanded display mode the selection is then widened by
`expandSelectionForDisplay` (same module): for every person in
`DisplayPolicy.expandedPersonIds` ALL their partnerships, partners and those
unions' children are added; for `DisplayPolicy.appendagePersonIds` (deep
direct-line ancestors) only the partner + partnership are added — the extra
union's children are deliberately NOT pulled in (see Partner Chains below).

Children shown in place (`PipelineInput.expandChildrenOf`, the card's
"children" tab): after `expandSelectionForDisplay`, `expandChildrenInSelection`
adds, for every listed person already in the selection, each of their unions
with children — the partner, the partnership and the children — and lifts the
person's depth limit. A child the step brings comes with their partners, as
the plain depth draws a relative: the partner of each of the child's unions
joins with the partnership, unless the selection holds that partner already
(drawn elsewhere: that union stays undrawn) or the partner is an empty "?"
stand-in (`isDiagramStandIn`, drawn only with a union's children). Never the
children's children: the child's own "children" tab leads on. A child the
selection held already keeps what it had.
`withChildrenShown` (pipeline orchestrator) then puts a listed person with more
than one partnership in the selection into `expandedPersonIds` (out of the
appendage set), so each union is a chain slot and its children hang under
their own couple, in the standard display too. With every partner drawn
(`autoExpand`, the expanded display) a person the step brought with partners
of several unions joins `expandedPersonIds` as well and stands in a chain with
all of them; the standard display draws one of them, as it draws any relative
(the others stay behind the card's partners tab). Phase B places the shown siblings
of an ancestor (gen <= -2) beside that ancestor, in the run reserved for them
in the compact tree (`attachSiblingRuns`/`placeSiblingRuns`, below), with the
parents centred over all their children; before, they kept their step-5 place
far from the parents and the outward overlap passes could end with cards over
each other. The rest of the pipeline is
unchanged; hiding the children again gives the original input and layout.

Siblings on the inner side. A node that stands for the parents of a husband
keeps the wife's siblings on its inner side (towards the other half of the
pedigree), the parents of a wife the husband's; left there they stand between
the halves of the pedigree, far from the couple (A). When the partner in the
direct-line couple has no parents in view, Phase B puts the run beyond the
partner instead (C): the row reads person, partner, siblings (mirrored for a
husband's siblings), the couple stays over its child and the parents' line
passes over the partner to the person and the siblings. Every such run is
reported in `LayoutResult.innerSiblingRuns` (`InnerSiblingRun`: `personId`,
`partnerId`, `besidePartner` — false when the partner's parents keep the run
on the inner side). Chain couples and lone parents keep A.

A grandparent's other union in the gen -1 row. When a gen -2 chain's extra
partner stands on the far side of the parents' couple from the direct-line
person's siblings (the mother's father's second wife left of him, the father's
mother's second husband right of her) and the direct-line partner has parents
in view, that union's children cannot hang under the extra partner: the couple
below is locked after Phase A and the partner's family stands beyond it. Step 5
(`placeAncestorChainBlockChildren`) puts them on the person's own side, beyond
the full siblings, nearest union first. With a partner without parents they
stand beyond the partner (`beyondPartnerSide`, the side Phase B gives the
siblings, C below), so the rows Phase A locks keep them there too.

The other partners face the siblings. While a person of an ancestor chain at
gen <= -2 has children shown, step 4 (`faceLineSiblings`, in
`buildAncestorBlocks`) mirrors the chain's person order when the other
partners would stand on the far side of the couple from the line child's
siblings: `[extras..., A, B]` becomes `[A, B, extras nearest first...]` (and
the mirror for a husband's siblings). The siblings' side follows Phase B's
sibling runs: a wife's to the right, a husband's to the left; beyond the
partner on the inner side when the partner has no parents in view; a line
child without a partner on the tree's outer side. In the grandparents' row
(the line child is a focus parent, placed by Phase A) it applies only with a
partner who has parents in view. Each other marriage's children then hang
under their own parent beside the full siblings and every line is drawn;
before, those lines crossed the line to the line child and were left out
(`omittedEdges`). Only with an other marriage that has children in view and
with the children shown; without `expandChildrenOf` the order is unchanged.

Children of an ancestor's sibling or other marriage in the parents' row.
Step 5 leaves the children of a grandparent's sibling (and, while a
grandparent on the line with other marriages has children shown, the
children of those marriages: the parents' half-siblings) where their parent's
block stood when the ancestors were placed, often several card widths beyond
the focus family. Before Phase A locks the row, `pullAncestorSiblingChildren`
moves each such group of children, with everything drawn below them, toward
the focus parents as one piece, as far as the nearest card in any of its rows
allows (horizontalGap), never across the focus parents; nearer groups first.

Parents shown in place beyond the depth (`PipelineInput.extraDepthFor`, the
"▸ parents" of an ancestor at the edge of the depth). While the ancestor walk
of `selectSubgraph` (focus and spouse lines) stops at `ancestorDepth`, it
records in `GraphSelection.ancestorLimitPersons` every person it reached at
the limit who has parents in the data. `extendAncestorDepth` (right after
`selectSubgraph`, before the display expansion) walks one generation more
from each listed person still at the limit whose parents are not in the
selection: the parents, their partnership (and, through the usual partnership
collection, unions between selected persons), and records the parents at the
limit in turn, so a parent's own "▸ parents" goes one step further (nested
clicks). Listed persons not at the limit are skipped. Nothing else changes:
the other branches keep their depth, Phase B builds the deeper branch like
any unbalanced pedigree (incomplete data does the same), and without
`extraDepthFor` the selection and the layout are exactly the previous ones.
The step brings the parents alone, never their ancestors nor their other
children: at depth 1 the selection already holds a focus parent's siblings
(aunts and uncles with their families, `includeParentSiblings`), which the
layout would draw once the grandparents are there. `extendAncestorDepth`
therefore cuts the line from each parent it added down to a child that is
not a listed person and drops from the selection everyone reached only
through such a cut (the child, partners, descendants and whoever hangs on
them), except the persons the same input without `extraDepthFor` draws (a
pedigree collapse, a cousin married into the view): those stay and stop the
walk. That second, plain layout runs only when such a child is in the
selection (in practice at depth 1). The siblings come with another input:
`expandChildrenOf` the parents (the person's "▸ siblings", or a grandparent's
"▸ children" after "▸ parents"), each with their partners and without their
descendants, as children shown in place always come (the cousins come with an
aunt's or uncle's own "▸ children").
`LayoutResult.ancestorDepthEdge` lists the drawn persons of the limit whose
parents are neither selected nor drawn and who have a parent that is not a
"?" stand-in: the cards whose parents are out of view only because of the
depth. A parent drawn another way (pedigree collapse), parents folded away
for children shown (`foldAncestorsOf`) and in-laws (never on the ancestor
walk) are not on it. The "▸ siblings" of such a person combines both inputs
in one layout: `extraDepthFor: [P]` and `expandChildrenOf` the parents.
`LayoutResult.extraDepthDrawn` lists the listed persons the walk actually
extended (absent when none): a person whose parents a raised depth or a new
view draws anyway is not on it, and the renderer drops that "▾ parents"
expansion after the render, the parents staying drawn.
`parentsShownFull.test.ts` checks, for every fixture, every focus, depths 1
to 7 and the four modes, every edge person: the strict harness checks, the
parents drawn in the row above, nobody drawn before lost, only the parents
(and in the expanded mode their other partners) added, never a sibling of
the person nor anyone descended from one, a line to the person; with the
parents' children shown the promised siblings drawn beside each other (a
sibling's partner chain may stand between them, as at the plain depth);
nested steps; and that removing the step gives the original positions.

Other partners shown in place (`PipelineInput.showPartnersOf`, the "▸ ∞"
pill of a card). `partnerIdsShownInPlace(data, P)` lists the partners of P's
unions without children; the pill promises those not drawn.
`showPartnersInSelection` (run by `withPartnersShown` after the display
expansion and the children shown) adds, for each listed person in the
selection, each such partner with the partnership; a partner shown this way
can list its own other partners in turn (nested clicks), so the walk repeats
until nothing new comes. Listed persons not in the selection are skipped. A
person who then stands in more than one selected union becomes a chain
person: it joins `DisplayPolicy.appendagePersonIds` (the set merged into the
chain persons in step 2; the mode becomes 'expanded'). It is added after
every chain person already there because merged chains are kept by their
first person (`mergeOverlappingChains`) and their unions take its
generation: a partner shown on a deep ancestor's appendage spouse has no
generation of its own, the ancestor has. The partner card then stands as
another marriage in the person's partner chain, on the side away from the
partner drawn before (`buildChainBlockPersonOrder`). A person the layout drew
with one union (everyone in the standard mode, a stepchild in the expanded
mode) shows, as a chain, the other unions the selection holds too (the
partners, and their children when the selection has them), as the children
tab does. Without `showPartnersOf` the selection and the layout are exactly
the previous ones; removing a person gives back the positions before.
`partnersShownFull.test.ts` checks, for every fixture, every focus, depths
1, 2, 3, 5 and the four modes, every drawn person with a promised partner:
the strict harness checks, the partners drawn in the person's row on the
side away from the partners drawn before, nobody drawn before lost, nothing
added beyond the partners (and the person's family as above); with the
person's children shown as well; nested steps and closing.
(`test/edge-childless-partners.json` has a childless partner at an
ancestor, the focus line, a descendant, a cousin and persons married in.)

Folded ancestors (`PipelineInput.foldAncestorsOf`, applied only together with
`expandChildrenOf`): after `withChildrenShown`, `foldAncestorsInSelection`
cuts the child→parent links of the listed persons and removes from the
selection every person no longer reachable from the focus through parent,
child and partner links. Ancestors the view reaches another way (pedigree
collapse, a parent also drawn through another child) stay, drawn once; a fold
then removes nothing.

`planShownChildrenFolding(input)` (src/layout/pipeline/shown-children-folding.ts)
decides the folds for the children shown and returns
`{ result, foldedAncestorsOf, foldedFor }`: `foldedAncestorsOf` maps each
person of `expandChildrenOf` to the persons whose ancestors fold for it,
`foldedFor` each folded person to that shown person (hiding the children
brings the ancestors back). Rules:
- B: for every inner run with `besidePartner` false whose siblings a parent of
  the person shows, the partner's ancestors fold, so C applies; a fold that
  does not free the place (the parents stay in view another way) is dropped.
- B2 (span): when the line of the clicked person's union comes down more than
  two card widths from the nearest of its children, the ancestors of the
  couple member whose ancestors take most room between the stem and the
  children fold first, then the other's; it stops as soon as the gap is at
  most two card widths. If no member's ancestors stand in the gap or even both
  folds do not help, nothing folds for the span.
Without `expandChildrenOf` the plan is exactly `runLayoutPipeline(input)`;
the input's own `foldAncestorsOf` is ignored (the plan decides the folds).
`pipelineInputFromRequest(request)` builds the `PipelineInput` the engine
uses from a `LayoutRequest` (which carries `foldAncestorsOf` too), so the
renderer can call the planner with the engine's input.
The children tab is offered for the children out of view that showing would
draw (`hiddenRelativesTabs`/`hiddenChildIds`, src/marriage-order.ts): the same
`childIdsShownInPlace` (children of the person's unions) the selection takes
them from, so a child linked by a parent link alone (its only parent a "?"
stand-in, never drawn below it) is not promised. The
"▾ children" bubble names only the children the click brought into view
(`newlyShownChildIds`). `childrenShownFull.test.ts` checks, on every fixture
card the tab is offered on (a fixture's own "?" stand-ins as focus too), that showing draws every promised child. As a
safety net the renderer gives the view back when a click draws none of them
and offers no tab or menu row for that person in that view.

---

### Step 2: buildLayoutModel

**Input:** StromData + GraphSelection
**Output:** LayoutModel (persons, unions, edges, personToUnion, childToParentUnion)

Creates a graph of UnionNode (atomic unit = couple + children) and PersonNode.

Each UnionNode has:
- `partnerA` (always left, typically male)
- `partnerB` (right, female, may be null)

Couple order (`orderPartners`): a man left, a woman right; a person of unknown
sex (`gender: 'unknown'`, GEDCOM `SEX U`) on the side the other partner leaves
free; two of unknown sex in data order (the partnership's `person1Id` left —
GEDCOM `HUSB`); two men or two women alphabetical by id. Later steps take
`partnerA` as the husband side, so they need no rule of their own.
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

The main BFS descends only through each person's PRIMARY union
(`personToUnion`), so branches hanging under a secondary marriage receive
generations from the edge-propagation fallback loop. A chain-union pass
(shared person's generation → all chain unions and partners) runs both before
and INSIDE that loop — a childless extra spouse of a deep chain person would
otherwise miss a generation and fall to the gen-0 fallback row.

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
   (`descendantRowWidth`). Exception: children in the ancestor rows (the
   children of an ancestor's sibling or of an ancestor's other marriage shown
   in place) are spaced by their measured subtree `width`. Their
   `envelopeWidth` also reserves the ancestor tree above them, which here is
   their parents' own block, so spacing by it put siblings a whole ancestor
   tree apart (the "children terribly far" bug). In the parents' row (gen -1)
   a block keeps the envelope when a partner of it has parents in view (the
   focus's parents, an aunt married to a man whose parents are drawn): that
   tree stands above it, Phase A locks the row and Phase B could not move
   the block out of its way.
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

// 3a. Reserve room for the ancestors' siblings drawn in the selection (the
//     children of a node's parents shown in place, gen <= -2): each node gets
//     a run of its person's sibling blocks — the husband's on the left, the
//     wife's on the right (a lone parent's on the tree's outward side); blocks
//     of the tree union innermost, other chain unions further out by stem
//     distance. extLeft/extRight widen the node (attachSiblingRuns).
//     A run on the inner side (the wife's siblings in a node of a husband's
//     parents, the husband's in a node of a wife's parents) goes beyond the
//     partner when the partner has no parents in view (husbandBeyondWife /
//     wifeBeyondHusband; C), and is recorded in model.innerSiblingRuns
attachSiblingRuns(hTree, 'LEFT', 'H'); attachSiblingRuns(wTree, 'RIGHT', 'W')

// 3. Compute tree widths (bottom-up; the runs count into a node's width)
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

// 7. Transfer positions to FamilyBlocks, then the sibling runs
transferAncestorTreeToBlocks(hTree)
transferAncestorTreeToBlocks(wTree)
placeSiblingRuns(hTree); placeSiblingRuns(wTree)
//    A run is packed by its rows' outline (packSiblingRun), not by block
//    widths: each sibling's block and everything below it moves as one piece,
//    from the couple outward, only as far as its cards need to clear the
//    cards already placed in the same rows (horizontalGap). A childless
//    sibling stands right beside the sibling before it, not a children row
//    away. A sibling in the grandparents' row whose children stand in the
//    parents' row (locked by Phase A) is pinned: it asks for the place over
//    its children; the free siblings fill the room before it in their order
//    while they fit, the rest go beyond. The parents centre over the siblings
//    in their own row.
//    A chain block is moved so that its block centre stands at the node's
//    X; when the children of another of its unions are in view and that
//    partner's slot grows wider than the cards, the block centre falls beyond
//    the last card, and the middle of the card row stands at the node's X
//    instead (chainCardRowCenter): the couple stays over its line child.
//    The packing and the overlap passes measure a chain by its drawn cards
//    (drawnCardExtent): the slot of a hidden "?" stand-in partner is no card,
//    and a childless sibling stands right beside the stand-in's partner.

// 8. Handle collateral ancestors (passes until nothing moves, at most 20;
//    ancestors' children shown in place can need more than a few)
resolveOverlapsOutward()

// 8a. Partners of an ancestor's other marriage back beside the partner
//     (gatherAncestorChainPartners, chain blocks at gen <= -2): the overlap
//     passes can leave an extra partner several card widths away. Each one
//     moves toward its partner, as far as "beside", into free row space only.
//     A partner with drawn children stops at the nearest child's center (its
//     line stays over its children). When the children already stand beyond
//     the partner's card (the chain's other families, children shown with
//     their partners, push them outward), the line may move inward over the
//     family's cards in the children's row — the chain's children and their
//     partners standing side by side up to the nearest child — and the empty
//     room between the partners goes. It never moves farther from its own
//     parents, and the block's anchors follow.
gatherAncestorChainPartners()

// 8b. The children of a "?" family under the known parent
//     (tuckStandInChildren, chain blocks at gen <= -3): they stand centred
//     under the couple the hidden stand-in's slot makes, half a card out from
//     the parent whose card the line comes from. Their subtrees (all in rows
//     gen <= -2) move toward that parent's card, at most until they stand
//     under it, and only as far as the nearest other card in each of their
//     rows leaves room (horizontalGap).
tuckStandInChildren()

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
- **Stem**: vertical line from couple center down. A couple's stem starts on
  its partner line (`spouseLineOffset`: `spouseLineY` from the card top, else
  the card's middle). A stem from a card starts at the bottom of that
  person's own card and names the person in `Connection.stemPersonId`: a
  single parent, a marriage chain's extra partner (the same person whose
  centre is the union's X, `findChainExtraPartner`), a parent beside a hidden
  "?" stand-in.
- **Bus**: horizontal line at `busY = (parentBandBottom + childBandTop) / 2`,
  where `parentBandBottom = top(parentGen) + height(parentGen)` (see
  Generation bands)
- **Drops**: vertical lines from bus to children, ending at the child band's
  top (every child card's top)
- **Connector**: horizontal segment from stem to bus (if stem outside bus range)

Post-processing:
- `resolveBusCollisions`: lane-based bus routing for overlapping buses
- `resolveElbowClearance`: nudging drop positions for min distance
- `omitUnroutableDrops`: lines that still cannot be drawn cleanly are left out

### Lines that cannot be routed (omitted edges)

After the lanes and the elbow clearance, step 7 checks every line of the
layout (`pipeline/line-geometry.ts`): a crossing, a collinear run (two lines
merged on one X or Y) or a T-touch (an endpoint on a foreign line) between
the lines of two different unions. A union's own segments and its partner
line meet freely. The check uses a uniform grid (128 px cells) over the
segments' boxes, so it costs about O(S · k), not O(S²); it is the same
function the built-in validation and the test geometry audit use.

When violations remain, `omitUnroutableDrops` removes one child's drop at a
time, greedily and deterministically:

1. Candidates: the drop on a violating segment, or every drop of a union
   whose stem, connector or bus is involved.
2. Score: the violations the drop's removal clears (the union's line counted
   again without that drop, its bus recomputed from the remaining drops).
3. Order: a drop off the focus's own line (the focus, their ancestors and
   descendants) always before one on it; then the higher score; then the drop
   farther from the focus (relationship distance); then a single-child union;
   then union id and child id.
4. When no single drop off the focus's line clears a violation (a stem on a
   foreign line stays while one drop is left), the whole line of an involved
   family is a candidate too: the one with the fewest drops on the focus's
   line, then the fewest drops, then the most violations, then union id. It
   is taken over a single drop on the focus's line only when none of its own
   drops is on that line.
5. There is no cap: every pick clears more violations than it adds, so the
   loop ends within as many rounds as there were violations, clean whenever
   every violation involves a parent-child line.
6. After the removals the lanes are allocated again from their zero offsets
   (`resolveBusCollisions` + `resolveElbowClearance`; reverted when that adds
   violations).

`resolveBusCollisions` leaves two lines on one lane when their lane order is
contradictory (each must lie above the other, a 2-cycle) or a lane bump
cannot separate them; their merged run is a collinear violation, so one of
them loses a drop here. No two drawn lines share a lane with overlapping
runs. Under Vitest a line violation or a shared lane left after this step
throws (`sharedLaneOverlaps`); in the browser the built-in validation reports
any violation (the same line check).

The last drop of a union takes its whole line with it. Card positions never
change. Lines of the view layer (links "linked in the view only") are
candidates under the same rules. Each removal is listed in
`RoutedModel.omittedEdges` / `LayoutResult.omittedEdges`
(`OmittedEdge { unionId, childId, parentIds, stemPersonId?, view? }`;
`parentIds` are the union's shown partners, a hidden "?" stand-in left out;
`view` is set by `flagViewLayer` like the lines' flags).

The renderer turns an omitted edge into links on the cards, in the
`.branch-tab` pill of the top-right edge slot: "◂ parents ↗" on the child's
card, "▸ child ↗" (or "children ↗" for several) on each parent's card, the
bubble naming the other end. They show in every view, the descendants chart
too; a click or Enter brings the other end into view (`ZoomPan.centerOnPerson`
for one card, `fitPersons` for several) and highlights it, without changing
the focus. The marriage-order pill's placement counts them with the other
tabs (`measureTabRows`). The image export (poster, family book) draws a
static label under the card instead: "parents: …", "child: …".

Debug: `globalThis.__OMIT_DEBUG = true` logs each round's candidates.

---

## 7. Step 8: emitLayoutResult

1. Computes Y positions: every card's `y` is its generation band's top
   (see Generation bands); `LayoutResult.bands` lists the bands
2. Normalizes X: shifts everything so minX = padding
3. Normalization includes: positions, connections, spouseLines, branch bounds
4. Passes `omittedEdges` through (ids only, nothing to normalize); the
   built-in validation checks every line (`line-geometry.ts`) and that each
   omitted edge names a child and at least one parent with a card

### Generation bands

One shared function (`computeGenerationBands`, `pipeline/bands.ts`) gives the
band of every generation to steps 7 and 8 and the debug geometry:

```
top(minGen) = padding
top(g + 1)  = top(g) + height(g) + verticalGap
height(g)   = tallest card drawn in generation g
```

A card's height is `LayoutConfig.personHeights` for that person, else
`cardHeight` (`personCardHeight`). Cards stand top-aligned in their band.
Without `personHeights` every band is `cardHeight` tall and
`top(g) = padding + (g - minGen) * (cardHeight + verticalGap)`, exactly as
before. Hidden "?" stand-ins and unplaced persons do not count towards a
band's height. X placement and the single card width do not depend on the
heights, so invariants 7 (horizontal bands) and 8 (bus between the bands)
hold with band bottoms at the tallest card. Validation (card overlap) and
the strict geometry audit (lines through cards) use each person's height.

The custom card's "by content" height (U02 V3) passes its measured heights
as `personHeights` together with the header partner line (`spouseLineY`).
Default custom card height changed by the author on 7 Oct 2026 to
by-content (V3).

---

## 8. Partner Chains (Expanded Display Mode)

A **PartnerChain** inlines all marriages of one person into a single horizontal
row: the shared person sits at their gender-side end (male = LEFT), all
partners on the opposite side. A shared person of unknown sex sits where the
primary couple puts them (the couple order above): their extra partners go
on their outer side, whatever those partners' sex. Chains merge transitively when both partners of
a couple have multiple marriages: `mergeOverlappingChains` joins all chains
that share a union, through any number of people (a marriage cascade b–c,
c–d, d–e is one chain). A partnership folded for both partners (each primary
elsewhere, e.g. a widow remarried twice married to a man with another wife)
gets ONE chain union: the second partner's chain reuses it (and its children
leave whichever primary union held them), so the two chains share it and
merge. Two copies would leave the second chain without a shared union, never
built as a block, its other families' children selected but undrawn. The chain lives in one **chain block**
(`FamilyBlock.chainInfo`) that is atomic for collision resolution.

The primary union (the couple adjacent at the chain's centre) is chosen by the
union priority of step 2 (focus parents, `isPrimary`, the lineage, children,
status, newest date). The extra partners on one side of a person stand in the
order of the marriages, the earliest next to the person: `expandPartnerChains`
lists each person's unions chronologically (wedding date, then data order, an
undated union last — `compareMarriages` in `src/marriage-order.ts`) and
`buildChainBlockPersonOrder` walks them in that order. The renderer, the
image export and the book mark a partner of a person with two or more unions
in view with a marriage-order pill ("1. ∞ 1866", numbered by the same order
over all of the person's unions in the data) at the top-edge corner pointing
to that person (`unionOrderBadges`). Each union gets at most one pill and each
card at most one: when both persons of a union have several unions in view,
the number counts the focus's marriages if the focus is one of them, else
those of the one with more unions in view, else the union's first person's;
the hover bubble names that person ("Jan Novák's 2nd marriage, 1885").
`placeUnionOrderPill` lays the pill out with the hidden-relatives tabs by one
rule for every card size: the middle of the top edge stays free (the drop line
to the parents arrives there), the tabs keep their corners, the pill sits on
the edge beside them in its own half of the card, and where it does not fit
(or a line is in the way) it moves above the tabs, wholly above the top edge
and within the card's width.

### Who gets expanded

`findAutoExpandPersonIds` (pipeline orchestrator) collects multi-partnership
persons on the direct line: gen -1 family cluster (parents, their partners and
siblings + spouses), gen 0 cluster (focus, partners, siblings + spouses) and
all descendants + their partners. These get FULL expansion (extra unions'
children are shown).

`findAppendageAncestorIds` extends this to direct-line ancestors beyond
gen -1 with APPENDAGE semantics: the extra spouse card is inlined next to the
ancestor, but the extra union's children are NOT added to the selection.
Two gates keep this safe: the walk is seeded only from the focus person and
the focus's partners (never from in-laws — their chains would need buses
spanning children anchored above unrelated families), and an ancestor
qualifies only when at most ONE of their unions has children in the selection.

### Slot model and card gravitation

Measure (step 4) gives every chain person a **slot** (`personSlotWidths`)
sized for that union's children subtree. Placement (step 5,
`setBlockPosition`) then distinguishes two coordinate sets:

- `personSlotCenters` — slot midpoints; each union's CHILDREN are centered
  here, and secondary-union buses sit here.
- `personPositions` — actual CARD centers. The primary couple's two cards sit
  adjacent at the primary-area center. Extra partners GRAVITATE toward the
  primary couple: a childless partner stacks directly adjacent to the previous
  card (MyHeritage style); a partner with children (`personsWithChildren`)
  stops at the inner edge of its own slot so its stem stays above its
  children span. Route-edges bridges card → bus with a connector.

### Chain child placement

- Descendant chains (`placeChainChildrenPerUnion`): per-union groups, primary
  children under the couple midpoint, secondary groups at slot centers,
  disjoint-interval sweep outward from the primary group.
- Ancestor chains (`placeAncestorChainBlockChildren`): the block is positioned
  so the direct-line union's slot sits over the already-placed direct-line
  child; remaining unions' child groups sweep outward from that pivot
  (nearest anchor first), shifting only on actual frontier collision.

### Phase B interplay

Chain blocks at gen <= -2 participate in Phase B trees as regular couples,
with two adaptations: `computeAncestorTreeWidth` uses the chain block's real
`coupleWidth` (3+ cards) so neighbor trees reserve enough space, and
`transferAncestorTreeToBlocks` moves chain blocks with a rigid `shiftBlock`
(field-by-field assignment would desynchronize `personPositions`).

### Known limitations (documented follow-ups)

- An in-law column (a spouse's parents and theirs) beside a sibling family
  standing on that spouse's side — a parent's other family (expanded mode)
  or, for the focus, the maternal aunts' families while the focus's spouse
  has parents with their own parents — cannot be drawn without a crossing.
  Step 7 leaves one of its lines out and the cards link to each other (a
  couple re-orientation rule could keep some of them drawn); found with view
  links in `viewLinksFull.test.ts`, which checks these scenarios as strictly
  as all others, and the same with the links made real.
- Sibling couples can stand between a chain person's far wives when the
  siblings and the wives share the parents' bus row (Tudor/Henry VIII
  constellation) — spouse lines then run across foreign cards' row space.
- Long single-child dynasty lines drift diagonally ("staircase") because each
  couple centers over its one child.
- Children shown in place, remaining gaps (measured on a real 1,300-state
  sweep and the two-clicks test in `childrenShownFull.test.ts`):
  - Phase B packs a sibling run by its rows' outline, but neighbouring
    clusters still stand apart where a rule fixes them. Gaps of more than one
    card width left beside the cards a click concerns, by class (the sweep's
    states, normal cards): (P) the parents centre over a wide row of their
    children (invariant 6) and the neighbour belongs to another anchor's
    cluster, which cluster separation only pushes outward (invariant 10);
    (Q) a whole cluster moves rigidly (invariant 4) because a wider row
    elsewhere pushes it, leaving a hole in a narrower row; (S) the line's
    lower row is offset from its ancestor already without children shown
    (staircase), the new children stand under their parents and the line is
    locked. Measured maximum about 3.4 card widths.
  - A lone parent's other marriage (the other partner not in view) gets a
    line from the parent's card. When its children stand beyond the line
    child's partner (C), that line would run along the couple's bus, and
    when its child is married to someone drawn by another line (the child
    stands with that family), it would cross; step 7 leaves it out and the
    cards link (`omittedEdges`).
  - The children of a lone parent's other marriage stand beside the main
    family's run (invariant 5) with the line from the parent's card, which
    stays in the couple centred over the main children: about 3 to 4 card
    widths when the main family is wide.
  - Children shown in the parents' row (gen -1) stand compactly under their
    parents now, and can be placed where the focus's parents stand.
    `resolveParentCoupleOverlaps` then moves the other block's whole
    ancestor component clear of the focus parents in one step; one card at a
    time would move another card into the couple. The component walk stops
    at an ancestor whose union is a parent union of either focus parent:
    the parents' block hangs under one parent's parents only, and the walk
    would otherwise drag the other parent's siblings into the couple.
    The pairwise passes can fail to settle: a component whose cards stand on
    both sides of another block (the children of an ancestor's other
    marriage shown around an aunt) is pushed back and forth, and it can
    reach the focus parents through a common ancestor. When an overlap is
    left after the passes, the row goes back to its positions before them
    and is swept outward from the focus parents' block
    (`sweepParentRowOutward`): the ancestor components merged where they
    share blocks, the focus parents' siblings first, then by distance, each
    pushed only away from the couple past the cards already placed.
  - Children shown in the parents' row (gen -1, Phase A, locked) still yield
    to the focus family. In the expanded display a parent's chain slot is
    sized for the primary children, so a focus parent with another marriage
    can stand 3 to 6 card widths from that partner, as without the click.
    The two-clicks test checks distances and contiguity for children drawn
    in rows gen <= -2, and for the children of a grandparent's other
    marriage in the parents' row: their line is drawn and comes down within
    two card widths of them, except where the line child's family is locked
    under the couple and several other marriages stand in the partners'
    order beside it (up to 4 card widths, `KNOWN_HALF_SIBLING_STEMS`), or
    a half-sibling's husband stands between her and the line (a couple's
    order follows gender, invariant 3). For a line ancestor in the
    grandparents' row the distance is counted without the cards of the line
    child's own family standing between the line and the half-siblings: the
    line child's full siblings stay together (invariant 5) with their
    families as rigid clusters (invariant 4), so the half-siblings can only
    stand beyond them; the test measures the line's distance to that family
    plus the family's distance to the half-siblings.
  - Half-siblings of a direct-line ancestor (an ancestor's other marriage)
    stand beside that ancestor as its sibling run (children of one person
    side by side), so their distance from the other parent follows how far
    the ancestor tree places the direct line from that parent (up to about
    6 card widths in a staircase). The click does not set it.
  - A grandparent's other partners on the siblings' side (`faceLineSiblings`)
    can stand several card widths from the grandparent: each stands over her
    own children beside the half-siblings, while the couple centres over its
    own wide row of children (invariant 6). Before, these lines were left
    out.
  - Forced cases: a couple centered over many children with the direct-line
    child at the end of the run (invariants 5 and 6), and a person standing
    over their own child next to a couple centered over a wide run. A bus
    from the person would overlap the couple's bus.

---

## 8a. View layer: links "linked in the view only"

`PipelineInput.viewLinks` (src/layout/pipeline/view-layer.ts) lays out
links a research hypothesis would make as if they were real, without
touching the tree's data. Before folding the "?" families,
`buildViewLayer` makes a derived copy where each link stands the way a real
link stands in the data:

- `child` with two shown parents: the anchor joins their couple's family
  (or a new family of the two);
- `child` with one shown parent beside a real one: the shown parent takes the
  "?" stand-in's place (alone in the "?" family: in place; with siblings:
  the anchor moves into a family of the two — as `fillPlaceholder`);
- `child` with one shown parent and no real one: a family of that parent and
  a new "?" stand-in (hidden like every pure stand-in, T11);
- `partners`: a partnership of the anchor and the shown partner.

One family is shown in one place (a later link showing it again is skipped).
After step 8 `flagViewLayer` marks the result: `LayoutResult.viewLayer`
(links, `ghostIds` = the laid out people of the shown families, `ghostOf`,
the derived data), `ChildDrop.view` / `Connection.view` / `SpouseLine.view`
= `'virtual'` for lines that exist only because of a link (a drop to an
anchor from a family of its shown parents; a whole family line when every
drop is virtual; a partner line between two people who are no couple in the
data) and `'ghost'` for the lines inside a shown family. `includeView: false`
ignores the links (the outputs' switch). The renderer passes the links only in
the Family and Descendants views; `viewLinksFull.test.ts` runs the full
invariant audit with links and checks the layout equals that of the same
links made real.

Drawing (renderer + src/view-link-lines.ts, geometry unchanged): ghost
cards (`.view-ghost`) and `'ghost'` lines take the ghost tokens
(`--ghost-*` in index.html). A `'ghost'` family line with a `'virtual'` drop
splits its bus (`splitBus`): the stretch over the family's own drops and its
stem junction stays ghost, the stretch out to the anchor is virtual. Virtual
segments are collected per link, chained into polylines (`chainSegments`) and
drawn hollow after all other lines: every 5px stroke first, then every 2px
stroke in `--bg`. Each link gets one label button (`.view-link-label`):
a `child` link's on the longest horizontal virtual stretch at least as long
as the label, else mid of its longest vertical run (`labelSpot`); a
`partners` link's under the couple. The anchor's research-edge stub and any
"+ family" pill or curve to a shown family are not drawn while it is shown
(the stub only where the view draws the shown parents: the Descendants of
the anchor keep it).

Interaction (src/ui/view-links-ui.ts, the edge bubble in
src/ui/research-edge-ui.ts): the actions only write the tree's view link
records (src/view-links.ts) and draw again (`TreeRenderer.refreshViewLinks`:
a focus depth at its maximum follows the shown generations, nothing is
written into the tree, no undo step). A `named` edge (`_END named`) draws an
open stub with two hollow circles and "named · N options"; pointing shows its
bubble, a click pins it with the hypothesis's versions and "Show as linked".
Each version (there and in "What research knows") says what it would bring:
"+ n people" for a drawable `_LINK`; "The tree records this already" for a
version with `3 _INTREE` (child / partners / siblings the tree has, open
hypotheses only) and no drawable link — nothing to draw, no switch; "Text
only, cannot be shown." for `same` / `siblings`; else "link not recorded
yet". A version with both a drawable link and `_INTREE` offers the link. A
shown record whose version now carries its link as `_INTREE` instead of
`_LINK` resolves `real`.
"+ family" and the curve's pill open a small menu (show it linked / go to the
family). In the family's own view the top couple carries "Show linked to the
tree" (`renderViewLinkIslands`), which shows the link and goes back to the
tree. After showing, the view fits the anchor and the family
(`ZoomPan.fitPersons`).

Keeping track (src/ui/view-links-list-ui.ts): while the view draws shown
links, an indicator "Linked in the view only · n" stands at the top of the
view (`#view-links-pill`, 8px under whatever top chrome is above it — the
evidence pill, the descendants badge, the phone's person row; a phone held
sideways: only the icon and the number at the top right); × switches the
tree's main switch off, the notice switches it on. The list
(`#view-links-panel`: a 420px panel on the right, a full-height sheet on a
phone) holds every record with its state — drawable (its switch), real now,
or no longer valid with the reason — ordered by the anchor's place in the
view, then real, then invalid (`orderViewLinkRows`); the main switch; ×,
"Remove invalid" and "Remove all" remove at once with Undo in the panel. It
opens from the indicator, the Research menu and Settings → Tree view (under
"Research edge"). After a load of the research, records it made invalid
(`newlyInvalidViewLinks`) are told once per page, after the load's own
notice. Another window of the tree follows a change of the records (a
`storage` event, `viewLinksTreeOfKey`); a live bridge's `/status` features
(`TreeRenderer.setViewLinksBridge`) must name `hypothesis.links` once it
answered in the page, else the data alone decide.

Outputs (`TreeRenderer.outputLayout`): the poster (SVG, PNG, the tiled
print), the book's tree page and "the people of the view" (export of the
view, a tree from the view, sharing a branch, the presentation's stops, the
counts) take the current view laid out again without the links, once per
render. A card of details (Detailed, Register, Custom) is measured again for
the people that layout holds (`customCardsOf`: the screen's card is as wide
as a shown family's longest text too), exactly as the screen would measure it
without the links; `getPosterCardBox` / `getPosterCardMetrics` give that box
and its columns, `getOutputFocusDepth` the depth the poster names (a shown
family's generations count on screen only). The browser's own print
(beforeprint / afterprint, wired in `initViewLinks`) lays the view out
without the links while it prints (`TreeRenderer.setPrinting`: the render
finishes within the event, the cross-tree data being cached by then) and
draws it as before afterwards, the focus depth given back; a print
stylesheet hides ghosts, virtual lines, labels, the indicator and the list
whatever happens. The poster's own sheet print is left alone. The output
dialogs (poster, book, the export dialog in the view's scope, a tree from the
view, sharing) carry one row "View-only links (n) are not included"
(`renderViewLinksNote`, n = `viewLinksShownCount`) while any is shown.
GEDCOM, JSON, CSV, the app file, the book's text, the fan, the timeline,
loading a research version and what will be sent never read the records.

Accessibility: a ghost's `aria-label` ends "Linked in the view only,
unproven."; the line's label is a button named "Unproven, hypothesis H0022,
version B. Open in the research." "What research knows" gives the keyboard
back to what opened it when it closes (the label; the stub, quietly — no
bubble; the ghost's card after its menu). The pinned bubble, the menus and
the confirmation keep the keyboard inside and give it back on Esc; the
switches (the list's rows, its main switch, the hypotheses' versions) are
`role="switch"` buttons. On touch every target is 44px (the label and the
family's button by an invisible extension that scales with the tree's zoom).
The specs: e2e/view-links-*.spec.ts, `view-links-modes.spec.ts` running the
touch UI on a phone, a phone held sideways and a tablet.

---

## 9. Testing

### Active suites (29 vitest files, 2556 tests + 17 Playwright e2e)

**Core harness** — `allPersonsFull.test.ts`: runs `runLayoutPipeline` with
EVERY person of every fixture as focus, in standard + expanded modes, checking
card overlaps, position validity, built-in validation and the strict geometry
audit (`helpers/geometryAudit.ts`: crossings, collinear merges, T-touches,
lines through cards). Lines step 7 left out are listed in the report
(`test/failures-full-<fixture>.txt`, "Omitted lines") and fail the run when
one is on the focus's own line. No run is tolerated: the former
`KNOWN_LINE_KNOTS` list is gone, step 7 omits the unroutable lines.
The audit has no tolerated class: the former `inherent-crossing` (a
topologically forced crossing between cross-married unions) is gone, those
knots are omitted lines shown as card links.

**Fixtures** — `comprehensive.json` (53 persons), targeted `edge-*.json`,
generated `etalon-*.json` scenarios A–O (`npm run gen:etalon`), plus a local
gitignored real-data fixture (skipped gracefully when absent).

**Pipeline unit tests** — per-step tests (`buildModel`, `assignGenerations`,
`measureSubtrees`, `routeEdges`, `selectSubgraph`, `pipeline`) plus feature
suites (dates, kinship, GEDCOM round-trip, privacy, undo, merge, demo trees).

**E2E** — Playwright suite (`npm run test:e2e`, 17 tests) drives the built
`strom.html`; it gates CI deploys together with the unit suite.

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

## 10. Visual Representation

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
