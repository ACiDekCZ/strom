// Drawn portraits for the photo on the card (Strom 3.29, spec 096): an illustration of an old photograph for some
// people of the app's family (family-data.ts keys), no real faces, no photos, no generated images — each portrait
// is plain SVG drawn from a few numbers (hair, collar, beard…), toned like the photographs of its time: a cabinet
// card of the 19th century (brown sepia, a strong oval), a studio photograph of the 1920s–30s (warm sepia), a
// post-war print (grey). Rendered by Chromium as a square JPEG of 256 px at quality 0.8, the size the app itself
// keeps a person's photo in (src/photo.ts PHOTO_SIZE, PHOTO_QUALITY). One set for every language.
//   node gen-portraits.mjs [outdir] [--sheet <file.png>] [--more]
// → <outdir>/<key>.jpg (default ./portraits); --sheet: all of them side by side, large and at the card's size.
// --more: also the people of MORE (the fan's outer rings and Jana's descendants, for the fan's portraits in every
// ring). Only into a folder of their own (SHOWCASE_PORTRAITS of that run): ./portraits and the whole set stay as
// they are.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Playwright of the Strom repository this folder lives in (tools/ukazka)
const { chromium } = createRequire(path.resolve(HERE, '../../package.json'))('playwright');

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const sheet = sheetAt >= 0 ? path.resolve(args[sheetAt + 1]) : null;
const more = args.includes('--more');
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && (sheetAt < 0 || i !== sheetAt + 1)) ?? path.join(HERE, 'portraits'));

/**
 * Who has a portrait (a key of FAMILY) and how it looks. era: c19 | e20 | post; hair: a style below; tone: hair
 * 0 light … 1 dark; grey: 0 … 1; collar: the clothes; age: young | middle | old; jaw, w, h: the face's shape
 * (1 = average); turn: −1 … 1 the face a little to its left or right; smile 0 … 1.
 */
const PEOPLE = [
    // the 19th century: cabinet cards (Václav and Kateřina's, Marie's parents' generation)
    { key: 'vaclav', sex: 'm', era: 'c19', age: 'old', hair: 'receding', tone: 0.75, grey: 0.45, moustache: 'full', collar: 'c19coat', w: 1.04, h: 1.0, jaw: 1.05, turn: -0.35, smile: 0 },
    { key: 'frantisek', sex: 'm', era: 'c19', age: 'middle', hair: 'short', tone: 0.9, grey: 0.15, moustache: 'full', beard: true, collar: 'c19coat', w: 1.06, h: 0.98, jaw: 1.1, turn: 0.3, smile: 0 },
    { key: 'ludmila', sex: 'f', era: 'c19', age: 'middle', hair: 'centreBun', tone: 0.85, grey: 0.1, collar: 'c19dress', w: 0.96, h: 1.0, jaw: 0.95, turn: 0.25, smile: 0.1 },
    { key: 'jan', sex: 'm', era: 'c19', age: 'old', hair: 'receding', tone: 0.6, grey: 0.75, moustache: 'full', beard: true, collar: 'c19coat', w: 1.0, h: 1.02, jaw: 1.0, turn: 0.2, smile: 0 },
    // the 1920s–30s: studio photographs (Josef and Marie's wedding 1924, Růžena, the Malýs)
    { key: 'josef', sex: 'm', era: 'e20', age: 'young', hair: 'side', tone: 0.85, grey: 0, moustache: 'trim', collar: 'suit', w: 1.0, h: 1.03, jaw: 1.0, turn: -0.25, smile: 0.25 },
    { key: 'marie', sex: 'f', era: 'e20', age: 'young', hair: 'bob', tone: 0.8, grey: 0, collar: 'roundCollar', w: 0.95, h: 1.0, jaw: 0.9, turn: 0.3, smile: 0.45 },
    { key: 'ruzena', sex: 'f', era: 'e20', age: 'young', hair: 'pinned', tone: 0.55, grey: 0, collar: 'laceBlouse', w: 0.97, h: 1.02, jaw: 0.92, turn: -0.2, smile: 0.3 },
    { key: 'antonin', sex: 'm', era: 'e20', age: 'young', hair: 'crop', tone: 0.7, grey: 0, moustache: 'none', collar: 'suit', w: 1.05, h: 0.98, jaw: 1.08, turn: 0.2, smile: 0.15 },
    { key: 'marieK', sex: 'f', era: 'e20', age: 'young', hair: 'bob', tone: 0.45, grey: 0, collar: 'laceBlouse', w: 0.98, h: 0.98, jaw: 0.95, turn: -0.3, smile: 0.35 },
    // after the war: grey prints (Anna, her brother and sister, Petr)
    { key: 'karel', sex: 'm', era: 'post', age: 'young', hair: 'back', tone: 0.8, grey: 0, moustache: 'none', collar: 'suitNarrow', w: 1.02, h: 1.04, jaw: 1.05, turn: 0.3, smile: 0.4 },
    { key: 'anna', sex: 'f', era: 'post', age: 'young', hair: 'waves', tone: 0.7, grey: 0, collar: 'blousePearls', w: 0.95, h: 1.0, jaw: 0.9, turn: -0.25, smile: 0.6 },
    { key: 'vera', sex: 'f', era: 'post', age: 'young', hair: 'curls', tone: 0.35, grey: 0, collar: 'cardigan', w: 0.97, h: 0.98, jaw: 0.92, turn: 0.35, smile: 0.7 },
    { key: 'petr', sex: 'm', era: 'post', age: 'young', hair: 'side', tone: 0.6, grey: 0, moustache: 'none', glasses: true, collar: 'suitNarrow', w: 1.0, h: 1.0, jaw: 1.0, turn: -0.2, smile: 0.35 },
];

/**
 * More people, only with --more (see the head): the fan of five generations around Jana nearly full of faces, and
 * her children, their partners and her grandchildren for the two-way fan. The great-great-grandparents as cabinet
 * cards of the 19th century; Jana, Pavel and the young ones as today's prints (era now: a faint warm tone).
 */
