/**
 * Styles and script of the person page (spec 025). One source for the window
 * (the app injects PERSON_PAGE_CSS; its tokens come from index.html, dark mode
 * included) and for the saved file (personPageFileCss: the light token values
 * on :root, the fonts, the same rules). The window chrome (.modal--page,
 * .pp-head, .pp-toc) is the window's own and is not here.
 */

import { PERSON_PAGE_VIZ_CSS, PERSON_PAGE_VIZ_LIGHT_TOKENS } from './person-page-viz-css.js';

/** The light ("paper") values of the app tokens the page uses — the file's :root and print. */
export const PERSON_PAGE_LIGHT_TOKENS = [
    '--surface: #fffdf8', '--surface-2: #f6f2ea', '--surface-modal: #fbf8f1', '--card-bg-2: #f6f1e6',
    '--text: #2b2822', '--text-light: #5c5546', '--text-faint: #746c5c',
    '--border: #ddd4c2', '--divider: #ece5d6',
    '--primary: #3f6b4f', '--primary-soft: #e6efe8', '--on-primary: #ffffff',
    '--accent-text: #8a5528', '--hover-bg: #f3eee2',
    '--hist-bg: #f5f1e7', '--hist-mark: #746c5c', '--hist-place: #3d7a8c', '--hist-local: #b5772a',
].join('; ') + ';';

/** The font stacks of the app (the file falls back to Georgia / the system sans without the embedded faces). */
const FONT_STACKS = "--font-serif: 'Strom Serif', Georgia, 'Times New Roman', serif; --font-sans: 'Instrument Sans', -apple-system, 'Segoe UI', sans-serif;";

