/**
 * The app's fonts for the image export. index.html inlines its webfonts as
 * @font-face rules with data: URIs; the poster SVG carries copies of the faces
 * it draws with, so the SVG file and the PNG (rasterised from the SVG through
 * an <img>, which cannot see the page's fonts) set the cards in the screen's
 * fonts. Only the faces asked for are copied (each is 25–43 KB of base64).
 *
 * When a face cannot be read (no such rule, a stylesheet that refuses access)
 * it is left out; the export then still keeps its geometry, because the custom
 * card's texts are drawn at the widths measured on screen (src/export-image.ts).
 */

/** A face of the app: its family name and weight as index.html declares them. */
export interface FontFaceWant {
    family: string;
    weight: number;
}

/** A @font-face rule as read from a stylesheet. */
export interface FontFaceRuleInfo {
    family: string;
    weight: string;
    cssText: string;
}

/** The serif faces every tree poster draws with (names, initials, footer). */
export const POSTER_SERIF_FACES: FontFaceWant[] = [
    { family: 'Source Serif 4', weight: 400 },
    { family: 'Source Serif 4', weight: 600 },
];
/** The sans faces of the custom card's lines (dates 500, places 400). */
export const POSTER_LINE_FACES: FontFaceWant[] = [
    { family: 'Instrument Sans', weight: 400 },
    { family: 'Instrument Sans', weight: 500 },
];

function normalizeFamily(family: string): string {
    return family.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

function normalizeWeight(weight: string): number {
    const w = weight.trim().toLowerCase();
    if (w === '' || w === 'normal') return 400;
    if (w === 'bold') return 700;
    return parseInt(w, 10);
}

/** The CSS of the wanted faces, one rule each, in the order asked for ('' when none is found). */
export function pickFontFaceCss(rules: Iterable<FontFaceRuleInfo>, wants: readonly FontFaceWant[]): string {
    const list = [...rules];
    const out: string[] = [];
    for (const want of wants) {
        const rule = list.find(r => normalizeFamily(r.family) === want.family.toLowerCase()
            && normalizeWeight(r.weight) === want.weight);
        // "]]>" would close the CDATA section the SVG wraps the CSS in.
        if (rule && !rule.cssText.includes(']]>')) out.push(rule.cssText);
    }
    return out.join('\n');
}

/** The @font-face rules of the document's stylesheets. */
function documentFontFaceRules(): FontFaceRuleInfo[] {
    const rules: FontFaceRuleInfo[] = [];
    if (typeof document === 'undefined') return rules;
    for (const sheet of Array.from(document.styleSheets)) {
        let cssRules: CSSRuleList;
        try {
            cssRules = sheet.cssRules;
        } catch {
            continue; // a stylesheet that refuses access
        }
        for (const rule of Array.from(cssRules)) {
            if (typeof CSSFontFaceRule === 'undefined' || !(rule instanceof CSSFontFaceRule)) continue;
            rules.push({
                family: rule.style.getPropertyValue('font-family'),
                weight: rule.style.getPropertyValue('font-weight'),
                cssText: rule.cssText,
            });
        }
    }
    return rules;
}

const cache = new Map<string, string>();

/** The app's @font-face rules for the wanted faces, ready for an SVG <style> ('' when unavailable). */
export function appFontFaceCss(wants: readonly FontFaceWant[]): string {
    const key = wants.map(w => `${w.family}:${w.weight}`).join('|');
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const css = pickFontFaceCss(documentFontFaceRules(), wants);
    if (css) cache.set(key, css);
    return css;
}
