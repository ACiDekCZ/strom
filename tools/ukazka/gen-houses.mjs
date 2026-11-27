// Drawn pictures of the demo's home village and its mill (Strom 3.33 / research 1.38, spec 145 T1: the look of a house,
// the pictures of its municipality): no real place, no photo, no generated image — each picture is plain SVG drawn
// here (gabled cottages, a chapel, the mill with its wheel), toned like an old postcard. One set for every language:
// the research names them by their address (demo-houses.ts: pictureUrl), the shots serve them from this folder.
// Rendered by Chromium as JPEG at quality 0.8.
//   node gen-houses.mjs [outdir] [--sheet <file.png>]
// → <outdir>/<name>.jpg (default ./houses)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.resolve(HERE, '../../package.json'))('playwright');

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const sheet = sheetAt >= 0 ? path.resolve(args[sheetAt + 1]) : null;
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && (sheetAt < 0 || i !== sheetAt + 1)) ?? path.join(HERE, 'houses'));

const W = 640, H = 420;
/** A tone of the postcard's sepia: 0 dark … 1 light. */
const T = (v) => {
    const dark = [58, 42, 28], light = [238, 226, 204];
    return `rgb(${dark.map((d, i) => Math.round(d + (light[i] - d) * v)).join(',')})`;
};
const line = T(0.12);

/** A gabled cottage: its left foot x, ground y, width, wall height, roof height; gable to the viewer or the eaves. */
function cottage(x, y, w, h, r, gable = true, shade = 0.78) {
    const wall = gable
        ? `<path d="M ${x},${y} L ${x},${y - h} L ${x + w / 2},${y - h - r} L ${x + w},${y - h} L ${x + w},${y} Z" fill="${T(shade)}" stroke="${line}" stroke-width="1.2"/>
           <path d="M ${x - 4},${y - h + 2} L ${x + w / 2},${y - h - r - 3} L ${x + w + 4},${y - h + 2}" fill="none" stroke="${T(0.22)}" stroke-width="3"/>`
        : `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="${T(shade)}" stroke="${line}" stroke-width="1.2"/>
           <path d="M ${x - 5},${y - h} L ${x + w * 0.18},${y - h - r} L ${x + w * 0.82},${y - h - r} L ${x + w + 5},${y - h} Z" fill="${T(0.36)}" stroke="${line}" stroke-width="1.2"/>`;
    const n = Math.max(1, Math.floor(w / 26));
    const win = Array.from({ length: n }, (_, i) => {
        const wx = x + (w / (n + 1)) * (i + 1) - 5;
        return `<rect x="${wx}" y="${y - h * 0.68}" width="10" height="12" fill="${T(0.26)}" stroke="${line}" stroke-width="0.8"/><path d="M ${wx + 5},${y - h * 0.68} v 12 M ${wx},${y - h * 0.68 + 6} h 10" stroke="${T(0.7)}" stroke-width="0.7"/>`;
    }).join('');
    const roofHatch = gable ? '' : Array.from({ length: Math.floor(w / 6) }, (_, i) => `<path d="M ${x + i * 6},${y - h} l ${3},${-r * 0.9}" stroke="${T(0.24)}" stroke-width="0.6"/>`).join('');
    return `<g>${wall}${win}${roofHatch}</g>`;
}

/** A broad tree: its foot and size. */
function tree(x, y, s, v = 0.34) {
    const blobs = [[0, -1.6, 1], [-0.7, -1.2, 0.8], [0.7, -1.25, 0.8], [0, -2.2, 0.75]]
        .map(([dx, dy, r]) => `<circle cx="${x + dx * s}" cy="${y + dy * s}" r="${r * s}" fill="${T(v)}" stroke="${T(v - 0.12)}" stroke-width="0.8"/>`).join('');
    return `<g><rect x="${x - s * 0.08}" y="${y - s}" width="${s * 0.16}" height="${s}" fill="${T(0.2)}"/>${blobs}</g>`;
}

/** The sky, hills and the ground of every picture. */
function landscape(seed, horizon) {
    return `<rect width="${W}" height="${H}" fill="url(#sky)"/>
      <path d="M 0,${horizon - 30} C 120,${horizon - 70} 220,${horizon - 40} 330,${horizon - 62} S 540,${horizon - 30} ${W},${horizon - 58} L ${W},${horizon} L 0,${horizon} Z" fill="${T(0.62)}"/>
      <path d="M 0,${horizon - 8} C 160,${horizon - 30} 300,${horizon - 4} 460,${horizon - 22} S ${W - 40},${horizon - 6} ${W},${horizon - 14} L ${W},${H} L 0,${H} Z" fill="${T(0.72)}"/>
      ${Array.from({ length: 22 }, (_, i) => `<path d="M ${((i * 97 + seed * 31) % W)},${horizon + 30 + ((i * 53) % (H - horizon - 40))} q 14,-3 28,0" stroke="${T(0.52)}" stroke-width="0.8" fill="none"/>`).join('')}`;
}