/** The page's content rules (`.pp-*`), for the window and the file alike. */
export const PERSON_PAGE_CSS = `
.pp { flex: 1 1 auto; min-width: 0; max-width: 680px; display: flex; flex-direction: column; gap: 32px; color: var(--text); font-family: var(--font-sans); font-size: 15px; line-height: 1.5; }
.pp *, .pp *::before, .pp *::after { box-sizing: border-box; }
.pp > section { border-top: 1px solid var(--divider); padding-top: 22px; scroll-margin-top: 8px; }
.pp h1, .pp h2, .pp h3 { margin: 0; font-family: var(--font-serif); font-weight: 600; color: var(--text); }
.pp h2 { font-size: 18px; line-height: 1.3; }
.pp p { margin: 0; }
.pp a { color: var(--primary); }
.pp .pn-note { font-size: 0.5em; font-weight: 400; color: var(--text-faint); white-space: nowrap; font-family: var(--font-sans); }
/* Above .pp h2: a kicker or a story title may be an h2. */
.pp .pp-eyebrow, .pp .pp-kicker { font-family: var(--font-sans); font-size: 11.5px; line-height: 1.4; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); }
.pp-hero { display: flex; gap: 18px; align-items: flex-start; }
/* The portrait (§3.1): a rounded square, a click shows it large; without a photo the initials. */
.pp-portrait { position: relative; flex: 0 0 auto; display: block; width: 128px; height: 128px; padding: 0; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background-color: var(--surface-2); cursor: zoom-in; }
span.pp-portrait { cursor: default; }
.pp-portrait .pp-photo { display: block; width: 100%; height: 100%; object-fit: cover; background-size: cover; background-position: center; background-repeat: no-repeat; }
.pp-portrait-zoom { position: absolute; right: 6px; bottom: 6px; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: rgba(255, 253, 248, 0.92); color: #2b2822; font-size: 13px; line-height: 1; }
.pp-initials { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 84px; height: 84px; border-radius: 50%; background: var(--surface-2); color: var(--text-light); font-family: var(--font-serif); font-size: 30px; }
.pp-initials--small { width: 64px; height: 64px; font-size: 23px; }
.pp-living-note { margin-top: 6px; font-size: 14px; color: var(--text-light); }
/* Images of the file: a box painted by the image's class (each image is embedded once). */
.pp-img { display: block; background-repeat: no-repeat; background-position: center; background-size: cover; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pp-hero-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pp-name { font-size: clamp(26px, 4.8cqi, 36px); line-height: 1.15; overflow-wrap: anywhere; text-wrap: balance; }
.pp-aka { font-size: 13.5px; color: var(--text-faint); overflow-wrap: anywhere; }
.pp-facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 6px 0 0; font-size: 15px; }
.pp-facts dt { color: var(--text-light); }
.pp-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.pp-differs { display: inline-block; margin-left: 6px; padding: 0 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--accent-text); font: inherit; font-size: 12px; line-height: 20px; text-decoration: none; cursor: pointer; white-space: nowrap; }
.pp-link { display: inline; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; text-decoration: underline dotted; text-underline-offset: 3px; cursor: pointer; }
a.pp-link { color: inherit; }
.pp-pdf-name { font-size: 14.5px; font-weight: 600; color: var(--primary); text-align: left; overflow-wrap: anywhere; }
.pp .pp-pdf-name.pp-link { color: var(--primary); text-decoration: none; }
span.pp-pdf-name { color: var(--text); }
.pp-sec-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-bottom: 14px; }
.pp { --pp-bg: var(--surface); }
.pp-body .pp { --pp-bg: var(--surface-modal); }
/* In brief (§0.3): under the header, 3 or 4 cells. */
.pp-sum { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin-top: -8px; background: var(--divider); border: 1px solid var(--divider); border-radius: 12px; overflow: hidden; }
.pp-sum--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pp-sum-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 12px 14px; background: var(--surface); }
.pp-sum-big { font-family: var(--font-serif); font-size: 21px; font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
.pp-sum-lab { font-size: 12.5px; line-height: 1.35; color: var(--text-light); overflow-wrap: anywhere; }
/* The open question (§0.4). */
.pp > section.pp-sec--question { border-top: 0; padding-top: 0; }
.pp-question { padding: 16px 18px; border: 1px dashed var(--border); border-radius: 12px; }
.pp-question-text { margin-top: 6px; font-family: var(--font-serif); font-size: 17px; line-height: 1.55; white-space: pre-line; overflow-wrap: anywhere; }
/* People around (§0.5). */
.pp-people { display: flex; flex-direction: column; gap: 10px; margin: 12px 0 0; }
.pp-people-row { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 2px 16px; }
.pp-people dt { padding-top: 2px; font-size: 13.5px; color: var(--text-light); }
.pp-people dd { margin: 0; min-width: 0; }
.pp-people ul { display: block; margin: 0; padding: 0; list-style: none; font-size: 15px; line-height: 1.55; overflow-wrap: anywhere; }
.pp-people li { display: inline; }
.pp-people-sep { color: var(--text-faint); }
.pp-people-note, .pp-people-more { font-size: 13.5px; color: var(--text-light); }
/* The family tree (§4): absolute cards and 1 px lines on a 680 px column (in %), the rail when narrow. */
.pp-fam { display: flex; flex-direction: column; gap: 0; margin-top: 12px; }
.pp-ft { position: relative; width: 100%; container: pp-ft / inline-size; }
.pp-ft-h, .pp-ft-v { position: absolute; border: 0 solid var(--border); }
.pp-ft-h { height: 0; border-top-width: 1px; }
.pp-ft-v { width: 0; border-left-width: 1px; }
.pp-ft-dash { border-style: dashed; }
.pp-ft-lab { position: absolute; z-index: 1; display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); font-size: 12px; line-height: 17px; color: var(--text-light); white-space: nowrap; }
.pp-ft-lab > * { padding: 0 4px; background: var(--pp-bg); }
.pp-ft-story { padding: 0; border: 0; background: none; color: var(--primary); font: inherit; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; }
.pp-ft-lab > .pp-ft-story { background: var(--pp-bg); padding: 0 4px; }
.pp-ft-lab > * { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
/* "story ↓", only "↓" where the gap between the cards (115/680 of the tree) is under 84 px (round 3 §4.1). */
.pp-ft-story-s { display: none; }
@container pp-ft (max-width: 496px) { .pp-ft-story-l { display: none; } .pp-ft-story-s { display: inline; } }
.pp-rail-story { white-space: nowrap; }
.pp-ft-nokids { color: var(--text-faint); }
.pp-ft-card { display: flex; flex-direction: column; justify-content: center; min-width: 0; margin: 0; padding: 4px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; text-align: left; text-decoration: none; overflow: hidden; }
.pp-ft .pp-ft-card { position: absolute; z-index: 2; }
button.pp-ft-card, a.pp-ft-card { cursor: pointer; }
.pp-ft-name { font-size: 13.5px; font-weight: 600; line-height: 1.25; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pp-ft-link .pp-ft-name { color: var(--primary); }
.pp-ft-years, .pp-ft-rel { font-size: 12px; line-height: 1.3; color: var(--text-light); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pp-ft-rel { color: var(--accent-text); }
.pp-ft-card--me { border-color: var(--primary); background: var(--primary-soft); }
.pp-ft-card--living { border-style: dashed; }
.pp-rail { display: none; flex-direction: column; gap: 8px; }
.pp-rail-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.pp-rail-card { min-height: 50px; }
.pp-rail-stem { display: block; width: 0; height: 12px; margin: -4px 0 -4px 50%; border-left: 1px solid var(--border); }
.pp-rail-u { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 0 24px; padding-left: 14px; border-left: 1px solid var(--border); }
.pp-rail-side, .pp-rail-kids { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pp-rail-lab { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 13px; color: var(--text-light); overflow-wrap: anywhere; }
/* 3 unions and more, wider than 640 px (§4.2, round 2): the upright tree with each union's block as a grid,
   the label and partner on the left, the children in 3 columns on the right; the parents in a 4-column grid
   (the narrow rules below put it back into one column). */
.pp-rail--wide { display: flex; }
.pp-rail--wide .pp-rail-parents { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.pp-rail--wide .pp-rail-stem { margin-left: 24px; }
.pp-rail--wide .pp-rail-u { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 8px 14px; align-items: start; padding-left: 16px; }
.pp-rail--wide .pp-rail-kidgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pp-ft-more { display: flex; flex-direction: column; margin-top: 14px; }
.pp-ft-row--open { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 48px; }
.pp-ft-row-h { font-size: 13.5px; font-weight: 600; color: var(--text-light); }
.pp-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0 6px; }
.pp-chip { display: inline-flex; align-items: baseline; gap: 4px; min-height: 30px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: inherit; font: inherit; font-size: 13px; text-decoration: none; }
button.pp-chip, a.pp-chip { cursor: pointer; }
.pp-chip-name { font-weight: 600; }
.pp-chip-link .pp-chip-name { color: var(--primary); }
.pp-chip-years { font-size: 12px; color: var(--text-light); }
.pp-chip--living { border-style: dashed; }
.pp-coll > .pp-disc, .pp-coll > summary { list-style: none; cursor: pointer; }
.pp-coll > summary::-webkit-details-marker, .pp-dtx > summary::-webkit-details-marker, .pp-quote > summary::-webkit-details-marker { display: none; }
.pp-disc { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 48px; padding: 6px 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; }
.pp-disc--inline { display: inline-flex; width: auto; min-height: 32px; color: var(--primary); font-weight: 600; font-size: 13.5px; }
.pp-fold-state { margin-left: auto; font-family: var(--font-sans); font-weight: 400; font-size: 13px; color: var(--text-faint); white-space: nowrap; }
.pp-fold-state .pp-st-open, .pp-coll[open] > summary .pp-st-closed, .pp-disc[aria-expanded="true"] .pp-st-closed { display: none; }
.pp-coll[open] > summary .pp-st-open, .pp-disc[aria-expanded="true"] .pp-st-open { display: inline; }
.pp-count { font-size: 13.5px; color: var(--text-faint); font-weight: 400; font-family: var(--font-sans); }
.pp-peek { display: block; margin-top: 2px; font-family: var(--font-sans); font-size: 13.5px; font-weight: 400; line-height: 1.45; color: var(--text-light); overflow-wrap: anywhere; }
.pp-coll[open] > summary .pp-peek, .pp-coll:has(> .pp-fold-h > .pp-disc[aria-expanded="true"]) > .pp-peek { display: none; }
/* In the file the peek sits inside the summary: the heading keeps the full row, the peek wraps below it. */
.pp-coll > summary.pp-disc { flex-wrap: wrap; }
.pp-coll > summary > .pp-fold-h { display: flex; flex: 1 1 auto; min-width: 0; }
.pp-coll > summary > .pp-peek { flex: 0 0 100%; margin-top: -4px; }
.pp-sum-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; flex: 1 1 auto; min-width: 0; }
.pp .pp-draft-tag { display: inline-block; font-family: var(--font-sans); font-weight: 500; margin-left: 8px; padding: 0 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-light); font-size: 11px; line-height: 18px; letter-spacing: 0; text-transform: none; vertical-align: 1px; }
.pp .pp-story-title { font-size: clamp(21px, 3.6cqi, 26px); line-height: 1.25; margin: 6px 0 12px; overflow-wrap: anywhere; hyphens: auto; }
/* A couple's story under the person's own (Partnership.story). */
.pp .pp-couple-story { margin-top: 24px; }
.pp .pp-story-kicker + .pp-couple-story { margin-top: 4px; }
.pp .pp-couple-story-title { font-size: clamp(18px, 3cqi, 21px); line-height: 1.3; margin: 0 0 10px; overflow-wrap: anywhere; hyphens: manual; }
.pp-prose { font-family: var(--font-serif); font-size: clamp(16px, 2.5cqi, 17.5px); line-height: 1.65; overflow-wrap: anywhere; }
.pp-prose p, .pp-prose ul { margin: 0 0 0.9em; }
.pp-prose .story-subhead { font-size: 1.05em; margin: 1.1em 0 0.4em; }
.pp-basis { margin-top: 10px; }
.pp-basis-body { padding: 10px 14px; border-radius: 8px; background: var(--surface-2); font-size: 13.5px; }
.pp-basis-body ul { margin: 0 0 6px; padding-left: 18px; }
.pp-basis-note { font-style: italic; }
.pp-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--text-faint); margin-left: 4px; white-space: nowrap; }
.pp-notes-text { margin-top: 8px; font-size: 15px; white-space: pre-line; overflow-wrap: anywhere; }
.pp-toggles { display: flex; flex-wrap: wrap; gap: 8px; }
.pp-toggle { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 12px; border: 1.5px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-size: 13.5px; white-space: nowrap; cursor: pointer; }
.pp-toggle::before { content: ''; width: 14px; height: 14px; border: 1.5px solid var(--border); border-radius: 3px; background: var(--surface); }
.pp-toggle[aria-checked="true"] { border-color: var(--primary); background: color-mix(in oklab, var(--primary) 12%, var(--surface)); }
.pp-toggle[aria-checked="true"]::before { content: '\\2713'; display: flex; align-items: center; justify-content: center; border-color: var(--primary); background: var(--primary); color: var(--on-primary); font-size: 11px; line-height: 1; }
.pp-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: -4px 0 14px; font-size: 12.5px; color: var(--text-faint); }
.pp-legend .pp-hm { margin-right: 4px; }
.pp-seg { display: flex; flex-direction: column; }
.pp-seg + .pp-seg { margin-top: 14px; }
.pp-seg-title { padding: 0 0 6px 82px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); }
.pp-seg-years { margin-left: 8px; color: var(--text-faint); font-weight: 400; letter-spacing: 0; white-space: nowrap; }
/* Every year (own, children's, history, a span) ends at the marker and sits on the first line of its text. */
.pp-row { display: grid; grid-template-columns: 46px 28px minmax(0, 1fr); column-gap: 8px; align-items: baseline; }
.pp-y { min-width: 0; padding: 6px 0; text-align: right; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: normal; }
.pp-m { align-self: stretch; display: flex; justify-content: center; align-items: flex-start; padding-top: 6px; background: linear-gradient(var(--divider), var(--divider)) center / 2px 100% no-repeat; }
.pp-mk { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--surface); color: var(--primary); font-size: 18px; line-height: 1; }
.pp-t { min-width: 0; padding: 6px 0 10px; font-size: 15.5px; overflow-wrap: anywhere; }
.pp-place { color: var(--text-light); }
.pp-dt { display: block; margin-top: 2px; font-size: 13.5px; color: var(--text-light); overflow-wrap: anywhere; }
.pp-dtx > summary { display: block; list-style: none; cursor: pointer; }
.pp-dtx .pp-dt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pp-dtx[open] .pp-dt { display: block; overflow: visible; }
.pp-more { font-size: 13px; font-weight: 600; color: var(--primary); white-space: nowrap; }
.pp-dtx[open] .pp-more { display: none; }
.pp-row--hist .pp-y { font-size: 13px; font-weight: 400; color: var(--text-faint); }
.pp-row--hist .pp-mk { font-size: 13px; color: var(--hist-mark); }
.pp-row--hist .pp-mk.pp-hm--place, .pp-hm--place { color: var(--hist-place); }
.pp-row--hist .pp-mk.pp-hm--local, .pp-hm--local { color: var(--hist-local); }
.pp-hm--region { color: var(--hist-mark); }
.pp-hist { padding: 8px 12px; border-radius: 8px; background: var(--hist-bg); font-size: 14.5px; }
.pp-hist-meta { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 4px; font-size: 12px; color: var(--text-faint); }
.pp-hist-kind { text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.pp-hist-meta a { color: inherit; }
.pp-quote > summary { display: inline; cursor: pointer; color: var(--primary); font-weight: 600; list-style: none; }
.pp-quote[open] { flex-basis: 100%; }
.pp-quote blockquote { margin: 4px 0 0; font-family: var(--font-serif); font-style: italic; font-size: 14px; color: var(--text-light); }
.pp-row--kid .pp-y { font-size: 13px; font-weight: 400; color: var(--text-light); }
.pp-row--kid .pp-mk { font-size: 15px; color: var(--text-faint); }
.pp-row--kid .pp-t { font-size: 14px; color: var(--text-light); }
.pp-no-history .pp-row--hist, .pp-no-history .pp-legend, .pp-no-kids .pp-row--kid { display: none; }
.pp-no-kids .pp-seg:not(.pp-seg--own):not(.pp-seg--hist), .pp-no-history .pp-seg:not(.pp-seg--own):not(.pp-seg--kid),
.pp-no-history.pp-no-kids .pp-seg:not(.pp-seg--own) { display: none; }
.pp-fig { display: grid; grid-template-columns: minmax(0, 1fr); margin: 10px 0 4px; max-width: 460px; }
.pp-fig img { grid-area: 1 / 1; display: block; width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
.pp-fig figcaption { grid-row: 2; margin-top: 4px; font-size: 12.5px; color: var(--text-light); overflow-wrap: anywhere; }
.pp-zoom { grid-area: 1 / 1; align-self: end; justify-self: end; margin: 6px; width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 15px; line-height: 1; cursor: pointer; }
.pp-fig-link { grid-area: 1 / 1; display: grid; grid-template-columns: minmax(0, 1fr); color: inherit; text-decoration: none; cursor: zoom-in; }
.pp-fig-link > .pp-img, .pp-fig > .pp-img { grid-area: 1 / 1; }
.pp-fig-link .pp-zoom { display: flex; align-items: center; justify-content: center; }
.pp-fig .pp-fig-img { width: 100%; aspect-ratio: var(--pp-ar, 4 / 3); background-size: contain; background-color: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; }
/* Images and documents (§3.2): one gallery, 6 at once, the PDFs as rows under it. */
.pp-gal { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 12px; }
.pp-gal-item { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 0; }
.pp-gal-thumb { display: block; width: 100%; aspect-ratio: 4 / 3; padding: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background-color: var(--surface-2); cursor: zoom-in; }
span.pp-gal-thumb { cursor: default; }
.pp-gal-img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pp-gal-item figcaption { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.pp-gal-kind { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-text); }
.pp-gal-cap { font-size: 13.5px; line-height: 1.35; overflow-wrap: anywhere; }
.pp-gal-sub { font-size: 12px; line-height: 1.35; color: var(--text-light); overflow-wrap: anywhere; }
.pp-gal-more { margin-top: 6px; }
.pp-gal-more .pp-fold-body > .pp-gal { margin-top: 6px; }
.pp-sec-head .pp-gal-open { margin-top: 0; }
.pp-pdfs { display: flex; flex-direction: column; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
.pp-pdf { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.pp-pdf-ic { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 34px; height: 40px; border-radius: 4px; background: var(--surface-2); color: var(--accent-text); font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; }
.pp-pdf-main { display: flex; flex-direction: column; min-width: 0; }
.pp-pdf-meta { font-size: 12px; color: var(--text-light); }
/* The file's light box (§3.4): :target shows it over the page, anchors move between images. */
.pp-lb { display: none; }
.pp-lb:target { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; background: #1c1a15; color: #e8e3d6; }
.pp-lb-top, .pp-lb-foot { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 12px; font-size: 14px; }
.pp-lb a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 10px; color: #e8e3d6; text-decoration: none; }
.pp-lb .pp-lb-img { flex: 1 1 auto; min-height: 0; margin: 0 12px; background-size: contain; }
.pp-lb-cap { min-width: 0; color: #c9c2b0; overflow-wrap: anywhere; }
.pp-lb-navs { flex: 0 0 auto; display: flex; gap: 4px; }
.pp-act { display: inline-block; margin-top: 8px; padding: 0; border: 0; background: none; color: var(--primary); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
.pp-src-intro { margin: 4px 0 12px; font-size: 14px; color: var(--text-light); }
.pp-src-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.pp-src { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 0 14px; }
.pp-src .pp-disc { min-height: 48px; flex-wrap: nowrap; align-items: flex-start; padding: 10px 0; }
.pp-src-lines { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pp-src-title { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.pp-src-sup { font-size: 13.5px; color: var(--text-light); overflow-wrap: anywhere; }
.pp-src-ref { font-size: 12.5px; color: var(--text-faint); overflow-wrap: anywhere; }
.pp-src-body { padding: 0 0 12px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.pp-transcript { font-family: var(--font-serif); font-size: 15px; white-space: pre-line; overflow-wrap: anywhere; }
.pp-research-intro { display: block; font-size: 14px; color: var(--text-light); }
.pp-rgroup { margin-top: 14px; }
.pp-rgroup ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.pp-rgroup li { overflow-wrap: anywhere; }
.pp-ids li { list-style: none; margin-left: -18px; display: flex; gap: 10px; }
.pp-ids code { flex: 0 0 auto; min-width: 52px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text-faint); }
.pp-foot { font-size: 12.5px; color: var(--text-faint); border-top: 1px solid var(--divider); padding-top: 14px; }
/* Narrow page (a phone, a window under 641 px): the window's body and the file's column are containers. */
@container (max-width: 640px) {
  .pp-hero--photo { flex-direction: column; }
  .pp-portrait { width: 96px; height: 96px; }
  .pp-initials { width: 64px; height: 64px; font-size: 23px; }
  .pp-initials--small { width: 52px; height: 52px; font-size: 19px; }
  .pp-sum, .pp-sum--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pp-sum--3 .pp-sum-cell:last-child { grid-column: span 2; }
  .pp-people-row { grid-template-columns: minmax(0, 1fr); }
  .pp-gal { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pp-ft { display: none; }
  .pp-rail { display: flex; }
  .pp-rail--wide .pp-rail-parents, .pp-rail--wide .pp-rail-kidgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pp-rail--wide .pp-rail-stem { margin-left: 50%; }
  .pp-rail--wide .pp-rail-u { display: flex; padding-left: 14px; }
}
@media (hover: hover) {
  .pp-portrait-zoom { opacity: 0; transition: opacity 0.15s; }
  .pp-portrait:hover .pp-portrait-zoom, .pp-portrait:focus-visible .pp-portrait-zoom { opacity: 1; }
  button.pp-ft-card:hover, a.pp-ft-card:hover, .pp-chip-link:hover, .pp-pdf:hover { background: var(--hover-bg); }
  .pp-gal-thumb:hover { border-color: var(--primary); }
  .pp-ft-story:hover { text-decoration: underline; }
  .pp-src > .pp-disc:hover, .pp-src > summary:hover { background: var(--hover-bg); }
  .pp-toggle:hover { border-color: var(--primary); }
  .pp-link:hover, .pp-act:hover { text-decoration-style: solid; }
}
@media (pointer: coarse) {
  .pp-toggle, .pp-disc--inline, .pp-chip { min-height: 44px; }
  .pp-chip { align-items: center; }
  .pp-ft-story { min-height: 32px; }
  .pp-zoom { width: 44px; height: 44px; }
}
@media (max-width: 640px) {
  .pp-hero--photo { flex-direction: column; }
  .pp-portrait { width: 96px; height: 96px; }
  .pp-initials { width: 64px; height: 64px; font-size: 23px; }
  .pp-initials--small { width: 52px; height: 52px; font-size: 19px; }
  .pp-sum, .pp-sum--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pp-sum--3 .pp-sum-cell:last-child { grid-column: span 2; }
  .pp-people-row { grid-template-columns: minmax(0, 1fr); }
  .pp-gal { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pp-ft { display: none; }
  .pp-rail { display: flex; }
  .pp-rail--wide .pp-rail-parents, .pp-rail--wide .pp-rail-kidgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pp-rail--wide .pp-rail-stem { margin-left: 50%; }
  .pp-rail--wide .pp-rail-u { display: flex; padding-left: 14px; }
  .pp { gap: 26px; }
  .pp-hero { gap: 14px; }
  .pp-fig { max-width: 100%; }
}
@media (min-width: 641px) and (max-width: 1024px) {
  .pp-fig { max-width: 460px; }
}
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
  .pp { gap: 24px; }
  .pp-portrait { width: 80px; height: 80px; }
  .pp-initials { width: 56px; height: 56px; font-size: 20px; }
}
@media print {
  body.printing-person-page > :not(.modal-overlay--page) { display: none !important; }
  .pp, .pp-body { ${PERSON_PAGE_LIGHT_TOKENS} }
  .pp-head, .pp-toc, .pp-toggles, .pp-zoom, .pp-fold-state, .pp-differs, .pp-act, .pp-more, .pp-lb, .pp-portrait-zoom, .js-only { display: none !important; }
  /* Print: the desktop tree, every image and relative (the folds open). */
  .pp-ft { display: block !important; }
  .pp-rail:not(.pp-rail--wide) { display: none !important; }
  .pp-rail--wide { display: flex !important; }
  .pp-rail-u { break-inside: avoid; }
  .pp-gal-more .pp-fold-body, #pp-sibs .pp-fold-body, #pp-grand .pp-fold-body { display: block !important; }
  .pp-gal-more > .pp-disc { display: none !important; }
  .pp-gal { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pp-gal-item, .pp-ft, .pp-sum, .pp-question, .pp-people-row { break-inside: avoid; }
  .pp-ft-card--me { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pp-body { overflow: visible !important; height: auto !important; }
  .pp { font-size: 11pt; gap: 18pt; max-width: none; }
  .pp-aka, .pp-dt, .pp-hist-meta, .pp-src-sup, .pp-src-ref, .pp-foot, .pp-fig figcaption { font-size: 10pt; }
  #pp-sec-timeline { break-before: page; }
  .pp-ft-link .pp-ft-name, .pp-chip-link .pp-chip-name { color: var(--text); }
  .pp-row, .pp-fig, .pp-src { break-inside: avoid; }
  .pp-fig { max-width: 100%; }
  .pp-dtx .pp-dt { display: block; overflow: visible; }
  #pp-sec-sources .pp-fold-body { display: block !important; }
  #pp-sec-sources .pp-src-list { list-style: decimal; padding-left: 20pt; gap: 4pt; }
  #pp-sec-sources .pp-src { display: list-item; border: 0; padding: 0; }
  #pp-sec-sources .pp-src-body, #pp-sec-sources .pp-src-intro, #pp-sec-sources .pp-peek { display: none !important; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 8pt; }
}
/* ── A couple's story as a chapter (spec 027 §5.2, §6.1) ──
   The kicker with the years, the title; after the person's own story it
   folds to its first paragraph ("Read all ▾"). From two chapters on the page
   (own + marriages) a tinted surface (--card-bg-2) and a double monogram;
   a single chapter has neither. Print: everything unfolded, the tinted
   surface a thin frame. */
.pp .pp-couple-story { margin-top: 20px; scroll-margin-top: 16px; outline: none; }
.pp .pp-couple-story--tint { padding: 20px 22px; border-radius: 14px; background: var(--card-bg-2); }
.pp .pp-story-kicker + .pp-couple-story, .pp .pp-story-title + .pp-couple-story { margin-top: 8px; }
.pp .pp-couple-story:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.pp-ch-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.pp-ch-headtext { min-width: 0; }
.pp-ch-mono { display: inline-flex; flex-shrink: 0; }
.pp-ch-mono > span { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--card-bg-2); background: var(--surface); color: var(--accent-text); font-family: var(--font-sans); font-size: 12px; font-weight: 600; line-height: 1; }
.pp-ch-mono > span + span { margin-left: -9px; }
.pp .pp-ch-kicker { margin: 0; }
.pp-ch-pair { margin: 1px 0 0; font-family: var(--font-sans); font-size: 13px; color: var(--text-light); overflow-wrap: anywhere; }
.pp .pp-ch-title { font-family: var(--font-serif); font-size: 22px; font-weight: 600; line-height: 1.3; margin: 0 0 10px; overflow-wrap: anywhere; hyphens: manual; }
.pp-ch-rest[hidden] { display: none; }
.pp .pp-ch-more { display: inline; padding: 0; border: 0; background: none; font: inherit; font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--primary); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; list-style: none; }
.pp-ch-more::-webkit-details-marker { display: none; }
.pp-ch-more .pp-st-open, .pp-ch-more[aria-expanded="true"] .pp-st-closed, .pp-ch-fold[open] > summary .pp-st-closed { display: none; }
.pp-ch-more[aria-expanded="true"] .pp-st-open, .pp-ch-fold[open] > summary .pp-st-open { display: inline; }
.pp-ch-fold > summary { margin: 0 0 0.9em; }
.pp-ch-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; margin: 10px 0 0; font-family: var(--font-sans); font-size: 13px; color: var(--text-faint); }
.pp-ch-also { flex: 1 1 auto; min-width: 0; }
.pp-story-cont { margin: 14px 0 0; font-family: var(--font-sans); font-size: 14px; color: var(--text-light); }
.pp-story-cont > span { margin-right: 4px; }
.pp-story-jump { margin-right: 10px; color: var(--primary); }
a.pp-story-jump { text-decoration: underline; text-underline-offset: 3px; }
@media (hover: hover) {
  .pp .pp-ch-more:hover { text-decoration-thickness: 2px; }
}
@media (pointer: coarse) {
  .pp .pp-ch-more, .pp-story-jump { display: inline-flex; align-items: center; min-height: 44px; }
}
@media (max-width: 640px), (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
  .pp .pp-couple-story--tint { padding: 16px; }
  .pp .pp-ch-title { font-size: 20px; }
}
@media print {
  .pp .pp-couple-story { break-inside: auto; }
  .pp .pp-couple-story--tint { background: transparent; border: 1px solid var(--border); }
  .pp-ch-rest[hidden] { display: block !important; }
  .pp-ch-more, .pp-story-cont { display: none !important; }
  details.pp-ch-fold { display: block; }
  details.pp-ch-fold > * { display: block; }
  details.pp-ch-fold > summary { display: none !important; }
  details.pp-ch-fold::details-content { content-visibility: visible; display: contents; }
}
` + PERSON_PAGE_VIZ_CSS;