const MORE = [
    { key: 'matej', sex: 'm', era: 'c19', age: 'old', hair: 'receding', tone: 0.5, grey: 0.85, moustache: 'full', beard: true, collar: 'c19coat', w: 1.02, h: 1.04, jaw: 1.0, turn: -0.2, smile: 0 },
    { key: 'annaD', sex: 'f', era: 'c19', age: 'old', hair: 'centreBun', tone: 0.6, grey: 0.6, collar: 'c19dress', w: 0.98, h: 1.0, jaw: 0.95, turn: -0.3, smile: 0 },
    { key: 'tomas', sex: 'm', era: 'c19', age: 'middle', hair: 'short', tone: 0.8, grey: 0.25, moustache: 'full', collar: 'c19coat', w: 1.08, h: 0.98, jaw: 1.12, turn: 0.25, smile: 0 },
    { key: 'rozalie', sex: 'f', era: 'c19', age: 'middle', hair: 'centreBun', tone: 0.55, grey: 0.15, collar: 'c19dress', w: 0.94, h: 1.02, jaw: 0.9, turn: -0.2, smile: 0.15 },
    { key: 'jakubFa', sex: 'm', era: 'c19', age: 'old', hair: 'receding', tone: 0.7, grey: 0.55, moustache: 'full', collar: 'c19coat', w: 1.0, h: 1.0, jaw: 1.04, turn: 0.3, smile: 0 },
    { key: 'jakubMo', sex: 'f', era: 'c19', age: 'old', hair: 'centreBun', tone: 0.75, grey: 0.45, collar: 'c19dress', w: 1.0, h: 0.98, jaw: 0.98, turn: 0.2, smile: 0.05 },
    { key: 'terezieFa', sex: 'm', era: 'c19', age: 'middle', hair: 'short', tone: 0.9, grey: 0.2, moustache: 'full', beard: true, collar: 'c19coat', w: 1.04, h: 1.0, jaw: 1.06, turn: -0.3, smile: 0 },
    { key: 'terezieMo', sex: 'f', era: 'c19', age: 'old', hair: 'centreBun', tone: 0.5, grey: 0.7, collar: 'c19dress', w: 0.96, h: 1.02, jaw: 0.94, turn: 0.3, smile: 0 },
    { key: 'josefKosFa', sex: 'm', era: 'c19', age: 'old', hair: 'receding', tone: 0.85, grey: 0.6, moustache: 'full', beard: true, collar: 'c19coat', w: 1.06, h: 1.02, jaw: 1.1, turn: 0.15, smile: 0 },
    { key: 'josefKosMo', sex: 'f', era: 'c19', age: 'middle', hair: 'centreBun', tone: 0.9, grey: 0.1, collar: 'c19dress', w: 0.95, h: 0.98, jaw: 0.92, turn: -0.25, smile: 0.1 },
    { key: 'johanaFa', sex: 'm', era: 'c19', age: 'middle', hair: 'side', tone: 0.75, grey: 0.2, moustache: 'full', collar: 'c19coat', w: 1.0, h: 1.04, jaw: 1.0, turn: -0.15, smile: 0.05 },
    { key: 'johanaMo', sex: 'f', era: 'c19', age: 'middle', hair: 'centreBun', tone: 0.4, grey: 0.2, collar: 'c19dress', w: 0.97, h: 1.0, jaw: 0.93, turn: 0.35, smile: 0.1 },
    { key: 'ludmilaFa', sex: 'm', era: 'c19', age: 'old', hair: 'crop', tone: 0.65, grey: 0.7, moustache: 'full', beard: true, collar: 'c19coat', w: 1.03, h: 0.98, jaw: 1.08, turn: 0.35, smile: 0 },
    { key: 'ludmilaMo', sex: 'f', era: 'c19', age: 'old', hair: 'centreBun', tone: 0.7, grey: 0.55, collar: 'c19dress', w: 1.0, h: 1.0, jaw: 0.97, turn: -0.15, smile: 0 },
    { key: 'jakub', sex: 'm', era: 'c19', age: 'middle', hair: 'short', tone: 0.7, grey: 0.1, moustache: 'full', collar: 'c19coat', w: 1.02, h: 1.02, jaw: 1.04, turn: 0.2, smile: 0.05 },
    { key: 'terezie', sex: 'f', era: 'c19', age: 'middle', hair: 'centreBun', tone: 0.45, grey: 0.05, collar: 'c19dress', w: 0.95, h: 1.0, jaw: 0.92, turn: -0.3, smile: 0.15 },
    { key: 'josefKos', sex: 'm', era: 'c19', age: 'middle', hair: 'side', tone: 0.9, grey: 0.1, moustache: 'full', collar: 'c19coat', w: 1.06, h: 1.0, jaw: 1.06, turn: -0.25, smile: 0.1 },
    { key: 'johana', sex: 'f', era: 'c19', age: 'middle', hair: 'centreBun', tone: 0.65, grey: 0.1, collar: 'c19dress', w: 0.96, h: 1.02, jaw: 0.94, turn: 0.25, smile: 0.2 },
    { key: 'katerina', sex: 'f', era: 'c19', age: 'old', hair: 'centreBun', tone: 0.8, grey: 0.5, collar: 'c19dress', w: 0.98, h: 1.0, jaw: 0.96, turn: 0.15, smile: 0.05 },
    // today: Jana (the focus), Pavel, their children with their partners, the grandchildren
    { key: 'jana', sex: 'f', era: 'now', age: 'middle', hair: 'bob', tone: 0.55, grey: 0.3, collar: 'blousePearls', w: 0.96, h: 1.0, jaw: 0.92, turn: -0.2, smile: 0.55 },
    { key: 'pavel', sex: 'm', era: 'now', age: 'middle', hair: 'receding', tone: 0.6, grey: 0.5, moustache: 'none', glasses: true, collar: 'suitNarrow', w: 1.04, h: 1.0, jaw: 1.06, turn: 0.25, smile: 0.4 },
    { key: 'tomasN', sex: 'm', era: 'now', age: 'young', hair: 'crop', tone: 0.75, grey: 0, moustache: 'none', collar: 'suitNarrow', w: 1.02, h: 1.02, jaw: 1.06, turn: -0.3, smile: 0.5 },
    { key: 'lucie', sex: 'f', era: 'now', age: 'young', hair: 'curls', tone: 0.3, grey: 0, collar: 'cardigan', w: 0.95, h: 0.98, jaw: 0.9, turn: 0.3, smile: 0.65 },
    { key: 'kristyna', sex: 'f', era: 'now', age: 'young', hair: 'waves', tone: 0.85, grey: 0, collar: 'roundCollar', w: 0.94, h: 1.02, jaw: 0.9, turn: -0.25, smile: 0.6 },
    { key: 'martin', sex: 'm', era: 'now', age: 'young', hair: 'side', tone: 0.45, grey: 0, moustache: 'none', collar: 'suitNarrow', w: 1.0, h: 1.0, jaw: 1.02, turn: 0.2, smile: 0.45 },
    { key: 'ema', sex: 'f', era: 'now', age: 'young', hair: 'bob', tone: 0.7, grey: 0, collar: 'cardigan', w: 0.92, h: 0.96, jaw: 0.88, turn: 0.25, smile: 0.7 },
    { key: 'jakubN', sex: 'm', era: 'now', age: 'young', hair: 'crop', tone: 0.6, grey: 0, moustache: 'none', collar: 'cardigan', w: 0.98, h: 0.96, jaw: 0.96, turn: -0.2, smile: 0.6 },
    { key: 'adam', sex: 'm', era: 'now', age: 'young', hair: 'short', tone: 0.85, grey: 0, moustache: 'none', collar: 'cardigan', w: 0.96, h: 0.95, jaw: 0.94, turn: 0.3, smile: 0.75 },
];
const ALL = more ? [...PEOPLE, ...MORE] : PEOPLE;