/** The green of the village: cottages around it, the chapel, a pond, trees. */
function green() {
    const y = 300;
    return `${landscape(3, 250)}
      ${tree(60, 286, 46, 0.3)}${tree(590, 280, 52, 0.32)}
      ${cottage(30, y, 92, 54, 40, true, 0.8)}${cottage(132, y - 6, 120, 46, 26, false, 0.76)}
      <g><rect x="282" y="${y - 86}" width="58" height="86" fill="${T(0.86)}" stroke="${line}" stroke-width="1.2"/>
         <path d="M 276,${y - 84} L 311,${y - 122} L 346,${y - 84} Z" fill="${T(0.34)}" stroke="${line}" stroke-width="1.2"/>
         <rect x="301" y="${y - 160}" width="20" height="40" fill="${T(0.84)}" stroke="${line}" stroke-width="1.1"/>
         <path d="M 297,${y - 158} L 311,${y - 196} L 325,${y - 158} Z" fill="${T(0.3)}" stroke="${line}" stroke-width="1.1"/>
         <path d="M 311,${y - 196} v -12 M 305,${y - 202} h 12" stroke="${line}" stroke-width="1.4"/>
         <path d="M 303,${y - 40} a 8,10 0 0 1 16,0 v 40 h -16 Z" fill="${T(0.24)}"/></g>
      ${cottage(372, y - 4, 110, 50, 28, false, 0.74)}${cottage(498, y, 86, 56, 42, true, 0.82)}
      <ellipse cx="420" cy="352" rx="96" ry="18" fill="${T(0.5)}" stroke="${T(0.4)}" stroke-width="1"/>
      ${Array.from({ length: 6 }, (_, i) => `<path d="M ${350 + i * 24},${352 + (i % 2) * 4} q 8,-2 16,0" stroke="${T(0.7)}" stroke-width="0.8" fill="none"/>`).join('')}
      ${tree(250, 330, 36, 0.36)}${tree(200, 372, 28, 0.4)}
      <path d="M 0,${H - 40} C 180,${H - 60} 300,${H - 30} ${W},${H - 52}" stroke="${T(0.6)}" stroke-width="10" fill="none"/>`;
}

/** The mill below the village: the building, the millrace, the wheel, the stream. */
function mill(close) {
    const s = close ? 1.7 : 1;
    const x0 = close ? 120 : 330, y = close ? 330 : 296;
    const wheel = (cx, cy, r) => `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T(0.16)}" stroke-width="${3 * s}"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.18}" fill="${T(0.2)}"/>
        ${Array.from({ length: 12 }, (_, i) => { const a = (Math.PI * 2 * i) / 12; return `<path d="M ${cx},${cy} L ${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}" stroke="${T(0.22)}" stroke-width="${1.2 * s}"/>`; }).join('')}
        ${Array.from({ length: 16 }, (_, i) => { const a = (Math.PI * 2 * i) / 16; return `<rect x="${cx + Math.cos(a) * r - 3 * s}" y="${cy + Math.sin(a) * r - 3 * s}" width="${6 * s}" height="${6 * s}" fill="${T(0.3)}"/>`; }).join('')}</g>`;
    return `${landscape(close ? 11 : 7, close ? 230 : 246)}
      ${close ? '' : `${cottage(40, 270, 86, 44, 32, true, 0.82)}${cottage(140, 264, 96, 38, 22, false, 0.78)}${tree(268, 262, 30, 0.38)}`}
      ${tree(x0 - 40 * s, y - 4, 44 * s, 0.3)}${tree(x0 + 250 * s, y - 2, 40 * s, 0.34)}
      ${cottage(x0, y, 150 * s, 62 * s, 50 * s, true, 0.84)}
      ${cottage(x0 + 150 * s, y, 70 * s, 48 * s, 20 * s, false, 0.72)}
      <path d="M ${x0 + 160 * s},${y - 66 * s} L ${x0 + 240 * s},${y - 70 * s}" stroke="${T(0.2)}" stroke-width="${5 * s}"/>
      ${wheel(x0 + 236 * s, y - 20 * s, 32 * s)}
      <path d="M 0,${y + 24 * s} C ${W * 0.3},${y + 6 * s} ${W * 0.6},${y + 40 * s} ${W},${y + 18 * s} L ${W},${y + 52 * s} C ${W * 0.6},${y + 70 * s} ${W * 0.3},${y + 36 * s} 0,${y + 56 * s} Z" fill="${T(0.54)}" stroke="${T(0.4)}" stroke-width="1"/>
      ${Array.from({ length: 9 }, (_, i) => `<path d="M ${30 + i * 68},${y + 34 * s + (i % 3) * 5} q 10,-3 20,0" stroke="${T(0.76)}" stroke-width="1" fill="none"/>`).join('')}`;
}

const PICTURES = [
    { name: 'green', draw: green },
    { name: 'valley', draw: () => mill(false) },
    { name: 'mill', draw: () => mill(true) },
];

function svg(p, i) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T(0.8)}"/><stop offset="1" stop-color="${T(0.93)}"/></linearGradient>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.72"><stop offset="0.62" stop-color="${T(0.1)}" stop-opacity="0"/><stop offset="1" stop-color="${T(0.1)}" stop-opacity="0.45"/></radialGradient>
    <filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${i + 3}"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="${i + 9}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.16"/></feComponentTransfer></filter>
  </defs>
  <g filter="url(#rough)">${p.draw()}</g>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${T(0.95)}" stroke-width="6"/>
</svg>`;
}

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    for (const [i, p] of PICTURES.entries()) {
        await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg(p, i)}</body></html>`);
        const file = path.join(out, `${p.name}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: W, height: H } });
        console.log(`${p.name} ${fs.statSync(file).size} B`);
    }
    if (sheet) {
        const page2 = await browser.newPage({ viewport: { width: W * 3 + 40, height: H + 20 }, deviceScaleFactor: 1 });
        await page2.setContent(`<!doctype html><html><body style="margin:0;padding:10px;background:#eee;display:flex;gap:10px">${PICTURES.map((p) => `<img src="data:image/jpeg;base64,${fs.readFileSync(path.join(out, `${p.name}.jpg`)).toString('base64')}">`).join('')}</body></html>`);
        await page2.screenshot({ path: sheet });
        console.log(`sheet ${sheet}`);
    }
} finally {
    await browser.close();
}
