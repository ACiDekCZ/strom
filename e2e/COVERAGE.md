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
| Save to a file (File System Access) | `file-access.spec.ts` | partial | mocked handle: save writes tree JSON, indicator shows, Ctrl+S re-saves; unsupported context hides controls. Real picker/permission UI and cross-reload handle persistence can't be driven headlessly |
| Invalid JSON import | `data-import-export.spec.ts` | covered | validation dialog, existing data intact |
| Invalid/garbage GEDCOM import | `data-import-export.spec.ts` | covered | lenient parser → empty result dialog, app stays alive |
| Demo → export → import | `data-import-export.spec.ts` | covered | person count matches |
| Local encryption across reload | `data-safety.spec.ts` | covered | enable in settings, IndexedDB holds ciphertext only, reload → password prompt → tree intact |
| Cancelled startup unlock | `data-safety.spec.ts` | covered | "Unlock" banner (`storage-notice`); an edit while locked is refused with a toast and never overwrites the encrypted tree; banner reopens the prompt |
| Wrong password then right one | `data-safety.spec.ts` | covered | 2 trees encrypted; error shown, retry unlocks; both trees' persons identical to before |
| Two tabs on the same tree | `data-safety.spec.ts` | covered | save in tab B → tab A shows the other-tab notice; its Reload brings in B's change; B does not warn itself |
| "Export all" JSON → import | `data-safety.spec.ts` | covered | via `#file-input`; confirm "Import all trees" restores both trees with 2/3 persons |
| "Export all" HTML → import | `data-safety.spec.ts` | covered | via `#html-input`; same checks as JSON |
| Reopen exported HTML (`file://`) | `data-safety.spec.ts` | covered | 2nd/3rd open offers the stored tree (existing-export dialog); view stored / view embedded + "Stay with this file" / update storage never duplicate it (bug fixed: the banner link used to import a second copy) |
| Deleting a tree deletes its backups | `data-safety.spec.ts` | covered | manual backups for 2 trees; after deleting one, the IndexedDB `snapshots` store holds only the other tree's backup |

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
| Timeline view (third mode) | `timeline.spec.ts` | covered | segment switches to life-bars on a year axis; back restores the tree |
| Family book generation | `book.spec.ts` | covered | dialog → new window with chapters + index |
| Flex date accepted/normalized/rejected | `edit-undo-lock.spec.ts` | covered | `about 1880` → `~1880`; nonsense rejected |
| Delete person (context menu) + undo | `person-crud.spec.ts` | covered | confirm dialog, undo restores |
| Delete person (Delete key) | `person-crud.spec.ts` | covered | deletes the focused person after confirm |
| Delete last person → empty state | `person-crud.spec.ts` | covered | empty state returns |
| Add partner / child / parent | `relations.spec.ts` | covered | cards render |
| Add sibling | `relations-extra.spec.ts` | covered | new sibling card renders |
| Family wizard (batch add + single undo) | `family-wizard.spec.ts` | covered | parents+partner+children in one form; one Ctrl+Z removes the whole family |
| Link existing person (no duplicate) | `relations-extra.spec.ts` | covered | relation modal "link existing" via person picker |
| Partnership status / note change + remove | `relations-extra.spec.ts` | covered | relationships panel; divorced + note persist; removal |
| Undo / redo (Ctrl+Z / Ctrl+Shift+Z) | `edit-undo-lock.spec.ts` | covered | delete → restore → delete again |
| Lock person (read-only edit form) | `edit-undo-lock.spec.ts` | covered | inputs read-only, Save hidden |
| Lock whole tree | `settings-lock.spec.ts` | covered | `body.tree-locked`, add blocked, unlock restores |
| Keyboard: Ctrl+F, +, 0, Esc | `interaction.spec.ts` | covered | search focus, zoom in, reset, close modal |
| Zoom controls + mouse wheel | `interaction.spec.ts` | covered | zoom level changes |
| Pan (drag canvas) | `interaction.spec.ts` | covered | transform changes |
| Overview minimap (show / navigate / settings toggle) | `minimap.spec.ts` | covered | appears when zoomed in past the viewport; click re-centers; setting hides it |
| Branch colours (toggle + legend + dark) | `branch-colors.spec.ts` | covered | settings toggle adds stripe classes + legend; dark-mode smoke; off removes both |
| Expanded mode (multi-marriage inline) | `interaction.spec.ts` | covered | all of Henry VIII's wives laid out; refocus re-lays-out |
| Hidden-relatives "+N" badge / collapse (−) | — | n-a | focus depth auto-expands to the whole connected tree, so badges do not appear in normal-size trees; expansion is focus-driven, there is no separate collapse control |
| Runtime language switch (CS ↔ EN) | `settings-lock.spec.ts`, `cs.spec.ts` | covered | settings radios; about labels switch without reload |
| German UI smoke (no English leaks) | `de.spec.ts` | covered | locale de-DE → `<html lang="de">`; add/edit person, relationships panel, export + privacy step, context menu, anniversaries, tree manager, settings, stats, kinship, book dialog scanned for common English words (text + placeholders) |
| Tree stats dialog | `settings-lock.spec.ts` | covered | shows the person count |
| Family statistics (visual charts) | `stats.spec.ts` | covered | collapsible section renders inline-SVG bar charts |
| Anniversaries panel + "on this day" | `anniversaries.spec.ts` | covered | today's birthday triggers the once-a-day card (gone after dismiss+reload); panel lists it |
| Audit log | `settings-lock.spec.ts` | covered | records a mutation when enabled |
| Search focuses a person | `search-kinship-archives.spec.ts` | covered | toolbar search picker |
| Relationship (kinship) calculator | `search-kinship-archives.spec.ts` | covered | shows a kinship term |
| Archive search gating (Czech relevance) | `search-kinship-archives.spec.ts` | covered | Czech portals gated by place |
| Photo upload / remove | `photo.spec.ts` | covered | avatar shows / clears |
| Trees: create / switch | `tree.spec.ts` | covered | tree switcher |
| Trees: rename / delete | `tree.spec.ts` | covered | tree manager |
| Demo tree loads | `demo.spec.ts` | covered | focus + hint toast |
| Interactive tour (offer / steps / Escape / mobile) | `tour.spec.ts` | covered | offered once after demo; steps advance; Escape ends; second demo load doesn't re-offer; bubble fits mobile |
| Backups: create / restore / undo restore | `backups.spec.ts` | covered | manual snapshot survives a delete; restore is undoable |
| About dialog version | `smoke.spec.ts`, `cs.spec.ts` | covered | matches `package.json` |
| PWA offline indicator | `pwa.spec.ts` | covered | toolbar badge toggles with `context.setOffline` |
| PWA service-worker registration | — (`pwa.test.ts` unit) | partial | registration gate is unit-tested per AppMode; the SW is only served on the PWA host (`stromapp.info/run/`), which the localhost e2e server cannot emulate, so live register/offline-serve is not driven end-to-end |
| Search filter panel position + Escape close | `search-filter.spec.ts` | covered | regression: panel used to overflow above the viewport |
| Descendants view recenters after pan/zoom | `descendants-view.spec.ts` | covered | regression: empty canvas after mode switch |
| Collaboration round-trip (share → welcome → collab bar → reply merge offer) | `share.spec.ts` | covered | full two-context flow incl. in-app HTML import of the reply |
| Change packets (send only changes → merge) | `share-diff.spec.ts` | covered | two-context: recipient sends a small change packet, sender reconstructs against the baseline and the merge preview has the addition; orphan packet → clear message |
| Plain export shows no collaboration surfaces | `share.spec.ts` | covered | backwards compatibility |
| Archives + kinship dialogs: header X and Escape close | `search-kinship-archives.spec.ts` | covered | unified with the standard modal pattern (dialog stack) |
| Floating zoom buttons setting (on/off) | `settings-lock.spec.ts` | covered | settings toggle hides/restores `.zoom-controls` |
| Descendants view hides hidden-relative badges | `descendants-view.spec.ts` | covered | branch tabs / +N badges do nothing in the filtered chart |
| Long names shrink to fit the card | `person-crud.spec.ts` | covered | two font steps before the ellipsis |
| Mobile: single tap opens the bottom sheet | `mobile.spec.ts` | covered | first tap = person menu, no desktop context menu |
| Timeline: wheel scrolls natively (no canvas zoom) | `timeline.spec.ts` | covered | wheel over the timeline leaves ZoomPan scale unchanged |
| Timeline: unknown-death bar to last event + fade | — (`timeline.test.ts` unit) | partial | model extension unit-tested; the fade is SVG cosmetics |
| Extended tree validation (dates, citations, attachments) | `tree.spec.ts` + `validation-dates.test.ts` (unit) | covered | death<birth, orphan citation shown with detail line; 13 unit tests for all new checks |
| Tree manager: row ⋯ menu, Open button, active badge | `tree.spec.ts` | covered | menu opens, rename item works, Open switches tree and closes manager |
| Tree manager: search box for long lists | — | partial | rendering gated at ≥6 trees; filtering is a trivial name includes() |
| Fan chart view (sectors, refocus, gen selector, add-parent slot) | `fan.spec.ts` + `fan-chart.test.ts` (unit) | covered | 4th view mode; ahnentafel model unit-tested incl. empty-slot rule |
| Toolbar Add-family button (opt-in setting) | `family-wizard.spec.ts` | covered | hidden by default; setting reveals; opens wizard on focus |
| GEDCOM fidelity: divorce w/o date, dropped-tag summary, unknown sex, CONC wrap, multi-line event notes | — (`gedcom-roundtrip.test.ts` unit) | covered | 9 unit tests over the parser/exporter pair |
| GEDCOM media (OBJE) + standard repositories/citation PAGE | — (`gedcom-roundtrip.test.ts` unit) | covered | photo/attachment round-trip, external files counted |
| Merge safety: undecided weak match imports separately | — (`merge-scoring.test.ts` unit) | covered | executor gating + first scoring tests; UI gate dialog not e2e-driven |
| Merge smart: flex dates + transitive propagation | — (`merge-scoring.test.ts` unit) | covered | ~dates match exact dates; chains resolve through generations |
| CSV person-table export | `data-import-export.spec.ts` + `csv-export.test.ts` (unit) | covered | localized headers, escaping, BOM |
| Locale date form in edit inputs | — (`dates.test.ts` unit) | covered | round-trip guaranteed by tests; visual form is cosmetic |
| Relationships dialog staged as a whole (status + relation type + witness) | `editing-review.spec.ts` | covered | Cancel→Discard rolls back all three (data + reopened dialog, no undo entry); Save applies all, one Ctrl+Z reverts all |
| "Add child" to a single person = one undo step | `editing-review.spec.ts` | covered | child + "?" placeholder partner removed by one Ctrl+Z, card count back to 1 |
| Escape asks before discarding edits (person / event / source editor) | `editing-review.spec.ts` | covered | Stay keeps typed text, Discard closes without saving; event and source editors on EXISTING records |
| No third parent / no ancestry cycle | `editing-review.spec.ts` | covered | full-parent child: no "Add parent", link picker empty; own father not offered as child; data layer refuses |
| Emptied field stays empty (event place, source repository/URL) | `editing-review.spec.ts` | covered | clear → save → reopen empty, key gone from data |
| "Deceased" on create + no-op Save adds no undo step | `editing-review.spec.ts` | covered | card shows †; unchanged Save leaves the undo description and top step as is |
| Family wizard keeps the anchor's existing parent | `editing-review.spec.ts` | covered | mother row fixed/read-only; father fills the free slot; exactly 3 persons, 1 union (untouched surname-prefilled rows add nobody — bug fixed) |
| Keyboard only: first person + child from the empty state | `editing-review.spec.ts` | covered | Tab/Enter/arrows/typing only; card menu → Add child |

