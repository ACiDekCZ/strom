/**
 * The one selection indicator (spec 046, "Linka"): the tokens and the rules of
 * `.sel-tab` (a tab or a navigation item), `.sel-opt` (an option in a group)
 * and `.sel-seg` (the frame of a segment). One source for every document that
 * shows a selection: index.html carries the same text between the
 * `sel:start` / `sel:end` markers (a unit test keeps the two equal), and the
 * saved pages (person page, family pages, book) put it into their own CSS.
 *
 * The selected state is read from the attributes and classes the app already
 * sets (SEL below), so no script and no test changes what marks a selection.
 *
 *   .sel-tab[data-sel-dir]   down (default: the content is below the bar),
 *                            up (the content is above it: the bottom bar),
 *                            side (the content is to the right).
 *   [data-sel-land="side"]   an "up" tab that turns "side" on a phone held
 *                            sideways (the bottom bar becomes the side bar).
 *   .sel-opt[data-sel-form]  chip (default), seg (a cell of a .sel-seg),
 *                            row (a row of a list or a table), tile.
 *   .sel-l[data-label]       a tab's label holding the width of its bold cut,
 *                            so a tab never shifts when it is chosen and the
 *                            toolbar fit measures the same either way.
 *
 * The rules come after the components' own rules (the end of the stylesheet),
 * which keep only their layout (padding, height, font size).
 */

/** Every way the app marks a selected tab or option today. */
export const SEL = ':is([aria-current]:not([aria-current="false"]), [aria-selected="true"], [aria-pressed="true"], [aria-checked="true"], '
    + '.active, .is-on, .is-selected, .is-active, .selected, .is-chosen, :has(> input:checked))';

const DISABLED = ':is(:disabled, [aria-disabled="true"])';
const LANDSCAPE_PHONE = '(max-width: 1024px) and (max-height: 500px) and (orientation: landscape)';

/** The light tokens (declarations only; a saved page puts them on its own :root). */
export const SEL_LIGHT_DECLS = '--sel-line: var(--text); --sel-line-w: 2px; --sel-fill: #f0e9da; --sel-fg: var(--text); '
    + '--sel-border: var(--text); --sel-r: 4px; --sel-mute: var(--line-color, #b8ae99);';

/** The dark tokens: only the fill and the muted line differ (the rest follows --text). */
export const SEL_DARK_DECLS = '--sel-fill: #3a362c; --sel-mute: var(--line-color, #5a5546);';

/** The tokens: light on :root, dark under the app's dark theme. */
export const SEL_TOKENS_CSS = `:root { ${SEL_LIGHT_DECLS} }
[data-theme="dark"] { ${SEL_DARK_DECLS} }
`;

