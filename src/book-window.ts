/**
 * The family book's window on screen (1031 §6.1, §6.2): the sticky toolbar,
 * the side contents with the current chapter, the phone's "⋯" menu, and the
 * small script that runs them. Print hides all of it (§6.3). The window is
 * always light.
 *
 * The actions that need the app — Change options, Save as HTML, Share — are
 * buttons with `data-book-act`; the app wires them after writing the window
 * (src/ui/book-ui.ts). A saved book has none of them: its toolbar keeps the
 * title, the contents and Print. Pure and DOM-free.
 */

import { getStringsForLang } from './strings.js';
import { BookLang } from './book-options.js';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The saved book's file name: "{title}.html", characters no file system takes replaced. */
export function bookFileName(title: string): string {
    // eslint-disable-next-line no-control-regex
    const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^[.\s-]+|[.\s-]+$/g, '');
    return `${clean || 'book'}.html`;
}

/** One entry of the side contents: a link, a heading of a group, or a chapter / part under a lineage. */
export type BookSideEntry =
    | { kind: 'link'; href: string; label: string }
    | { kind: 'sub'; href: string; label: string }
    | { kind: 'group'; label: string };

const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** The toolbar (§6.1): the title and "· about {s} pages", the actions, ✕; on a phone "Contents", "⋯" and ✕ (§6.2). */
export function bookToolbarHtml(lang: BookLang, title: string, pages: number, forSave: boolean): string {
    const B = getStringsForLang(lang).book;
    const W = B.win;
    const act = (key: 'options' | 'save', label: string): string =>
        `<button type="button" class="book-bar-btn book-bar-wide book-bar-${key}" data-book-act="${key}">${esc(label)}</button>`;
    const actions = [
        `<button type="button" class="book-bar-btn book-bar-toc" data-book-ui="toc" aria-expanded="false" aria-controls="book-side">${esc(W.toc)}</button>`,
        forSave ? '' : act('options', W.options),
        forSave ? '' : act('save', W.save),
        `<button type="button" class="book-bar-btn book-bar-wide book-bar-primary" data-book-ui="print">${esc(B.toolbarPrint)}</button>`,
        forSave ? '' : `<button type="button" class="book-bar-icon book-bar-more" data-book-ui="more" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(W.more)}" title="${esc(W.more)}">⋯</button>`,
        forSave ? '' : `<button type="button" class="book-bar-icon book-bar-x" data-book-ui="close" aria-label="${esc(B.toolbarClose)}" title="${esc(B.toolbarClose)}">${CLOSE_SVG}</button>`,
    ].join('');
    const menu = forSave ? '' : `<div class="book-more" role="menu" hidden>`
        + `<button type="button" role="menuitem" data-book-act="save">${esc(W.save)}</button>`
        + `<button type="button" role="menuitem" data-book-act="share" hidden>${esc(W.share)}</button>`
        + `<button type="button" role="menuitem" data-book-ui="print">${esc(B.toolbarPrint)}</button>`
        + `<button type="button" role="menuitem" data-book-act="options">${esc(W.options)}</button></div>`;
    return `<header class="book-toolbar${forSave ? ' book-toolbar--saved' : ''}">`
        + `<div class="book-bar-title"><span class="book-bar-name">${esc(title)}</span><span class="book-bar-pages"> · ${esc(W.pages(pages))}</span></div>`
        + `<div class="book-bar-actions">${actions}</div>${menu}</header>`;
}

/** The side contents (§6.1): sticky on the left from 1100 px, a panel / bottom sheet below (§6.2). */
export function bookSideHtml(lang: BookLang, entries: readonly BookSideEntry[]): string {
    const B = getStringsForLang(lang).book;
    const rows = entries.map(e => e.kind === 'group'
        ? `<li class="book-side-group">${esc(e.label)}</li>`
        : `<li${e.kind === 'sub' ? ' class="book-side-sub"' : ''}><a href="${esc(e.href)}">${e.label}</a></li>`).join('');
    return `<nav class="book-side" id="book-side" aria-label="${esc(B.win.toc)}">`
        + `<div class="book-side-head"><span class="book-side-h">${esc(B.win.toc)}</span>`
        + `<button type="button" class="book-bar-icon book-side-x" data-book-ui="toc-close" aria-label="${esc(B.toolbarClose)}">${CLOSE_SVG}</button></div>`
        + `<ol>${rows}</ol></nav>`;
}

/**
 * The window's script (plain ES5, it also runs in a saved file): the contents
 * panel and the "⋯" menu open and close (a click outside or Escape closes
 * them), Print, Close, and the current chapter marked in the side contents —
 * the deepest section crossing a reading line a quarter down the view
 * (IntersectionObserver, as the person page's contents).
 */
