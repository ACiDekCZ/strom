/**
 * Bundled demo family trees for onboarding. Chosen by UI language: Czech users
 * get the Přemyslid dynasty, everyone else the House of Tudor — the app targets
 * an international audience, so the default demo must not be region-specific.
 * The data ships inside the app (no download), works offline and in the
 * single-file export.
 *
 * Historical data from public sources (Wikipedia/Britannica). Early Přemyslid
 * dates are uncertain and intentionally use flex-date qualifiers (~ / <), which
 * doubles as a showcase of that feature. Multiple marriages (Ottokar I & II,
 * Wenceslaus II; Henry VIII's six wives) showcase partner chains.
 */

import {
    StromData, Person, Partnership, PersonId, PartnershipId, Gender,
    toPersonId, toPartnershipId, STROM_DATA_VERSION,
} from './types.js';

interface PersonOpts {
    birthDate?: string;
    deathDate?: string;
    notes?: string;
}

/** Small deterministic builder — no Date.now / Math.random, stable IDs. */
class DemoBuilder {
    private persons: Record<PersonId, Person> = {};
    private partnerships: Record<PartnershipId, Partnership> = {};

    constructor(private prefix: string) {}

    person(id: string, firstName: string, lastName: string, gender: Gender, opts: PersonOpts = {}): PersonId {
        const pid = toPersonId(`${this.prefix}_${id}`);
        const p: Person = {
            id: pid, firstName, lastName, gender,
            isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        };
        if (opts.birthDate) p.birthDate = opts.birthDate;
        if (opts.deathDate) p.deathDate = opts.deathDate;
        if (opts.notes) p.notes = opts.notes;
        this.persons[pid] = p;
        return pid;
    }

    /** Marry two people. The male partner is person1 (rendered left), as elsewhere. */
    marry(a: PersonId, b: PersonId): PartnershipId {
        let p1 = a, p2 = b;
        if (this.persons[a].gender === 'female' && this.persons[b].gender === 'male') {
            p1 = b; p2 = a;
        }
        const uid = toPartnershipId(`u_${p1}_${p2}`);
        this.partnerships[uid] = { id: uid, person1Id: p1, person2Id: p2, childIds: [], status: 'married' };
        this.persons[p1].partnerships.push(uid);
        this.persons[p2].partnerships.push(uid);
        return uid;
    }

    kids(union: PartnershipId, ...children: PersonId[]): void {
        const u = this.partnerships[union];
        for (const c of children) {
            u.childIds.push(c);
            this.persons[c].parentIds = [u.person1Id, u.person2Id];
            if (!this.persons[u.person1Id].childIds.includes(c)) this.persons[u.person1Id].childIds.push(c);
            if (!this.persons[u.person2Id].childIds.includes(c)) this.persons[u.person2Id].childIds.push(c);
        }
    }

    build(): StromData {
        return { version: STROM_DATA_VERSION, persons: this.persons, partnerships: this.partnerships };
    }
}

// ==================== PŘEMYSLOVCI ====================

