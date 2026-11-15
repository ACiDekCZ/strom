import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, seedSetting } from './helpers.js';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf-8')).version;

/**
 * About: the logo opens it, it shows the package.json version, and the support
 * link is a plain link to the author's page (no widget script). The Czech
 * labels are checked in cs.spec.ts.
 */
test('About shows the version and offers "Buy me a coffee" as a plain link in a new tab', async ({ page }) => {
    await openApp(page);
    await page.locator('.app-logo').click();
    const about = page.locator('#about-modal');
    await expect(about).toBeVisible();
    await expect(about.locator('#about-version')).toHaveText(APP_VERSION);
    await expect(about.locator('.about-support > p').first()).toContainText('free and open source');
    const link = about.getByRole('link', { name: 'Buy me a coffee' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://www.buymeacoffee.com/acidekcz');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // The Czech users' group is offered in the Czech UI only.
    await expect(about.locator('a[href*="facebook.com"], .about-users-group')).toHaveCount(0);
});

/**
 * The cup on "Buy me a coffee" has still steam: three wisps, fully drawn,
 * with or without reduced motion (no endless animation).
 */
test('The coffee cup in About has still steam, with or without reduced motion', async ({ page }) => {
    // The suite runs with reduced motion (playwright.config.ts); motion back on here.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openApp(page);
    await page.locator('.app-logo').click();
    const steam = page.locator('#about-modal .about-coffee .about-coffee-steam');
    await expect(steam).toHaveCount(3);
    const anim = () => steam.evaluateAll((els) => els.map((el) => {
        const cs = getComputedStyle(el);
        return { name: cs.animationName, opacity: cs.opacity };
    }));
    const still = [{ name: 'none', opacity: '1' }, { name: 'none', opacity: '1' }, { name: 'none', opacity: '1' }];
    expect(await anim()).toEqual(still);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await anim()).toEqual(still);
});

/**
 * What's new: About opens the same "What's new" dialog as after an update
 * (its "All changes ↗" leads on to the changelog on GitHub), over About. The
 * link keeps the changelog's address in the UI language at the section of the
 * running version (opened as a link only where the build has no notes). The
 * tests run on localhost, where the branch follows the version: a beta version
 * reads the beta branch, a released one main. The anchor is the version
 * without its suffix.
 */
const CHANGELOG_BRANCH = /-beta\b/.test(APP_VERSION) ? 'beta' : 'main';
const CHANGELOG_ANCHOR = APP_VERSION.split('-')[0].replace(/\./g, '');
const changelogHref = (file: string) =>
    `https://github.com/ACiDekCZ/strom/blob/${CHANGELOG_BRANCH}/${file}#${CHANGELOG_ANCHOR}`;

// The Czech and German labels are checked in cs.spec.ts
// and de.spec.ts; every language × branch × version in about-changelog.test.ts.
test('About\'s What\'s new opens the dialog of an update over About; closing it goes back to About', async ({ page }) => {
    await openApp(page);
    const seenBefore = await page.evaluate(() => localStorage.getItem('strom-whats-new-seen'));
    await page.locator('.app-logo').click();
    const about = page.locator('#about-modal');
    await expect(about).toBeVisible();
    const link = about.getByRole('link', { name: "What's new", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', changelogHref('CHANGELOG.md'));
    await expect(link).toHaveAttribute('aria-haspopup', 'dialog');

    // Not a new window: the dialog in the app, the same one as after an update.
    const popups: unknown[] = [];
    page.on('popup', (p) => popups.push(p));
    await link.click();
    const notes = page.locator('#release-notes-modal');
    await expect(notes).toBeVisible();
    await expect(notes.getByRole('heading', { name: "What's new" })).toBeVisible();
    await expect(notes).toContainText(`Strom ${APP_VERSION}`);
    await expect(notes.locator('.release-notes-list li').first()).toBeVisible();
    const full = notes.getByRole('link', { name: 'All changes ↗' });
    await expect(full).toHaveAttribute('href', changelogHref('CHANGELOG.md'));
    await expect(full).toHaveAttribute('target', '_blank');
    // "Don't show next time" is about the dialog after an update: not here.
    await expect(notes.locator('#release-notes-dont-show')).toHaveCount(0);
    expect(popups).toHaveLength(0);

    // Escape closes the notes alone; About stays, its link takes the focus back.
    await page.keyboard.press('Escape');
    await expect(notes).toHaveCount(0);
    await expect(about).toBeVisible();
    await expect(link).toBeFocused();
    // Opened again and closed by its button: About still there; nothing recorded.
    await link.click();
    await expect(notes).toBeVisible();
    await notes.locator('.release-notes-close').click();
    await expect(notes).toHaveCount(0);
    await expect(about).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('strom-whats-new-seen'))).toBe(seenBefore);
});

/**
 * License: AGPL-3.0-or-later. The app runs over the network, so (AGPL
 * section 13) About offers the corresponding source: a visible link to the
 * public repository in a new tab, on a phone as well as a tablet and a desktop.
 */
for (const vp of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 820, height: 1180 },
    { name: 'phone', width: 360, height: 740 },
    { name: 'phone sideways', width: 740, height: 360 },
]) {
    test(`About shows the license AGPL-3.0-or-later and a link to the source code (${vp.name})`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        const about = page.locator('#about-modal');
        await expect(about).toBeVisible();

        const license = about.locator('#about-license');
        await expect(license).toHaveText('AGPL-3.0-or-later');
        await expect(license).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
        await expect(about).not.toContainText('MPL');

        const source = about.getByRole('link', { name: 'Source code' });
        await source.scrollIntoViewIfNeeded();
        await expect(source).toBeVisible();
        await expect(source).toHaveAttribute('href', 'https://github.com/ACiDekCZ/strom');
        await expect(source).toHaveAttribute('target', '_blank');
        await expect(source).toHaveAttribute('rel', /noopener/);

        // The link lies inside the dialog and inside the viewport.
        const box = await source.boundingBox();
        const dialog = await about.locator('.about-modal').boundingBox();
        expect(box).not.toBeNull();
        expect(dialog).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(dialog!.x);
        expect(box!.x + box!.width).toBeLessThanOrEqual(dialog!.x + dialog!.width);
        expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);

        // What's new sits beside the source link, inside the dialog and the viewport too.
        const whatsNew = about.getByRole('link', { name: "What's new", exact: true });
        await whatsNew.scrollIntoViewIfNeeded();
        await expect(whatsNew).toBeVisible();
        const wn = await whatsNew.boundingBox();
        expect(wn).not.toBeNull();
        expect(wn!.x).toBeGreaterThanOrEqual(dialog!.x);
        expect(wn!.x + wn!.width).toBeLessThanOrEqual(dialog!.x + dialog!.width);
        expect(wn!.x + wn!.width).toBeLessThanOrEqual(vp.width);
    });
}

