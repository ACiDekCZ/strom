const fs = require('fs');
const path = process.argv[2];

const MONTHS = {
    'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
    'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
    'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
};

function parseGedcomDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = MONTHS[parts[1].toUpperCase()] || '01';
        const year = parts[2];
        return `${year}-${month}-${day}`;
    } else if (parts.length === 2) {
        const month = MONTHS[parts[0].toUpperCase()] || '01';
        const year = parts[1];
        return `${year}-${month}-01`;
    } else if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
        return `${parts[0]}-01-01`;
    }
    return '';
}

function parseName(nameStr) {
    const match = nameStr.match(/^(.*?)\/(.*)\/$/);
    if (match) {
        return { firstName: match[1].trim(), lastName: match[2].trim() };
    }
    const cleaned = nameStr.replace(/\//g, '').trim();
    const parts = cleaned.split(/\s+/).filter(p => p);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
}

function parseGedcom(content) {
    // Strip BOM
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    const lines = content.split(/\r?\n/);
    const individuals = new Map();
    const families = new Map();
    let currentRecord = null;
    let currentType = null;
    let currentSubTag = null;

    for (const line of lines) {
        const match = line.match(/^(\d+)\s+(@\w+@|\w+)\s*(.*)?$/);
        if (!match) continue;
        const level = parseInt(match[1]);
        const tag = match[2];
        const value = (match[3] || '').trim();

        if (level === 0) {
            if (tag.startsWith('@I') && value === 'INDI') {
                currentRecord = { id: tag, name: '', firstName: '', lastName: '', sex: '', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', fams: [], famc: null };
                currentType = 'INDI';
                individuals.set(tag, currentRecord);
            } else if (tag.startsWith('@F') && value === 'FAM') {
                currentRecord = { id: tag, husb: null, wife: null, children: [], marriageDate: '' };
                currentType = 'FAM';
                families.set(tag, currentRecord);
            } else {
                currentRecord = null;
                currentType = null;
            }
            currentSubTag = null;
        } else if (currentRecord) {
            if (level === 1) {
                currentSubTag = tag;
                if (currentType === 'INDI') {
                    if (tag === 'NAME') { const p = parseName(value); currentRecord.name = value; currentRecord.firstName = p.firstName; currentRecord.lastName = p.lastName; }
                    else if (tag === 'SEX') currentRecord.sex = value;
                    else if (tag === 'FAMS') currentRecord.fams.push(value);
                    else if (tag === 'FAMC') currentRecord.famc = value;
                } else if (currentType === 'FAM') {
                    if (tag === 'HUSB') currentRecord.husb = value;
                    else if (tag === 'WIFE') currentRecord.wife = value;
                    else if (tag === 'CHIL') currentRecord.children.push(value);
                }
            } else if (level === 2) {
                if (currentType === 'INDI') {
                    if (currentSubTag === 'BIRT') { if (tag === 'DATE') currentRecord.birthDate = parseGedcomDate(value); if (tag === 'PLAC') currentRecord.birthPlace = value; }
                    else if (currentSubTag === 'DEAT') { if (tag === 'DATE') currentRecord.deathDate = parseGedcomDate(value); if (tag === 'PLAC') currentRecord.deathPlace = value; }
                } else if (currentType === 'FAM') {
                    if (currentSubTag === 'MARR' && tag === 'DATE') currentRecord.marriageDate = parseGedcomDate(value);
                }
            }
        }
    }
    return { individuals, families };
}

function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function convertToStrom(gedcom) {
    const { individuals, families } = gedcom;
    const validIndividuals = new Map();
    const skippedIds = new Set();

    for (const [gedId, indi] of individuals) {
        if (!indi.firstName && !indi.lastName) { skippedIds.add(gedId); continue; }
        validIndividuals.set(gedId, indi);
    }

    const personIdMap = new Map();
    const partnershipIdMap = new Map();

    for (const [gedId] of validIndividuals) personIdMap.set(gedId, generateId('p'));
    for (const [gedId] of families) partnershipIdMap.set(gedId, generateId('u'));

    const persons = {};
    for (const [gedId, indi] of validIndividuals) {
        const personId = personIdMap.get(gedId);
        persons[personId] = {
            id: personId,
            firstName: indi.firstName || '?',
            lastName: indi.lastName || '',
            gender: indi.sex === 'M' ? 'male' : 'female',
            isPlaceholder: !indi.firstName || indi.firstName === '?' || indi.firstName === '//',
            partnerships: [],
            parentIds: [],
            childIds: []
        };
        if (indi.birthDate) persons[personId].birthDate = indi.birthDate;
        if (indi.birthPlace) persons[personId].birthPlace = indi.birthPlace;
        if (indi.deathDate) persons[personId].deathDate = indi.deathDate;
        if (indi.deathPlace) persons[personId].deathPlace = indi.deathPlace;
    }

    const partnerships = {};
    for (const [gedFamId, fam] of families) {
        const partnershipId = partnershipIdMap.get(gedFamId);
        if (!fam.husb || !fam.wife) continue;
        const person1Id = personIdMap.get(fam.husb);
        const person2Id = personIdMap.get(fam.wife);
        if (!person1Id || !person2Id) continue;

        partnerships[partnershipId] = { id: partnershipId, person1Id, person2Id, childIds: [], status: 'married' };
        if (fam.marriageDate) partnerships[partnershipId].weddingDate = fam.marriageDate;
        if (persons[person1Id]) persons[person1Id].partnerships.push(partnershipId);
        if (persons[person2Id]) persons[person2Id].partnerships.push(partnershipId);

        for (const childGedId of fam.children) {
            const childId = personIdMap.get(childGedId);
            if (!childId || !persons[childId]) continue;
            partnerships[partnershipId].childIds.push(childId);
            if (!persons[childId].parentIds.includes(person1Id)) persons[childId].parentIds.push(person1Id);
            if (!persons[childId].parentIds.includes(person2Id)) persons[childId].parentIds.push(person2Id);
            if (!persons[person1Id].childIds.includes(childId)) persons[person1Id].childIds.push(childId);
            if (!persons[person2Id].childIds.includes(childId)) persons[person2Id].childIds.push(childId);
        }
    }

    // Single parent families
    for (const [, fam] of families) {
        if (fam.husb && fam.wife) continue;
        const parentGedId = fam.husb || fam.wife;
        if (!parentGedId) continue;
        const parentId = personIdMap.get(parentGedId);
        if (!parentId || !persons[parentId]) continue;
        for (const childGedId of fam.children) {
            const childId = personIdMap.get(childGedId);
            if (!childId || !persons[childId]) continue;
            if (!persons[childId].parentIds.includes(parentId)) persons[childId].parentIds.push(parentId);
            if (!persons[parentId].childIds.includes(childId)) persons[parentId].childIds.push(childId);
        }
    }

    return { persons, partnerships };
}

const content = fs.readFileSync(path, 'utf-8');
const gedcom = parseGedcom(content);
const data = convertToStrom(gedcom);

console.log(JSON.stringify(data, null, 2));
console.error('Persons:', Object.keys(data.persons).length);
console.error('Partnerships:', Object.keys(data.partnerships).length);
