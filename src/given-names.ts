/**
 * Given names that are one name in another language of the registers.
 *
 * A Bohemian parish register writes Latin (Wenceslaus, Catharina, Joannes),
 * a German-kept one German (Wenzel, Katharina, Johann), the family says it in
 * Czech (Václav, Kateřina, Jan). Read against the tree they are the same
 * person's name, not a different one: comparing them says nothing new.
 *
 * A group lists the common register forms of one name. Forms are compared
 * without accents and case. A form that belongs to two names (Albert as
 * Vojtěch or Albert) is left out: a group only says "the same" where it is.
 */

const GROUPS: readonly string[] = [
    // Men
    'Václav Wenceslaus Venceslaus Wenzel Wenzl',
    'Jan Joannes Johannes Ioannes Johann Hans',
    'Josef Josephus Joseph',
    'Jiří Georgius Georg',
    'František Franciscus Franz',
    'Antonín Antonius Anton',
    'Matěj Matthias Mathias',
    'Matouš Matthaeus Matthäus',
    'Tomáš Thomas',
    'Martin Martinus',
    'Petr Petrus Peter',
    'Pavel Paulus Paul',
    'Jakub Jacobus Jakob',
    'Ondřej Andreas',
    'Vojtěch Adalbertus Adalbert',
    'Karel Carolus Karl',
    'Jindřich Henricus Heinrich',
    'Michal Michael',
    'Mikuláš Nicolaus Nikolaus',
    'Lukáš Lucas Lukas',
    'Filip Philippus Philipp',
    'Vavřinec Laurentius Lorenz',
    'Bartoloměj Bartholomaeus Bartholomäus',
    'Štěpán Stephanus Stephan Stefan',
    'Ignác Ignatius Ignaz',
    'Vincenc Vincentius Vinzenz',
    'Florián Florianus Florian',
    'Prokop Procopius',
    'Kryštof Christophorus Christoph',
    'Ludvík Ludovicus Ludwig',
    'Zikmund Sigismundus Sigmund',
    'Bedřich Fridericus Friedrich',
    'Augustin Augustinus',
    'Šimon Simon Simeon',
    // Women
    'Marie Maria',
    'Kateřina Catharina Catherina Katharina Katarina',
    'Alžběta Elisabetha Elisabeth Elisabet',
    'Magdalena Magdalene Majdalena',
    'Barbora Barbara',
    'Dorota Dorothea',
    'Terezie Tereza Theresia Therese',
    'Johana Joanna Johanna',
    'Veronika Veronica',
    'Rozálie Rosalia Rosalie',
    'Františka Francisca Franziska',
    'Josefa Josepha',
    'Markéta Margaretha Margarethe Margareta',
    'Ludmila Ludmilla',
    'Apolena Apollonia Apolonia',
    'Voršila Ursula',
    'Zuzana Susanna Susanne',
    'Klára Clara Klara',
    'Anežka Agnes',
];

function fold(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Folded form → the group's first form (folded). */
const KEY = new Map<string, string>();
for (const group of GROUPS) {
    const forms = group.split(' ').map(fold);
    for (const f of forms) KEY.set(f, forms[0]);
}

function key(name: string): string {
    return fold(name).split(' ').map(w => KEY.get(w) ?? w).join(' ');
}

/**
 * The same given name, written alike or in another register language
 * (Wenceslaus = Wenzel = Václav). Several names compare word by word
 * (Joannes Nepomucenus = Jan Nepomucenus).
 */
export function sameGivenName(a: string, b: string): boolean {
    return key(a) === key(b);
}
