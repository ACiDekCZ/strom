/**
 * Styles of the person page's places map and life chart (spec 025, §1.8 and
 * §2.7). Kept apart from person-page-css.ts: the page adds these strings to
 * its own (window and saved file alike). The window takes the token values
 * from index.html (light and dark); a saved file puts
 * PERSON_PAGE_VIZ_LIGHT_TOKENS on its :root next to PERSON_PAGE_LIGHT_TOKENS.
 * Print turns both blocks to greys (the tokens are overridden on the blocks
 * under @media print).
 */

/** Light values of the tokens the map and chart add (and --accent, which the file's token set lacks). */
export const PERSON_PAGE_VIZ_LIGHT_TOKENS = [
    '--accent: #b0703c',
    '--map-land: #f4efe4', '--map-land2: #e9e1d0', '--map-geo: #b9ab8e', '--map-label-bg: rgba(255, 253, 248, .82)',
    '--chart-young: #e2d6bd', '--chart-married: #a8c0ad', '--chart-band1: #efe8da', '--chart-band2: #ddd2bc',
].join('; ') + ';';

/** Print values (greys) of the map and chart tokens. */
export const PERSON_PAGE_VIZ_PRINT_TOKENS = [
    '--map-land: #ffffff', '--map-land2: #eeeeee', '--map-geo: #9a9a9a', '--map-label-bg: rgba(255, 255, 255, .9)',
    '--chart-young: #e0e0e0', '--chart-married: #b8b8b8', '--chart-band1: #f0f0f0', '--chart-band2: #d9d9d9',
    '--primary: #444444', '--accent: #111111', '--hist-mark: #555555', '--hist-place: #333333', '--hist-local: #777777',
].join('; ') + ';';

const LANDSCAPE = '(max-width: 1024px) and (max-height: 500px) and (orientation: landscape)';