/**
 * Sharing helps too: under the coffee, "Share Strom" opens the system share
 * sheet with the website in the UI language; without one it copies the
 * address and says so briefly; a sheet closed without sharing ends quietly.
 * The author on X is a link beside the others, in a new tab.
 */
test('About: Share Strom opens the share sheet with the website in the UI language', async ({ page }) => {
    await seedSetting(page, 'language', 'de');
    await page.addInitScript(() => {
        const w = window as unknown as { __shared: unknown[] };
        w.__shared = [];
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (data: unknown) => { w.__shared.push(data); },
        });
    });
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showAboutDialog());
    const about = page.locator('#about-modal');
    await expect(about.locator('.about-share-note')).toHaveText('Auch Teilen hilft: Je mehr Menschen Strom kennen, desto mehr kann es wachsen.');
    const share = about.getByRole('button', { name: 'Strom teilen' });
    await share.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
        .toEqual([{ title: 'Strom', url: 'https://stromapp.info/de/' }]);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(about).toBeVisible();
});

test('About: a cancelled share sheet shows nothing; without a sheet the address is copied with a short notice', async ({ page }) => {
    await seedSetting(page, 'language', 'cs');
    await page.addInitScript(() => {
        const w = window as unknown as { __copied: string[] };
        w.__copied = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (t: string) => { w.__copied.push(t); } },
        });
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async () => { throw new DOMException('Share canceled', 'AbortError'); },
        });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showAboutDialog());
    const about = page.locator('#about-modal');
    await expect(about.locator('.about-share-note')).toHaveText('Pomůže i sdílení: čím víc lidí o Stromu ví, tím víc se může rozvíjet.');
    const share = about.getByRole('button', { name: 'Sdílet Strom' });

    // A share sheet closed without sharing: no copy, no notice, no error.
    await share.click();
    await page.waitForTimeout(300);
    await expect(page.locator('.toast')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([]);

    // No share sheet: the address is copied and the notice says so.
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await share.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied))
        .toEqual(['https://stromapp.info/cs/']);
    await expect(page.locator('.toast')).toHaveText('Odkaz zkopírován');
    expect(errors).toEqual([]);
});