function buildPremyslids(): { data: StromData; focus: PersonId } {
    const b = new DemoBuilder('pr');

    const borivoj = b.person('borivoj', 'Bořivoj I.', 'Přemyslovec', 'male', { birthDate: '~852', deathDate: '~889', notes: 'První historicky doložený přemyslovský kníže, pokřtěný svatým Metodějem.' });
    const ludmila = b.person('ludmila', 'Ludmila', 'ze Pšova', 'female', { birthDate: '~860', deathDate: '921', notes: 'Svatá Ludmila, babička sv. Václava; zavražděna z popudu Drahomíry.' });
    const uBorivoj = b.marry(borivoj, ludmila);
    const spytihnev1 = b.person('spytihnev1', 'Spytihněv I.', 'Přemyslovec', 'male', { birthDate: '~875', deathDate: '915' });
    const vratislav1 = b.person('vratislav1', 'Vratislav I.', 'Přemyslovec', 'male', { birthDate: '~888', deathDate: '921' });
    b.kids(uBorivoj, spytihnev1, vratislav1);

    const drahomira = b.person('drahomira', 'Drahomíra', 'ze Stodor', 'female', { birthDate: '~890', deathDate: '>935' });
    const uVratislav1 = b.marry(vratislav1, drahomira);
    const vaclav = b.person('vaclav', 'Václav I.', 'Přemyslovec', 'male', { birthDate: '~907', deathDate: '935', notes: 'Svatý Václav, patron české země; zavražděn bratrem Boleslavem ve Staré Boleslavi.' });
    const boleslav1 = b.person('boleslav1', 'Boleslav I.', 'Přemyslovec', 'male', { birthDate: '~915', deathDate: '972', notes: 'Zvaný Ukrutný; za jeho vlády vzniklo pražské biskupství.' });
    b.kids(uVratislav1, vaclav, boleslav1);

    const biagota = b.person('biagota', 'Biagota', '', 'female', { birthDate: '~920' });
    const uBoleslav1 = b.marry(boleslav1, biagota);
    const boleslav2 = b.person('boleslav2', 'Boleslav II.', 'Přemyslovec', 'male', { birthDate: '~932', deathDate: '999', notes: 'Zvaný Pobožný; podporoval sv. Vojtěcha.' });
    const doubravka = b.person('doubravka', 'Doubravka', 'Přemyslovna', 'female', { birthDate: '~940', deathDate: '977' });
    b.kids(uBoleslav1, boleslav2, doubravka);

    const emma = b.person('emma', 'Emma', 'z Mělníka', 'female', { birthDate: '~950', deathDate: '1006' });
    const uBoleslav2 = b.marry(boleslav2, emma);
    const boleslav3 = b.person('boleslav3', 'Boleslav III.', 'Přemyslovec', 'male', { birthDate: '~965', deathDate: '1037' });
    const jaromir = b.person('jaromir', 'Jaromír', 'Přemyslovec', 'male', { birthDate: '~975', deathDate: '1035' });
    const oldrich = b.person('oldrich', 'Oldřich', 'Přemyslovec', 'male', { birthDate: '~975', deathDate: '1034' });
    b.kids(uBoleslav2, boleslav3, jaromir, oldrich);

    const bozena = b.person('bozena', 'Božena', '', 'female', { birthDate: '~995', deathDate: '1052' });
    const uOldrich = b.marry(oldrich, bozena);
    const bretislav1 = b.person('bretislav1', 'Břetislav I.', 'Přemyslovec', 'male', { birthDate: '~1002', deathDate: '1055', notes: 'Zvaný Achilles; unesl si Jitku ze Svinibrodu z kláštera.' });
    b.kids(uOldrich, bretislav1);

    const jitka = b.person('jitka', 'Jitka', 'ze Svinibrodu', 'female', { birthDate: '~1003', deathDate: '1058' });
    const uBretislav1 = b.marry(bretislav1, jitka);
    const spytihnev2 = b.person('spytihnev2', 'Spytihněv II.', 'Přemyslovec', 'male', { birthDate: '1031', deathDate: '1061' });
    const vratislav2 = b.person('vratislav2', 'Vratislav II.', 'Přemyslovec', 'male', { birthDate: '~1032', deathDate: '1092', notes: 'První český král (1085), titul osobní, nedědičný.' });
    const konrad1 = b.person('konrad1', 'Konrád I.', 'Brněnský', 'male', { birthDate: '~1035', deathDate: '1092' });
    b.kids(uBretislav1, spytihnev2, vratislav2, konrad1);

    const svatava = b.person('svatava', 'Svatava', 'Polská', 'female', { birthDate: '~1046', deathDate: '1126' });
    const uVratislav2 = b.marry(vratislav2, svatava);
    const borivoj2 = b.person('borivoj2', 'Bořivoj II.', 'Přemyslovec', 'male', { birthDate: '~1064', deathDate: '1124' });
    const vladislav1 = b.person('vladislav1', 'Vladislav I.', 'Přemyslovec', 'male', { birthDate: '~1065', deathDate: '1125' });
    const sobeslav1 = b.person('sobeslav1', 'Soběslav I.', 'Přemyslovec', 'male', { birthDate: '~1075', deathDate: '1140' });
    b.kids(uVratislav2, borivoj2, vladislav1, sobeslav1);

    const richenza = b.person('richenza', 'Richenza', 'z Bergu', 'female', { birthDate: '~1095', deathDate: '1125' });
    const uVladislav1 = b.marry(vladislav1, richenza);
    const vladislav2 = b.person('vladislav2', 'Vladislav II.', 'Přemyslovec', 'male', { birthDate: '~1110', deathDate: '1174', notes: 'Druhý český král (1158), korunován Fridrichem Barbarossou.' });
    b.kids(uVladislav1, vladislav2);

    // Vladislav II married twice: Gertruda (mother of Bedřich) and Judita of
    // Thuringia (mother of Přemysl Otakar I. — Gertruda died before his birth).
    const gertruda = b.person('gertruda', 'Gertruda', 'Babenberská', 'female', { birthDate: '~1118', deathDate: '1150' });
    const uVladislav2 = b.marry(vladislav2, gertruda);
    const bedrich = b.person('bedrich', 'Bedřich', 'Přemyslovec', 'male', { birthDate: '~1142', deathDate: '1189' });
    b.kids(uVladislav2, bedrich);
    const juditaD = b.person('judita_d', 'Judita', 'Durynská', 'female', { birthDate: '~1135', deathDate: '~1174' });
    const uVladislav2j = b.marry(vladislav2, juditaD);
    const otakar1 = b.person('otakar1', 'Přemysl Otakar I.', 'Přemyslovec', 'male', { birthDate: '~1155', deathDate: '1230', notes: 'Získal Zlatou bulou sicilskou (1212) dědičný královský titul.' });
    b.kids(uVladislav2j, otakar1);

    // Multiple marriages: Adléta (dissolved) then Constance of Hungary.
    const adleta = b.person('adleta', 'Adléta', 'Míšeňská', 'female', { birthDate: '~1160', deathDate: '1211' });
    b.marry(otakar1, adleta);
    const constance = b.person('constance', 'Konstancie', 'Uherská', 'female', { birthDate: '~1180', deathDate: '1240' });
    const uOtakar1c = b.marry(otakar1, constance);
    const vaclav1k = b.person('vaclav1k', 'Václav I.', 'Přemyslovec', 'male', { birthDate: '~1205', deathDate: '1253', notes: 'Zvaný Jednooký; ubránil zemi před Mongoly.' });
    const anezka = b.person('anezka', 'Anežka', 'Česká', 'female', { birthDate: '~1211', deathDate: '1282', notes: 'Svatá Anežka Česká, zakladatelka špitálu a řádu křižovníků.' });
    const premyslMar = b.person('premysl_mar', 'Přemysl', 'Moravský', 'male', { birthDate: '~1209', deathDate: '1239' });
    b.kids(uOtakar1c, vaclav1k, anezka, premyslMar);

    const kunhutaH = b.person('kunhuta_h', 'Kunhuta', 'Štaufská', 'female', { birthDate: '~1200', deathDate: '1248' });
    const uVaclav1k = b.marry(vaclav1k, kunhutaH);
    const otakar2 = b.person('otakar2', 'Přemysl Otakar II.', 'Přemyslovec', 'male', { birthDate: '~1233', deathDate: '1278', notes: 'Král železný a zlatý; padl v bitvě na Moravském poli.' });
    b.kids(uVaclav1k, otakar2);

    // Multiple marriages: Margaret of Austria (dissolved) then Kunigunda.
    const margaretR = b.person('margaret_r', 'Markéta', 'Babenberská', 'female', { birthDate: '~1204', deathDate: '1266' });
    b.marry(otakar2, margaretR);
    const kunhutaHal = b.person('kunhuta_hal', 'Kunhuta', 'Haličská', 'female', { birthDate: '~1245', deathDate: '1285' });
    const uOtakar2k = b.marry(otakar2, kunhutaHal);
    const vaclav2 = b.person('vaclav2', 'Václav II.', 'Přemyslovec', 'male', { birthDate: '1271', deathDate: '1305', notes: 'Král český a polský; zavedl pražský groš.' });
    b.kids(uOtakar2k, vaclav2);

    // Multiple marriages: Judith of Habsburg then Elizabeth Richeza.
    const judita = b.person('judita', 'Guta', 'Habsburská', 'female', { birthDate: '1271', deathDate: '1297' });
    const uVaclav2j = b.marry(vaclav2, judita);
    const rejcka = b.person('rejcka', 'Eliška', 'Rejčka', 'female', { birthDate: '1288', deathDate: '1335' });
    b.marry(vaclav2, rejcka);
    const vaclav3 = b.person('vaclav3', 'Václav III.', 'Přemyslovec', 'male', { birthDate: '1289', deathDate: '1306', notes: 'Poslední Přemyslovec po meči; zavražděn v Olomouci roku 1306.' });
    const eliskaP = b.person('eliska_p', 'Eliška', 'Přemyslovna', 'female', { birthDate: '1292', deathDate: '1330', notes: 'Matka císaře Karla IV.' });
    const annaP = b.person('anna_p', 'Anna', 'Přemyslovna', 'female', { birthDate: '1290', deathDate: '1313' });
    b.kids(uVaclav2j, vaclav3, eliskaP, annaP);

    const viola = b.person('viola', 'Viola', 'Těšínská', 'female', { birthDate: '~1290', deathDate: '1317' });
    b.marry(vaclav3, viola);

    return { data: b.build(), focus: vaclav };
}

