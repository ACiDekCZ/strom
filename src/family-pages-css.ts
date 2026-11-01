/**
 * The family pages' file (spec 026 §0.2, §8): the rules a file of many pages
 * adds after the person page's (personPageFileCss) — the column of 960 px,
 * one page shown at a time, the lineage's and the hub's blocks, the contents
 * of the file and the separators without the script, the dark scheme of the
 * system (§8.2), print of the shown page only (§8.3) — and PAGE_SET_SCRIPT,
 * which shows the page of the address's hash (§0.5).
 *
 * Breakpoints as everywhere (src/breakpoints.ts): phone ≤ 640, tablet
 * 641–1024, desktop > 1024, a phone held sideways; touch targets ≥ 44 px on
 * coarse pointers, hover only under (hover: hover).
 */

import { PERSON_PAGE_LIGHT_TOKENS } from './person-page-css.js';
import { PERSON_PAGE_VIZ_LIGHT_TOKENS } from './person-page-viz-css.js';
import { PAGE_SET_SEARCH_JS } from './family-pages-search.js';

/** The lineage bars' colour (light / dark), next to the person page's tokens. */
const LIGHT_EXTRA = '--rod-bar: #9fb8a6; --sp-frame: #d0c6b2;';

/** §8.2: the person page's tokens in the dark of the system (the design's values). */
const DARK_TOKENS = [
    '--surface: #2c2a24', '--surface-2: #26241f', '--surface-modal: #2c2a24', '--card-bg-2: #26241f',
    '--text: #e8e3d6', '--text-light: #b3aa97', '--text-faint: #9e9683',
    '--border: #4a4538', '--divider: #3a362d',
    '--primary: #8fbf9f', '--primary-soft: #33403a', '--on-primary: #1c1a15',
    '--accent: #c98d59', '--accent-text: #d9a272', '--hover-bg: #35322a',
    '--hist-bg: #34312a', '--hist-mark: #a89f8d', '--hist-place: #6fb3c6', '--hist-local: #d19a4a',
    '--hist-text: #cfc6b4', '--hist-place-text: #9fd2e0', '--hist-local-text: #e9c77f',
    '--map-land: #26241f', '--map-land2: #34312a', '--map-geo: #5d5749', '--map-label-bg: rgba(44, 42, 36, .85)',
    '--map-water: #3f4d57', '--map-ring: #4a463c', '--map-anchor: #8a8270', '--map-region: #3a372f',
    '--chart-young: #5a503d', '--chart-life: #4a4538', '--chart-married: #4f6d58', '--chart-band1: #34312a', '--chart-band2: #433e33',
    '--rod-bar: #6f8f78', '--sp-frame: #575143',
].join('; ') + ';';

/** The file's tokens: the lineage bars and the frame, the system's dark scheme. */
const ROOT_CSS = `
:root { ${LIGHT_EXTRA} }
@media screen and (prefers-color-scheme: dark) { :root { ${DARK_TOKENS} color-scheme: dark; } }
`;

/** Paper's tokens in print (the file only: the app keeps its own). */
const PRINT_ROOT_CSS = `  :root { ${PERSON_PAGE_LIGHT_TOKENS} ${PERSON_PAGE_VIZ_LIGHT_TOKENS} ${LIGHT_EXTRA} color-scheme: light; }
`;