## Opening from outside (Strom Research)

| Area | Test file | Status | Notes |
|------|-----------|--------|-------|
| Drag & drop a Strom Research `.ged` → its tree; again → same tree updated, no duplicate | `research-open.spec.ts` | covered | `_STROM_TREE` link stored in tree metadata; summary toast; 1 tree after two drops |
| Drop overlay + non-GEDCOM file refused | `research-open.spec.ts` | covered | overlay on dragenter, toast on a `.json` drop |
| Plain GEDCOM dropped → normal import dialog | `research-open.spec.ts` | covered | `#gedcom-result-modal` |
| Edited in the app → ask; "Open as new copy" / "Update" | `research-open.spec.ts` | covered | copy takes the link, edited tree keeps its edit; Update replaces it, still one tree |
| `?import-url=` on 127.0.0.1 | `research-open.spec.ts` | covered | request answered by `page.route`; address cleaned |
| `?import-url=` fetch refused → manual import offered | `research-open.spec.ts` | covered | dialog with "Import file…" |
| `?import-url=` to another host ignored, no request | `research-open.spec.ts` | covered | `127.0.0.1.evil.com`; allow-list details in vitest `research-link.test.ts` |
| File handler (`launchQueue`) | `research-open.spec.ts` | partial | simulated `window.launchQueue` via `addInitScript`; the real OS "open with" / install prompt cannot be driven headlessly |
| `?live=` bridge: read-only tree, panel (working / changes / waiting), refresh + highlight on `change`, "following ended" | `research-open.spec.ts` | covered | status, tree.ged and the SSE stream answered by `page.route`; bridge text with markup shown as text |
| `?live=` stop following | `research-open.spec.ts` | covered | panel removed, read-only lifted |
| No `launchQueue` / `EventSource`, phone viewport, bogus `?live=` / `?import-url=` | `research-open.spec.ts` | covered | no `pageerror`, toolbar visible, params removed; valid `?live=` without EventSource still opens the research (polling fallback) |
| Real browsers reaching a loopback bridge from https (PNA / mixed content) | — | n-a | depends on the browser's network policy; not reproducible in the headless suite |

