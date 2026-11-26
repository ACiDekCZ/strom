// Invented register pages ("scans") for the demo research: a printed form with
// handwritten entries on aged paper, rendered by Chromium. One of the entries on
// each page is the demo family's; its box is written beside the image so the
// builder can clip it (strom source add --clip M…@x,y,w,h).
//   node gen-scans.mjs <lang> <outdir>
// → <outdir>/<page>.jpg, <outdir>/<page>-clip.jpg (the entry alone) and <outdir>/clips.json { page: {x,y,w,h} } (pixels)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// Playwright of the Strom repository this folder lives in (tools/ukazka)
const { chromium } = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'))('playwright');

const lang = process.argv[2] ?? 'cs';
const out = path.resolve(process.argv[3] ?? `/tmp/scans-${lang}`);
fs.mkdirSync(out, { recursive: true });

// Each page: printed title, column heads, rows (cells); `mark` = the row of the demo family.
const PAGES = {
    cs: {
        bapt1931: {
            title: 'Matrika narozených · Farnost Dolní Lhota · 1931', folio: 'fol. 112',
            heads: ['Číslo', 'Den narození a křtu', 'Čp.', 'Jméno dítěte', 'Otec', 'Matka', 'Kmotři'],
            widths: [6, 14, 5, 12, 23, 22, 18],
            rows: [
                ['1', '3. ledna / 6. ledna', '27', 'František', 'Jan Dvořák, domkář v Dolní Lhotě', 'Marie roz. Šimková', 'Václav Šimek, rolník'],
                ['2', '14. ledna / 18. ledna', '12', 'Anna', 'Josef Horák, rolník v Dolní Lhotě čp. 12, syn Václava Horáka a Kateřiny roz. Vlkové', 'Marie roz. Krejčí, dcera Františka Krejčího a Ludmily roz. Novákové', 'Růžena Horáková, svobodná'],
                ['3', '29. ledna / 1. února', '40', 'Marie', 'Antonín Kos, kovář', 'Anna roz. Malá', 'Anna Malá, výměnkářka'],
            ],
            mark: 1,
        },
        marr1924: {
            title: 'Matrika oddaných · Farnost Dolní Lhota · 1924', folio: 'fol. 58',
            heads: ['Číslo', 'Den oddavek', 'Ženich', 'Věk', 'Nevěsta', 'Věk', 'Svědkové'],
            widths: [6, 11, 28, 6, 28, 6, 15],
            rows: [
                ['7', '12. května', 'Josef Horák, rolník, Dolní Lhota čp. 12, syn Václava Horáka a Kateřiny roz. Vlkové', '26', 'Marie Krejčí, Dolní Lhota čp. 31, dcera Františka Krejčího a Ludmily roz. Novákové', '21', 'Karel Krejčí, Jan Svoboda'],
                ['8', '26. května', 'Karel Beneš, tesař, Horní Lhota čp. 9', '29', 'Anežka Pokorná, Dolní Lhota čp. 4', '24', 'Josef Pokorný'],
            ],
            mark: 0,
        },
        bapt1898: {
            title: 'Liber natorum · Parochia Dolní Lhota · 1898', folio: 'fol. 21',
            heads: ['Nr.', 'Dies nativitatis', 'Domus', 'Nomen', 'Pater', 'Mater', 'Patrini'],
            widths: [6, 13, 6, 11, 24, 24, 16],
            rows: [
                ['11', '28. Februarii', '5', 'Wenceslaus', 'Joannes Vlk, agricola', 'Anna nata Kolářová', 'Josephus Kolář'],
                ['12', '3. Martii', '12', 'Josephus', 'Wenceslaus Horák, agricola, filius Joannis Horák', 'Catharina nata Vlk, filia Joannis Vlk ex Horní Lhota', 'Franciscus Krejčí'],
                ['13', '9. Martii', '33', 'Maria', 'Adalbertus Novák, textor', 'Barbara nata Černá', 'Maria Černá'],
            ],
            mark: 1,
        },
    },
    en: {
        bapt1931: {
            title: 'Baptisms solemnized in the Parish of St Mary, Thornbury · 1931', folio: 'p. 112',
            heads: ['No.', 'When baptised', 'Child’s name', 'Parents', 'Surname', 'Abode', 'Trade', 'By whom'],
            widths: [5, 12, 11, 20, 11, 15, 10, 16],
            rows: [
                ['892', 'Jan. 4th', 'Frank', 'John & Mary', 'Dawson', 'Church Street', 'Labourer', 'H. Ellis, Vicar'],
                ['893', 'Jan. 18th, born Jan. 14th', 'Emily', 'Thomas & Mary', 'Hartley', 'Mill Lane', 'Farmer', 'H. Ellis, Vicar'],
                ['894', 'Feb. 1st', 'Mary', 'Albert & Ann', 'Moss', 'The Green', 'Smith', 'H. Ellis, Vicar'],
            ],
            mark: 1,
        },
        marr1924: {
            title: 'Marriages solemnized at the Parish Church of St Mary, Thornbury · 1924', folio: 'p. 58',
            heads: ['No.', 'When married', 'Name and surname', 'Age', 'Condition', 'Rank or profession', 'Father’s name', 'Rank of father'],
            widths: [5, 11, 22, 6, 10, 14, 18, 14],
            rows: [
                ['115', 'May 12th', 'Thomas Hartley', '26', 'Bachelor', 'Farmer', 'William Hartley', 'Farmer'],
                ['', '', 'Mary Cooper', '21', 'Spinster', '—', 'George Cooper', 'Blacksmith'],
                ['116', 'May 26th', 'Charles Webb', '29', 'Bachelor', 'Carpenter', 'Henry Webb', 'Carpenter'],
            ],
            mark: 0, markRows: 2,
        },
        bapt1898: {
            title: 'Baptisms solemnized in the Parish of St Mary, Thornbury · 1898', folio: 'p. 21',
            heads: ['No.', 'When baptised', 'Child’s name', 'Parents', 'Surname', 'Abode', 'Trade', 'By whom'],
            widths: [5, 12, 11, 20, 11, 15, 10, 16],
            rows: [
                ['161', 'Feb. 28th', 'Walter', 'John & Ann', 'Fletcher', 'Oakley', 'Miller', 'R. Price, Curate'],
                ['162', 'Mar. 3rd', 'Thomas', 'William & Sarah', 'Hartley', 'Mill Lane', 'Labourer', 'R. Price, Curate'],
                ['163', 'Mar. 9th', 'Maria', 'Albert & Barbara', 'Nash', 'Bridge End', 'Weaver', 'R. Price, Curate'],
            ],
            mark: 1,
        },
    },
    de: {
        bapt1931: {
            title: 'Taufbuch · Pfarrei Oberndorf · 1931', folio: 'fol. 112',
            heads: ['Nr.', 'Geburts- und Tauftag', 'Haus', 'Name des Kindes', 'Vater', 'Mutter', 'Paten'],
            widths: [6, 14, 5, 12, 23, 22, 18],
            rows: [
                ['1', '3. Januar / 6. Januar', '27', 'Franz', 'Johann Bauer, Häusler in Oberndorf', 'Maria geb. Schmid', 'Wenzel Schmid, Bauer'],
                ['2', '14. Januar / 18. Januar', '12', 'Anna', 'Johann Weber, Landwirt in Oberndorf Nr. 12, Sohn des Georg Weber und der Katharina geb. Vogel', 'Maria geb. Schneider, Tochter des Franz Schneider und der Theresia geb. Huber', 'Rosa Weber, ledig'],
                ['3', '29. Januar / 1. Februar', '40', 'Maria', 'Anton Koch, Schmied', 'Anna geb. Klein', 'Anna Klein, Auszüglerin'],
            ],
            mark: 1,
        },
        marr1924: {
            title: 'Trauungsbuch · Pfarrei Oberndorf · 1924', folio: 'fol. 58',
            heads: ['Nr.', 'Tag der Trauung', 'Bräutigam', 'Alter', 'Braut', 'Alter', 'Zeugen'],
            widths: [6, 11, 28, 6, 28, 6, 15],
            rows: [
                ['7', '12. Mai', 'Johann Weber, Landwirt, Oberndorf Nr. 12, Sohn des Georg Weber und der Katharina geb. Vogel', '26', 'Maria Schneider, Oberndorf Nr. 31, Tochter des Franz Schneider und der Theresia geb. Huber', '21', 'Karl Schneider, Johann Kaiser'],
                ['8', '26. Mai', 'Karl Braun, Zimmermann, Unterdorf Nr. 9', '29', 'Agnes Wolf, Oberndorf Nr. 4', '24', 'Josef Wolf'],
            ],
            mark: 0,
        },
        bapt1898: {
            title: 'Liber natorum · Parochia Oberndorf · 1898', folio: 'fol. 21',
            heads: ['Nr.', 'Dies nativitatis', 'Domus', 'Nomen', 'Pater', 'Mater', 'Patrini'],
            widths: [6, 13, 6, 11, 24, 24, 16],
            rows: [
                ['11', '28. Februarii', '5', 'Wenceslaus', 'Joannes Vogel, agricola', 'Anna nata Kaiser', 'Josephus Kaiser'],
                ['12', '3. Martii', '12', 'Joannes', 'Georgius Weber, agricola, filius Josephi Weber', 'Catharina nata Vogel, filia Josephi Vogel ex Unterdorf', 'Franciscus Schneider'],
                ['13', '9. Martii', '33', 'Maria', 'Adalbertus Huber, textor', 'Barbara nata Schwarz', 'Maria Schwarz'],
            ],
            mark: 1,
        },
    },
    pl: {
        bapt1931: {
            title: 'Księga urodzeń · Parafia Wierzbno Dolne · 1931', folio: 'k. 112',
            heads: ['Numer', 'Dzień urodzenia i chrztu', 'Nr domu', 'Imię dziecka', 'Ojciec', 'Matka', 'Chrzestni'],
            widths: [6, 14, 5, 12, 23, 22, 18],
            rows: [
                ['1', '3 stycznia / 6 stycznia', '27', 'Franciszek', 'Jan Dudek, chałupnik w Wierzbnie Dolnym', 'Maria z d. Szymańska', 'Wacław Szymański, rolnik'],
                ['2', '14 stycznia / 18 stycznia', '12', 'Zofia', 'Józef Jaworski, rolnik w Wierzbnie Dolnym nr 12, syn Wacława Jaworskiego i Katarzyny z d. Wilk', 'Maria z d. Krawczyk, córka Franciszka Krawczyka i Ludwiki z d. Nowak', 'Stefania Jaworska, panna'],
                ['3', '29 stycznia / 1 lutego', '40', 'Maria', 'Antoni Drozd, kowal', 'Anna z d. Mazur', 'Anna Mazur, wycużniczka'],
            ],
            mark: 1,
        },
        marr1924: {
            title: 'Księga ślubów · Parafia Wierzbno Dolne · 1924', folio: 'k. 58',
            heads: ['Numer', 'Dzień ślubu', 'Pan młody', 'Wiek', 'Panna młoda', 'Wiek', 'Świadkowie'],
            widths: [6, 11, 28, 6, 28, 6, 15],
            rows: [
                ['7', '12 maja', 'Józef Jaworski, rolnik, Wierzbno Dolne nr 12, syn Wacława Jaworskiego i Katarzyny z d. Wilk', '26', 'Maria Krawczyk, Wierzbno Dolne nr 31, córka Franciszka Krawczyka i Ludwiki z d. Nowak', '21', 'Karol Krawczyk, Jan Stępniak'],
                ['8', '26 maja', 'Karol Laskowski, cieśla, Wierzbno Górne nr 9', '29', 'Agnieszka Kmieć, Wierzbno Dolne nr 4', '24', 'Józef Kmieć'],
            ],
            mark: 0,
        },
        bapt1898: {
            title: 'Liber natorum · Parochia Wierzbno Dolne · 1898', folio: 'fol. 21',
            heads: ['Nr.', 'Dies nativitatis', 'Domus', 'Nomen', 'Pater', 'Mater', 'Patrini'],
            widths: [6, 13, 6, 11, 24, 24, 16],
            rows: [
                ['11', '28. Februarii', '5', 'Venceslaus', 'Joannes Wilk, agricola', 'Anna nata Kołodziej', 'Josephus Kołodziej'],
                ['12', '3. Martii', '12', 'Josephus', 'Venceslaus Jaworski, agricola, filius Joannis Jaworski', 'Catharina nata Wilk, filia Joannis Wilk ex Wierzbno Górne', 'Franciscus Krawczyk'],
                ['13', '9. Martii', '33', 'Maria', 'Adalbertus Nowak, textor', 'Barbara nata Czarnecka', 'Maria Czarnecka'],
            ],
            mark: 1,
        },
    },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const W = 2200, H = 1400;

function html(p) {
    const cols = p.widths.map((w) => `<col style="width:${w}%">`).join('');
    const heads = p.heads.map((h) => `<th>${esc(h)}</th>`).join('');
    const rows = p.rows.map((r, i) => `<tr data-i="${i}">${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    // a few empty ruled rows below, as on a real page
    const empty = Array.from({ length: 4 }, () => `<tr class="empty">${p.heads.map(() => '<td></td>').join('')}</tr>`).join('');
    return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0}
body{width:${W}px;height:${H}px;position:relative;overflow:hidden;
 background:
  radial-gradient(ellipse at 20% 15%, rgba(255,250,235,.55), transparent 55%),
  radial-gradient(ellipse at 85% 80%, rgba(120,85,40,.22), transparent 60%),
  radial-gradient(ellipse at 50% 50%, #eadcbc, #d9c79f 75%, #c8b184);
 font-family:"Snell Roundhand","Apple Chancery","Brush Script MT",cursive;color:#2c2216}
body::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.35;mix-blend-mode:multiply;
 background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/><feColorMatrix values='0 0 0 0 .45 0 0 0 0 .35 0 0 0 0 .2 0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.page{position:absolute;left:90px;right:90px;top:70px}
h1{font:600 38px/1.2 "Baskerville","Hoefler Text",Georgia,serif;letter-spacing:.06em;text-align:center;margin:0 0 8px;color:#3a2c1c}
.folio{position:absolute;right:0;top:-20px;font:italic 30px "Baskerville",Georgia,serif;color:#5a4630}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:26px}
th{font:600 22px/1.2 "Baskerville","Hoefler Text",Georgia,serif;color:#3a2c1c;padding:10px 8px;border:2px solid #6b5436;background:rgba(160,130,80,.12)}
td{border:1.5px solid #7d6645;padding:16px 12px;vertical-align:top;font-size:36px;line-height:1.28;color:#261b10;text-shadow:0 0 1px rgba(40,25,10,.35)}
tr.empty td{height:120px}
td:first-child{text-align:center}
</style><div class="page"><div class="folio">${esc(p.folio)}</div><h1>${esc(p.title)}</h1>
<table><colgroup>${cols}</colgroup><thead><tr>${heads}</tr></thead><tbody>${rows}${empty}</tbody></table></div>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const clips = {};
for (const [name, p] of Object.entries(PAGES[lang])) {
    await page.setContent(html(p));
    await page.evaluate(() => document.fonts.ready);
    const boxes = await page.evaluate(({ mark, n }) => {
        const rows = [...document.querySelectorAll('tbody tr')].slice(mark, mark + n).map((r) => r.getBoundingClientRect());
        const top = Math.min(...rows.map((b) => b.top)), bottom = Math.max(...rows.map((b) => b.bottom));
        return { x: rows[0].left, y: top, w: rows[0].width, h: bottom - top };
    }, { mark: p.mark, n: p.markRows ?? 1 });
    const pad = 18;
    clips[name] = { x: Math.max(0, Math.round(boxes.x - pad)), y: Math.max(0, Math.round(boxes.y - pad)), w: Math.round(boxes.w + 2 * pad), h: Math.round(boxes.h + 2 * pad) };
    await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 88 });
    // the entry alone, for a tree that carries its excerpt (build-family.ts)
    await page.screenshot({ path: path.join(out, `${name}-clip.jpg`), type: 'jpeg', quality: 88, clip: { x: clips[name].x, y: clips[name].y, width: clips[name].w, height: clips[name].h } });
}
fs.writeFileSync(path.join(out, 'clips.json'), JSON.stringify({ ...clips, _size: { w: W, h: H } }, null, 1));
await browser.close();
console.log(out);
