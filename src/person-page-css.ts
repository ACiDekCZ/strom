/**
 * Styles and script of the person page (spec 025). One source for the window
 * (the app injects PERSON_PAGE_CSS; its tokens come from index.html, dark mode
 * included) and for the saved file (personPageFileCss: the light token values
 * on :root, the fonts, the same rules). The window chrome (.modal--page,
 * .pp-head, .pp-toc) is the window's own and is not here.
 */

/** The light ("paper") values of the app tokens the page uses — the file's :root and print. */
export const PERSON_PAGE_LIGHT_TOKENS = [
    '--surface: #fffdf8', '--surface-2: #f6f2ea', '--surface-modal: #fbf8f1',
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
.pp-photo, .pp-initials { flex: 0 0 auto; width: clamp(68px, 13cqi, 104px); height: clamp(68px, 13cqi, 104px); border-radius: 50%; }
.pp-photo { object-fit: cover; border: 1px solid var(--border); }
.pp-initials { display: flex; align-items: center; justify-content: center; background: var(--surface-2); color: var(--text-light); font-family: var(--font-serif); font-size: clamp(24px, 4.6cqi, 36px); }
.pp-hero-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pp-name { font-size: clamp(26px, 4.8cqi, 36px); line-height: 1.15; overflow-wrap: anywhere; text-wrap: balance; }
.pp-aka { font-size: 13.5px; color: var(--text-faint); overflow-wrap: anywhere; }
.pp-facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 6px 0 0; font-size: 15px; }
.pp-facts dt { color: var(--text-light); }
.pp-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.pp-differs { display: inline-block; margin-left: 6px; padding: 0 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--accent-text); font: inherit; font-size: 12px; line-height: 20px; text-decoration: none; cursor: pointer; white-space: nowrap; }
.pp-link { display: inline; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; text-decoration: underline dotted; text-underline-offset: 3px; cursor: pointer; }
a.pp-link { color: inherit; }
.pp-sec-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-bottom: 14px; }
.pp-fam { display: flex; flex-direction: column; gap: 12px; }
.pp-fam-row { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: flex-start; }
.pp-fam-label { flex: 0 0 104px; padding-top: 10px; font-size: 13.5px; color: var(--text-light); }
.pp-fam-cards { flex: 1 1 300px; min-width: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.pp-card { display: inline-flex; flex-direction: column; justify-content: center; min-height: 44px; max-width: 100%; padding: 6px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; text-align: left; overflow-wrap: anywhere; }
button.pp-card { cursor: pointer; }
.pp-card-name { font-size: 15px; font-weight: 600; color: var(--primary); }
.pp-card-years { font-size: 12.5px; color: var(--text-light); white-space: nowrap; }
.pp-card-sub { margin-top: 1px; font-size: 12.5px; font-weight: 400; color: var(--text-light); overflow-wrap: anywhere; }
.pp-file .pp-card, .pp-card--plain { min-height: 0; border-color: transparent; padding: 2px 0; background: none; }
.pp-file .pp-fam-cards { gap: 6px 20px; }
.pp-file .pp-fam-label { padding-top: 2px; }
.pp-file .pp-card-name, .pp-card--plain .pp-card-name { color: var(--text); }
.pp-coll > .pp-disc, .pp-coll > summary { list-style: none; cursor: pointer; }
.pp-coll > summary::-webkit-details-marker, .pp-dtx > summary::-webkit-details-marker, .pp-quote > summary::-webkit-details-marker { display: none; }
.pp-disc { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 48px; padding: 6px 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; }
.pp-disc--inline { display: inline-flex; width: auto; min-height: 32px; color: var(--primary); font-weight: 600; font-size: 13.5px; }
.pp-fold-state { margin-left: auto; font-family: var(--font-sans); font-weight: 400; font-size: 13px; color: var(--text-faint); white-space: nowrap; }
.pp-fold-state .pp-st-open, .pp-coll[open] > summary .pp-st-closed, .pp-disc[aria-expanded="true"] .pp-st-closed { display: none; }
.pp-coll[open] > summary .pp-st-open, .pp-disc[aria-expanded="true"] .pp-st-open { display: inline; }
.pp-count { font-size: 13.5px; color: var(--text-faint); font-weight: 400; font-family: var(--font-sans); }
.pp-peek { display: block; font-size: 13.5px; color: var(--text-light); overflow-wrap: anywhere; }
.pp-coll[open] > summary .pp-peek, .pp-disc[aria-expanded="true"] .pp-peek { display: none; }
.pp-sum-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; flex: 1 1 auto; min-width: 0; }
.pp .pp-draft-tag { display: inline-block; margin-left: 8px; padding: 0 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-light); font-size: 11px; line-height: 18px; letter-spacing: 0; text-transform: none; vertical-align: 1px; }
.pp .pp-story-title { font-size: clamp(21px, 3.6cqi, 26px); line-height: 1.25; margin: 6px 0 12px; overflow-wrap: anywhere; hyphens: auto; }
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
.pp-row { display: grid; grid-template-columns: 46px 28px minmax(0, 1fr); column-gap: 8px; }
.pp-y { padding: 6px 0; text-align: right; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pp-m { display: flex; justify-content: center; align-items: flex-start; padding-top: 6px; background: linear-gradient(var(--divider), var(--divider)) center / 2px 100% no-repeat; }
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
.pp-row--kid .pp-y { padding-right: 10px; font-size: 13px; font-weight: 400; color: var(--text-light); }
.pp-row--kid .pp-mk { font-size: 15px; color: var(--text-faint); }
.pp-row--kid .pp-t { font-size: 14px; color: var(--text-light); }
.pp-no-history .pp-row--hist, .pp-no-history .pp-legend, .pp-no-kids .pp-row--kid { display: none; }
.pp-no-kids .pp-seg:not(.pp-seg--own):not(.pp-seg--hist), .pp-no-history .pp-seg:not(.pp-seg--own):not(.pp-seg--kid),
.pp-no-history.pp-no-kids .pp-seg:not(.pp-seg--own) { display: none; }
.pp-fig { display: grid; grid-template-columns: minmax(0, 1fr); margin: 10px 0 4px; max-width: 460px; }
.pp-fig img { grid-area: 1 / 1; display: block; width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
.pp-fig figcaption { grid-row: 2; margin-top: 4px; font-size: 12.5px; color: var(--text-light); overflow-wrap: anywhere; }
.pp-zoom { grid-area: 1 / 1; align-self: end; justify-self: end; margin: 6px; width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 15px; line-height: 1; cursor: pointer; }
.pp-mat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr)); gap: 12px; margin-top: 12px; }
.pp-mat { margin: 0; min-width: 0; }
.pp-mat img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
.pp-mat figcaption { margin-top: 4px; font-size: 12.5px; color: var(--text-light); overflow-wrap: anywhere; }
.pp-mat-files { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.pp-mat-kind { font-size: 11.5px; font-weight: 600; color: var(--text-faint); }
.pp-mat-hint { color: var(--text-faint); font-size: 13px; }
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
.pp-zoom-layer { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(20, 18, 14, 0.86); touch-action: pinch-zoom; }
.pp-zoom-layer img { max-width: 100%; max-height: 100%; object-fit: contain; border: 0; background: none; }
.pp-zoom-close { position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; border: 0; border-radius: 22px; background: rgba(255, 253, 248, 0.92); color: #2b2822; font-size: 26px; line-height: 1; cursor: pointer; }
@media (hover: hover) {
  button.pp-card:hover, .pp-src > .pp-disc:hover, .pp-src > summary:hover { background: var(--hover-bg); }
  .pp-toggle:hover { border-color: var(--primary); }
  .pp-link:hover, .pp-act:hover { text-decoration-style: solid; }
}
@media (pointer: coarse) {
  .pp-toggle, .pp-link-card, .pp-card, .pp-disc--inline { min-height: 44px; }
  .pp-zoom { width: 44px; height: 44px; }
}
@media (max-width: 640px) {
  .pp { gap: 26px; }
  .pp-hero { gap: 14px; }
  .pp-fig { max-width: 100%; }
}
@media (min-width: 641px) and (max-width: 1024px) {
  .pp-fig { max-width: 460px; }
}
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
  .pp { gap: 24px; }
  .pp-photo, .pp-initials { width: 68px; height: 68px; }
}
@media print {
  body.printing-person-page > :not(.modal-overlay--page) { display: none !important; }
  .pp, .pp-body { ${PERSON_PAGE_LIGHT_TOKENS} }
  .pp-head, .pp-toc, .pp-toggles, .pp-zoom, .pp-fold-state, .pp-differs, .pp-act, .pp-more, .pp-zoom-layer, .js-only { display: none !important; }
  .pp-body { overflow: visible !important; height: auto !important; }
  .pp { font-size: 11pt; gap: 18pt; max-width: none; }
  .pp-aka, .pp-dt, .pp-hist-meta, .pp-card-years, .pp-card-sub, .pp-src-sup, .pp-src-ref, .pp-foot, .pp-fig figcaption { font-size: 10pt; }
  #pp-sec-timeline { break-before: page; }
  .pp-card { min-height: 0 !important; border-color: transparent; padding: 2px 0; background: none; }
  .pp-card-name { color: var(--text); }
  .pp-fam-cards { gap: 6px 20px; }
  .pp-row, .pp-fig, .pp-src { break-inside: avoid; }
  .pp-fig { max-width: 100%; }
  .pp-dtx .pp-dt { display: block; overflow: visible; }
  #pp-sec-sources .pp-fold-body { display: block !important; }
  #pp-sec-sources .pp-src-list { list-style: decimal; padding-left: 20pt; gap: 4pt; }
  #pp-sec-sources .pp-src { display: list-item; border: 0; padding: 0; }
  #pp-sec-sources .pp-src-body, #pp-sec-sources .pp-src-intro, #pp-sec-sources .pp-peek { display: none !important; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 8pt; }
}
`;

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
    return `${fonts}\n:root { ${PERSON_PAGE_LIGHT_TOKENS} ${FONT_STACKS} color-scheme: light; }\n${FILE_FRAME_CSS}${PERSON_PAGE_CSS}`;
}

/**
 * The saved file's script (inline, no libraries): the History / Children's
 * events switches, history excerpts closed on load (open without JS), the
 * light box over the SAME <img> (Esc, ×, a tap outside closes it), "sources
 * differ" opening the researchers' section, and the sources list open for
 * printing.
 */
export const PERSON_PAGE_SCRIPT = `(function(){var d=document,a=d.querySelector('article.pp');if(!a)return;
var q=function(s){return Array.prototype.slice.call(d.querySelectorAll(s))};
q('details.pp-quote[open]').forEach(function(e){e.open=false});
q('[data-pp-switch]').forEach(function(b){b.addEventListener('click',function(){var on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',on?'true':'false');a.classList.toggle(b.getAttribute('data-pp-switch')==='history'?'pp-no-history':'pp-no-kids',!on)})});
var r=d.getElementById('pp-research');q('a.pp-differs').forEach(function(l){l.addEventListener('click',function(){if(r)r.open=true})});
var z=null,img=null,back=null,last=null;
function shut(){if(!z)return;back.parentNode.insertBefore(img,back);back.parentNode.removeChild(back);z.parentNode.removeChild(z);z=null;if(last)last.focus()}
function show(f,from){img=f.querySelector('img');if(!img||z)return;last=from;back=d.createElement('span');img.parentNode.insertBefore(back,img);z=d.createElement('div');z.className='pp-zoom-layer';z.setAttribute('role','dialog');z.setAttribute('aria-modal','true');var c=d.createElement('button');c.type='button';c.className='pp-zoom-close';c.setAttribute('aria-label',a.getAttribute('data-pp-close')||'');c.textContent='\\u00d7';c.addEventListener('click',shut);z.appendChild(c);z.appendChild(img);z.addEventListener('click',function(e){if(e.target===z)shut()});d.body.appendChild(z);c.focus()}
q('.pp-fig').forEach(function(f){var b=f.querySelector('.pp-zoom'),i=f.querySelector('img');if(b)b.addEventListener('click',function(){show(f,b)});if(i)i.addEventListener('click',function(){if(!z)show(f,b||i)})});
d.addEventListener('keydown',function(e){if(e.key==='Escape')shut()});
var s=d.getElementById('pp-sources-fold'),was=false;
window.addEventListener('beforeprint',function(){if(s){was=s.open;s.open=true}});
window.addEventListener('afterprint',function(){if(s)s.open=was});
})();`;