/** The saved file's own frame (paper look, centred column) and the no-JS rules. */
const FILE_FRAME_CSS = `
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--surface); color: var(--text); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
.pp-file { max-width: 760px; margin: 0 auto; padding: clamp(20px, 5vw, 44px) clamp(16px, 4vw, 40px) 56px; container-type: inline-size; }
html.no-js .js-only { display: none !important; }
html.no-js .pp-fig { max-width: 100%; }
`;

/**
 * The whole <style> content of the saved file: the embedded font faces (as the
 * app supplies them; empty = the fallback fonts), the light tokens on :root
 * (no prefers-color-scheme: the file is always "paper"), the frame and the page.
 */
export function personPageFileCss(fontCss = ''): string {
    // A font face never ends the <style> element early.
    const fonts = fontCss.replace(/<\//g, '<\\/');
    return `${fonts}\n:root { ${PERSON_PAGE_LIGHT_TOKENS} ${PERSON_PAGE_VIZ_LIGHT_TOKENS} ${FONT_STACKS} color-scheme: light; }\n${FILE_FRAME_CSS}${PERSON_PAGE_CSS}`;
}

/**
 * The saved file's script (inline, no libraries): the History / Children's
 * events switches, history excerpts closed on load (open without JS), the
 * :target light boxes made nicer (closing goes back where it was opened,
 * ‹ › replace the history entry, Esc and the arrow keys), "sources differ"
 * opening the researchers' section, and the folds open for printing.
 */
export const PERSON_PAGE_SCRIPT = `(function(){var d=document,a=d.querySelector('article.pp');if(!a)return;
var q=function(s){return Array.prototype.slice.call(d.querySelectorAll(s))};
q('details.pp-quote[open]').forEach(function(e){e.open=false});
q('[data-pp-switch]').forEach(function(b){b.addEventListener('click',function(){var on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',on?'true':'false');a.classList.toggle(b.getAttribute('data-pp-switch')==='history'?'pp-no-history':'pp-no-kids',!on)})});
var r=d.getElementById('pp-research');q('a.pp-differs').forEach(function(l){l.addEventListener('click',function(){if(r)r.open=true})});
var opened=false;
d.addEventListener('click',function(e){var l=e.target.closest?e.target.closest('a[href^="#obr-"]'):null;if(!l)return;if(l.hasAttribute('data-pp-lb')){e.preventDefault();location.replace(l.getAttribute('href'));return}opened=true});
q('a[data-pp-lb="close"]').forEach(function(c){c.addEventListener('click',function(e){if(opened){e.preventDefault();opened=false;history.back()}})});
d.addEventListener('keydown',function(e){var h=location.hash,t=h.indexOf('#obr-')===0?d.getElementById(h.slice(1)):null;if(!t)return;var k=e.key==='Escape'?'close':e.key==='ArrowLeft'?'prev':e.key==='ArrowRight'?'next':'';var l=k?t.querySelector('[data-pp-lb="'+k+'"]'):null;if(l){e.preventDefault();l.click()}});
var folds=q('#pp-sources-fold, details.pp-gal-more, details.pp-sibs, details.pp-grand'),was=[];
window.addEventListener('beforeprint',function(){was=folds.map(function(f){var o=f.open;f.open=true;return o})});
window.addEventListener('afterprint',function(){folds.forEach(function(f,i){f.open=!!was[i]})});
})();`;

/**
 * The saved file's script for the couples' chapters (spec 027 §6.1): a link
 * to a chapter opens its fold before the jump; printing opens every fold
 * (and closes them again afterwards).
 */
export const PERSON_PAGE_STORY_SCRIPT = `(function(){var d=document;
var q=function(s){return Array.prototype.slice.call(d.querySelectorAll(s))};
q('a[data-pp-story]').forEach(function(l){l.addEventListener('click',function(){var c=d.getElementById(l.getAttribute('data-pp-story'));var f=c&&c.querySelector('details.pp-ch-fold');if(f)f.open=true})});
var shut=[];
window.addEventListener('beforeprint',function(){shut=q('details.pp-ch-fold:not([open])');shut.forEach(function(f){f.open=true})});
window.addEventListener('afterprint',function(){shut.forEach(function(f){f.open=false});shut=[]});
})();`;