/** The pages' rules without the file's tokens (the app's window takes them, on the app's tokens). */
export const FAMILY_PAGES_BODY_CSS = `.pp-file.sp-file { max-width: 960px; padding: 28px 40px 40px; }
.sp-page { display: block; }
.sp-on .sp-page { display: none; }
.sp-on .sp-page.sp-cur, .sp-on .sp-page:target { display: block; }
/* Without the script every page under the other, a thin rule with the page's address between them (3i). */
html:not(.sp-on) .sp-page + .sp-page { margin-top: 40px; }
html:not(.sp-on) .sp-page + .sp-page::before { content: "#" attr(id); display: block; margin-bottom: 24px; padding-top: 8px; border-top: 1px solid var(--border); font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; color: var(--text-faint); text-align: center; overflow-wrap: anywhere; }
.sp-toc-file { display: none; }
html:not(.sp-on) .sp-toc-file { display: block; margin-bottom: 32px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 12px; }
.no-js .sp-fbar, .no-js .sp-map { display: none !important; }
.sp-toc-h { margin: 0 0 8px; font-family: var(--font-serif); font-size: 20px; font-weight: 600; }
.sp-toc-row { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; font-size: 14px; line-height: 1.55; }
.sp-toc-row > span:first-child { color: var(--text-light); }
.sp-toc-row a { color: var(--primary); overflow-wrap: anywhere; }
.sp-print-foot { display: none; }

/* The blocks of a lineage, a branch, the hub, a family and an index. */
.sp-body { display: flex; flex-direction: column; gap: 32px; color: var(--text); }
.sp-body .pp-link { color: var(--primary); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.sp-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; margin: 0 0 16px; font-size: 13.5px; color: var(--text-light); }
.sp-crumbs a { color: var(--primary); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; display: inline-flex; align-items: center; min-height: 32px; }
.sp-crumbs [aria-current] { display: inline-flex; align-items: center; min-height: 32px; overflow-wrap: anywhere; }
.sp-crumbs .sp-sep { color: var(--text-faint); }
.sp-crumb-back { display: none; }
.sp-head { display: flex; flex-direction: column; gap: 10px; }
.sp-kicker { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); font-weight: 600; }
.sp-h1 { margin: 0; font-family: var(--font-serif); font-size: 38px; line-height: 1.12; font-weight: 600; text-wrap: balance; overflow-wrap: anywhere; }
.sp-h2 { margin: 0 0 4px; font-family: var(--font-serif); font-size: 22px; font-weight: 600; }
.sp-h3 { margin: 0 0 4px; font-size: 11px; font-weight: 400; color: var(--text-faint); }
.sp-founder, .sp-sub { margin: 0; font-size: 15.5px; color: var(--text-light); }
.sp-stats { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 6px; font-size: 14px; color: var(--text-light); }
.sp-stat { white-space: nowrap; }
.sp-stat strong { color: var(--text); font-weight: 600; }
.sp-facts { margin: 0; padding-top: 4px; display: grid; grid-template-columns: minmax(80px, 120px) minmax(0, 1fr); gap: 6px 14px; font-size: 14.5px; }
.sp-facts dt { color: var(--text-light); }
.sp-facts dd { margin: 0; overflow-wrap: anywhere; }
.sp-faint { color: var(--text-faint); }
.sp-yrs { color: var(--text-light); font-size: 14px; white-space: nowrap; }
.sp-nw { white-space: nowrap; }
.sp-block { display: flex; flex-direction: column; gap: 6px; }
.sp-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px 32px; }
.sp-chart { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.sp-bar-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; min-height: 18px; }
.sp-bar-row--place { grid-template-columns: minmax(0, 150px) minmax(0, 1fr); }
.sp-bar-k { font-size: 12.5px; line-height: 1.25; overflow-wrap: anywhere; }
.sp-bar-gen { font-family: var(--font-serif); font-size: 13px; color: var(--text-light); }
.sp-bar-n { color: var(--text-faint); }
.sp-axis { position: relative; height: 9px; background: var(--surface-2); border-radius: 2px; }
.sp-bar { position: absolute; top: 0; bottom: 0; background: var(--rod-bar); border-radius: 2px; }
.sp-ticks { display: flex; justify-content: space-between; margin-left: 44px; font-size: 11px; color: var(--text-faint); }
.sp-chart:has(.sp-bar-row--place) .sp-ticks { margin-left: 0; }
.sp-more { margin: 2px 0 0; font-size: 13px; }
.sp-gen-h { display: flex; align-items: baseline; gap: 12px; margin: 0; padding: 14px 0 6px; border-bottom: 1px solid var(--border); font-weight: 400; }
.sp-roman { font-family: var(--font-serif); font-size: 22px; font-weight: 600; color: var(--accent-text); min-width: 40px; }
.sp-gen-meta { font-size: 13px; color: var(--text-light); }
.sp-row { display: flex; flex-direction: column; gap: 3px; padding: 10px 0 10px 4px; border-bottom: 1px solid var(--divider); }
.sp-row p { margin: 0; }
.sp-row-main { line-height: 1.5; overflow-wrap: anywhere; }
.sp-row-main > .pp-link:first-child, .sp-row-main > :first-child { font-size: 16px; font-weight: 600; }
.sp-meta { font-size: 13px; color: var(--text-faint); }
.sp-row-sub { font-size: 13px; color: var(--text-faint); }
.sp-row-note { font-size: 13px; font-style: italic; color: var(--text-light); }
.sp-row--young .sp-row-main { color: var(--text-light); }
.sp-unions { list-style: none; margin: 4px 0 0 2px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sp-union { padding-left: 12px; border-left: 2px solid var(--divider); font-size: 14px; line-height: 1.6; }
.sp-union-line { overflow-wrap: anywhere; }
.sp-union-line .sp-nw { color: var(--accent-text); }
.sp-rodref { color: var(--text-light); }
.sp-kids > summary { display: inline-flex; align-items: center; min-height: 28px; color: var(--text-light); cursor: pointer; }
.sp-kid-list { margin: 2px 0; font-size: 13.5px; }
.sp-kid { white-space: normal; }
.sp-teaser { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border-radius: 12px; background: var(--surface-2); }
.sp-teaser-h { margin: 0; font-family: var(--font-serif); font-size: 18px; font-weight: 600; }
.sp-btns { display: flex; flex-wrap: wrap; gap: 8px; }
.sp-btn { min-height: 40px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 8px; border: 1px solid var(--sp-frame); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; text-decoration: none; cursor: pointer; }
.sp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.sp-card { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); font: inherit; text-align: left; text-decoration: none; cursor: pointer; min-width: 0; }
.sp-card-t { font-family: var(--font-serif); font-size: 21px; font-weight: 600; overflow-wrap: anywhere; }
.sp-card-f { font-size: 13.5px; color: var(--text-light); overflow-wrap: anywhere; }
.sp-card-m { font-size: 13px; color: var(--text-faint); }
.sp-card-go { font-size: 14px; color: var(--primary); font-weight: 600; }
.sp-card .sp-axis { height: 8px; }
.sp-cross { display: flex; flex-direction: column; gap: 4px; }
.sp-cross-row { display: flex; flex-wrap: wrap; gap: 0 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--divider); font-size: 14.5px; overflow-wrap: anywhere; }
.sp-cross-rods { font-size: 13px; color: var(--text-faint); }
.sp-partners { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.sp-partner { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border: 1px solid var(--border); border-radius: 12px; min-width: 0; }
.sp-partner-name { font-family: var(--font-serif); font-size: 20px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
.sp-fam-page { display: flex; flex-direction: column; gap: 30px; }
.sp-sym { color: var(--accent-text); font-weight: 400; }
.sp-other { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; padding: 10px 14px; border-radius: 10px; background: var(--card-bg-2); font-size: 14px; overflow-wrap: anywhere; }
.sp-other-pre { color: var(--text-light); }
.sp-partner { gap: 10px; }
.sp-partner-top { display: flex; gap: 14px; align-items: flex-start; }
.sp-portrait { width: 64px; height: 80px; flex: none; border-radius: 6px; object-fit: cover; background-color: var(--card-bg-2); }
.sp-partner-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sp-role { font-size: 12px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.06em; }
.sp-pfacts, .sp-mfacts { margin: 0; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 3px 10px; font-size: 14px; }
.sp-mfacts { flex: 1 1 280px; gap: 4px 10px; font-size: 14.5px; }
.sp-pfacts dt, .sp-mfacts dt { color: var(--text-light); }
.sp-pfacts dd, .sp-mfacts dd { margin: 0; overflow-wrap: anywhere; }
.sp-prow { font-size: 13.5px; color: var(--text-light); overflow-wrap: anywhere; }
.sp-go { align-self: flex-start; min-height: 36px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 8px; border: 1px solid var(--sp-frame); background: none; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--primary); text-decoration: none; cursor: pointer; }
.sp-mar { display: flex; flex-wrap: wrap; gap: 16px 24px; align-items: flex-start; }
.sp-clip { flex: 0 1 300px; display: flex; flex-direction: column; gap: 6px; color: inherit; text-decoration: none; cursor: zoom-in; min-width: 0; }
.sp-clip-img { width: 100%; aspect-ratio: var(--pp-ar, 5 / 2); border-radius: 6px; border: 1px solid var(--border); background-size: contain; object-fit: contain; }
.sp-clip-cap { font-size: 12.5px; color: var(--text-light); }
.sp-res, .sp-src { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.sp-src { font-size: 14px; color: var(--text-light); }
.sp-kids-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.sp-kid { display: flex; flex-direction: column; gap: 2px; padding: 11px 13px; border: 1px solid var(--divider); border-radius: 10px; min-width: 0; overflow-wrap: anywhere; }
.sp-kid--young { background: var(--card-bg-2); color: var(--text-light); }
.sp-kid-name { font-size: 15px; font-weight: 600; }
.sp-kid-note { font-size: 13px; color: var(--text-light); }
.sp-story .pp-couple-story { margin: 0; }
.sp-pfam { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.sp-famcard { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; width: 100%; box-sizing: border-box; padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background: none; font: inherit; color: var(--text); text-align: left; text-decoration: none; cursor: pointer; overflow-wrap: anywhere; }
.sp-famcard-t { font-size: 15px; font-weight: 600; }
.sp-famcard-m { font-size: 13.5px; color: var(--text-light); }
.sp-famcard-go { margin-left: auto; font-size: 13.5px; font-weight: 600; color: var(--primary); }
.sp-oddil { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; border-radius: 10px; background: var(--card-bg-2); }
.sp-oddil-k { font-size: 12px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.06em; }
.sp-oddil-t { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.sp-oddil-l { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: 14px; overflow-wrap: anywhere; }
.sp-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.sp-list > li { padding: 8px 0; border-bottom: 1px solid var(--divider); overflow-wrap: anywhere; }
.sp-foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--text-faint); }
.sp-foot p { margin: 0; }
.sp-body .book-index { columns: 2 280px; column-gap: 32px; font-size: 14px; line-height: 1.6; }
.sp-body .book-index-letter { break-after: avoid; margin: 12px 0 4px; font-family: var(--font-serif); font-size: 18px; font-weight: 600; color: var(--accent-text); }
.sp-body .book-index-row { break-inside: avoid; overflow-wrap: anywhere; }
.sp-body .book-index-see { color: var(--text-faint); font-style: italic; }
@media (hover: hover) {
  .sp-card:hover, .sp-famcard:hover { border-color: var(--primary); }
  .sp-btn:hover, .sp-go:hover { background: var(--hover-bg); }
  .sp-body .pp-link:hover, .sp-crumbs a:hover { text-decoration-thickness: 2px; }
}
.sp-card:focus-visible, .sp-famcard:focus-visible, .sp-btn:focus-visible, .sp-go:focus-visible, .sp-clip:focus-visible, .sp-crumbs a:focus-visible, .sp-toc-row a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
/* Tablet: a narrower margin. */
@media (min-width: 641px) and (max-width: 1024px) { .pp-file.sp-file { padding: 24px 28px 36px; } }
/* Phone: 16 px margins, a smaller heading, cards under each other, the breadcrumb only "‹ the page above". */
@media (max-width: 640px) {
  .pp-file.sp-file { padding: 16px 16px 28px; }
  .sp-h1 { font-size: 29px; }
  .sp-cards, .sp-partners { grid-template-columns: minmax(0, 1fr); }
  .sp-charts { grid-template-columns: minmax(0, 1fr); }
  .sp-toc-row { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .sp-crumbs > :not(.sp-crumb-back) { display: none; }
  .sp-crumbs > .sp-crumb-back { display: inline-flex; }
  .sp-facts { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .sp-facts dd { margin-bottom: 6px; }
  .sp-fam-page { gap: 24px; }
  .sp-partner { padding: 14px 14px; }
  .sp-clip { flex-basis: 100%; }
}
/* A phone held sideways: the phone's margins, partners' cards beside each other (8c). */
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
  .pp-file.sp-file { padding: 16px 24px 28px; }
  .sp-h1 { font-size: 29px; }
  .sp-partners { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (pointer: coarse) {
  .sp-crumbs a, .sp-crumbs [aria-current], .sp-crumb-back { min-height: 44px; }
  .sp-btn, .sp-kids > summary, .sp-go, .sp-famcard { min-height: 44px; }
  .sp-toc-row a { display: inline-block; padding: 10px 0; }
}
/* The file's bar (§3.1): the name, the search, Index and Map of places; on a phone the magnifier and Menu. */
.sp-fbar { position: sticky; top: 0; z-index: 30; background: var(--surface); border-bottom: 1px solid var(--border); }
html:not(.sp-on) body > .sp-fbar { display: none; }
.sp-fbar-in { box-sizing: border-box; max-width: 960px; height: 56px; margin: 0 auto; padding: 0 40px; display: flex; align-items: center; gap: 16px; }
.sp-fbar-home { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: var(--font-serif); font-size: 17px; font-weight: 600; color: var(--text); text-decoration: none; }
.sp-fbar-gap { flex: 1 1 auto; }
.sp-search { position: relative; display: flex; align-items: center; flex: 0 1 240px; min-width: 0; color: var(--text-light); }
.sp-search > .sp-ico { position: absolute; left: 11px; pointer-events: none; }
.sp-q { box-sizing: border-box; width: 100%; height: 36px; margin: 0; padding: 0 10px 0 33px; font: inherit; font-size: 14px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; -webkit-appearance: none; appearance: none; }
.sp-q::placeholder { color: var(--text-faint); }
.sp-q:focus { outline: 2px solid var(--primary); outline-offset: -1px; border-color: var(--primary); }
.sp-ico { position: relative; display: inline-block; flex: none; box-sizing: border-box; width: 13px; height: 13px; border: 2px solid currentColor; border-radius: 50%; }
.sp-ico::after { content: ""; position: absolute; right: -5px; bottom: -4px; width: 2px; height: 6px; background: currentColor; border-radius: 1px; transform: rotate(-45deg); }
.sp-fbar-nav { display: flex; align-items: center; gap: 16px; }
.sp-fbar-a { display: inline-flex; align-items: center; min-height: 36px; white-space: nowrap; font-size: 14px; color: var(--text-light); text-decoration: none; }
.sp-fbar-a[aria-current] { color: var(--text); font-weight: 600; }
.sp-fbar-cancel, .sp-fbar-lupa, .sp-fbar-menu { display: none; align-items: center; justify-content: center; flex: none; min-height: 44px; margin: 0; padding: 0 8px; font: inherit; font-size: 14px; color: var(--primary); background: none; border: 0; border-radius: 8px; cursor: pointer; }
.sp-fbar--has .sp-fbar-cancel { display: inline-flex; }
.sp-menu { display: none; }
/* The search's results replace the page while the field holds a query (§3.4). */
.sp-results[hidden] { display: none !important; }
.sp-searching .sp-page, .sp-searching .sp-toc-file { display: none !important; }
.sp-results { color: var(--text); }
.sp-res-head { margin: 0 0 12px; font-size: 13.5px; color: var(--text-light); }
.sp-res-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--divider); }
.sp-res-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; padding: 10px 0; border-bottom: 1px solid var(--divider); }
.sp-res-n { font-family: var(--font-serif); font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
.sp-res-y { font-size: 13.5px; color: var(--text-light); font-variant-numeric: tabular-nums; }
.sp-res-t { font-size: 12.5px; color: var(--text-faint); }
.sp-res-more { margin: 14px 0 0; font-size: 14px; }
.sp-res-none { padding: 8px 0; }
.sp-res-none-t { margin: 0 0 6px; font-family: var(--font-serif); font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
.sp-res-hint { max-width: 60ch; margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: var(--text-light); }
.sp-results .pp-link, .sp-results a { color: var(--primary); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
/* The indexes (§3.5): the tabs, the alphabet, the rows, the folds. */
.sp-tabs { display: flex; flex-wrap: wrap; gap: 0 4px; margin-top: -16px; border-bottom: 1px solid var(--border); }
.sp-tab { display: inline-flex; align-items: center; min-height: 40px; margin-bottom: -1px; padding: 0 14px; font-size: 14.5px; color: var(--text-light); text-decoration: none; border-bottom: 2px solid transparent; }
.sp-tab[aria-current] { color: var(--text); font-weight: 600; border-bottom-color: var(--primary); }
.sp-ix { margin-top: -12px; }
.sp-letters { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 20px; }
.sp-letter { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 7px; font-size: 14px; color: var(--primary); text-decoration: none; border: 1px solid var(--border); border-radius: 6px; }
.sp-letter[aria-current] { color: var(--text); font-weight: 600; background: var(--primary-soft); border-color: var(--primary); }
.sp-ix-group + .sp-ix-group { margin-top: 20px; }
.sp-ix-letter { margin: 0 0 4px; padding-bottom: 4px; font-family: var(--font-serif); font-size: 20px; font-weight: 600; border-bottom: 1px solid var(--divider); }
.sp-ix-h2 { margin: 28px 0 8px; font-family: var(--font-serif); font-size: 18px; font-weight: 600; }
.sp-ix-list, .sp-ix-sub { margin: 0; padding: 0; list-style: none; }
.sp-ix-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; padding: 6px 0; font-size: 15px; line-height: 1.4; }
.sp-ix-n { overflow-wrap: anywhere; }
.sp-ix-y { font-size: 13.5px; color: var(--text-light); font-variant-numeric: tabular-nums; }
.sp-ix-t, .sp-ix-dot { font-size: 12.5px; color: var(--text-faint); }
.sp-ix-more { border-bottom: 1px solid var(--divider); }
.sp-ix-sum { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 10px 0; font-size: 15px; cursor: pointer; list-style: none; }
.sp-ix-sum::-webkit-details-marker { display: none; }
.sp-ix-sum::after { content: "▸"; color: var(--text-faint); }
.sp-ix-more[open] > .sp-ix-sum::after { content: "▾"; }
.sp-ix-sub { padding: 0 0 10px 16px; font-size: 14.5px; line-height: 1.8; }
.sp-fbar-a:focus-visible, .sp-fbar-home:focus-visible, .sp-fbar-cancel:focus-visible, .sp-fbar-lupa:focus-visible, .sp-fbar-menu:focus-visible, .sp-menu-a:focus-visible,
.sp-tab:focus-visible, .sp-letter:focus-visible, .sp-ix-sum:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
@media (hover: hover) {
  .sp-fbar-a:hover, .sp-fbar-home:hover, .sp-tab:hover { color: var(--text); }
  .sp-letter:hover, .sp-menu-a:hover, .sp-fbar-lupa:hover, .sp-fbar-menu:hover, .sp-fbar-cancel:hover { background: var(--hover-bg); }
  .sp-ix-sum:hover { color: var(--primary); }
}
@media (min-width: 641px) and (max-width: 1024px) { .sp-fbar-in { padding: 0 28px; } }
/* Phone and a phone held sideways: the name, the magnifier and Menu; the magnifier turns the bar into the field. */
@media (max-width: 640px), (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
  .sp-fbar-in { padding: 0 8px 0 16px; gap: 4px; }
  .sp-fbar-home { flex: 1 1 auto; }
  .sp-fbar-gap, .sp-search, .sp-fbar-nav, .sp-fbar--has .sp-fbar-cancel { display: none; }
  .sp-fbar-lupa, .sp-fbar-menu { display: inline-flex; }
  .sp-fbar-lupa { width: 44px; padding: 0; color: var(--text); }
  .sp-fbar-lupa .sp-ico { width: 16px; height: 16px; }
  .sp-fbar-menu { min-width: 44px; font-size: 15px; }
  .sp-fbar--q .sp-fbar-home, .sp-fbar--q .sp-fbar-lupa, .sp-fbar--q .sp-fbar-menu { display: none; }
  .sp-fbar--q .sp-search { display: flex; flex: 1 1 auto; }
  .sp-fbar--q .sp-fbar-cancel { display: inline-flex; }
  .sp-q { height: 40px; font-size: 16px; }
  .sp-menu:not([hidden]) { display: block; padding: 4px 0 8px; background: var(--surface); border-top: 1px solid var(--divider); box-shadow: 0 8px 16px rgba(0, 0, 0, .08); }
  .sp-menu-a { box-sizing: border-box; display: flex; align-items: center; width: 100%; min-height: 48px; padding: 0 16px; font-size: 16px; color: var(--text); text-decoration: none; }
  .sp-menu-a[aria-current] { font-weight: 600; color: var(--primary); }
  .sp-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .sp-tab { flex: none; padding: 0 12px; }
}
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) { .sp-fbar-in { padding: 0 16px 0 24px; } }
@media (pointer: coarse) {
  .sp-tab, .sp-fbar-a, .sp-ix-sum { min-height: 44px; }
  .sp-letter { min-width: 44px; height: 44px; }
  .sp-ix-sub li { padding: 4px 0; }
}
/* §3.6: the light boxes of the file's pages follow the script (opened by pushState, so not by :target); a hint under the image. */
html.sp-on .pp-lb:target:not(.sp-lb-on) { display: none; }
html.sp-on .pp-lb.sp-lb-on { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; background: #1c1a15; color: #e8e3d6; }
html.sp-lb-open { overflow: hidden; }
.sp-lb-hint { flex: 0 0 auto; margin: 0; padding: 2px 16px 14px; font-size: 12.5px; line-height: 1.4; color: #c9c1b0; text-align: center; }
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) { .sp-lb-hint { display: none; } }
/* §8.3: the shown page only (all of them without the script), no breadcrumbs or folds, links as text, paper. */
@media print {
${PRINT_ROOT_CSS}  body { background: #fff; }
  .pp-file.sp-file { max-width: none; padding: 0; }
  .sp-crumbs, .sp-fbar, .sp-results, .sp-toc-file { display: none !important; }
  .sp-body a, .sp-body .pp-link, .sp-crumbs a { color: inherit !important; text-decoration: none !important; }
  .sp-btns, .sp-card-go, .sp-go, .sp-famcard-go { display: none !important; }
  details.sp-kids > summary { display: none !important; }
  details.sp-kids::details-content { content-visibility: visible; display: contents; }
  .sp-letters, .sp-tabs, .sp-ix-sum::after { display: none !important; }
  details.sp-ix-more::details-content { content-visibility: visible; display: contents; }
  .sp-on .sp-print-foot { display: block; margin-top: 24px; padding-top: 8px; border-top: 1px solid #cfcfcf; font-size: 11px; color: #4d4d4d; }
  .sp-card, .sp-row, .sp-union, .sp-partner, .sp-kid, .sp-mar { break-inside: avoid; }
}
`;

