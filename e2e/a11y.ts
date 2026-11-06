import { Page } from '@playwright/test';

/**
 * What the browser's accessibility tree holds (Chrome DevTools Protocol, the
 * same tree a screen reader or a browser agent's page reader gets): the
 * interactive elements without an accessible name, and the dialogs and menus
 * in it. Hidden, inert and display:none elements are not in it.
 */
export interface AxItem { role: string; name: string; html: string }

interface AxNode {
    nodeId: string;
    ignored: boolean;
    role?: { value: string };
    name?: { value: string; sources?: { type: string; attribute?: string; value?: { value: string }; superseded?: boolean }[] };
    backendDOMNodeId?: number;
}

const INTERACTIVE = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'checkbox', 'radio', 'option']);

async function axNodes(page: Page): Promise<{ nodes: AxNode[]; describe: (n: AxNode) => Promise<string> }> {
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: AxNode[] };
    const describe = async (n: AxNode): Promise<string> => {
        if (!n.backendDOMNodeId) return '';
        try {
            const { outerHTML } = await cdp.send('DOM.getOuterHTML', { backendNodeId: n.backendDOMNodeId }) as { outerHTML: string };
            return outerHTML.slice(0, 160);
        } catch { return ''; }
    };
    return { nodes, describe };
}

/** Buttons, links, menu items, tabs… in the accessibility tree that have no name. */
export async function unnamedControls(page: Page): Promise<AxItem[]> {
    const { nodes, describe } = await axNodes(page);
    const out: AxItem[] = [];
    for (const n of nodes) {
        if (n.ignored) continue;
        const role = n.role?.value ?? '';
        if (!INTERACTIVE.has(role)) continue;
        const name = (n.name?.value ?? '').trim();
        // A name from the title alone counts as none: a tooltip, which page readers often skip.
        const used = (n.name?.sources ?? []).find(s => !s.superseded && s.value?.value?.trim());
        const fromTitle = !!name && used?.attribute === 'title';
        // A name of symbols only ("×", "⤢", "›") reads as nothing.
        const readable = /[\p{L}\p{N}]/u.test(name);
        if (name && readable && !fromTitle) continue;
        out.push({ role, name, html: await describe(n) });
    }
    return out;
}

/** The dialogs (dialog, alertdialog) and menus in the accessibility tree, with their names. */
export async function axDialogsAndMenus(page: Page): Promise<AxItem[]> {
    const { nodes, describe } = await axNodes(page);
    const out: AxItem[] = [];
    for (const n of nodes) {
        if (n.ignored) continue;
        const role = n.role?.value ?? '';
        if (!['dialog', 'alertdialog', 'menu'].includes(role)) continue;
        out.push({ role, name: n.name?.value ?? '', html: await describe(n) });
    }
    return out;
}

/**
 * The dialogs and menus a page reader that walks the DOM still finds: every
 * `.modal-overlay` and `[role=dialog|alertdialog|menu]` with no `hidden`,
 * `inert` or `aria-hidden="true"` on itself or an ancestor, outermost only
 * (a dialog box inside its overlay counts once). CSS alone (display: none,
 * visibility, opacity) does not count as out: such a reader does not see it.
 */
export function domExposedPopups(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const sel = '.modal-overlay, [role="dialog"], [role="alertdialog"], [role="menu"]';
        const out = (el: Element): boolean => !!el.closest('[hidden], [inert], [aria-hidden="true"]');
        const exposed = Array.from(document.querySelectorAll(sel)).filter(el => !out(el));
        return exposed
            .filter(el => !exposed.some(o => o !== el && o.contains(el)))
            .map(el => {
                const id = el.id ? `#${el.id}` : '';
                const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
                return `${el.tagName.toLowerCase()}${id}${cls}`;
            });
    });
}
