# E2E Coverage Matrix

End-to-end (Playwright) coverage of user-facing functionality, run against the
real single-file build (`strom.html`). Priority is on data paths where data loss
is possible (import/export/merge/encryption).

**Status legend:** `covered` = exercised end-to-end · `partial` = only part of the
flow is driven (reason given) · `n-a` = deliberately not covered (reason given).

This is a living document. **Every new feature must add its rows here** and keep
the table honest.

## Data paths (loss-sensitive)

| Area | Test file | Status | Notes |
|------|-----------|--------|-------|
| JSON export → re-import as new tree (round-trip) | `data-import-export.spec.ts` | covered | 3 persons + partnership survive |
| Import as new tree keeps existing tree intact | `data-import-export.spec.ts` | covered | second tree added, original untouched |
| GEDCOM export → re-import through the UI | `data-import-export.spec.ts` | covered | INDI/FAM, names + relations preserved |
| Focus/branch export | `data-import-export.spec.ts` | covered | only the focused component is written |
| Standalone-HTML app export → open in view mode | `export-app-viewmode.spec.ts` | covered | opened via `file://`; read-only (edit controls hidden) |
| Encrypted export → open, wrong vs right password | `export-app-viewmode.spec.ts` | covered | encrypted HTML-app open flow (supports retry) |
| Encrypted JSON import, wrong password → retry | `data-import-export.spec.ts` | covered | retry bug fixed in review; error shown, same prompt accepts the right password |
| Tree merge (two trees, shared person) | `merge.spec.ts` | partial | target-picker + wizard opens + shared match detected + shown in review list; the multi-step execute is not driven through the UI (unstable to script) |
| Person merge (within a tree) | `merge.spec.ts` | covered | two persons → one, undo restores; relations unified |
| PNG poster export | `export-poster.spec.ts` | covered | PNG magic number + non-trivial size |
| SVG poster export | `export-poster.spec.ts` | covered | valid XML, contains a name |
| JSON export privacy (living persons) | `export-poster.spec.ts` | covered | `initials` mode hides full names |
| Persistence across reload | `person-crud.spec.ts` | covered | reload after a deterministic IndexedDB flush wait |
| Invalid JSON import | `data-import-export.spec.ts` | covered | validation dialog, existing data intact |
| Invalid/garbage GEDCOM import | `data-import-export.spec.ts` | covered | lenient parser → empty result dialog, app stays alive |
| Demo → export → import | `data-import-export.spec.ts` | covered | person count matches |

## Functional sweep

