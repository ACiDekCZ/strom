/**
 * The family book's typesetting (1031 §5.1, §5.2, §5.11): A4, Source Serif
 * ('Strom Serif'), the running head of each lineage as a named page, the page
 * number in the footer, the breaks. The book window is always light.
 */

import { PERSON_PAGE_CHART_CSS, PERSON_PAGE_VIZ_LIGHT_TOKENS } from './person-page-viz-css.js';
import { STORY_COMPARE_CSS } from './story-compare.js';

/** A text as a CSS string literal: quotes, backslashes and line breaks escaped ("Rod O\"Brien"). */
export function cssString(text: string): string {
    return '"' + text.replace(/[\\"]/g, m => '\\' + m).replace(/[\n\r\f]/g, ' ').replace(/[<>]/g, m => '\\' + m.charCodeAt(0).toString(16) + ' ') + '"';
}

/** The named pages of the lineages: `@page rod-N { @top-left { content: "Rod Fíšek" } }`. */
export function rodPagesCss(heads: readonly string[]): string {
    return heads.map((h, i) => `.rod-${i + 1} { page: rod-${i + 1}; }\n@page rod-${i + 1} { @top-left { content: ${cssString(h)}; font: italic 9pt 'Strom Serif', Georgia, serif; color: #5c5546; } }`).join('\n');
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const BOOK_CSS = `
:root { ${PERSON_PAGE_VIZ_LIGHT_TOKENS} --text: #1f1c17; --text-light: #4a4438; --text-faint: #5c5546; --accent: #8a5528; --accent-text: #8a5528;
    --primary: #3f6b4f; --divider: #e3dccd; --pp-bg: #fffdf8; --hover-bg: #f3eee2; color-scheme: light; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: #f1ece2; color: #1f1c17; font: 12pt/1.5 'Strom Serif', Georgia, 'Times New Roman', serif; font-kerning: normal; }
.book { max-width: 210mm; margin: 0 auto; }
.book-sheet { background: #fffdf8; padding: 20mm 22mm 22mm; }
@media screen { .book-sheet { margin: 24px auto; box-shadow: 0 2px 14px rgba(0,0,0,.12); } }
h1, h2, h3, h4 { font-weight: 600; margin: 0; line-height: 1.2; }
p { margin: 0 0 .6em; orphans: 3; widows: 3; }
a { color: inherit; }
.book-rule { width: 15mm; height: 0; border: 0; border-top: 1px solid #8a5528; margin: 14px 0; }
.book-sub { font-size: 10pt; font-variant: small-caps; letter-spacing: .08em; color: #8a5528; font-weight: 600; text-transform: lowercase; margin: 16px 0 6px; }
.book-muted { color: #5c5546; }
.book-p { color: #8a5528; font-size: 8.5pt; font-family: ${SANS}; font-weight: 600; margin-left: 1px; vertical-align: super; line-height: 0; }

/* Title page and contents */
.book-front { page: front; }
.book-title-page { min-height: 230mm; display: flex; flex-direction: column; justify-content: center; }
.book-title-page h1 { font-size: 34pt; font-weight: 600; letter-spacing: .01em; }
.book-title-sub { font-size: 15pt; color: #4a4438; margin-top: 6px; }
.book-title-meta { font-size: 10pt; color: #5c5546; line-height: 1.8; }
.book-toc h2 { font-size: 22.5pt; margin-bottom: 14px; }
.book-toc ol { list-style: none; margin: 0; padding: 0; }
.book-toc li { break-inside: avoid; }
.book-toc-rod { font-weight: 600; margin-top: 10px; }
.book-toc-rod .book-muted { font-weight: 400; }
.book-toc-fam { font-size: 11pt; line-height: 1.55; }
.book-toc-fam a, .book-toc-rod a { text-decoration: none; }
.book-toc-no { display: inline-block; min-width: 2.2em; color: #8a5528; font-variant-numeric: tabular-nums; }
.book-toc-sub { font-size: 10.5pt; color: #4a4438; }

/* A lineage */
.book-rod { break-before: page; }
.book-kicker { font: 600 10pt ${SANS}; letter-spacing: .14em; text-transform: uppercase; color: #8a5528; }
.book-rod-name { font-size: 30pt; margin: 4px 0 0; }
.book-grid { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 4px 16px; margin: 0; }
.book-grid dt { color: #5c5546; font-size: 10.5pt; padding-top: 2px; }
.book-grid dd { margin: 0; }
.book-places { margin: 6px 0 0; }
.book-place { display: grid; grid-template-columns: 150px minmax(0, 1fr) 70px; gap: 12px; align-items: center; font-size: 10.5pt; break-inside: avoid; }
.book-place-axis { position: relative; height: 8px; border-bottom: 1px solid #e3dccd; }
.book-place-bar { position: absolute; top: 1px; height: 6px; border-radius: 3px; background: #8a5528; opacity: .7; min-width: 4px; }
.book-place-n { text-align: right; color: #5c5546; }
.book-place-years { font-size: 9pt; color: #5c5546; display: flex; justify-content: space-between; margin-left: 162px; margin-right: 82px; }
.book-maleline { margin-top: 12px; }
.book-maleline-gen { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 6px 0; break-inside: avoid; }
.book-maleline-card { font-size: 12.5px; line-height: 1.25; border: 1px solid #e3dccd; border-radius: 4px; padding: 3px 7px; background: #fbf8f1; text-align: center; }
.book-rod-lineage { margin-top: 18px; }
.book-rod-lineage.book-break { break-before: page; }
.book-rod-lineage h2 { font-size: 18pt; margin-bottom: 8px; }
.book-lineage-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) 64px; gap: 8px; font-size: 11pt; line-height: 1.45; padding: 2px 0; break-inside: avoid; }
.book-lineage-gen { color: #8a5528; font-variant: small-caps; font-weight: 600; text-align: right; }
.book-lineage-ref { text-align: right; color: #8a5528; font-size: 10pt; white-space: nowrap; }
.book-lineage-ref a { text-decoration: none; }
.book-lineage-text .is-family { font-weight: 600; }
.book-lineage-text .is-out { font-style: italic; color: #4a4438; }
.book-lineage-text .book-marr { display: block; color: #4a4438; font-size: 10.5pt; }
.book-lineage-text .book-young { color: #5c5546; font-size: 10.5pt; }

/* A family */
.book-family { margin-top: 26px; }
.book-family-head { break-inside: avoid; break-after: avoid; border-top: 1px solid #e3dccd; padding-top: 14px; }
.book-family-head h2 { font-size: 22.5pt; margin: 4px 0 2px; }
.book-family.is-sub .book-family-head h2 { font-size: 18pt; }
.book-family-line { color: #4a4438; }
.book-section { border-top: 1px solid #e3dccd; margin-top: 14px; padding-top: 4px; }
.book-person { margin-top: 12px; }
.book-person h3 { font-size: 15pt; }
.book-person h3 .book-years { font-weight: 400; color: #4a4438; }
.book-person h3 .book-from { font-weight: 400; font-size: 11pt; color: #5c5546; }
.book-person .book-grid { margin-top: 6px; }
.book-person-see { color: #4a4438; font-size: 11pt; }
.book-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
.book-mark { font: 10pt ${SANS}; color: #5c5546; margin-left: 6px; white-space: nowrap; }
.book-story { margin-top: 10px; text-align: justify; hyphens: auto; }
.book-story h4 { font-size: 12pt; margin: 8px 0 4px; }
.book-story h4 .book-story-title { font-weight: 400; font-style: italic; color: #4a4438; }
.book-story .story-subhead { font-size: 12pt; font-style: italic; margin: 10px 0 4px; break-after: avoid; }
.book-story ul { margin: 0 0 .6em 1.2em; padding: 0; }
.book-children { break-inside: avoid; }
.book-children ul { list-style: none; margin: 0; padding: 0; }
.book-child { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
.book-child-ref { color: #8a5528; font-size: 10.5pt; text-align: right; }
.book-child-ref a { text-decoration: none; }
.book-child-ref .is-out { color: #5c5546; font-style: italic; }
.book-chapter-sources { font-size: 10pt; color: #4a4438; }
.book-chapter-sources p { margin: 0 0 2px; }
.book-chapter-sources .book-pn { color: #8a5528; font-weight: 600; font-family: ${SANS}; font-size: 9pt; margin-right: 6px; }
.book-notes { font: 10pt/1.5 ${SANS}; color: #4a4438; margin-top: 8px; }
.book-notes p { margin: 0 0 4px; }
.book-research { font: 10pt/1.5 ${SANS}; color: #4a4438; margin-top: 8px; }
.book-research ul { margin: 0; padding-left: 1.1em; }
.book-chart { break-inside: avoid; margin: 10px 0; }
.book-clips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.book-clip { break-inside: avoid; margin: 8px 0; }
.book-clip img { display: block; max-width: 100%; max-height: 60mm; object-fit: contain; }
.book-clip figcaption { font-size: 9.5pt; color: #4a4438; margin-top: 3px; }
.book-photo { width: 34mm; float: right; margin: 0 0 6px 12px; border-radius: 4px; }
.book-couple-events .book-ce { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; font-size: 11pt; }

/* The person page's timeline rows, set for paper */
.pp-seg { margin-top: 6px; }
.pp-seg-title { font-size: 10pt; font-variant: small-caps; letter-spacing: .08em; color: #8a5528; text-transform: lowercase; font-weight: 600; margin: 10px 0 2px; break-after: avoid; }
.pp-seg-years { margin-left: 8px; color: #5c5546; font-variant: normal; letter-spacing: 0; font-weight: 400; }
.pp-row { display: grid; grid-template-columns: 62px 20px minmax(0, 1fr); gap: 4px; font-size: 11pt; line-height: 1.45; break-inside: avoid; }
.pp-y { font-weight: 600; font-variant-numeric: tabular-nums; }
.pp-y small { display: block; font-size: 8.5pt; font-weight: 400; }
.pp-yr { display: inline-flex; flex-direction: column; }
.pp-m { color: #8a5528; line-height: 1; padding-top: 3px; }
.pp-mk svg { width: 13px; height: 13px; }
.pp-dt { display: block; color: #4a4438; font-size: 10pt; }
.pp-place { color: #4a4438; }
.pp-row--hist { color: #6a5a3f; }
.pp-row--hist .pp-m { color: #6a5a3f; }
.pp-hist-text { margin: 0; font-size: 10.5pt; }
.pp-fig { margin: 6px 0; }
.pp-fig img { display: block; max-width: 100%; max-height: 60mm; object-fit: contain; }
.pp-fig figcaption { font-size: 9.5pt; color: #4a4438; }
.pp-link { all: unset; }
.pp-more-kids { color: #4a4438; }
${PERSON_PAGE_CHART_CSS}
.pp-chart { font-family: ${SANS}; }

/* Other families, sources, index */
.book-back { break-before: page; }
.book-back h2 { font-size: 22.5pt; margin-bottom: 12px; }
.book-small-rod { margin: 0 0 8px; font-size: 11pt; break-inside: avoid; }
.book-sources { font-size: 10pt; }
.book-sources.is-long { column-count: 2; column-gap: 8mm; }
.book-source { break-inside: avoid; margin: 0 0 6px; }
.book-source .book-pn { color: #8a5528; font-weight: 600; font-family: ${SANS}; font-size: 9pt; margin-right: 6px; }
.book-source-scan, .book-source-refs { display: block; color: #5c5546; }
.book-source-scan a { word-break: break-all; }
.book-index { column-count: 2; column-gap: 8mm; font-size: 10pt; line-height: 1.45; }
.book-index-letter { font-weight: 600; color: #8a5528; margin: 8px 0 2px; break-after: avoid; }
.book-index-row { display: flex; align-items: baseline; gap: 4px; break-inside: avoid; }
.book-index-name { min-width: 0; }
.book-index-dots { flex: 1; border-bottom: 1px dotted #c9bfa9; min-width: 8px; }
.book-index-refs { white-space: nowrap; }
.book-index-refs b { font-weight: 600; }
.book-index-see { font-style: italic; color: #4a4438; }
.book-sources-page { page: sources; }
.book-index-page { page: index; }

/* The window's own controls (the toolbar, the side contents: src/book-window.ts): on screen only */
.book-nv { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin: 0 0 12px; padding: 10px 14px; border-radius: 8px; background: #f6ecd3; color: #7f5500; font: 13px/1.45 ${SANS}; text-align: left; }
.book-nv > span { flex: 1; min-width: 200px; }
.book-nv-compare, .bc-btn { padding: 6px 12px; border-radius: 7px; border: 1px solid #e2cf9f; background: #fffdf8; color: #2b2822; font: 500 13px ${SANS}; cursor: pointer; text-decoration: none; }
.book-compare { width: min(720px, 92vw); max-height: 88vh; padding: 0; border: 0; border-radius: 14px; box-shadow: 0 12px 40px rgba(20,16,8,.3); background: #fffdf8; color: #2b2822; font-family: ${SANS}; }
.book-compare[open] { display: flex; flex-direction: column; }
.book-compare::backdrop { background: rgba(20,16,8,.45); }
.bc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 20px 24px 14px; border-bottom: 1px solid #ece5d6; }
.bc-head h2 { margin: 0; font-size: 19px; }
.bc-sub { margin-top: 2px; font-size: 13px; color: #5c5546; }
.bc-x { width: 32px; height: 32px; border: 0; background: none; font-size: 22px; color: #5c5546; cursor: pointer; }
.bc-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 24px 24px; }
.bc-foot { display: flex; align-items: center; gap: 8px; padding: 14px 24px; background: #f6f2ea; border-top: 1px solid #ece5d6; }
.bc-btn--primary { background: #3f6b4f; border-color: #3f6b4f !important; color: #fff; font-weight: 600; }
.bc-gap { flex: 1; }
.bc-msg { flex: 1; font-size: 13px; color: #5c5546; }
.book-open-mark { display: inline-flex; vertical-align: -2px; margin-left: 6px; opacity: .8; }
.book-story-approve { font: 13px ${SANS}; margin: 6px 0 0; }
.book-story-approve a { color: #8a5a2b; }
${STORY_COMPARE_CSS}

/* Phone, tablet, a phone held sideways */
@media (max-width: 1024px) { .book-sheet { padding: 32px 28px; } }
@media (max-width: 640px) {
    body { font-size: 16px; }
    .book-sheet { padding: 24px 16px; margin: 0; box-shadow: none; }
    .book-title-page { min-height: 70vh; }
    .book-title-page h1 { font-size: 28px; }
    .book-rod-name { font-size: 26px; }
    .book-family-head h2 { font-size: 22px; }
    .book-grid { grid-template-columns: minmax(0, 1fr); gap: 0; }
    .book-grid dd { margin-bottom: 6px; }
    .book-place { grid-template-columns: 96px minmax(0, 1fr) 54px; gap: 8px; }
    .book-place-years { margin-left: 104px; margin-right: 62px; }
    .book-lineage-row { grid-template-columns: 30px minmax(0, 1fr) 52px; gap: 6px; }
    .book-lineage-text { padding-left: calc(var(--lv, 0) * 12px) !important; }
    .book-pair { grid-template-columns: minmax(0, 1fr); }
    .book-clips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .book-index, .book-sources.is-long { column-count: 1; }
    .pp-row { grid-template-columns: 52px 18px minmax(0, 1fr); }
}
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) { .book-title-page { min-height: auto; padding: 24px 0; } }

@page { size: A4; margin: 20mm 22mm 22mm; @bottom-center { content: counter(page); font: 10pt 'Strom Serif', Georgia, serif; color: #5c5546; } }
@page front { @bottom-center { content: none; } @top-left { content: none; } }
@media print {
    body { background: #fff; font-size: 12pt; }
    .book { max-width: none; }
    .book-sheet { padding: 0; margin: 0; box-shadow: none; background: #fff; }
    .book-sheet + .book-sheet { break-before: page; }
    .book-toolbar, .book-nv, .book-compare, .book-story-approve, .book-research-controls { display: none !important; }
    .book-title-page { min-height: 240mm; }
    a { text-decoration: none; }
    .book-source-scan a[data-print]::after { content: attr(data-print); }
    .book-source-scan a[data-print] span { display: none; }
}
`;
