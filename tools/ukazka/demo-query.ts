// The data of the demo research for the shots of `strom query` (research 1.32): the Horáks of house 12 as millers over
// four generations, the occupation in its Czech, German and Latin forms (mlynář, Müller, Müllner, molitor), a side
// branch, births in the 18th century, and two stories of the mill. Invented, Czech only (shots made on request,
// LANGS=cs). Gated: SHOWCASE_QUERY=1 (build-demo.ts), off by default, so the whole set stays as it is.
type J = Record<string, unknown>;

export interface QueryCtx {
    lang: string;
    strom: (...args: string[]) => J;
    id: (j: J, prefix: string) => string;
    /** The demo's people and tasks by key (build-demo.ts). */
    P: Record<string, string>;
    /** The main direction (Anna's ancestors). */
    G1: string;
    /** The village of the Horáks. */
    place: string;
}

export function addQuery(c: QueryCtx): void {
    if (c.lang !== 'cs') {
        console.warn(`demo-query: only cs (not ${c.lang})`);
        return;
    }
    const { strom, id, P, place } = c;
    const t = id(strom('task', 'add', 'Povolání předků z matrik, katastru a sčítání', '--level', 'enrich', '--research', c.G1,
        '--about', P.vaclav!, '--about', P.jan!, '--about', P.matej!, '--where', 'Křty Dolní Lhota 1784–1829, stabilní katastr, sčítání 1869 a 1890',
        '--why', 'mlýn v čp. 12', '--done-when', 'povolání zapsána'), 'T');
    strom('session', 'start', t);
    const src = (title: string, kind: string, date: string, info: string, transcript: string, ...more: string[]) =>
        id(strom('source', 'add', title, '--kind', kind, '--date', date, '--information', info, '--transcript', transcript, ...more), 'S');
    const ev = (who: string, kind: string, ...more: string[]) => id(strom('event', 'add', who, kind, ...more), 'E');

    // Matěj's own family (with his son Jan), found before his parents' family exists
    const fMatej = id(strom('person', 'show', P.matej!), 'F');
    // Matěj's parents and his sister: the Horáks of house 12 before 1800
    const jakub = id(strom('person', 'add', 'Jakub /Horák/', '--sex', 'M', '--born', 'ABT 1768', '--born-place', place), 'P');
    const dorota = id(strom('person', 'add', 'Dorota /Horáková/', '--sex', 'F', '--note', 'provdaná do mlýna v Horní Lhotě'), 'P');
    const sM = src('Křest Matěje Horáka 1796', 'baptism', '13 NOV 1796', 'primary',
        'Matthias, filius Jacobi Horak molitoris in Dolní Lhota No. 12 et Mariae', '--language', 'la', '--locator', 'fol. 64');
    strom('event', 'add', P.matej!, 'BIRT', '--date', '12 NOV 1796', '--place', place, '--house', '12', '--cite', sM, '--status', 'proven');
    ev(jakub, 'OCCU', '--value', 'molitor', '--date', '1796', '--place', place, '--house', '12', '--cite', sM, '--status', 'proven');
    strom('family', 'add', '--partner', jakub, '--child', P.matej!, '--child', dorota, '--cite', sM);
    const sD = src('Křest Doroty Horákové 1799', 'baptism', '3 FEB 1799', 'primary',
        'Dorothea, filia Jacobi Horak molitoris in Dolní Lhota No. 12', '--language', 'la', '--locator', 'fol. 81');
    strom('event', 'add', dorota, 'BIRT', '--date', '2 FEB 1799', '--place', place, '--house', '12', '--cite', sD, '--status', 'proven');

    // Matěj in the cadastre, his younger son Vojtěch a miller's journeyman (a side branch)
    const sK = src('Stabilní katastr Dolní Lhota 1842', 'land', '1842', 'primary', 'čp. 12 Matěj Horák, mlynář, mlýn o jednom kole');
    const eMatej = ev(P.matej!, 'OCCU', '--value', 'mlynář', '--date', '1842', '--place', place, '--house', '12', '--cite', sK, '--status', 'proven');
    const vojtech = id(strom('person', 'add', 'Vojtěch /Horák/', '--sex', 'M', '--born', 'ABT 1841', '--born-place', place), 'P');
    strom('family', 'child', fMatej, vojtech, '--cite', sK);
    const sV = src('Oddavky Vojtěcha Horáka 1866', 'marriage', '6 FEB 1866', 'primary', 'Vojtěch Horák, mlynářský tovaryš z Dolní Lhoty čp. 12, syn Matěje');
    ev(vojtech, 'OCCU', '--value', 'mlynářský tovaryš', '--date', '1866', '--place', 'Horní Lhota', '--cite', sV, '--status', 'probable');

    // Jan in the census of 1869 (German forms), Václav in the census of 1890
    const s69 = src('Sčítání lidu 1869, Dolní Lhota', 'census', '1869', 'primary', 'Nr. 12: Johann Horak, Müller; Katharina; Wenzel, Sohn', '--language', 'de');
    const eJan = ev(P.jan!, 'OCCU', '--value', 'Müller', '--date', '1869', '--place', place, '--house', '12', '--cite', s69, '--status', 'proven');
    const s90 = src('Sčítání lidu 1890, Dolní Lhota', 'census', '1890', 'primary', 'čp. 12: Václav Horák, mlynář; Kateřina; Josef, Růžena');
    const eVaclav = ev(P.vaclav!, 'OCCU', '--value', 'mlynář', '--date', '1890', '--place', place, '--house', '12', '--cite', s90, '--status', 'proven');

    // The mother's side: Tomáš Krejčí only from a list of trades (a lead)
    const sT = src('Seznam živností okresu 1880', 'other', '1880', 'secondary', 'Krejčí Thomas, Müllner, Horní Lhota');
    ev(P.tomas!, 'OCCU', '--value', 'Müllner', '--date', '1880', '--place', 'Horní Lhota', '--cite', sT, '--status', 'lead');

    // Two stories of the mill: Václav's (approved), Matěj's (a draft)
    // (no "čp." in them: research 1.32 ends the sentence of a story's snippet at its full stop)
    strom('story', 'set', P.vaclav!, '--title', 'Syn Janův',
        '--text', 'Václav Horák převzal **mlýn v Dolní Lhotě** po otci Janovi, kterého sčítání 1869 zapisuje německy jako Müller. Při sčítání 1890 je mlynářem on sám. Jeho syn Josef už mlýn nevedl a hospodařil jako rolník.',
        '--fact', eVaclav, '--fact', eJan, '--final');
    strom('story', 'set', P.matej!, '--title', 'Kolo na potoce',
        '--text', 'Matěj Horák se narodil roku 1796 v domě číslo 12 jako syn Jakuba, kterého křestní zápis nazývá latinsky *molitor*. Katastr 1842 ho zapisuje jako mlynáře s mlýnem o jednom kole.',
        '--fact', eMatej);

    strom('task', 'done', t, '--result', 'mlynáři v čp. 12 ve čtyřech generacích');
    strom('session', 'close', '--summary', 'Povolání předků: Horákové z čp. 12 mlynáři od Jakuba (1796) po Václava (1890).', '--next', 'křest Jana Horáka');
}