// ==================== HOUSE OF TUDOR ====================

function buildTudors(): { data: StromData; focus: PersonId } {
    const b = new DemoBuilder('td');

    const edmund = b.person('edmund', 'Edmund', 'Tudor', 'male', { birthDate: '~1430', deathDate: '1456', notes: 'Earl of Richmond; half-brother of Henry VI.' });
    const margaretBf = b.person('margaret_bf', 'Margaret', 'Beaufort', 'female', { birthDate: '1443', deathDate: '1509', notes: 'Mother of Henry VII; a key figure behind his claim to the throne.' });
    const uEdmund = b.marry(edmund, margaretBf);

    const henry7 = b.person('henry7', 'Henry VII', 'Tudor', 'male', { birthDate: '1457', deathDate: '1509', notes: 'First Tudor king; won the crown at Bosworth Field, ending the Wars of the Roses.' });
    b.kids(uEdmund, henry7);
    const elizabethY = b.person('elizabeth_y', 'Elizabeth', 'of York', 'female', { birthDate: '1466', deathDate: '1503', notes: 'Her marriage united the houses of Lancaster and York.' });
    const uHenry7 = b.marry(henry7, elizabethY);
    const arthur = b.person('arthur', 'Arthur', 'Tudor', 'male', { birthDate: '1486', deathDate: '1502', notes: 'Prince of Wales; died months after marrying Catherine of Aragon.' });
    const margaretT = b.person('margaret_t', 'Margaret', 'Tudor', 'female', { birthDate: '1489', deathDate: '1541' });
    const henry8 = b.person('henry8', 'Henry VIII', 'Tudor', 'male', { birthDate: '1491', deathDate: '1547', notes: 'Broke with Rome to annul his first marriage; had six wives.' });
    const maryT = b.person('mary_t', 'Mary', 'Tudor', 'female', { birthDate: '1496', deathDate: '1533' });
    b.kids(uHenry7, arthur, margaretT, henry8, maryT);

    // Catherine of Aragon married Arthur, then Henry VIII (a partner chain).
    const catherineA = b.person('catherine_a', 'Catherine', 'of Aragon', 'female', { birthDate: '1485', deathDate: '1536', notes: 'First wife of Henry VIII; mother of Mary I. Marriage annulled in 1533.' });
    b.marry(arthur, catherineA);

    // Henry VIII's six wives, in order.
    const uH8_cath = b.marry(henry8, catherineA);
    const anneB = b.person('anne_b', 'Anne', 'Boleyn', 'female', { birthDate: '~1501', deathDate: '1536', notes: 'Second wife of Henry VIII; mother of Elizabeth I. Executed in 1536.' });
    const uH8_anne = b.marry(henry8, anneB);
    const janeS = b.person('jane_s', 'Jane', 'Seymour', 'female', { birthDate: '~1508', deathDate: '1537', notes: 'Third wife; mother of Edward VI. Died soon after childbirth.' });
    const uH8_jane = b.marry(henry8, janeS);
    const anneC = b.person('anne_c', 'Anne', 'of Cleves', 'female', { birthDate: '1515', deathDate: '1557', notes: 'Fourth wife; marriage annulled after six months.' });
    b.marry(henry8, anneC);
    const catherineH = b.person('catherine_h', 'Catherine', 'Howard', 'female', { birthDate: '~1523', deathDate: '1542', notes: 'Fifth wife; executed in 1542.' });
    b.marry(henry8, catherineH);
    const catherineP = b.person('catherine_p', 'Catherine', 'Parr', 'female', { birthDate: '1512', deathDate: '1548', notes: 'Sixth wife; outlived Henry VIII.' });
    b.marry(henry8, catherineP);

    const mary1 = b.person('mary1', 'Mary I', 'Tudor', 'female', { birthDate: '1516', deathDate: '1558', notes: 'Queen of England; restored Catholicism, known as "Bloody Mary".' });
    b.kids(uH8_cath, mary1);
    const elizabeth1 = b.person('elizabeth1', 'Elizabeth I', 'Tudor', 'female', { birthDate: '1533', deathDate: '1603', notes: 'The Virgin Queen; her reign was the Elizabethan golden age. The Tudor line ended with her.' });
    b.kids(uH8_anne, elizabeth1);
    const edward6 = b.person('edward6', 'Edward VI', 'Tudor', 'male', { birthDate: '1537', deathDate: '1553', notes: 'Became king at nine; died at fifteen.' });
    b.kids(uH8_jane, edward6);

    const philip2 = b.person('philip2', 'Philip II', 'of Spain', 'male', { birthDate: '1527', deathDate: '1598' });
    b.marry(mary1, philip2);

    // Margaret Tudor -> Stuart line to Mary, Queen of Scots.
    const james4 = b.person('james4', 'James IV', 'of Scotland', 'male', { birthDate: '1473', deathDate: '1513' });
    const uMargaret = b.marry(margaretT, james4);
    const james5 = b.person('james5', 'James V', 'of Scotland', 'male', { birthDate: '1512', deathDate: '1542' });
    b.kids(uMargaret, james5);
    const maryG = b.person('mary_g', 'Mary', 'of Guise', 'female', { birthDate: '1515', deathDate: '1560' });
    const uJames5 = b.marry(james5, maryG);
    const maryQ = b.person('mary_q', 'Mary', 'Stuart', 'female', { birthDate: '1542', deathDate: '1587', notes: 'Mary, Queen of Scots; executed on the orders of Elizabeth I.' });
    b.kids(uJames5, maryQ);

    // Mary Tudor -> Brandon -> Lady Jane Grey.
    const brandon = b.person('brandon', 'Charles', 'Brandon', 'male', { birthDate: '~1484', deathDate: '1545' });
    const uMaryT = b.marry(maryT, brandon);
    const frances = b.person('frances', 'Frances', 'Brandon', 'female', { birthDate: '1517', deathDate: '1559' });
    b.kids(uMaryT, frances);
    const henryG = b.person('henry_g', 'Henry', 'Grey', 'male', { birthDate: '1517', deathDate: '1554' });
    const uFrances = b.marry(frances, henryG);
    const janeG = b.person('jane_g', 'Jane', 'Grey', 'female', { birthDate: '~1537', deathDate: '1554', notes: 'The "Nine Days\' Queen"; deposed by Mary I and executed.' });
    b.kids(uFrances, janeG);

    return { data: b.build(), focus: henry8 };
}

const PREMYSLIDS = buildPremyslids();
const TUDORS = buildTudors();

export type DemoLang = 'cs' | 'en';

/** A fresh copy of the demo tree for the language (cs = Přemyslids, else Tudors). */
export function getDemoTree(lang: DemoLang): StromData {
    const source = lang === 'cs' ? PREMYSLIDS.data : TUDORS.data;
    return structuredClone(source);
}

/** Id of the person to focus after loading the demo (sv. Václav / Henry VIII). */
export function getDemoFocus(lang: DemoLang): PersonId {
    return lang === 'cs' ? PREMYSLIDS.focus : TUDORS.focus;
}