| Area | Test file | Status | Notes |
|------|-----------|--------|-------|
| Create first person | `smoke.spec.ts`, `cs.spec.ts` | covered | empty state → card |
| Edit every person field + reload | `person-crud.spec.ts` | covered | names, gender, dates, places, notes, deceased |
| Life events: add event + reload | `life-events.spec.ts` | covered | add via event editor, survives reload |
| Sources: cite a new source + reload | `sources.spec.ts` | covered | create+cite via picker, chip survives reload |
| Sources manager + citation count | `sources.spec.ts` | covered | add via manager, cite, count shown |
| Attachments: add image + reload + delete | `attachments.spec.ts` | covered | compressed in-browser, note persists, delete |
| Attachments: oversized PDF rejected | `attachments.spec.ts` | covered | >2 MB PDF warned, not attached |
| Parent relationship type (adoptive) | `parent-rel-type.spec.ts` | covered | select sets adoptive, child drop dashed, persists |
| Duplicate suggestion in new-person modal | `duplicate-suggest.spec.ts` | covered | hint appears, "Go to person" focuses existing |
| Duplicate "use existing" in add-relation | `duplicate-suggest.spec.ts` | covered | links existing person, no duplicate created |
| Duplicate suggestions settings toggle | `duplicate-suggest.spec.ts` | covered | disabling hides the hint |
| Search filter highlight (last name) | `search-filter.spec.ts` | covered | matches get search-hit, rest search-dim, clear resets |
| Search filter by birth-year range | `search-filter.spec.ts` | covered | only in-range persons highlighted |
| Mobile long-press → bottom sheet | `mobile.spec.ts` | covered | touch viewport; Edit opens person modal |
| Mobile pinch zoom | `mobile.spec.ts` | covered | two-finger pinch changes zoom level |
| Descendants view (toolbar + badge) | `descendants-view.spec.ts` | covered | ancestors hidden, badge, ✕ returns to family |
| Descendants via context menu | `descendants-view.spec.ts` | covered | "Show descendants" enters the mode |
| Family book generation | `book.spec.ts` | covered | dialog → new window with chapters + index |
| Flex date accepted/normalized/rejected | `edit-undo-lock.spec.ts` | covered | `about 1880` → `~1880`; nonsense rejected |
| Delete person (context menu) + undo | `person-crud.spec.ts` | covered | confirm dialog, undo restores |
| Delete person (Delete key) | `person-crud.spec.ts` | covered | deletes the focused person after confirm |
| Delete last person → empty state | `person-crud.spec.ts` | covered | empty state returns |
| Add partner / child / parent | `relations.spec.ts` | covered | cards render |
| Add sibling | `relations-extra.spec.ts` | covered | new sibling card renders |
| Link existing person (no duplicate) | `relations-extra.spec.ts` | covered | relation modal "link existing" via person picker |
| Partnership status / note change + remove | `relations-extra.spec.ts` | covered | relationships panel; divorced + note persist; removal |
| Undo / redo (Ctrl+Z / Ctrl+Shift+Z) | `edit-undo-lock.spec.ts` | covered | delete → restore → delete again |
| Lock person (read-only edit form) | `edit-undo-lock.spec.ts` | covered | inputs read-only, Save hidden |
| Lock whole tree | `settings-lock.spec.ts` | covered | `body.tree-locked`, add blocked, unlock restores |
| Keyboard: Ctrl+F, +, 0, Esc | `interaction.spec.ts` | covered | search focus, zoom in, reset, close modal |
| Zoom controls + mouse wheel | `interaction.spec.ts` | covered | zoom level changes |
| Pan (drag canvas) | `interaction.spec.ts` | covered | transform changes |
| Overview minimap (show / navigate / settings toggle) | `minimap.spec.ts` | covered | appears when zoomed in past the viewport; click re-centers; setting hides it |
| Expanded mode (multi-marriage inline) | `interaction.spec.ts` | covered | all of Henry VIII's wives laid out; refocus re-lays-out |
| Hidden-relatives "+N" badge / collapse (−) | — | n-a | focus depth auto-expands to the whole connected tree, so badges do not appear in normal-size trees; expansion is focus-driven, there is no separate collapse control |
| Runtime language switch (CS ↔ EN) | `settings-lock.spec.ts`, `cs.spec.ts` | covered | settings radios; about labels switch without reload |
| Tree stats dialog | `settings-lock.spec.ts` | covered | shows the person count |
| Audit log | `settings-lock.spec.ts` | covered | records a mutation when enabled |
| Search focuses a person | `search-kinship-archives.spec.ts` | covered | toolbar search picker |
| Relationship (kinship) calculator | `search-kinship-archives.spec.ts` | covered | shows a kinship term |
| Archive search gating (Czech relevance) | `search-kinship-archives.spec.ts` | covered | Czech portals gated by place |
| Photo upload / remove | `photo.spec.ts` | covered | avatar shows / clears |
| Trees: create / switch | `tree.spec.ts` | covered | tree switcher |
| Trees: rename / delete | `tree.spec.ts` | covered | tree manager |
| Demo tree loads | `demo.spec.ts` | covered | focus + hint toast |
| About dialog version | `smoke.spec.ts`, `cs.spec.ts` | covered | matches `package.json` |

## Deliberately not covered (`n-a`)

| Area | Reason |
|------|--------|
| Print / poster print CSS | printing cannot be driven headlessly; SVG/PNG/PDF export paths cover the render |
| Card tooltips / badge tooltips | pure hover cosmetics, no data effect |
| Debug panels / `__*_DEBUG` flags | developer-only, not user-facing |
| Cross-tree presence badge navigation | requires a specific multi-tree layout; low data-loss risk |
| Mobile-only controls (`.add-person-round`) | responsive; the suite runs at desktop width |
| Search filter panel position + Escape close | `search-filter.spec.ts` | covered | regression: panel used to overflow above the viewport |
| Descendants view recenters after pan/zoom | `descendants-view.spec.ts` | covered | regression: empty canvas after mode switch |