/** The places map (§1). */
export const PERSON_PAGE_MAP_CSS = `
.pp-map { position: relative; aspect-ratio: 2 / 1; margin: 0 0 12px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--map-land); }
.pp-map-in { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.pp-map-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: hidden; }
.pp-map-grid { fill: none; stroke: var(--divider); stroke-width: 0.8; vector-effect: non-scaling-stroke; }
.pp-map-coast { fill: none; stroke: var(--map-geo); stroke-width: 1; vector-effect: non-scaling-stroke; }
.pp-map-border { fill: none; stroke: var(--map-geo); stroke-width: 1.4; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; }
.pp-map-route { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: .5 6; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.pp-map-pt { position: absolute; z-index: 2; width: 22px; height: 22px; margin: -11px 0 0 -11px; padding: 0; border: 2px solid var(--surface); border-radius: 50%; background: var(--primary); color: #fff; font: 600 11.5px/18px var(--font-sans); text-align: center; box-shadow: 0 1px 3px rgba(30, 24, 12, .25); cursor: pointer; }
.pp-map-pt--rel { z-index: 1; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 2px solid var(--primary); background: var(--surface); box-shadow: none; }
.pp-map-pt.is-sel { z-index: 3; width: 26px; height: 26px; margin: -13px 0 0 -13px; line-height: 22px; background: var(--accent); }
.pp-map-pt--rel.is-sel { width: 18px; height: 18px; margin: -9px 0 0 -9px; border-color: var(--accent); background: var(--surface); }
.pp-map-pt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pp-map-lb { position: absolute; z-index: 1; transform: translate(16px, -50%); padding: 1px 6px; border-radius: 5px; background: var(--map-label-bg); color: var(--text); font-size: 12.5px; font-weight: 600; line-height: 18px; white-space: nowrap; pointer-events: none; }
.pp-map-lb--rel { font-weight: 500; color: var(--text-light); }
.pp-map-yr { margin-left: 6px; font-size: 11px; font-weight: 400; color: var(--text-faint); }
.pp-map-yr.y-p { display: none; }
.pp-map-attr { position: absolute; z-index: 4; top: 5px; right: 8px; padding: 0 4px; border-radius: 3px; background: var(--map-label-bg); color: var(--text-faint); font-size: 10px; line-height: 14px; }
.pp-map-scale { position: absolute; z-index: 4; left: 10px; bottom: 8px; width: calc(var(--u) * 100% / 640); color: var(--text-light); font-size: 11px; line-height: 13px; }
.pp-map-scale-bar { display: block; height: 5px; border: 1.5px solid var(--text-light); border-top: 0; }
.pp-map-scale-t { position: absolute; left: 0; bottom: 7px; white-space: nowrap; }
.pp-map-inset { position: absolute; z-index: 4; right: 8px; bottom: 8px; width: 31%; aspect-ratio: 2 / 1; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
.pp-map-inset--tl { right: auto; bottom: auto; left: 8px; top: 8px; }
.pp-map-inset svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pp-map-land { fill: var(--map-land2); fill-rule: evenodd; stroke: none; }
.pp-map-frame { fill: none; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.pp-map-arc { fill: none; stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.pp-map-ipt { fill: var(--surface); stroke: var(--primary); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.pp-map-ipt.is-sel { stroke: var(--accent); }
.pp-map-ilb { --tx: 6px; --ty: -50%; position: absolute; transform: translate(var(--tx), var(--ty)); padding: 0 3px; border-radius: 3px; background: var(--map-label-bg); color: var(--text-light); font-size: 10px; line-height: 13px; white-space: nowrap; }
.pp-map-ilb--l { --tx: calc(-100% - 6px); }
.pp-map-ilb--up { --ty: calc(-100% - 1px); }
.pp-map-ilb--dn { --ty: 1px; }
.pp-map-tools { align-items: center; }
.pp-map-tools .pp-act { margin-top: 0; min-height: 34px; }
.pp-places { scroll-margin-top: 12px; }
.pp-map-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.pp-map-row { display: flex; align-items: flex-start; gap: 10px; padding: 6px 8px; border-radius: 8px; font-size: 14px; line-height: 1.45; }
.pp-map-row[data-pp-map-place] { cursor: pointer; }
.pp-map-row.is-sel { background: var(--hover-bg); }
.pp-map-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.pp-map-rt { min-width: 0; overflow-wrap: anywhere; }
.pp-map-badge { flex: 0 0 auto; width: 20px; height: 20px; margin-top: 1px; border-radius: 50%; background: var(--primary); color: #fff; font-size: 11px; font-weight: 600; line-height: 20px; text-align: center; }
.pp-map-row.is-sel .pp-map-badge:not(.pp-map-badge--rel):not(.pp-map-badge--none) { background: var(--accent); }
.pp-map-badge--rel { width: 14px; height: 14px; margin: 4px 3px 0; border: 2px solid var(--primary); background: var(--surface); }
.pp-map-row.is-sel .pp-map-badge--rel { border-color: var(--accent); }
.pp-map-badge--none { width: 14px; height: 14px; margin: 4px 3px 0; border: 1.5px dashed var(--text-faint); background: none; }
.pp-map-badge--dot { width: 10px; height: 10px; margin: 6px 5px 0; }
.pp-map-name { font-weight: 600; }
.pp-map-ev { color: var(--text-light); }
.pp-map-amb { color: var(--text-faint); font-size: 13px; }
.pp-map-row--nopos { color: var(--text-light); }
.pp-map-note { margin-top: 8px !important; color: var(--text-faint); font-size: 13px; }
@media (min-width: 641px) {
  .lb-d-l { transform: translate(calc(-100% - 16px), -50%); }
  .lb-d-hide { display: none; }
}
@media (max-width: 640px) {
  .pp-map { aspect-ratio: 4 / 3; }
  .pp-map-in { left: -25%; width: 150%; }
  .lb-p-l { transform: translate(calc(-100% - 16px), -50%); }
  .lb-p-hide { display: none; }
  .pp-map-ilb--wide { display: none; }
  .pp-map-yr.y-d { display: none; }
  .pp-map-yr.y-p { display: inline; }
  .pp-map-scale { width: calc(var(--u) * 100% / 426.667); }
  .pp-map-inset { width: 40%; }
  .pp-map-row { font-size: 13.5px; }
}
@media ${LANDSCAPE} {
  .pp-map { aspect-ratio: 3 / 1; }
  .pp-map-in { left: 0; width: 100%; top: -25%; height: 150%; }
  .pp-map-scale { width: calc(var(--u) * 100% / 640); }
  .pp-map-inset { width: 24%; }
}
@media (hover: hover) {
  .pp-map-row[data-pp-map-place]:hover { background: var(--hover-bg); }
  .pp-map-pt:hover { filter: brightness(1.12); }
}
@media (pointer: coarse) {
  .pp-map-tools .pp-act { min-height: 44px; }
  .pp-map-pt::before { content: ''; position: absolute; inset: -11px; border-radius: 50%; }
  .pp-map-pt--rel::before { inset: -15px; }
  .pp-map-row { min-height: 44px; align-items: center; }
}
@media print {
  .pp-places, .pp-chart { ${PERSON_PAGE_VIZ_PRINT_TOKENS} -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pp-map-tools { display: none !important; }
  .pp-map, .pp-map-list { break-inside: avoid; }
  .pp-map-pt { box-shadow: none; }
}
`;