## Strom Research in the app (3.0 promotion)

Suites that test something else start with the promotion "already seen":
`openApp()` seeds `whatsNew30Shown` / `researchNewDismissed` into the browser
settings (`seedResearchPromoSeen`); `research-promo.spec.ts` opts out with
`openApp(page, { researchPromo: true })`. The website is answered by
`context.route` — no request leaves the test. Gating + URL builder: vitest
`research-promo.test.ts`.

| Area | Test file | Status | Notes |
|------|-----------|--------|-------|
| Welcome-screen offer at 1440 / 400 / 700px, between "I have data elsewhere" and the demo link; opens the site in a new tab (EN bare, CS `?lang=cs`, DE `?lang=de`) | `research-promo.spec.ts` | covered | popup via `context.waitForEvent('page')`; new user gets `whatsNew30Shown` right away |
| "Runs on a computer" line at 400px and on touch, not on desktop | `research-promo.spec.ts` | covered | touch = `hasTouch` + `isMobile` at 820px |
| One-time 3.0 card on an existing tree: desktop card anchored under Actions (14px gap, 384px, arrow on the button centre, ≥16px from the edge); shown once (also when just ignored) | `research-promo.spec.ts` | covered | "Learn more" opens the site; reload shows nothing |
| "Not now" / "Learn more" / Esc / backdrop tap put the dot and the label out | `research-promo.spec.ts` | covered | desktop, phone sheet, 1024px tablet sheet |
| Dot on Actions (desktop) and on the bottom-bar More tab (≤1024px); none on the top ⋯; red anniversaries dot wins | `research-promo.spec.ts` | covered | `aria-label` "Actions, new item" / "More, new item" while lit |
| Menu item (desktop menu below "Strom:", More sheet below the tree row) → explanation dialog; dialog puts "New" out; item stays; primary opens the site; Close / outside click close | `research-promo.spec.ts` | covered | ≤499px: stacked full-width buttons, primary on top, ≥48px |
| "New" out after 30 days | `research-promo.spec.ts` | covered | `researchNewFirstSeen` moved 31 days back |
| Hidden: view mode (exported HTML with data), exported app from disk, locked data / password prompt, research tree (card + label, item stays), command-line open (card; "New" stays) | `research-promo.spec.ts` | covered | CLI open simulated with `?open=file` |
| Keyboard: ArrowUp / Tab reach the item, Enter opens the dialog, Esc closes card and dialog, focus back to the trigger / the tree | `research-promo.spec.ts` | covered | |
| Dark theme: card + dialog on dark tokens, screenshots to `screenshots/` | `research-promo.spec.ts` | covered | local-only folder |
| State only in browser settings — not in IndexedDB tree data, not in the JSON export | `research-promo.spec.ts` | covered | |
| 360 × 780 in German: offer, 3.0 sheet, More sheet and dialog without horizontal overflow | `research-promo.spec.ts` | covered | |
| Real `window.open` behaviour of Safari / installed PWA | — | n-a | headless Chromium only |