/** The rules of the indicator (variant V1 "Linka"). */
export const SEL_RULES_CSS = `.sel-tab { font-weight: 500; color: var(--text-light); }
.sel-tab.sel-tab { border-radius: 0; }
.sel-tab${SEL}, .sel-opt${SEL} { color: var(--sel-fg); font-weight: 600; }
.sel-tab > .sel-l { display: inline-grid; }
.sel-tab > .sel-l::after { content: attr(data-label); content: attr(data-label) / ""; font-weight: 600; height: 0; overflow: hidden; visibility: hidden; white-space: inherit; }
.sel-tab:focus-visible, .sel-opt:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: revert-layer; }
.sel-tab${DISABLED}, .sel-opt${DISABLED} { opacity: .55; cursor: default; }
.sel-tab${SEL}${DISABLED}, .sel-opt${SEL}${DISABLED} { --sel-line: var(--sel-mute); --sel-border: var(--sel-mute); }
.sel-tab${SEL} { box-shadow: inset 0 calc(-1 * var(--sel-line-w)) 0 var(--sel-line); }
.sel-tab[data-sel-dir="up"]${SEL} { box-shadow: inset 0 var(--sel-line-w) 0 var(--sel-line); }
.sel-tab[data-sel-dir="side"]${SEL} { box-shadow: inset var(--sel-line-w) 0 0 var(--sel-line); }
.sel-opt { border: 1px solid var(--border, #ddd4c2); border-radius: var(--sel-r); background: var(--surface, #fffdf8); color: var(--text-light); }
.sel-opt${SEL} { border-color: var(--sel-border); box-shadow: inset 0 0 0 1px var(--sel-border); }
.sel-seg { display: inline-flex; border: 1px solid var(--border, #ddd4c2); border-radius: var(--sel-r); }
.sel-seg > .sel-opt { border: 0; border-radius: 0; }
.sel-seg > .sel-opt:first-child { border-radius: calc(var(--sel-r) - 1px) 0 0 calc(var(--sel-r) - 1px); }
.sel-seg > .sel-opt:last-child { border-radius: 0 calc(var(--sel-r) - 1px) calc(var(--sel-r) - 1px) 0; }
.sel-seg > .sel-opt:first-child:last-child { border-radius: calc(var(--sel-r) - 1px); }
.sel-seg > .sel-opt + .sel-opt { border-left: 1px solid var(--border, #ddd4c2); }
.sel-seg > .sel-opt${SEL} { box-shadow: inset 0 0 0 2px var(--sel-border); }
.sel-opt[data-sel-form="row"] { border: 0; border-bottom: 1px solid var(--divider, #ece5d6); border-radius: 0; background: transparent; }
.sel-opt[data-sel-form="row"]${SEL} { background: var(--sel-fill); box-shadow: inset 0 -2px 0 var(--sel-line); }
.sel-opt[data-sel-form="tile"] { border-radius: var(--r-md, 6px); }
@media (hover: hover) {
  .sel-tab:not(${SEL}, ${DISABLED}):hover { color: var(--text); box-shadow: inset 0 -1px 0 var(--sel-mute); }
  .sel-tab[data-sel-dir="up"]:not(${SEL}, ${DISABLED}):hover { box-shadow: inset 0 1px 0 var(--sel-mute); }
  .sel-tab[data-sel-dir="side"]:not(${SEL}, ${DISABLED}):hover { box-shadow: inset 1px 0 0 var(--sel-mute); }
  .sel-opt:not(${SEL}, ${DISABLED}):hover { background: var(--surface-2, #f6f2ea); border-color: var(--sel-mute); }
}
@media ${LANDSCAPE_PHONE} {
  .sel-tab[data-sel-dir="up"][data-sel-land="side"]${SEL} { box-shadow: inset var(--sel-line-w) 0 0 var(--sel-line); }
}
@media ${LANDSCAPE_PHONE} and (hover: hover) {
  .sel-tab[data-sel-dir="up"][data-sel-land="side"]:not(${SEL}, ${DISABLED}):hover { box-shadow: inset 1px 0 0 var(--sel-mute); }
}
@media (pointer: coarse) {
  .sel-tab, .sel-opt:is([data-sel-form="seg"], [data-sel-form="row"], [data-sel-form="tile"]) { min-height: 44px; }
  .sel-opt:is(:not([data-sel-form]), [data-sel-form="chip"]) { position: relative; }
  .sel-opt:is(:not([data-sel-form]), [data-sel-form="chip"])::before { content: ""; position: absolute; inset: -7px 0; }
}
@media print {
  .sel-tab${SEL} { box-shadow: none; border-bottom: var(--sel-line-w) solid var(--sel-line); }
  .sel-tab[data-sel-dir="up"]${SEL} { box-shadow: none; border-bottom: 0; border-top: var(--sel-line-w) solid var(--sel-line); }
  .sel-tab[data-sel-dir="side"]${SEL} { box-shadow: none; border-bottom: 0; border-left: var(--sel-line-w) solid var(--sel-line); }
  .sel-opt${SEL}, .sel-seg > .sel-opt${SEL} { box-shadow: none; outline: 2px solid var(--sel-border); outline-offset: -2px; }
  .sel-opt[data-sel-form="row"]${SEL} { box-shadow: none; outline: 0; border-bottom: 2px solid var(--sel-line); }
}
`;

/** The whole block as index.html carries it between its markers. */
export const SEL_CSS = SEL_TOKENS_CSS + SEL_RULES_CSS;

/**
 * Put a tab's label into its `.sel-l` span (made once), with the label as
 * `data-label` for the bold cut's reserve.
 */
export function setSelTabLabel(tab: HTMLElement, label: string): void {
    let span = tab.querySelector<HTMLElement>(':scope > .sel-l');
    if (!span) {
        span = tab.ownerDocument.createElement('span');
        span.className = 'sel-l';
        tab.replaceChildren(span);
    }
    span.textContent = label;
    span.dataset.label = label;
}