export const FAMILY_PAGES_CSS = ROOT_CSS + FAMILY_PAGES_BODY_CSS;

/**
 * The window's rules (§0.8): the pages' rules on the app's tokens (light and
 * dark from the app's theme), print without the file's paper tokens, and the
 * links as buttons (the window's `data-sp-open`) looking like the file's links.
 */
/** The window's rules in the app's document, once (the set's window and the person page's family cards). */
export function ensureFamilyPagesAppCss(doc: Document = document): void {
    if (doc.getElementById('family-pages-css')) return;
    const style = doc.createElement('style');
    style.id = 'family-pages-css';
    style.textContent = FAMILY_PAGES_APP_CSS;
    doc.head.appendChild(style);
}

export const FAMILY_PAGES_APP_CSS = FAMILY_PAGES_BODY_CSS.replace(PRINT_ROOT_CSS, '') + `
.sp-app { max-width: 960px; margin: 0 auto; padding: 24px 32px 40px; }
.sp-app button.pp-link, .sp-app button.sp-crumb, .sp-app button.sp-crumb-back, .sp-app button.sp-toc-a {
  font: inherit; color: var(--primary); background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit;
  text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px;
}
.sp-app .sp-crumbs button { display: inline-flex; align-items: center; min-height: 32px; }
.sp-app button.sp-card { width: 100%; font: inherit; color: inherit; cursor: pointer; text-align: left; }
.sp-app button.sp-btn { font: inherit; cursor: pointer; }
.sp-app button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
@media (hover: hover) { .sp-app button.pp-link:hover, .sp-app .sp-crumbs button:hover { text-decoration-thickness: 2px; } }
@media (min-width: 641px) and (max-width: 1024px) { .sp-app { padding: 20px 24px 32px; } }
@media (max-width: 640px) { .sp-app { padding: 16px 16px 28px; } }
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) { .sp-app { padding: 12px 24px 24px; } }
@media (pointer: coarse) { .sp-app .sp-crumbs button { min-height: 44px; } }
.sp-appset .sp-fbar button.sp-fbar-home, .sp-appset .sp-fbar button.sp-fbar-a, .sp-appset button.sp-menu-a, .sp-app button.sp-tab, .sp-app button.sp-letter {
  font: inherit; background: none; margin: 0; cursor: pointer; text-align: inherit;
}
.sp-appset .sp-fbar button.sp-fbar-home { padding: 0; border: 0; font-family: var(--font-serif); font-size: 17px; font-weight: 600; color: var(--text); }
.sp-appset .sp-fbar button.sp-fbar-a { padding: 0; border: 0; font-size: 14px; color: var(--text-light); }
.sp-appset .sp-fbar button.sp-fbar-a[aria-current] { color: var(--text); font-weight: 600; }
.sp-appset button.sp-menu-a { border: 0; font-size: 16px; color: var(--text); }
.sp-appset button.sp-menu-a[aria-current] { font-weight: 600; color: var(--primary); }
.sp-app button.sp-tab { border: 0; border-bottom: 2px solid transparent; font-size: 14.5px; color: var(--text-light); }
.sp-app button.sp-tab[aria-current] { color: var(--text); font-weight: 600; border-bottom-color: var(--primary); }
.sp-app button.sp-letter { font-size: 14px; color: var(--primary); }
.sp-app button.sp-letter[aria-current] { color: var(--text); font-weight: 600; background: var(--primary-soft); border-color: var(--primary); }
.sp-appset .sp-fbar-in { max-width: none; }
`;