test('About: a share sheet that never opens (an app window on a Mac) still copies the address, the notice over the dialog', async ({ page }) => {
    await page.addInitScript(() => {
        const w = window as unknown as { __copied: string[] };
        w.__copied = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (t: string) => { w.__copied.push(t); } },
        });
        // Chrome's share() in an app window on a Mac: no sheet, never settles.
        Object.defineProperty(navigator, 'share', { configurable: true, value: () => new Promise(() => {}) });
    });
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showAboutDialog());
    const about = page.locator('#about-modal');
    await about.getByRole('button', { name: 'Share Strom' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied), { timeout: 4000 })
        .toEqual(['https://stromapp.info/']);
    const toast = page.locator('.toast');
    await expect(toast).toHaveText('Link copied');
    await expect(about).toBeVisible();
    // Seen, not under the dialog's shade: the toast is what is on top at its centre, above the Close button.
    await expect.poll(() => toast.evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    })).toBe(true);
    const close = await about.locator('.about-footer button').boundingBox();
    const box = await toast.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(close!.y);
});

test('About: the author on X is a link beside the others, in a new tab', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showAboutDialog());
    const x = page.locator('#about-modal .about-meta').getByRole('link', { name: 'Author on X ↗' });
    await expect(x).toBeVisible();
    await expect(x).toHaveAttribute('href', 'https://x.com/visekm');
    await expect(x).toHaveAttribute('target', '_blank');
    await expect(x).toHaveAttribute('rel', /\bnoopener\b/);
    // The share button is a web action without a mark (no ↗, no ◆).
    await expect(page.locator('#about-share')).toHaveText('Share Strom');
});

/**
 * About with the sharing line and the X link fits every screen: nothing
 * spills past the dialog or the viewport, nothing overlaps, and on touch the
 * support buttons are a finger high. German has the longest texts; a wider
 * fallback font stands in for CI's fonts.
 */