export const BOOK_WINDOW_SCRIPT = `(function () {
  var d = document, b = d.body;
  var side = d.getElementById('book-side');
  var more = d.querySelector('.book-more');
  var tocBtn = d.querySelector('[data-book-ui="toc"]');
  var moreBtn = d.querySelector('[data-book-ui="more"]');
  function near(t, sel) { return t && t.closest ? t.closest(sel) : null; }
  function setToc(open) {
    b.classList.toggle('book-toc-open', open);
    if (tocBtn) tocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function setMore(open) {
    if (!more) return;
    more.hidden = !open;
    if (moreBtn) moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  d.addEventListener('click', function (e) {
    var t = e.target, el = near(t, '[data-book-ui]');
    var ui = el ? el.getAttribute('data-book-ui') : '';
    if (ui === 'toc') { setMore(false); setToc(!b.classList.contains('book-toc-open')); return; }
    if (ui === 'toc-close') { setToc(false); return; }
    if (ui === 'more') { setToc(false); setMore(!!(more && more.hidden)); return; }
    if (ui === 'print') { setMore(false); window.print(); return; }
    if (ui === 'close') { window.close(); setTimeout(function () { if (!window.closed) history.back(); }, 200); return; }
    if (more && !more.hidden && (!near(t, '.book-more') || near(t, '[data-book-act]'))) setMore(false);
    if (near(t, '.book-side a')) { setToc(false); return; }
    if (b.classList.contains('book-toc-open') && !near(t, '.book-side')) setToc(false);
  });
  d.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (more && !more.hidden) { setMore(false); if (moreBtn) moreBtn.focus(); return; }
    if (b.classList.contains('book-toc-open')) { setToc(false); if (tocBtn) tocBtn.focus(); }
  });
  if (!side || !('IntersectionObserver' in window)) return;
  var links = side.querySelectorAll('a[href^="#"]'), targets = [], linkOf = {}, on = {}, current = null;
  for (var i = 0; i < links.length; i++) {
    var id = links[i].getAttribute('href').slice(1), el = d.getElementById(id);
    if (el) { targets.push(el); linkOf[id] = links[i]; }
  }
  function mark() {
    var best = -1;
    for (var i = 0; i < targets.length; i++) if (on[targets[i].id]) best = i;
    if (best < 0) return;
    var a = linkOf[targets[best].id];
    if (a === current) return;
    if (current) current.removeAttribute('aria-current');
    current = a;
    a.setAttribute('aria-current', 'true');
    var r = a.getBoundingClientRect(), s = side.getBoundingClientRect();
    if (s.height > 0 && (r.top < s.top + 40 || r.bottom > s.bottom - 24)) side.scrollTop += r.top - s.top - s.height / 3;
  }
  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) on[entries[i].target.id] = entries[i].isIntersecting;
    mark();
  }, { rootMargin: '-25% 0px -74% 0px' });
  for (var j = 0; j < targets.length; j++) io.observe(targets[j]);
})();`;

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * The window on screen: a 52 px sticky toolbar the text starts under (it
 * never covers it: in the flow, `scroll-padding-top` for the anchors), one
 * paper column of 720 px (#fffefb on #e7e1d5), the side contents from 1100 px.
 */
export const BOOK_WINDOW_CSS = `
html { scroll-padding-top: 64px; }
@media screen {
    body { background: #e7e1d5; }
    .book-layout { display: flex; justify-content: center; align-items: flex-start; gap: 32px; padding: 24px 24px 56px; }
    .book { flex: 0 1 720px; max-width: 720px; margin: 0; background: #fffefb; box-shadow: 0 2px 14px rgba(0,0,0,.12); }
    .book-sheet { margin: 0; box-shadow: none; background: transparent; padding: 48px 56px; }
    .book-sheet + .book-sheet { border-top: 1px solid #ece5d6; }
    .book-title-page { min-height: 760px; }
}
.book-toolbar { position: sticky; top: 0; z-index: 20; height: 52px; box-sizing: border-box; display: flex; align-items: center; gap: 12px;
    padding: 0 12px 0 20px; background: #fffdf8; border-bottom: 1px solid #e3dccd; font-family: ${SANS}; color: #2b2822; }
.book-bar-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: #5c5546; }
.book-bar-name { font: 600 16px 'Strom Serif', Georgia, serif; color: #1f1c17; }
.book-bar-actions { flex: none; display: flex; align-items: center; gap: 8px; }
.book-bar-btn { display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid #d6cdbb;
    background: #fffefb; color: #2b2822; font: 500 14px ${SANS}; cursor: pointer; white-space: nowrap; }
.book-bar-save { border-color: #3f6b4f; color: #3f6b4f; font-weight: 600; }
.book-bar-primary { background: #3f6b4f; border-color: #3f6b4f; color: #fff; font-weight: 600; }
.book-bar-icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px;
    background: none; color: #4a4436; font: 600 20px/1 ${SANS}; cursor: pointer; }
.book-bar-btn:focus-visible, .book-bar-icon:focus-visible, .book-more button:focus-visible, .book-side a:focus-visible { outline: 2px solid #3f6b4f; outline-offset: 1px; }
.book-bar-toc, .book-bar-more { display: none !important; }
.book-more { position: absolute; top: 48px; right: 10px; z-index: 30; min-width: 230px; display: flex; flex-direction: column; padding: 6px;
    background: #fffefb; border: 1px solid #e3dccd; border-radius: 12px; box-shadow: 0 10px 30px rgba(20,16,8,.2); }
.book-more[hidden] { display: none; }
.book-more button { min-height: 44px; padding: 0 14px; border: 0; border-radius: 8px; background: none; color: #2b2822; font: 15px ${SANS}; text-align: left; cursor: pointer; }
.book-more button[hidden] { display: none; }
.book-side { flex: 0 0 220px; position: sticky; top: 76px; max-height: calc(100vh - 100px); overflow-y: auto; font-family: ${SANS}; overscroll-behavior: contain; }
.book-side-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px 8px; }
.book-side-h { font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #8a5528; }
.book-side-x { display: none; }
.book-side ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.book-side a { display: block; padding: 5px 10px; border-radius: 6px; font-size: 13.5px; line-height: 1.35; color: #4a4438; text-decoration: none; overflow-wrap: anywhere; }
.book-side-sub a { padding-left: 20px; font-size: 13px; }
.book-side-group { padding: 10px 10px 2px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #8a8270; }
.book-side a[aria-current="true"] { background: #efe9dc; color: #1f1c17; font-weight: 600; }
@media (hover: hover) {
    .book-side a:hover, .book-more button:hover { background: #f3eee2; color: #1f1c17; }
    .book-bar-btn:hover { background: #f6f2ea; }
    .book-bar-primary:hover { background: #355b43; }
    .book-bar-icon:hover { background: #f3eee2; }
}
/* Narrower than 1100 px: "Contents" in the toolbar opens the contents as a panel. */
@media (max-width: 1099px) {
    .book-bar-toc { display: inline-flex !important; }
    .book-layout { display: block; }
    .book { margin: 0 auto; }
    .book-side { display: none; position: fixed; top: 52px; left: 0; bottom: 0; width: min(340px, 86vw); max-height: none; z-index: 30;
        padding: 10px 8px 24px; background: #fffdf8; border-right: 1px solid #e3dccd; box-shadow: 6px 0 24px rgba(20,16,8,.16); }
    body.book-toc-open .book-side { display: block; }
    .book-side-x { display: inline-flex; }
}
/* Phone (§6.2): title with an ellipsis, Contents, ⋯ and ✕ at 44 px; the contents as a bottom sheet; margins 18 px. */
@media (max-width: 640px) {
    .book-toolbar { gap: 2px; padding: 0 4px 0 14px; }
    .book-bar-pages { display: none; }
    .book-bar-wide { display: none !important; }
    .book-toolbar--saved .book-bar-wide { display: inline-flex !important; }
    .book-bar-more { display: inline-flex !important; }
    .book-bar-toc { border: 0; background: none; color: #3f6b4f; font-weight: 600; padding: 0 10px; }
    .book-bar-btn, .book-bar-icon { min-height: 44px; }
    .book-bar-icon { width: 44px; height: 44px; }
    .book-layout { padding: 0; }
    .book { box-shadow: none; }
    .book-sheet { padding: 24px 18px; }
    .book-title-page { min-height: 70vh; }
    .book-side { top: auto; right: 0; width: auto; max-height: 72vh; border-right: 0; border-radius: 16px 16px 0 0;
        box-shadow: 0 -8px 30px rgba(20,16,8,.2); padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
    .book-side a { display: flex; align-items: center; min-height: 44px; padding-top: 0; padding-bottom: 0; }
}
@media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) { .book-title-page { min-height: auto; } }
@media (pointer: coarse) {
    .book-bar-btn { min-height: 44px; }
    .book-bar-icon { width: 44px; height: 44px; }
    .book-side a { min-height: 44px; display: flex; align-items: center; }
}
@media print {
    html { scroll-padding-top: 0; }
    .book-toolbar, .book-side, .book-more { display: none !important; }
    .book-layout { display: block; padding: 0; }
    .book { max-width: none; box-shadow: none; background: #fff; }
}
`;
