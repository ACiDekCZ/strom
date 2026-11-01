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

export const FAMILY_PAGES_CSS = `
:root { ${LIGHT_EXTRA} }
@media screen and (prefers-color-scheme: dark) { :root { ${DARK_TOKENS} color-scheme: dark; } }
.pp-file.sp-file { max-width: 960px; padding: 28px 40px 40px; }
.sp-page { display: block; }
.sp-on .sp-page { display: none; }
.sp-on .sp-page.sp-cur, .sp-on .sp-page:target { display: block; }
/* Without the script every page under the other, a thin rule with the page's address between them (3i). */
html:not(.sp-on) .sp-page + .sp-page { margin-top: 40px; }
html:not(.sp-on) .sp-page + .sp-page::before { content: "#" attr(id); display: block; margin-bottom: 24px; padding-top: 8px; border-top: 1px solid var(--border); font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; color: var(--text-faint); text-align: center; overflow-wrap: anywhere; }
.sp-toc-file { display: none; }
html:not(.sp-on) .sp-toc-file { display: block; margin-bottom: 32px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 12px; }
.no-js .sp-bar, .no-js .sp-map { display: none !important; }
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
.sp-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.sp-list > li { padding: 8px 0; border-bottom: 1px solid var(--divider); overflow-wrap: anywhere; }
.sp-foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; color: var(--text-faint); }
.sp-foot p { margin: 0; }
.sp-body .book-index { columns: 2 280px; column-gap: 32px; font-size: 14px; line-height: 1.6; }
.sp-body .book-index-letter { break-after: avoid; margin: 12px 0 4px; font-family: var(--font-serif); font-size: 18px; font-weight: 600; color: var(--accent-text); }
.sp-body .book-index-row { break-inside: avoid; overflow-wrap: anywhere; }
.sp-body .book-index-see { color: var(--text-faint); font-style: italic; }
@media (hover: hover) {
  .sp-card:hover { border-color: var(--primary); }
  .sp-btn:hover { background: var(--hover-bg); }
  .sp-body .pp-link:hover, .sp-crumbs a:hover { text-decoration-thickness: 2px; }
}
.sp-card:focus-visible, .sp-btn:focus-visible, .sp-crumbs a:focus-visible, .sp-toc-row a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
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
}
/* A phone held sideways: the phone's margins, partners' cards beside each other (8c). */
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
  .pp-file.sp-file { padding: 16px 24px 28px; }
  .sp-h1 { font-size: 29px; }
  .sp-partners { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (pointer: coarse) {
  .sp-crumbs a, .sp-crumbs [aria-current], .sp-crumb-back { min-height: 44px; }
  .sp-btn, .sp-kids > summary { min-height: 44px; }
  .sp-toc-row a { display: inline-block; padding: 10px 0; }
}
/* §8.3: the shown page only (all of them without the script), no breadcrumbs or folds, links as text, paper. */
@media print {
  :root { ${PERSON_PAGE_LIGHT_TOKENS} ${PERSON_PAGE_VIZ_LIGHT_TOKENS} ${LIGHT_EXTRA} color-scheme: light; }
  body { background: #fff; }
  .pp-file.sp-file { max-width: none; padding: 0; }
  .sp-crumbs, .sp-bar, .sp-toc-file { display: none !important; }
  .sp-body a, .sp-body .pp-link, .sp-crumbs a { color: inherit !important; text-decoration: none !important; }
  .sp-btns, .sp-card-go { display: none !important; }
  details.sp-kids > summary { display: none !important; }
  details.sp-kids::details-content { content-visibility: visible; display: contents; }
  .sp-on .sp-print-foot { display: block; margin-top: 24px; padding-top: 8px; border-top: 1px solid #cfcfcf; font-size: 11px; color: #4d4d4d; }
  .sp-card, .sp-row, .sp-union { break-inside: avoid; }
}
`;

/**
 * The file's pages (§0.2, §0.5), inline, no libraries: only the page of the
 * address's hash is shown (none or an unknown one: the introduction); a hash
 * `{slug}--{id}` is an anchor inside the page `{slug}`. A change of the hash
 * switches the page and goes to its top, so the browser's Back and Forward go
 * page by page; an anchor inside a page is scrolled to. The document's title
 * follows the page. The children of a union start folded (open without the
 * script) and are unfolded for printing. Small functions in one closure, so
 * the search and the indexes (step E) can join.
 */
export const PAGE_SET_SCRIPT = `(function(){var d=document,h=d.documentElement;
var q=function(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s))};
var pages=q('section.sp-page');if(!pages.length)return;
var intro=d.querySelector('section.sp-page[data-sp-intro]')||pages[0],cur=null;
function hashId(){var x=location.hash.slice(1);try{return decodeURIComponent(x)}catch(e){return x}}
function pageOf(id){if(!id)return null;var e=d.getElementById(id);var s=e&&e.closest('section.sp-page');if(s)return s;var i=id.indexOf('--');if(i>0){e=d.getElementById(id.slice(0,i));if(e&&e.matches('section.sp-page'))return e}return null}
function show(s){if(s===cur)return false;if(cur)cur.classList.remove('sp-cur');s.classList.add('sp-cur');cur=s;var t=s.getAttribute('data-sp-title');if(t)d.title=t;return true}
function route(first){var id=hashId(),s=pageOf(id)||intro,moved=show(s);if(!moved)return;
if(id&&id!==s.id){var e=d.getElementById(id);if(e&&!/(^|--)obr-/.test(id))e.scrollIntoView()}else if(!first)window.scrollTo(0,0)}
h.classList.add('sp-on');
q('details.sp-kids[open]').forEach(function(f){f.open=false});
route(true);
window.addEventListener('hashchange',function(){route(false)});
var shut=[];
window.addEventListener('beforeprint',function(){shut=q('details.sp-kids:not([open])');shut.forEach(function(f){f.open=true})});
window.addEventListener('afterprint',function(){shut.forEach(function(f){f.open=false});shut=[]});
})();`;