/**
 * The file's pages (§0.2, §0.5), inline, no libraries: only the page of the
 * address's hash is shown (none or an unknown one: the introduction); a hash
 * `{slug}--{id}` is an anchor inside the page `{slug}` (a fold of an index is
 * opened). A change of the hash switches the page and goes to its top, so
 * the browser's Back and Forward go page by page; an anchor inside a page is
 * scrolled to. The document's title and the bar's current item follow the
 * page. The children of a union and the folds of the indexes start folded
 * (open without the script) and are unfolded for printing.
 *
 * The bar (§3.1): the search (§3.4) draws its results over the pages while
 * the field holds a query, the address unchanged; Escape or Cancel brings
 * the page back where it was. On a phone the magnifier turns the bar into the
 * field and Menu opens its panel. The alphabet of the index of people
 * filters its groups (§3.5) instead of jumping to them.
 *
 * The light boxes (§3.6): opening one pushes `#{slug}--obr-N` and shows it;
 * a hash without `--obr-` (the browser's Back) closes it and the page stays
 * where it was. ×, Escape or a click beside the image go back when the box
 * was opened here, else (a link with `--obr-N` opened the file) replace the
 * address with the page's `#{slug}`; ‹ › replace the entry.
 */
export const PAGE_SET_SCRIPT = `(function(){var d=document,h=d.documentElement;
var q=function(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s))};
var pages=q('section.sp-page');if(!pages.length)return;
var intro=d.querySelector('section.sp-page[data-sp-intro]')||pages[0],cur=null;
function hashId(){var x=location.hash.slice(1);try{return decodeURIComponent(x)}catch(e){return x}}
function pageOf(id){if(!id)return null;var e=d.getElementById(id);var s=e&&e.closest('section.sp-page');if(s)return s;var i=id.indexOf('--');if(i>0){e=d.getElementById(id.slice(0,i));if(e&&e.matches('section.sp-page'))return e}return null}
function cur1(e,on){if(on)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current')}
function mark(s){var k=s.classList.contains('sp-page--index')?'index':s.classList.contains('sp-page--map')?'map':'';
q('[data-sp-nav]').forEach(function(a){cur1(a,a.getAttribute('data-sp-nav')===k)});
q('.sp-menu-a').forEach(function(a){cur1(a,a.getAttribute('href')==='#'+s.id)})}
function show(s){if(s===cur)return false;if(cur)cur.classList.remove('sp-cur');s.classList.add('sp-cur');cur=s;var t=s.getAttribute('data-sp-title');if(t)d.title=t;mark(s);return true}
function route(first){var id=hashId(),s=pageOf(id)||intro,moved=show(s);
var e=id&&id!==s.id?d.getElementById(id):null;if(e&&e.tagName==='DETAILS'&&!e.open){e.open=true;if(!moved)e.scrollIntoView()}
if(!moved)return;
if(e){if(!/(^|--)obr-/.test(id))e.scrollIntoView()}else if(!first)window.scrollTo(0,0)}
h.classList.add('sp-on');
q('details.sp-kids[open],details.sp-ix-more[open]').forEach(function(f){f.open=false});
route(true);
${PAGE_SET_SEARCH_JS}
function J(id){var e=d.getElementById(id);try{return e?JSON.parse(e.textContent):null}catch(x){return null}}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var bar=d.querySelector('.sp-fbar'),inp=bar&&bar.querySelector('.sp-q'),res=d.getElementById('sp-results'),menu=d.getElementById('sp-menu'),
menuBtn=bar&&bar.querySelector('.sp-fbar-menu'),lang=h.lang||'en',ix=null,str=null,on=false,saved=0,pr=null;
try{pr=new Intl.PluralRules(lang)}catch(x){}
function pl(t,n){t=t||{};return String(t[pr?pr.select(n):'other']||t.other||'').replace('{n}',String(n))}
function fill(t,v){return String(t||'').replace('{q}',function(){return v})}
function link(slug,html){return slug&&d.getElementById(slug)?'<a class="pp-link" href="'+'#'+esc(slug)+'">'+html+'</a>':html}
function draw(v){ix=ix||J('sp-index')||[];str=str||J('sp-strings')||{};var r=spSearch(ix,v,lang,10),o;
if(!r.total)o='<div class="sp-res-none"><p class="sp-res-none-t">'+esc(fill(str.none,v))+'</p><p class="sp-res-hint">'+esc(str.hint||'')+'</p><p>'+link(str.idx,esc(str.toIdx||''))+'</p></div>';
else o='<p class="sp-res-head">'+esc(fill(pl(str.res,r.total),v))+'</p><ul class="sp-res-list">'+r.hits.map(function(e){
return '<li class="sp-res-row">'+(e.s&&d.getElementById(e.s)?'<a class="pp-link sp-res-n" href="'+'#'+esc(e.s)+'">'+esc(e.n)+'</a>':'<span class="sp-res-n">'+esc(e.n)+'</span>')
+(e.y?' <span class="sp-res-y">'+esc(e.y)+'</span>':'')+(e.t?' <span class="sp-res-t">'+esc(e.t)+'</span>':'')+'</li>'}).join('')+'</ul>'
+(r.total>r.hits.length?'<p class="sp-res-more">'+link(str.idx,esc(pl(str.more,r.total-r.hits.length)))+'</p>':'');
res.innerHTML=o}
function setQ(v,keep){var t=v.replace(/^\\s+|\\s+$/g,'');bar.classList.toggle('sp-fbar--has',v!=='');
if(t){if(!on){on=true;saved=window.pageYOffset;h.classList.add('sp-searching');res.hidden=false;window.scrollTo(0,0)}draw(t)}
else if(on){on=false;h.classList.remove('sp-searching');res.hidden=true;res.innerHTML='';if(!keep)window.scrollTo(0,saved)}}
function shut(){if(menu&&!menu.hidden){menu.hidden=true;menuBtn.setAttribute('aria-expanded','false')}}
function cancel(keep){if(!inp)return;inp.value='';setQ('',keep);bar.classList.remove('sp-fbar--q')}
if(bar&&inp&&res){
inp.addEventListener('input',function(){setQ(inp.value)});
inp.addEventListener('keydown',function(e){if(e.key==='Escape'||e.key==='Esc'){e.preventDefault();e.stopPropagation();cancel();inp.blur()}});
bar.querySelector('.sp-fbar-cancel').addEventListener('click',function(){cancel()});
bar.querySelector('.sp-fbar-lupa').addEventListener('click',function(){shut();bar.classList.add('sp-fbar--q');inp.focus()});
res.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a)return;var same=a.getAttribute('href')===location.hash;cancel(true);if(same){route(false);window.scrollTo(0,0)}});
}
if(menu&&menuBtn){
menuBtn.addEventListener('click',function(){var o=menu.hidden;menu.hidden=!o;menuBtn.setAttribute('aria-expanded',String(o))});
menu.addEventListener('click',function(e){if(e.target.closest('a'))shut()});
d.addEventListener('keydown',function(e){if((e.key==='Escape'||e.key==='Esc')&&!menu.hidden){shut();menuBtn.focus()}});
d.addEventListener('click',function(e){if(!menu.hidden&&!e.target.closest('.sp-fbar'))shut()});
}
d.addEventListener('click',function(e){var L=e.target.closest('[data-sp-letter]');if(!L)return;e.preventDefault();
var v=L.getAttribute('data-sp-letter'),box=L.closest('.sp-ix')||d;
q('[data-sp-letter]',box).forEach(function(x){if(x===L)x.setAttribute('aria-current','true');else x.removeAttribute('aria-current')});
q('[data-sp-group]',box).forEach(function(g){g.hidden=v!==''&&g.getAttribute('data-sp-group')!==v})});
var lbRe=/(^|--)obr-/,lbEl=null,lbPushed=false,lbFrom=null,lbY=0;
function lbSync(){var id=hashId(),e=lbRe.test(id)?d.getElementById(id):null;if(e&&!e.classList.contains('pp-lb'))e=null;
if(lbEl&&lbEl!==e)lbEl.classList.remove('sp-lb-on');
if(e&&!lbEl)lbY=window.pageYOffset;
if(e&&e!==lbEl){e.classList.add('sp-lb-on');str=str||J('sp-strings')||{};
if(str.lbHint&&!e.querySelector('.sp-lb-hint')){var p=d.createElement('p');p.className='sp-lb-hint';p.textContent=str.lbHint;e.appendChild(p)}
var c=e.querySelector('.pp-lb-close');if(c)try{c.focus({preventScroll:true})}catch(x){}}
if(!e){lbPushed=false;if(lbEl){var y=lbY;window.scrollTo(0,y);requestAnimationFrame(function(){window.scrollTo(0,y)});if(lbFrom){try{lbFrom.focus({preventScroll:true})}catch(x){}lbFrom=null}}}
lbEl=e;h.classList.toggle('sp-lb-open',!!e)}
function lbClose(){if(!lbEl)return;if(lbPushed){lbPushed=false;history.back();return}
var s=lbEl.closest('section.sp-page');history.replaceState(null,'','#'+(s?s.id:''));lbSync()}
d.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
var a=t.closest('a[href^="#"]'),hr=a?a.getAttribute('href').slice(1):'',k=a?a.getAttribute('data-pp-lb'):null;
if(a&&lbRe.test(hr)&&d.getElementById(hr)){e.preventDefault();e.stopPropagation();
if(k==='prev'||k==='next'){history.replaceState(null,'','#'+hr);lbSync();return}
if(!lbEl){lbFrom=a;history.pushState(null,'','#'+hr);lbPushed=true}else history.replaceState(null,'','#'+hr);lbSync();return}
if(lbEl&&a&&k==='close'){e.preventDefault();e.stopPropagation();lbClose();return}
if(lbEl&&lbEl.contains(t)&&!t.closest('a,button,.pp-lb-img')){e.preventDefault();e.stopPropagation();lbClose()}},true);
window.addEventListener('keydown',function(e){if(!lbEl)return;var k=e.key;
if(k==='Escape'||k==='Esc'){e.preventDefault();e.stopPropagation();lbClose();return}
if(k==='ArrowLeft'||k==='ArrowRight'){e.preventDefault();e.stopPropagation();var l=lbEl.querySelector('[data-pp-lb="'+(k==='ArrowLeft'?'prev':'next')+'"]');if(l)l.click()}},true);
window.addEventListener('popstate',lbSync);
lbSync();
window.addEventListener('hashchange',function(){if(on)cancel(true);shut();route(false);lbSync()});
var opened=[];
window.addEventListener('beforeprint',function(){opened=q('details.sp-kids:not([open]),details.sp-ix-more:not([open])');opened.forEach(function(f){f.open=true})});
window.addEventListener('afterprint',function(){opened.forEach(function(f){f.open=false});opened=[]});
})();`;