// Each era's colours: the dark and the light of the print, the card's paper round the oval, the oval's softness.
const ERA = {
    c19: { dark: [38, 22, 10], light: [238, 220, 188], paper: [228, 210, 172], oval: [0.66, 1.0], grain: 0.16 },
    e20: { dark: [34, 25, 16], light: [242, 230, 208], paper: [236, 226, 204], oval: [0.74, 1.0], grain: 0.13 },
    post: { dark: [18, 18, 18], light: [240, 238, 232], paper: [234, 232, 226], oval: [0.84, 1.0], grain: 0.1 },
    now: { dark: [40, 32, 30], light: [250, 241, 230], paper: [240, 234, 226], oval: [0.88, 1.0], grain: 0.05 },
};

/** A grey level 0 (black) … 1 (white) in the print's own tone. */
const toner = (era) => (v) => {
    const { dark, light } = ERA[era];
    const k = Math.max(0, Math.min(1, v));
    return `rgb(${dark.map((d, i) => Math.round(d + (light[i] - d) * k)).join(',')})`;
};

/** A small steady random number of a key (the same portrait every time). */
function rnd(key) {
    let h = 2166136261;
    for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function portraitSvg(p) {
    const r = rnd(p.key);
    const T = toner(p.era);
    const cx = 128 + (r() - 0.5) * 4, cy = 104 + (r() - 0.5) * 3;
    const rx = 36 * p.w, ry = 46 * p.h;
    const t = p.turn * 4; // the features shift to the side the face turns to
    const jaw = p.sex === 'f' ? 0.5 * p.jaw : 0.6 * p.jaw;
    const hairV = 0.55 - 0.48 * p.tone + 0.42 * p.grey; // the hair's grey level
    const skin = p.era === 'post' || p.era === 'now' ? 0.8 : 0.78;
    const line = T(0.12), soft = T(0.36);
    const seed = Math.floor(r() * 900) + 1;

    // ── the face's outline: a temple-wide oval with a narrower jaw
    const face = `M ${cx},${cy - ry} C ${cx + rx * 0.96},${cy - ry} ${cx + rx},${cy - ry * 0.4} ${cx + rx},${cy - ry * 0.05}
        C ${cx + rx},${cy + ry * 0.45} ${cx + rx * jaw},${cy + ry * 0.98} ${cx},${cy + ry}
        C ${cx - rx * jaw},${cy + ry * 0.98} ${cx - rx},${cy + ry * 0.45} ${cx - rx},${cy - ry * 0.05}
        C ${cx - rx},${cy - ry * 0.4} ${cx - rx * 0.96},${cy - ry} ${cx},${cy - ry} Z`;

    // ── hair: what stands behind the face (long hair) and the part over the forehead
    const top = cy - ry, hl = (k) => cy - ry * k; // hairline heights
    let back = '', front = '', strands = '';
    const H = (d) => `<path d="${d}" fill="${T(hairV)}" stroke="${line}" stroke-width="1.2"/>`;
    switch (p.hair) {
        case 'receding':
            front = `M ${cx - rx - 2},${cy - 2} C ${cx - rx - 4},${top - 2} ${cx - rx * 0.4},${top - 10} ${cx + 2},${top - 9}
                C ${cx + rx * 0.5},${top - 9} ${cx + rx + 4},${top - 2} ${cx + rx + 2},${cy - 2}
                L ${cx + rx - 2},${hl(0.3)} C ${cx + rx * 0.85},${hl(0.7)} ${cx + rx * 0.55},${hl(0.82)} ${cx + rx * 0.3},${hl(0.86)}
                C ${cx},${hl(0.98)} ${cx - rx * 0.3},${hl(0.9)} ${cx - rx * 0.32},${hl(0.86)}
                C ${cx - rx * 0.55},${hl(0.8)} ${cx - rx * 0.85},${hl(0.7)} ${cx - rx + 2},${hl(0.3)} Z`;
            strands = [-0.6, -0.2, 0.25, 0.6].map((k) => `M ${cx + rx * k},${top - 6} q ${4},${8} ${3},${18}`).join(' ');
            break;
        case 'short':
        case 'crop': {
            const lift = p.hair === 'crop' ? 5 : 9;
            front = `M ${cx - rx - 1},${cy - 4} C ${cx - rx - 3},${top - lift} ${cx - rx * 0.3},${top - lift - 6} ${cx + 3},${top - lift - 5}
                C ${cx + rx * 0.6},${top - lift - 4} ${cx + rx + 3},${top - lift + 2} ${cx + rx + 1},${cy - 4}
                L ${cx + rx - 2},${hl(0.3)} C ${cx + rx * 0.8},${hl(0.62)} ${cx + rx * 0.4},${hl(0.7)} ${cx},${hl(0.68)}
                C ${cx - rx * 0.4},${hl(0.7)} ${cx - rx * 0.8},${hl(0.62)} ${cx - rx + 2},${hl(0.3)} Z`;
            strands = [-0.5, -0.1, 0.3, 0.65].map((k) => `M ${cx + rx * k},${top - lift} q ${3},${6} ${1},${14}`).join(' ');
            break;
        }
        case 'side': {
            const px = cx - rx * 0.42; // the parting
            front = `M ${cx - rx - 1},${cy - 4} C ${cx - rx - 4},${top - 8} ${cx - rx * 0.5},${top - 14} ${px},${top - 13}
                C ${cx + rx * 0.4},${top - 16} ${cx + rx + 6},${top - 8} ${cx + rx + 2},${cy - 4}
                L ${cx + rx - 2},${hl(0.3)} C ${cx + rx * 0.85},${hl(0.62)} ${cx + rx * 0.5},${hl(0.62)} ${cx + rx * 0.1},${hl(0.66)}
                C ${cx - rx * 0.2},${hl(0.7)} ${px},${hl(0.74)} ${px - 3},${hl(0.8)}
                C ${cx - rx * 0.7},${hl(0.72)} ${cx - rx * 0.9},${hl(0.6)} ${cx - rx + 2},${hl(0.3)} Z`;
            strands = `M ${px},${top - 12} q -2,10 -3,${ry * 0.2}` + [0.0, 0.3, 0.6].map((k) => ` M ${px + 4},${top - 11 + k * 3} C ${cx + rx * (k - 0.2)},${top - 14 + k * 4} ${cx + rx * (k + 0.2)},${top - 8 + k * 6} ${cx + rx * (0.45 + k * 0.5)},${top + k * 10}`).join('');
            break;
        }
        case 'back':
            front = `M ${cx - rx - 1},${cy - 4} C ${cx - rx - 4},${top - 10} ${cx - rx * 0.3},${top - 17} ${cx + 4},${top - 16}
                C ${cx + rx * 0.6},${top - 16} ${cx + rx + 5},${top - 8} ${cx + rx + 1},${cy - 4}
                L ${cx + rx - 2},${hl(0.32)} C ${cx + rx * 0.8},${hl(0.66)} ${cx + rx * 0.35},${hl(0.74)} ${cx},${hl(0.72)}
                C ${cx - rx * 0.35},${hl(0.74)} ${cx - rx * 0.8},${hl(0.66)} ${cx - rx + 2},${hl(0.32)} Z`;
            strands = [-0.5, -0.1, 0.3].map((k) => `M ${cx + rx * k},${hl(0.74)} C ${cx + rx * (k + 0.15)},${top - 6} ${cx + rx * (k + 0.45)},${top - 12} ${cx + rx * (k + 0.8)},${top - 6}`).join(' ');
            break;
        case 'centreBun':
            back = `M ${cx - 17},${top - 4} C ${cx - 18},${top - 20} ${cx + 18},${top - 20} ${cx + 17},${top - 4} Z`;
            front = `M ${cx - rx - 5},${cy + 8} C ${cx - rx - 8},${top - 6} ${cx - rx * 0.4},${top - 10} ${cx},${top - 9}
                C ${cx + rx * 0.4},${top - 10} ${cx + rx + 8},${top - 6} ${cx + rx + 5},${cy + 8}
                L ${cx + rx - 1},${cy + 4} C ${cx + rx - 2},${hl(0.3)} ${cx + rx * 0.6},${hl(0.62)} ${cx + 2},${hl(0.74)}
                L ${cx},${hl(0.66)} L ${cx - 2},${hl(0.74)}
                C ${cx - rx * 0.6},${hl(0.62)} ${cx - rx + 2},${hl(0.3)} ${cx - rx + 1},${cy + 4} Z`;
            strands = [0.2, 0.45, 0.7].map((k) => `M ${cx + 2},${top - 8} C ${cx + rx * k},${top - 6} ${cx + rx * (k + 0.2)},${hl(0.5)} ${cx + rx + 2},${cy + 2} M ${cx - 2},${top - 8} C ${cx - rx * k},${top - 6} ${cx - rx * (k + 0.2)},${hl(0.5)} ${cx - rx - 2},${cy + 2}`).join(' ');
            break;
        case 'pinned':
            back = `M ${cx - rx - 12},${cy + 14} C ${cx - rx - 20},${top - 10} ${cx + rx + 20},${top - 10} ${cx + rx + 12},${cy + 14} Z`;
            front = `M ${cx - rx - 10},${cy + 12} C ${cx - rx - 16},${top - 4} ${cx - rx * 0.4},${top - 16} ${cx + 4},${top - 15}
                C ${cx + rx * 0.5},${top - 16} ${cx + rx + 16},${top - 4} ${cx + rx + 10},${cy + 12}
                L ${cx + rx - 1},${cy + 2} C ${cx + rx},${hl(0.4)} ${cx + rx * 0.6},${hl(0.66)} ${cx + rx * 0.15},${hl(0.7)}
                C ${cx - rx * 0.3},${hl(0.66)} ${cx - rx * 0.5},${hl(0.74)} ${cx - rx * 0.62},${hl(0.62)}
                C ${cx - rx + 2},${hl(0.3)} ${cx - rx},${cy - 6} ${cx - rx + 1},${cy + 2} Z`;
            strands = [0, 1, 2].map((i) => `M ${cx - rx - 8 + i * 2},${hl(0.1 - i * 0.3)} c 8,-6 14,4 22,-2 s 14,4 22,-2 s 14,4 22,-2`).join(' ');
            break;
        case 'bob':
            back = `M ${cx - rx - 9},${cy + ry * 0.52} C ${cx - rx - 14},${top - 6} ${cx + rx + 14},${top - 6} ${cx + rx + 9},${cy + ry * 0.52}
                C ${cx + rx},${cy + ry * 0.6} ${cx + rx - 4},${cy + ry * 0.5} ${cx + rx - 3},${cy + ry * 0.4}
                L ${cx - rx + 3},${cy + ry * 0.4} C ${cx - rx + 4},${cy + ry * 0.5} ${cx - rx},${cy + ry * 0.6} ${cx - rx - 9},${cy + ry * 0.52} Z`;
            front = `M ${cx - rx - 9},${cy + ry * 0.5} C ${cx - rx - 13},${top - 4} ${cx - rx * 0.4},${top - 12} ${cx + rx * 0.3},${top - 11}
                C ${cx + rx + 10},${top - 8} ${cx + rx + 13},${hl(0.3)} ${cx + rx + 9},${cy + ry * 0.5}
                C ${cx + rx + 2},${cy + ry * 0.4} ${cx + rx - 1},${cy + 8} ${cx + rx - 2},${cy - 4}
                C ${cx + rx * 0.7},${hl(0.62)} ${cx + rx * 0.2},${hl(0.66)} ${cx - rx * 0.1},${hl(0.62)}
                C ${cx - rx * 0.5},${hl(0.55)} ${cx - rx * 0.75},${hl(0.45)} ${cx - rx + 1},${cy - 6}
                C ${cx - rx},${cy + 8} ${cx - rx - 2},${cy + ry * 0.4} ${cx - rx - 9},${cy + ry * 0.5} Z`;
            strands = [0, 1, 2, 3].map((i) => `M ${cx - rx - 6},${hl(0.55 - i * 0.32)} c 10,-7 16,5 26,-1 s 16,5 26,-1 s 16,5 26,-1`).join(' ');
            break;
        case 'waves':
            back = `M ${cx - rx - 14},${cy + ry + 8} C ${cx - rx - 22},${cy} ${cx - rx - 16},${top - 10} ${cx},${top - 12}
                C ${cx + rx + 16},${top - 10} ${cx + rx + 22},${cy} ${cx + rx + 14},${cy + ry + 8}
                C ${cx + rx + 6},${cy + ry + 14} ${cx + rx - 2},${cy + ry + 4} ${cx + rx - 4},${cy + ry * 0.5}
                L ${cx - rx + 4},${cy + ry * 0.5} C ${cx - rx + 2},${cy + ry + 4} ${cx - rx - 6},${cy + ry + 14} ${cx - rx - 14},${cy + ry + 8} Z`;
            front = `M ${cx - rx - 12},${cy + 10} C ${cx - rx - 16},${top - 8} ${cx - rx * 0.5},${top - 16} ${cx - rx * 0.1},${top - 15}
                C ${cx + rx * 0.7},${top - 15} ${cx + rx + 16},${top - 6} ${cx + rx + 12},${cy + 10}
                L ${cx + rx},${cy - 2} C ${cx + rx - 2},${hl(0.5)} ${cx + rx * 0.5},${hl(0.62)} ${cx + rx * 0.05},${hl(0.6)}
                C ${cx - rx * 0.25},${hl(0.4)} ${cx - rx * 0.6},${hl(0.62)} ${cx - rx * 0.75},${hl(0.52)}
                C ${cx - rx},${hl(0.3)} ${cx - rx},${cy - 4} ${cx - rx},${cy + 4} Z`;
            strands = `M ${cx - rx * 0.35},${top - 12} C ${cx + rx * 0.3},${top - 10} ${cx + rx * 0.7},${hl(0.7)} ${cx + rx + 6},${cy}`
                + ` M ${cx - rx * 0.6},${top - 6} C ${cx - rx - 6},${hl(0.5)} ${cx - rx - 10},${cy + 20} ${cx - rx - 6},${cy + ry}`
                + ` M ${cx + rx + 4},${cy + 14} C ${cx + rx + 12},${cy + 30} ${cx + rx + 4},${cy + ry} ${cx + rx + 10},${cy + ry + 6}`;
            break;
        case 'curls':
            back = `M ${cx - rx - 12},${cy + 18} C ${cx - rx - 22},${top - 14} ${cx + rx + 22},${top - 14} ${cx + rx + 12},${cy + 18} Z`;
            front = `M ${cx - rx - 11},${cy + 14} C ${cx - rx - 18},${top - 8} ${cx - rx * 0.4},${top - 20} ${cx + 4},${top - 19}
                C ${cx + rx * 0.6},${top - 20} ${cx + rx + 18},${top - 8} ${cx + rx + 11},${cy + 14}
                L ${cx + rx},${cy} C ${cx + rx - 1},${hl(0.45)} ${cx + rx * 0.6},${hl(0.6)} ${cx + rx * 0.25},${hl(0.62)}
                C ${cx},${hl(0.56)} ${cx - rx * 0.3},${hl(0.64)} ${cx - rx * 0.6},${hl(0.58)}
                C ${cx - rx},${hl(0.4)} ${cx - rx},${cy - 4} ${cx - rx},${cy} Z`;
            strands = Array.from({ length: 11 }, (_, i) => {
                const a = Math.PI * (0.98 + (i / 10) * 1.04), R = rx + 10;
                const x = cx + Math.cos(a) * R, y = cy - 4 + Math.sin(a) * (ry + 8);
                return `M ${x - 4},${y} a 4.5,4.5 0 1 1 7,3`;
            }).join(' ');
            break;
    }

    // ── features
    const ey = cy - ry * 0.08, ex = rx * 0.4, eye = (s) => {
        const x = cx + s * ex + t;
        const w = 6.6, open = p.sex === 'f' ? 3.6 : 3.1;
        return `<path d="M ${x - w},${ey} C ${x - w * 0.5},${ey - open * 1.15} ${x + w * 0.5},${ey - open * 1.15} ${x + w},${ey} C ${x + w * 0.5},${ey + open * 0.75} ${x - w * 0.5},${ey + open * 0.75} ${x - w},${ey} Z" fill="${T(0.86)}"/>
            <circle cx="${x + t * 0.3}" cy="${ey - 0.3}" r="2.9" fill="${T(0.3)}"/><circle cx="${x + t * 0.3}" cy="${ey - 0.3}" r="1.4" fill="${T(0.06)}"/>
            <circle cx="${x + t * 0.3 - 1}" cy="${ey - 1.3}" r="0.7" fill="${T(0.95)}"/>
            <path d="M ${x - w - 0.6},${ey + 0.3} C ${x - w * 0.5},${ey - open * 1.25} ${x + w * 0.5},${ey - open * 1.25} ${x + w + 0.6},${ey + 0.2}" fill="none" stroke="${line}" stroke-width="${p.sex === 'f' ? 1.9 : 1.5}" stroke-linecap="round"/>
            <path d="M ${x - w * 0.8},${ey - open * 1.7} C ${x - w * 0.3},${ey - open * 2.1} ${x + w * 0.4},${ey - open * 2.1} ${x + w * 0.8},${ey - open * 1.8}" fill="none" stroke="${soft}" stroke-width="0.8" opacity="0.6"/>
            <path d="M ${x - w * 1.25},${ey - 9 - (p.sex === 'f' ? 1.5 : 0)} C ${x - w * 0.4},${ey - 13 - (p.sex === 'f' ? 2 : 0)} ${x + w * 0.5},${ey - 13 - (p.sex === 'f' ? 2 : 0)} ${x + w * 1.3},${ey - 9.5 - (p.sex === 'f' ? 0.5 : 0)}"
                fill="none" stroke="${T(Math.min(hairV, 0.4) - 0.05)}" stroke-width="${p.sex === 'f' ? 1.7 : 2.8}" stroke-linecap="round"/>`;
    };
    const nx = cx + t * 1.3, ny = cy + ry * 0.3;
    const nose = `<path d="M ${nx + 1.5},${ey + 2} C ${nx + 2.5},${ny - 8} ${nx + 5},${ny - 3} ${nx + 3.5},${ny + 1}" fill="none" stroke="${soft}" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M ${nx - 6},${ny} C ${nx - 4},${ny + 3.5} ${nx - 1.5},${ny + 2.5} ${nx},${ny + 2} C ${nx + 1.5},${ny + 2.5} ${nx + 4},${ny + 3.5} ${nx + 6},${ny}" fill="none" stroke="${T(0.3)}" stroke-width="1.3" stroke-linecap="round"/>
        <ellipse cx="${nx + 4 + t * 0.5}" cy="${ny - 6}" rx="3" ry="8" fill="${T(0.2)}" opacity="0.09"/>`;
    const my = cy + ry * 0.55, mw = p.sex === 'f' ? 10 : 11, sm = p.smile * 3;
    const mouth = (p.sex === 'f'
        ? `<path d="M ${cx - mw + t},${my} C ${cx - 4 + t},${my - 3.2} ${cx + 4 + t},${my - 3.2} ${cx + mw + t},${my} C ${cx + 5 + t},${my + 5 + sm * 0.3} ${cx - 5 + t},${my + 5 + sm * 0.3} ${cx - mw + t},${my} Z" fill="${T(0.48)}"/>`
        : '')
        + `<path d="M ${cx - mw + t},${my - sm * 0.4} C ${cx - 4 + t},${my + 1 + sm * 0.5} ${cx + 4 + t},${my + 1 + sm * 0.5} ${cx + mw + t},${my - sm * 0.4}" fill="none" stroke="${T(0.22)}" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M ${cx - 5 + t},${my + 5.5} C ${cx - 1 + t},${my + 7.5} ${cx + 3 + t},${my + 7.5} ${cx + 6 + t},${my + 5.5}" fill="none" stroke="${soft}" stroke-width="1" opacity="0.55"/>`;
    const lines = p.age === 'young' ? '' : `<g fill="none" stroke="${soft}" stroke-width="0.9" opacity="${p.age === 'old' ? 0.75 : 0.45}">
        <path d="M ${nx - 9},${ny + 2} C ${nx - 13},${my - 2} ${nx - 13},${my + 4} ${nx - 13},${my + 8}"/><path d="M ${nx + 9},${ny + 2} C ${nx + 13},${my - 2} ${nx + 13},${my + 4} ${nx + 13},${my + 8}"/>
        <path d="M ${cx - 14},${ey - 22} q 14,-3 28,0"/>${p.age === 'old' ? `<path d="M ${cx - 12},${ey - 27} q 12,-3 24,0"/>` : ''}</g>`;
    const hairCol = T(Math.max(0.12, hairV - 0.08));
    const moustache = p.moustache === 'full'
        ? `<path d="M ${cx + t},${my - 6} C ${cx - 6 + t},${my - 9} ${cx - 16 + t},${my - 8} ${cx - 21 + t},${my - 1} C ${cx - 15 + t},${my - 3} ${cx - 7 + t},${my - 1} ${cx + t},${my - 2.5}
            C ${cx + 7 + t},${my - 1} ${cx + 15 + t},${my - 3} ${cx + 21 + t},${my - 1} C ${cx + 16 + t},${my - 8} ${cx + 6 + t},${my - 9} ${cx + t},${my - 6} Z" fill="${hairCol}" stroke="${line}" stroke-width="0.8"/>`
        : p.moustache === 'trim'
            ? `<path d="M ${cx + t},${my - 6} C ${cx - 5 + t},${my - 8} ${cx - 10 + t},${my - 6.5} ${cx - 11 + t},${my - 2.5} C ${cx - 6 + t},${my - 3.5} ${cx - 3 + t},${my - 3} ${cx + t},${my - 3.2}
            C ${cx + 3 + t},${my - 3} ${cx + 6 + t},${my - 3.5} ${cx + 11 + t},${my - 2.5} C ${cx + 10 + t},${my - 6.5} ${cx + 5 + t},${my - 8} ${cx + t},${my - 6} Z" fill="${hairCol}"/>`
            : '';
    const beard = p.beard
        ? `<path d="M ${cx - rx + 1},${cy + 2} C ${cx - rx + 2},${my + 4} ${cx - rx * 0.55},${cy + ry + 14} ${cx + t},${cy + ry + 16}
            C ${cx + rx * 0.55},${cy + ry + 14} ${cx + rx - 2},${my + 4} ${cx + rx - 1},${cy + 2}
            C ${cx + rx - 6},${my - 4} ${cx + 10},${my + 2} ${cx + t},${my + 4} C ${cx - 10},${my + 2} ${cx - rx + 6},${my - 4} ${cx - rx + 1},${cy + 2} Z" fill="${hairCol}" stroke="${line}" stroke-width="0.9"/>
            <path d="M ${cx - 6 + t},${my + 7} q 6,3 12,0" fill="none" stroke="${T(0.35)}" stroke-width="1"/>`
        : '';
    const glasses = p.glasses
        ? `<g fill="none" stroke="${T(0.12)}" stroke-width="1.6"><rect x="${cx - ex - 10 + t}" y="${ey - 7}" width="20" height="14" rx="5"/><rect x="${cx + ex - 10 + t}" y="${ey - 7}" width="20" height="14" rx="5"/>
            <path d="M ${cx - ex + 10 + t},${ey - 2} q ${ex - 10},-4 ${2 * ex - 20},0"/><path d="M ${cx - ex - 10 + t},${ey - 3} L ${cx - rx},${ey - 4}"/><path d="M ${cx + ex + 10 + t},${ey - 3} L ${cx + rx},${ey - 4}"/></g>`
        : '';
    const ears = p.hair === 'centreBun' || p.hair === 'pinned' || p.hair === 'bob' || p.hair === 'waves' || p.hair === 'curls' ? ''
        : [-1, 1].map((s) => `<ellipse cx="${cx + s * (rx - 1)}" cy="${ey + 8}" rx="6" ry="11" fill="${T(skin - 0.06)}" stroke="${line}" stroke-width="1"/>
            <path d="M ${cx + s * (rx + 1)},${ey + 2} q ${s * 3},6 0,12" fill="none" stroke="${soft}" stroke-width="0.9"/>`).join('');

    // ── the clothes from the neck down
    const neckTop = cy + ry * 0.78, sh = Math.round(cy + ry + 24);
    const neck = `<path d="M ${cx - 15},${neckTop} C ${cx - 15},${sh - 14} ${cx - 18},${sh - 6} ${cx - 20},${sh + 4} L ${cx + 20},${sh + 4} C ${cx + 18},${sh - 6} ${cx + 15},${sh - 14} ${cx + 15},${neckTop} Z"
        fill="${T(skin - 0.05)}" stroke="${line}" stroke-width="1"/><path d="M ${cx - 14},${neckTop + 4} C ${cx - 4},${neckTop + 14} ${cx + 6},${neckTop + 14} ${cx + 15},${neckTop + 4}" fill="${T(0.2)}" opacity="0.16"/>`;
    const shoulders = (top) => `M 18,262 C 22,${top + 30} 60,${top + 6} ${cx - 24},${top} L ${cx + 24},${top} C ${236 - 40},${top + 6} 236,${top + 30} 240,262 Z`;
    let clothes = '';
    const lapels = (dark, wide) => `<path d="M ${cx - 22},${sh - 2} L ${cx - 3},${250} L ${cx - wide},${232} L ${cx - wide - 10},${222} L ${cx - wide - 2},${212} Z" fill="${T(dark + 0.07)}" stroke="${line}" stroke-width="1"/>
        <path d="M ${cx + 22},${sh - 2} L ${cx + 3},${250} L ${cx + wide},${232} L ${cx + wide + 10},${222} L ${cx + wide + 2},${212} Z" fill="${T(dark + 0.07)}" stroke="${line}" stroke-width="1"/>`;
    switch (p.collar) {
        case 'suit':
        case 'suitNarrow': {
            const dark = p.collar === 'suit' ? 0.2 : 0.3, tw = p.collar === 'suit' ? 6 : 4.5;
            clothes = `<path d="${shoulders(sh)}" fill="${T(dark)}" stroke="${line}" stroke-width="1.2"/>
                <path d="M ${cx - 20},${sh - 4} L ${cx + 20},${sh - 4} L ${cx},${246} Z" fill="${T(0.92)}" stroke="${line}" stroke-width="0.8"/>
                <path d="M ${cx - 4},${sh + 3} L ${cx + 4},${sh + 3} L ${cx + 3},${sh + 10} L ${cx + tw},${236} L ${cx},${244} L ${cx - tw},${236} L ${cx - 3},${sh + 10} Z" fill="${T(p.collar === 'suit' ? 0.4 : 0.22)}" stroke="${line}" stroke-width="0.8"/>
                <path d="M ${cx - 18},${sh - 8} L ${cx - 2},${sh + 4} L ${cx - 13},${sh + 12} Z M ${cx + 18},${sh - 8} L ${cx + 2},${sh + 4} L ${cx + 13},${sh + 12} Z" fill="${T(0.96)}" stroke="${line}" stroke-width="0.9"/>
                ${lapels(dark, p.collar === 'suit' ? 16 : 13)}`;
            break;
        }
        case 'c19coat':
            clothes = `<path d="${shoulders(sh + 2)}" fill="${T(0.14)}" stroke="${line}" stroke-width="1.2"/>
                <path d="M ${cx - 20},${sh - 2} L ${cx + 20},${sh - 2} L ${cx + 12},${250} L ${cx - 12},${250} Z" fill="${T(0.3)}" stroke="${line}" stroke-width="0.8"/>
                ${[218, 232, 246].map((y) => `<circle cx="${cx}" cy="${y}" r="1.8" fill="${T(0.75)}"/>`).join('')}
                <path d="M ${cx - 16},${sh - 14} L ${cx + 16},${sh - 14} L ${cx + 17},${sh - 2} L ${cx - 17},${sh - 2} Z" fill="${T(0.94)}" stroke="${line}" stroke-width="0.9"/>
                <path d="M ${cx - 12},${sh - 6} C ${cx - 6},${sh - 9} ${cx + 6},${sh - 9} ${cx + 12},${sh - 6} L ${cx + 10},${sh + 4} C ${cx + 4},${sh + 1} ${cx - 4},${sh + 1} ${cx - 10},${sh + 4} Z" fill="${T(0.12)}"/>
                ${lapels(0.12, 20)}`;
            break;
        case 'c19dress':
            clothes = `<path d="${shoulders(sh)}" fill="${T(0.16)}" stroke="${line}" stroke-width="1.2"/>
                <path d="M ${cx - 17},${neckTop + 6} C ${cx - 18},${sh - 4} ${cx - 22},${sh} ${cx - 26},${sh + 2} L ${cx + 26},${sh + 2} C ${cx + 22},${sh} ${cx + 18},${sh - 4} ${cx + 17},${neckTop + 6} Z" fill="${T(0.18)}" stroke="${line}" stroke-width="1"/>
                <path d="M ${cx - 17},${neckTop + 6} C ${cx - 6},${neckTop + 10} ${cx + 6},${neckTop + 10} ${cx + 17},${neckTop + 6}" fill="none" stroke="${T(0.9)}" stroke-width="2.2" stroke-dasharray="2 1.5"/>
                <ellipse cx="${cx}" cy="${neckTop + 16}" rx="6" ry="7.5" fill="${T(0.7)}" stroke="${T(0.1)}" stroke-width="1.2"/><ellipse cx="${cx - 1}" cy="${neckTop + 15}" rx="2.6" ry="3.4" fill="${T(0.88)}"/>
                ${[0, 1, 2, 3].map((i) => `<path d="M ${70 + i * 6},${sh + 30 + i * 8} q 8,-4 14,2" fill="none" stroke="${T(0.32)}" stroke-width="0.9"/>`).join('')}`;
            break;
        case 'roundCollar':
            clothes = `<path d="${shoulders(sh)}" fill="${T(0.36)}" stroke="${line}" stroke-width="1.2"/>
                <path d="M ${cx - 20},${sh - 4} C ${cx - 40},${sh + 4} ${cx - 34},${sh + 26} ${cx - 2},${sh + 20} L ${cx - 1},${sh + 4} Z" fill="${T(0.94)}" stroke="${line}" stroke-width="1"/>
                <path d="M ${cx + 20},${sh - 4} C ${cx + 40},${sh + 4} ${cx + 34},${sh + 26} ${cx + 2},${sh + 20} L ${cx + 1},${sh + 4} Z" fill="${T(0.94)}" stroke="${line}" stroke-width="1"/>
                <path d="M ${cx - 6},${sh + 20} L ${cx + 6},${sh + 20} L ${cx + 9},${sh + 34} L ${cx},${sh + 28} L ${cx - 9},${sh + 34} Z" fill="${T(0.2)}"/>`;
            break;
        case 'laceBlouse':
            clothes = `<path d="${shoulders(sh)}" fill="${T(0.84)}" stroke="${line}" stroke-width="1.2"/>
                <path d="M ${cx - 20},${sh - 4} C ${cx - 10},${sh + 18} ${cx + 10},${sh + 18} ${cx + 20},${sh - 4}" fill="none" stroke="${T(0.4)}" stroke-width="1.6" stroke-dasharray="1.5 2"/>
                <path d="M ${cx - 24},${sh} C ${cx - 12},${sh + 26} ${cx + 12},${sh + 26} ${cx + 24},${sh}" fill="none" stroke="${T(0.5)}" stroke-width="1" stroke-dasharray="3 2"/>
                ${[0, 1, 2, 3].map((i) => `<path d="M ${50 + i * 10},${sh + 20 + i * 10} q 6,8 2,18" fill="none" stroke="${T(0.6)}" stroke-width="0.9"/><path d="M ${206 - i * 10},${sh + 20 + i * 10} q -6,8 -2,18" fill="none" stroke="${T(0.6)}" stroke-width="0.9"/>`).join('')}
                <circle cx="${cx}" cy="${sh + 14}" r="2.8" fill="${T(0.3)}"/>`;
            break;
        case 'blousePearls':
            clothes = `<path d="${shoulders(sh)}" fill="${T(0.5)}" stroke="${line}" stroke-width="1.2"/>
                <path d="M ${cx - 22},${sh - 4} L ${cx + 22},${sh - 4} L ${cx + 14},${248} L ${cx - 14},${248} Z" fill="${T(0.9)}" stroke="${line}" stroke-width="0.8"/>
                <path d="M ${cx - 20},${sh - 6} L ${cx - 2},${sh + 12} L ${cx - 24},${sh + 16} Z M ${cx + 20},${sh - 6} L ${cx + 2},${sh + 12} L ${cx + 24},${sh + 16} Z" fill="${T(0.97)}" stroke="${line}" stroke-width="0.9"/>
                ${Array.from({ length: 13 }, (_, i) => { const a = Math.PI * (0.15 + 0.7 * (i / 12)); return `<circle cx="${cx - Math.cos(a) * 18}" cy="${sh - 10 + Math.sin(a) * 12}" r="1.9" fill="${T(0.95)}" stroke="${T(0.4)}" stroke-width="0.5"/>`; }).join('')}`;
            break;
        case 'cardigan':
            clothes = `<path d="${shoulders(sh)}" fill="${T(0.46)}" stroke="${line}" stroke-width="1.2"/>
                <path d="M ${cx - 22},${sh - 2} C ${cx - 10},${sh + 16} ${cx + 10},${sh + 16} ${cx + 22},${sh - 2} L ${cx + 6},${250} L ${cx - 6},${250} Z" fill="${T(0.88)}" stroke="${line}" stroke-width="0.8"/>
                <path d="M ${cx - 16},${sh - 6} C ${cx - 26},${sh + 4} ${cx - 22},${sh + 12} ${cx - 4},${sh + 10} Z M ${cx + 16},${sh - 6} C ${cx + 26},${sh + 4} ${cx + 22},${sh + 12} ${cx + 4},${sh + 10} Z" fill="${T(0.97)}" stroke="${line}" stroke-width="0.8"/>
                ${[214, 228, 242].map((y) => `<circle cx="${cx - 9}" cy="${y}" r="1.7" fill="${T(0.25)}"/>`).join('')}
                ${Array.from({ length: 8 }, (_, i) => `<path d="M ${40 + i * 7},${sh + 22 + i * 5} l 0,16" stroke="${T(0.36)}" stroke-width="0.8"/><path d="M ${216 - i * 7},${sh + 22 + i * 5} l 0,16" stroke="${T(0.36)}" stroke-width="0.8"/>`).join('')}`;
            break;
    }

    const E = ERA[p.era];
    const paper = `rgb(${E.paper.join(',')})`;
    const id = p.key;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="bg-${id}" cx="0.36" cy="0.34" r="0.85"><stop offset="0" stop-color="${T(0.84)}"/><stop offset="0.55" stop-color="${T(0.62)}"/><stop offset="1" stop-color="${T(0.4)}"/></radialGradient>
    <radialGradient id="shade-${id}" cx="0.78" cy="0.6" r="0.65"><stop offset="0" stop-color="${T(0.1)}" stop-opacity="0.32"/><stop offset="1" stop-color="${T(0.1)}" stop-opacity="0"/></radialGradient>
    <radialGradient id="cheek-${id}" cx="0.4" cy="0.42" r="0.62"><stop offset="0.55" stop-color="${T(0.1)}" stop-opacity="0"/><stop offset="1" stop-color="${T(0.1)}" stop-opacity="0.28"/></radialGradient>
    <radialGradient id="oval-${id}" cx="0.5" cy="0.47" r="0.5"><stop offset="${E.oval[0]}" stop-color="#fff"/><stop offset="${Math.min(1, E.oval[1])}" stop-color="#000"/></radialGradient>
    <mask id="m-${id}"><rect width="256" height="256" fill="#000"/><ellipse cx="128" cy="124" rx="${p.era === 'post' || p.era === 'now' ? 170 : 146}" ry="${p.era === 'post' || p.era === 'now' ? 178 : 158}" fill="url(#oval-${id})"/></mask>
    <clipPath id="face-${id}"><path d="${face}"/></clipPath>
    <clipPath id="hair-${id}"><path d="${front}"/></clipPath>
    <pattern id="hatch-${id}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><path d="M 0,0 L 0,4" stroke="${T(0.05)}" stroke-width="0.9"/></pattern>
    <filter id="rough-${id}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>
    <filter id="grain-${id}"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="${seed + 7}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${E.grain * 2.2}"/></feComponentTransfer></filter>
    <filter id="soft-${id}"><feGaussianBlur stdDeviation="0.35"/></filter>
  </defs>
  <rect width="256" height="256" fill="${paper}"/>
  <g mask="url(#m-${id})">
    <rect width="256" height="256" fill="url(#bg-${id})"/>
    <rect x="150" width="106" height="256" fill="url(#hatch-${id})" opacity="0.18"/>
    <g filter="url(#rough-${id})">
      <g filter="url(#soft-${id})">
      <g transform="translate(128 100) scale(1.2) translate(-128 -100)">
      ${back ? H(back) : ''}
      ${neck}
      ${clothes}
      ${ears}
      <path d="${face}" fill="${T(skin)}" stroke="${line}" stroke-width="1.3"/>
      <g clip-path="url(#face-${id})"><rect width="256" height="256" fill="url(#cheek-${id})"/><ellipse cx="${cx + rx * 0.75}" cy="${cy + 6}" rx="${rx * 0.55}" ry="${ry * 1.1}" fill="url(#shade-${id})"/></g>
      ${lines}
      ${eye(-1)}${eye(1)}
      ${nose}
      ${beard}
      ${mouth}
      ${moustache}
      ${glasses}
      ${front ? H(front) : ''}
      ${strands && front ? `<g clip-path="url(#hair-${id})"><path d="${strands}" fill="none" stroke="${T(Math.max(0.06, hairV - 0.24))}" stroke-width="1.1" opacity="0.75"/></g>` : ''}
      <path d="${shoulders(sh)}" fill="url(#hatch-${id})" opacity="0.28"/>
      ${front ? `<path d="${front}" fill="url(#hatch-${id})" opacity="0.22"/>` : ''}
      </g>
      </g>
    </g>
  </g>
  <rect width="256" height="256" filter="url(#grain-${id})" opacity="1"/>
</svg>`;
}

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
    for (const p of ALL) {
        await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${portraitSvg(p)}</body></html>`);
        const file = path.join(out, `${p.key}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: 256, height: 256 } });
        console.log(`${p.key} ${p.era} ${fs.statSync(file).size} B`);
    }
    if (sheet) {
        const imgs = ALL.map((p) => `data:image/jpeg;base64,${fs.readFileSync(path.join(out, `${p.key}.jpg`)).toString('base64')}`);
        const w = 7 * 266;
        const page2 = await browser.newPage({ viewport: { width: w, height: 266 * 2 + 140 }, deviceScaleFactor: 1 });
        await page2.setContent(`<!doctype html><html><body style="margin:0;padding:5px;background:#f5f3ef;font:12px sans-serif">
            <div style="display:flex;flex-wrap:wrap;gap:10px">${imgs.map((s, i) => `<figure style="margin:0"><img src="${s}" width="256" height="256"><figcaption>${ALL[i].key}</figcaption></figure>`).join('')}</div>
            <div style="display:flex;gap:8px;margin-top:8px">${imgs.map((s) => `<img src="${s}" width="80" height="80" style="border-radius:12px">`).join('')}</div>
            <div style="display:flex;gap:8px;margin-top:8px">${imgs.map((s) => `<img src="${s}" width="44" height="44" style="border-radius:50%">`).join('')}</div></body></html>`);
        await page2.screenshot({ path: sheet, fullPage: true });
        console.log(`sheet ${sheet}`);
    }
} finally {
    await browser.close();
}