/** The life chart (§2). */
export const PERSON_PAGE_CHART_CSS = `
.pp-chart { margin: 0 0 16px; color: var(--text-faint); font-size: 11px; line-height: 1.2; }
.pp-chart a { color: inherit; text-decoration: none; }
.pp-chart a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pp-chart-set { position: relative; }
.pp-chart-set--narrow { display: none; }
.pp-ch-row { position: relative; }
.pp-ch-ages { height: 16px; font-size: 10.5px; }
.pp-ch-ages span, .pp-ch-axis span { position: absolute; top: 2px; transform: translateX(-50%); white-space: nowrap; }
.pp-ch-ages .pp-ch-age--e { left: auto; right: 0; transform: none; }
.pp-ch-hist { height: 26px; }
.pp-ch-hbar { position: absolute; top: 12px; height: 6px; border-radius: 3px; background: var(--hist-mark); opacity: .55; }
.pp-ch-hm { position: absolute; top: 4px; width: 0; }
.pp-ch-hg { position: absolute; left: 0; top: 0; transform: translateX(-50%); font-size: 12px; line-height: 14px; color: var(--hist-mark); }
.pp-ch-hm--place .pp-ch-hg { color: var(--hist-place); }
.pp-ch-hm--local .pp-ch-hg { color: var(--hist-local); }
.pp-ch-hl { position: absolute; left: 8px; top: 1px; font-size: 10.5px; white-space: nowrap; color: var(--text-faint); }
.pp-ch-plabels { height: 18px; }
.pp-ch-pl { position: absolute; bottom: 3px; overflow: hidden; padding-left: 2px; color: var(--text-light); font-size: 11.5px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.pp-ch-bar { height: 16px; }
.pp-ch-barin { position: absolute; top: 0; height: 16px; border-radius: 4px; overflow: hidden; }
.pp-ch-bari { position: absolute; top: 0; height: 100%; }
.pp-ch-p { position: absolute; top: 0; height: 100%; display: block; }
.pp-ch-p--youth, .pp-ch-p--life { background: var(--chart-young); }
.pp-ch-p--marriage { background: var(--chart-married); }
.pp-ch-p--widowed, .pp-ch-p--divorced { background: repeating-linear-gradient(135deg, var(--text-faint) 0 1.5px, transparent 1.5px 4px); }
.pp-ch-fade-s { -webkit-mask-image: linear-gradient(90deg, rgba(0,0,0,.12), #000 18%); mask-image: linear-gradient(90deg, rgba(0,0,0,.12), #000 18%); }
.pp-ch-fade-e { -webkit-mask-image: linear-gradient(90deg, #000 82%, rgba(0,0,0,.12)); mask-image: linear-gradient(90deg, #000 82%, rgba(0,0,0,.12)); }
.pp-ch-fade-s.pp-ch-fade-e { -webkit-mask-image: linear-gradient(90deg, rgba(0,0,0,.12), #000 18%, #000 82%, rgba(0,0,0,.12)); mask-image: linear-gradient(90deg, rgba(0,0,0,.12), #000 18%, #000 82%, rgba(0,0,0,.12)); }
.pp-ch-dash { position: absolute; top: 0; height: 16px; border: 1.5px dashed var(--text-faint); border-left: 0; border-radius: 0 4px 4px 0; }
.pp-ch-band { height: 18px; margin-top: 2px; }
.pp-ch-res { position: absolute; top: 0; height: 100%; overflow: hidden; padding: 0 4px; color: var(--text-light) !important; font-size: 10.5px; line-height: 18px; white-space: nowrap; }
.pp-ch-res--1 { background: var(--chart-band1); }
.pp-ch-res--2 { background: var(--chart-band2); }
.pp-ch-marks { height: 34px; }
.pp-ch-mk, .pp-ch-end { position: absolute; top: 0; width: 0; height: 100%; display: block; color: var(--text-light); }
.pp-ch-mk::before { content: ''; position: absolute; left: -8px; top: 0; width: 16px; height: 100%; }
.pp-ch-tick { position: absolute; left: -0.5px; top: 0; width: 1px; height: 6px; background: var(--text-faint); }
.pp-ch-gl { position: absolute; left: 0; top: 6px; transform: translateX(-50%); color: var(--text); font-size: 12px; line-height: 13px; }
.pp-ch-ml { position: absolute; left: 0; top: 19px; transform: translateX(-50%); font-size: 10.5px; line-height: 13px; white-space: nowrap; }
.pp-ch-mk--event .pp-ch-tick { height: 10px; }
.pp-ch-mk--event .pp-ch-ml { top: 11px; }
.pp-ch-mk--s .pp-ch-ml { transform: none; }
.pp-ch-mk--e .pp-ch-ml { transform: translateX(-100%); }
.pp-ch-end .pp-ch-ml { top: 6px; }
.pp-ch-end--today .pp-ch-tick { height: 14px; background: var(--accent); }
.pp-ch-end--today .pp-ch-ml { top: 16px; color: var(--accent-text); }
.pp-ch-line { height: 24px; }
.pp-ch-ln { position: absolute; top: 15px; height: 3px; border-radius: 2px; display: block; }
.pp-ch-ln::before { content: ''; position: absolute; left: 0; right: 0; top: -15px; height: 24px; }
.pp-ch-ln--partner { background: var(--accent); }
.pp-ch-ln--child { background: var(--primary); }
.pp-ch-ln--on.pp-ch-ln--partner { background: linear-gradient(90deg, var(--accent) 80%, transparent); }
.pp-ch-ln--on.pp-ch-ln--child { background: linear-gradient(90deg, var(--primary) 80%, transparent); }
.pp-ch-ln--short { min-width: 6px; border-radius: 3px; }
.pp-ch-lb { position: absolute; left: 0; bottom: 5px; color: var(--text-light); font-size: 10.5px; line-height: 12px; white-space: nowrap; }
.pp-ch-lb--end { left: auto; right: 0; }
.pp-ch-axis { height: 18px; border-top: 1px solid var(--divider); }
.pp-no-history .pp-ch-hist { display: none; }
.pp-no-kids .pp-ch-kid, .pp-no-kids .pp-ch-kid-lg { display: none; }
.pp-chart-legend { margin: 8px 0 0 !important; }
.pp-ch-lg { display: inline-flex; align-items: center; gap: 6px; }
.pp-ch-sw { display: inline-block; width: 16px; height: 10px; border-radius: 2px; }
.pp-ch-sw--partner { height: 3px; background: var(--accent); }
.pp-ch-sw--child { height: 3px; background: var(--primary); }
.pp-osa-flash { animation: pp-osa-flash 1.2s ease-out; }
.pp-osa-anchor { position: absolute; }
.pp-row:target, .pp-row:has(> .pp-t > .pp-osa-anchor:target) { animation: pp-osa-flash 1.2s ease-out; }
@keyframes pp-osa-flash { from { background: var(--hover-bg); } to { background: transparent; } }
@media (max-width: 640px) {
  .pp-chart-set--wide { display: none; }
  .pp-chart-set--narrow { display: block; }
}
@media ${LANDSCAPE} {
  .pp-ch-ages { height: 13px; }
  .pp-ch-hist { height: 21px; }
  .pp-ch-hbar { top: 9px; }
  .pp-ch-plabels { height: 15px; }
  .pp-ch-bar, .pp-ch-barin, .pp-ch-dash { height: 13px; }
  .pp-ch-band { height: 14px; }
  .pp-ch-res { line-height: 14px; }
  .pp-ch-marks { height: 28px; }
  .pp-ch-ml { top: 16px; }
  .pp-ch-line { height: 19px; }
  .pp-ch-ln { top: 12px; }
  .pp-ch-ln::before { top: -12px; height: 19px; }
  .pp-ch-axis { height: 15px; }
  .pp-chart-legend { flex-wrap: nowrap !important; overflow-x: auto; white-space: nowrap; }
}
@media (hover: hover) {
  .pp-ch-p:hover, .pp-ch-res:hover { filter: brightness(.94); }
  .pp-ch-mk:hover .pp-ch-gl, .pp-ch-mk:hover .pp-ch-ml { color: var(--accent-text); }
  .pp-ch-ln:hover { filter: brightness(1.15); }
}
@media (pointer: coarse) {
  .pp-ch-mk::before { left: -22px; width: 44px; }
  /* At the chart's ends the touch area grows inwards, never past the column. */
  .pp-ch-mk--s::before { left: 0; }
  .pp-ch-mk--e::before { left: -44px; }
}
@media print {
  .pp-chart { break-inside: avoid; }
  .pp-chart-set--wide { display: block !important; }
  .pp-chart-set--narrow { display: none !important; }
}
`;

/** Both blocks' rules. */
export const PERSON_PAGE_VIZ_CSS = PERSON_PAGE_MAP_CSS + PERSON_PAGE_CHART_CSS;
