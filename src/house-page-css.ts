/**
 * The house page's own rules (spec 030 §3), on top of the person page's
 * (PERSON_PAGE_CSS: .pp, .pp-sec, .pp-facts, .pp-sum, .pp-link, .pp-foot).
 * In the app they are injected beside the person page's; in the saved file
 * they follow them, with the few app tokens the file's :root lacks.
 */

/** The light values of the app tokens the house page adds (the file's :root). */
export const HOUSE_PAGE_FILE_TOKENS = ':root { --research: #3d4a7a; --research-soft: #e9ebf3; --research-line: #c9cfe3; '
    + '--read-amber-line: #e8d7ae; --line-color: #b8ae99; }\n';

export const HOUSE_PAGE_CSS = `
.hp .hp-aka { margin: 2px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 15px; color: var(--text-light); }
.hp .hp-name { font-family: var(--font-serif); font-size: 18px; color: var(--text); overflow-wrap: anywhere; }
.hp .hp-name-edit { padding: 0; border: 0; background: none; color: var(--primary); font: inherit; font-size: 13.5px; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.hp .hp-name-input { font: inherit; font-family: var(--font-serif); font-size: 18px; padding: 2px 6px; min-width: 0; width: min(100%, 320px); border: 1px solid var(--border); border-radius: var(--r-sm, 4px); background: var(--surface); color: var(--text); }
.hp .hp-state { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.hp .hp-out { margin: 10px 0 0; font-size: 13px; color: var(--text-light); }
.hp .hp-sec-note { font-size: 12.5px; color: var(--text-faint); font-weight: 400; }
.hp .hp-h3 { margin: 18px 0 8px; font-family: var(--font-sans); font-size: 13.5px; font-weight: 600; color: var(--text-light); }
.hp .hp-h3-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; margin: 18px 0 8px; }
.hp .hp-h3-row .hp-h3 { margin: 0; }
.hp .hp-note { margin: 18px 0 0; font-size: 14px; color: var(--text-light); }

/* origin tags: research, own research, conjecture, married in */
.hp .hp-otag { display: inline-block; padding: 0 6px; border: 1px solid var(--border); border-radius: var(--r-tag, 3px); font-size: 11px; line-height: 17px; white-space: nowrap; color: var(--text-light); }
.hp .hp-otag--res { border-color: var(--research-line); background: var(--research-soft); color: var(--research); }
.hp .hp-otag--own { border-color: var(--read-amber-line); background: var(--hist-bg); color: var(--hist-local-text); }
.hp .hp-otag--guess { border-style: dashed; background: transparent; font-style: italic; }
.hp .hp-otag--mar { background: transparent; }

/* numbers over time */
.hp .hp-nums { display: flex; flex-direction: column; }
.hp .hp-num { display: grid; grid-template-columns: 110px 90px minmax(0, 1fr); gap: 4px 12px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--divider); }
.hp .hp-num:first-child { border-top: 0; }
.hp .hp-num--prop { padding: 8px 10px; border-radius: var(--r-md, 6px); background: var(--surface-2); border-top-color: transparent; }
.hp .hp-num-y { font-variant-numeric: tabular-nums; color: var(--text-light); font-size: 14px; }
.hp .hp-num-n { font-family: var(--font-serif); font-size: 16px; }
.hp .hp-num-w { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 13.5px; color: var(--text-light); min-width: 0; overflow-wrap: anywhere; }
.hp .hp-num-acts { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.hp .hp-mini { padding: 3px 10px; border: 1px solid var(--border); border-radius: var(--r-md, 6px); background: var(--surface); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }
.hp .hp-mini--primary { border-color: var(--primary); background: var(--primary); color: var(--on-primary); }
.hp .hp-src { color: var(--text-light); font-size: 12.5px; overflow-wrap: anywhere; }
.hp a.hp-src { color: var(--primary); }

/* timeline */
.hp .hp-tl { position: relative; display: flex; flex-direction: column; }
.hp .hp-tl::before { content: ''; position: absolute; left: 61px; top: 8px; bottom: 8px; width: 1.5px; background: var(--line-color); }
.hp .hp-tl-r { position: relative; display: grid; grid-template-columns: 48px 28px minmax(0, 1fr); align-items: start; padding: 5px 0; }
.hp .hp-tl-y { font-variant-numeric: tabular-nums; color: var(--text-light); font-size: 14px; text-align: right; }
.hp .hp-tl-d { justify-self: center; width: 9px; height: 9px; margin-top: 6px; border: 1.5px solid var(--line-color); border-radius: 50%; background: var(--surface-modal); position: relative; }
.hp .hp-tl-r--tree .hp-tl-d { background: var(--text-light); border-color: var(--text-light); }
.hp .hp-tl-r--res .hp-tl-d { border-color: var(--research); }
.hp .hp-tl-r--own .hp-tl-d { border-color: var(--hist-local); }
.hp .hp-tl-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; font-size: 15px; }
.hp .hp-tl-m { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-size: 12.5px; color: var(--text-faint); }
.hp .hp-tl-r--hidden .hp-tl-t > span:first-child { color: var(--text-light); }
.hp .hp-hid { font-style: italic; }
.hp .hp-reveal { padding: 0; border: 0; background: none; color: var(--primary); font: inherit; font-size: 12.5px; text-decoration: underline; cursor: pointer; }

/* holders and residents */
.hp .hp-table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.hp .hp-table th { text-align: left; font-size: 12px; font-weight: 600; color: var(--text-light); padding: 4px 10px 6px 0; border-bottom: 1px solid var(--border); }
.hp .hp-table td { padding: 7px 10px 7px 0; border-bottom: 1px solid var(--divider); vertical-align: top; overflow-wrap: anywhere; }
.hp .hp-table td.hp-y { font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--text-light); }
.hp .hp-table td.hp-unk { font-style: italic; color: var(--text-faint); }
.hp .hp-ext-rl { color: var(--text-faint); font-size: 12.5px; }

/* the building */
.hp .hp-look { margin: 0 0 12px; font-size: 15px; }
.hp .hp-fig { margin: 0 0 12px; }
.hp .hp-img { display: block; max-width: 100%; height: 190px; object-fit: cover; border-radius: var(--r-md, 6px); border: 1px solid var(--border); }
.hp .hp-fig figcaption { margin-top: 4px; font-size: 12px; color: var(--text-faint); overflow-wrap: anywhere; }

/* what is not known, what was searched */
.hp .hp-ql { display: flex; flex-direction: column; }
.hp .hp-ql-i { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; padding: 8px 0; border-top: 1px solid var(--divider); overflow-wrap: anywhere; }
.hp .hp-ql-i:first-child { border-top: 0; }
.hp .hp-qt { font-family: var(--font-serif); font-size: 16px; flex: 1 1 260px; min-width: 0; }
.hp .hp-ql-r { flex: 0 0 auto; }
.hp .hp-ql-s { flex: 1 1 100%; font-size: 12.5px; color: var(--text-faint); }

/* sources and materials */
.hp .hp-srcs { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
.hp .hp-sr { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md, 6px); min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
.hp .hp-sr-s, .hp .hp-sr-ref { font-size: 12.5px; color: var(--text-light); }
.hp .hp-sr-ref a { color: var(--primary); }
.hp .hp-mats { display: flex; flex-direction: column; }
.hp .hp-mat { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--divider); }
.hp .hp-mat:first-child { border-top: 0; }
.hp .hp-mat-t { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; font-size: 14.5px; }
.hp .hp-mat-s, .hp .hp-mat-k { font-size: 12.5px; color: var(--text-faint); }
.hp .hp-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }

/* The map (§4): the frame the window draws tiles into, the point, the line under it. */
.hp .hmap-wrap { display: flex; flex-direction: column; gap: 10px; }
.hp .hmap-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hp .hmap-layers { background: var(--surface); max-width: 100%; overflow-x: auto; }
.hp .hmap-layer { min-height: 30px; padding: 0 11px; border: 0; background: none; color: var(--text-light); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; }
.hp .hmap-layer[aria-checked="true"] { color: var(--sel-fg, var(--text)); font-weight: 600; }
.hp .hmap-note { margin: 0; font-size: 13px; color: var(--text-light); }
.hp .hmap { position: relative; height: 280px; border: 1px solid var(--border); border-radius: var(--r-lg, 8px); overflow: hidden; background: var(--map-land, var(--surface-2)); user-select: none; -webkit-user-select: none; }
.hp .hmap-tiles { position: absolute; inset: 0; overflow: hidden; }
.hp .hmap-tiles img { position: absolute; width: 256px; height: 256px; max-width: none; -webkit-user-drag: none; pointer-events: none; }
.hp .hmap-tiles .hmap-img { left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
.hp .hpt { position: absolute; z-index: 2; display: flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; padding: 0 6px; box-sizing: border-box; transform: translate(-50%, -50%); border-radius: var(--r-pill, 999px); background: var(--surface); border: 1.5px solid var(--primary); color: var(--primary-dark, var(--primary)); font-size: 11.5px; font-weight: 600; box-shadow: var(--shadow-sm); white-space: nowrap; }
.hp .hpt.main { background: var(--primary); color: var(--on-primary, #fff); border: 2px solid #fff; min-width: 26px; height: 26px; font-size: 12px; }
.hp .hpt.town { background: var(--primary); border: 2px solid #fff; min-width: 18px; width: 18px; height: 18px; padding: 0; }
.hp .hpt.drag { outline: 2px dashed var(--text); outline-offset: 3px; cursor: grab; touch-action: none; }
.hp .hpt.drag.dragging { cursor: grabbing; }
.hp .hmap-notice { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 16px; text-align: center; background: var(--surface-2); color: var(--text-light); font-size: 13px; }
.hp .hmap-notice p { margin: 0; max-width: 46ch; }
.hp .hmap-zoom { position: absolute; z-index: 3; right: 8px; top: 8px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--r-md, 6px); background: var(--surface); overflow: hidden; }
.hp .hmap-zoom button { width: 30px; height: 30px; padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-size: 16px; line-height: 1; cursor: pointer; }
.hp .hmap-zoom button + button { border-top: 1px solid var(--divider); }
.hp .hmap-zoom button:disabled { color: var(--text-faint, var(--text-light)); cursor: default; }
.hp .hmap-attr { position: absolute; z-index: 3; right: 0; bottom: 0; max-width: 100%; padding: 1px 6px; box-sizing: border-box; font-size: 10.5px; color: var(--text-light); background: var(--map-label-bg, var(--surface)); border-top-left-radius: var(--r-sm, 4px); overflow-wrap: anywhere; }
.hp .hmap-attr a { color: inherit; }
.hp .hmap-u { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.hp .hmap-pos { color: var(--text-light); display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; }
.hp .hmap-acts { display: inline-flex; flex-wrap: wrap; gap: 4px 14px; }
.hp .hmap-act { padding: 0; border: 0; background: none; color: var(--primary); font: inherit; font-size: 13px; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.hp .hmap-man { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.hp .hmap-mu { color: var(--text-light); }
.hp .hmap-man a, .hp .hmap-coords a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
@media (hover: hover) {
    .hp .hp-name-edit:hover, .hp .hp-reveal:hover { color: var(--text); }
    .hp .hp-mini:hover { background: var(--hover-bg); }
    .hp .hmap-layer:hover, .hp .hmap-zoom button:hover:not(:disabled) { background: var(--hover-bg); }
    .hp .hmap-act:hover { color: var(--text); }
    .hp .hp-mini--primary:hover { background: var(--primary); filter: brightness(1.08); }
}
@media (pointer: coarse) {
    .hp .hp-mini, .hp .hp-name-edit, .hp .hp-reveal { min-height: 44px; }
    .hp .hp-mini { padding: 6px 14px; }
    .hp .hmap-act, .hp .hmap-layer { min-height: 44px; }
    .hp .hmap-zoom button { width: 40px; height: 40px; }
    .hp .hpt.drag { min-width: 36px; height: 36px; }
}
@media (min-width: 641px) and (max-width: 1024px) {
    .hp .hp-num { grid-template-columns: 96px 80px minmax(0, 1fr); }
}
@media (max-width: 640px) {
    .hp .hp-num { grid-template-columns: auto minmax(0, 1fr); }
    .hp .hp-num-w { grid-column: 1 / -1; }
    .hp .hp-tl::before { left: 55px; }
    .hp .hp-tl-r { grid-template-columns: 42px 28px minmax(0, 1fr); }
    .hp .hp-table thead { display: none; }
    .hp .hp-table, .hp .hp-table tbody, .hp .hp-table tr, .hp .hp-table td { display: block; width: auto; }
    .hp .hp-table tr { padding: 7px 0; border-bottom: 1px solid var(--divider); }
    .hp .hp-table td { padding: 0; border: 0; }
    .hp .hp-table td.hp-y { white-space: normal; font-size: 13px; }
    .hp .hp-srcs { grid-template-columns: minmax(0, 1fr); }
    .hp .hmap { height: 240px; }
    .pp-body .hp .hmap { margin: 0 -16px; border-radius: 0; border-left: 0; border-right: 0; }
    .hp .hmap-wrap .hmap-top { order: 2; }
    .hp .hmap-wrap .hmap { order: 1; }
    .hp .hmap-wrap .hmap-u { order: 3; }
}
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
    .hp .hp-num { grid-template-columns: 96px 80px minmax(0, 1fr); }
    .hp .hp-img { height: 140px; }
    .hp .hmap { height: 200px; }
}
@media print {
    .hp .hp-name-edit, .hp .hp-reveal, .hp .hp-mini, .hp .hp-acts, .hp .hp-out, .hp .hmap-zoom, .hp .hmap-acts, .hp .hmap-top { display: none !important; }
    .hp .hp-num, .hp .hp-tl-r, .hp .hp-table tr, .hp .hp-sr, .hp .hp-mat { break-inside: avoid; }
}
`;