## Security & privacy

| Area | Test file | Status | Notes |
|------|-----------|--------|-------|
| XSS via imported JSON (names, places, notes, quote-breaking person id, attribute-breaking wedding place) | `security-privacy.spec.ts` | covered | card + tooltip, person edit, relationships panel, anniversaries (birthday in 3 days; row click focuses the odd id), kinship, archives: literal text shown, no `window.__xss`, no JS dialog |
| XSS in the tree-merge compare preview of a foreign file | `security-privacy.spec.ts` | covered | same file imported twice, merge wizard match list + side-by-side compare overlay |
| XSS via GEDCOM import (markup in NAME/PLAC/NOTE, attribute-breaking MARR PLAC) | `security-privacy.spec.ts` | covered | import result dialog, card + tooltip, edit dialog, relationships panel |
| HTML export carries only the exported tree | `security-privacy.spec.ts` | covered | tree A on screen, tree B exported from the tree manager (anonymous + full): none of A's names in the file |
| HTML export: `</script>` / `$'` in a note | `security-privacy.spec.ts` | covered | exported file opened via `file://` loads B in view mode, no script runs, note round-trips byte-for-byte |
| GEDCOM export living privacy (initials, anonymous) | `security-privacy.spec.ts` | covered | living person's name variant, note, birth place, wedding date/place, witness, couple note dropped (initials keeps the wedding year by design); deceased couple keeps all of it |
| CSV formula injection | `security-privacy.spec.ts` | covered | `=cmd…` name written as `'=cmd…` |

## Responsive layout

| Area | Test file | Status | Notes |
|------|-----------|--------|-------|
| No horizontal document overflow (360/499/550/768/900/1024/1280/1440, light + dark) | `layout-overflow.spec.ts` | covered | demo tree; `scrollWidth <= clientWidth + 1` on html/body, also with each dialog open |
| Toolbar controls never overlap | `layout-overflow.spec.ts` | covered | visible buttons/inputs/selects of the bar pairwise non-intersecting at every width |
| Key dialogs fit the viewport, no inner horizontal scroll | `layout-overflow.spec.ts` | covered | person edit, relationships, export, tree manager, settings; relationships rows overflowed at 360px — fixed (rows wrap ≤499px) |

## Deliberately not covered (`n-a`)

| Area | Reason |
|------|--------|
| Print / poster print CSS | printing cannot be driven headlessly; SVG/PNG/PDF export paths cover the render |
| Card tooltips / badge tooltips | pure hover cosmetics, no data effect |
| Debug panels / `__*_DEBUG` flags | developer-only, not user-facing |
| Cross-tree presence badge navigation | requires a specific multi-tree layout; low data-loss risk |
| Mobile-only controls (`.add-person-round`) | responsive; the suite runs at desktop width |
