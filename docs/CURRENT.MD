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

---

## 7. Step 8: emitLayoutResult

1. Computes Y positions: every card's `y` is its generation band's top
   (see Generation bands); `LayoutResult.bands` lists the bands
2. Normalizes X: shifts everything so minX = padding
3. Normalization includes: positions, connections, spouseLines, branch bounds

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
a couple have multiple marriages. The chain lives in one **chain block**
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
  has parents with their own parents — gets a crossing. Same class as
  `KNOWN_LINE_KNOTS` (needs couple re-orientation planning); found with view
  links in `viewLinksFull.test.ts`, it is the same with the links made real.
- Sibling couples can stand between a chain person's far wives when the
  siblings and the wives share the parents' bus row (Tudor/Henry VIII
  constellation) — spouse lines then run across foreign cards' row space.
- Long single-child dynasty lines drift diagonally ("staircase") because each
  couple centers over its one child.

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
lines through cards). `KNOWN_LINE_KNOTS` lists the only tolerated
constellation class; `inherent-crossing` marks topologically forced crossings
between cross-married unions.

**Fixtures** — `comprehensive.json` (53 persons), targeted `edge-*.json`,
generated `etalon-*.json` scenarios A–N (`npm run gen:etalon`), plus a local
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