for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'phone', width: 390, height: 844, touch: true },
    { name: 'phone sideways', width: 844, height: 390, touch: true },
]) {
    for (const lang of ['de', 'pl']) {
        test(`About with sharing and the X link fits (${lang}, ${vp.name})`, async ({ browser }) => {
            const context = await browser.newContext({
                viewport: { width: vp.width, height: vp.height },
                hasTouch: !!vp.touch, isMobile: !!vp.touch,
            });
            const page = await context.newPage();
            await seedSetting(page, 'language', lang);
            await openApp(page);
            await page.addStyleTag({ content: '#about-modal, #about-modal * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
            await page.evaluate(() => window.Strom.UI.showAboutDialog());
            const about = page.locator('#about-modal .about-modal');
            await expect(about).toBeVisible();
            const share = page.locator('#about-share');
            await share.scrollIntoViewIfNeeded();
            const res = await page.evaluate(() => {
                const dlg = document.querySelector<HTMLElement>('#about-modal .about-modal')!;
                const d = dlg.getBoundingClientRect();
                const els = [...dlg.querySelectorAll<HTMLElement>('.about-meta a, .about-support p, .about-coffee')];
                const rects = els.map(el => ({ t: el.textContent!.trim().slice(0, 20), r: el.getBoundingClientRect() }));
                const outside = rects.filter(({ r }) => r.left < d.left - 0.5 || r.right > d.right + 0.5 || r.right > window.innerWidth)
                    .map(x => x.t);
                const overlaps: string[] = [];
                for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
                    const a = rects[i].r, b = rects[j].r;
                    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(`${rects[i].t} / ${rects[j].t}`);
                }
                const buttons = [...dlg.querySelectorAll<HTMLElement>('.about-coffee')].map(b => b.getBoundingClientRect().height);
                const shareBtn = dlg.querySelector<HTMLElement>('#about-share')!;
                return {
                    outside, overlaps, buttons,
                    dialogScroll: dlg.scrollWidth - dlg.clientWidth,
                    pageScroll: document.documentElement.scrollWidth - window.innerWidth,
                    shareOneLine: shareBtn.getBoundingClientRect().height < 50,
                };
            });
            expect(res.outside).toEqual([]);
            expect(res.overlaps).toEqual([]);
            expect(res.dialogScroll).toBeLessThanOrEqual(0);
            expect(res.pageScroll).toBeLessThanOrEqual(0);
            expect(res.shareOneLine).toBe(true);
            if (vp.touch) for (const h of res.buttons) expect(h).toBeGreaterThanOrEqual(44);
            await context.close();
        });
    }
}

/**
 * The embedded serif is a subset of Source Serif 4, whose OFL reserves the
 * name "Source": a modified copy must not carry it, so the app ships it as
 * "Strom Serif". The original name stays only in the license notice at the top
 * of <head>. Every face is a data: URI inside the one HTML file.
 */
test('the serif is embedded as "Strom Serif" and no face is declared under the reserved name "Source"', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();
    await page.evaluate(() => document.fonts.ready);

    const faces = await page.evaluate(() => [...document.fonts]
        .map(f => ({ family: f.family.replace(/["']/g, ''), weight: f.weight, status: f.status })));
    expect(faces.filter(f => /Source/i.test(f.family))).toEqual([]);
    expect(faces.filter(f => f.family === 'Strom Serif').map(f => f.weight).sort()).toEqual(['400', '600']);
    expect(faces.find(f => f.family === 'Strom Serif' && f.weight === '600')?.status).toBe('loaded');

    // A card name is set in it.
    const nameFont = await page.locator('#tree-canvas .person-card .name-text').first()
        .evaluate(el => getComputedStyle(el).fontFamily);
    expect(nameFont).toMatch(/^["']?Strom Serif["']?,/);

    // Every @font-face of the app is a data: URI (nothing is loaded beside the file).
    const srcs = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => {
        try { return [...sheet.cssRules]; } catch { return []; }
    }).filter((r): r is CSSFontFaceRule => r instanceof CSSFontFaceRule)
        .map(r => r.style.getPropertyValue('src')));
    expect(srcs.length).toBeGreaterThanOrEqual(5);
    for (const src of srcs) expect(src).toMatch(/^url\("data:font\/woff2;base64,/);

    // Outside the license comment at the top of <head> the reserved name appears only in the same notice that the
    // family book carries with its fonts (OFL 1.1 asks the notice to travel with the font), never as a face's name.
    const html = await (await page.request.get('/strom.html')).text();
    const notice = html.indexOf('-->');
    expect(html.slice(0, notice)).toContain('Source Serif 4');
    const bookNotice = /Strom Serif: a modified \(subsetted\) version of Source Serif 4 \(designed by /g;
    expect(html.slice(notice).match(bookNotice)).toHaveLength(1);
    expect(html.slice(notice).replace(bookNotice, '')).not.toMatch(/Source Serif/);
});

