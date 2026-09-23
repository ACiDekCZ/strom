# Writing GEDCOM that Strom reads whole

This is the contract for any program that produces GEDCOM for Strom: what the
importer understands, where each fact lands, and what it does with the rest.
It describes the importer as it actually behaves — every claim here is covered
by a test in `src/__tests__/gedcom-roundtrip.test.ts`,
`gedcom-contract.test.ts`, `gedcom-research-import.test.ts`,
`review-formats.test.ts` or `research-link.test.ts` (opening files from
outside: `e2e/research-open.spec.ts`).

The short version: emit **GEDCOM 5.5.1 in UTF-8**, put facts under their own
standard tags, and nothing will be lost. Strom keeps a fact even when it has no
field for it, but only if it arrives under a tag the importer knows.

## The file itself

```
0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
...
0 TRLR
```

- **UTF-8, declared.** `1 CHAR UTF-8` in the header. Accented names survive
  everywhere, including in exported file names.
- **255 bytes per physical line**, counted in *bytes*, not characters. Czech or
  German text reaches that limit at roughly 130 characters. Split with `CONC`
  and `CONT` (below).
- **Cross-reference ids** (`@I1@`, `@F1@`, `@S1@`) may be any shape; Strom maps
  them to its own ids on import. A record without an id still imports — it is
  given an anonymous one — but then nothing can point at it.

### CONC and CONT are not interchangeable

- `CONC` continues the same line. The two pieces are joined with **nothing**
  between them.
- `CONT` starts a **new line** in the text.

Split mid-word rather than next to a space. A value that begins or ends with a
space is a value some readers will trim, silently gluing two words together.

```
1 NOTE Ženich veden jako 'honestus adolescens' — svobodný mláde
2 CONC nec, ve třiceti letech.
2 CONT Oba poddaní panství Novohradského.
```

Continuations are read under `NOTE`, `TEXT`, `TITL` and the other text
structures, and also under the values that can run long: `NAME`, `PLAC`,
`PAGE`, `WWW`, `_WITN`, `REFN`, `TYPE`, `SOUR` (inline) and `_QUESTION`.
Strom's own export splits exactly those, so no physical line it writes is
longer than 255 bytes.

### Shared notes

A note record — `0 @N1@ NOTE text` with its `CONT` / `CONC` lines (GEDCOM 7:
`SNOTE`) — is read, and a pointer to it (`1 NOTE @N1@`, `2 NOTE @N1@`) reads as
its text wherever a `NOTE` may stand: on a person, a family, an event, under
`BIRT` / `DEAT` / `MARR`, on a source. A pointer to a note the file never
defines is read as an empty note. The record itself is never reported as an
unsupported tag.

## People

```
0 @I1@ INDI
1 NAME František /Krepčík/
1 SEX M
1 BIRT
2 DATE 5 MAY 1863
2 PLAC Lučice
```

| Tag | Where it lands |
|---|---|
| `NAME` | Given name and surname; the surname goes between slashes. A person with neither (`1 NAME //`, or `?`) is an unknown stand-in; a surname alone (`1 NAME /Nováková/`) is a real person |
| `NAME` (repeated) | Further spellings of the same person, kept as name variants |
| `NAME` > `TYPE` | Read to keep the birth surname as the person's surname: a `married` name listed first swaps places with the `birth` (or `maiden`) one. The type itself is not stored |
| `NAME` > `SOUR` | The record the name comes from — cites the person, with `PAGE` and `QUAY` |
| `SEX` | `M` / `F`. `U` or missing is inferred from the family role where possible |
| `BIRT`, `DEAT` | The dedicated date and place fields, not events. `1 DEAT Y` with no date marks the person as dead, and Strom exports it that way |
| `_QUESTION` | Strom's own tag: the open question about the person ("does anyone know when she was born?"), with `CONT` / `CONC` |
| `REFN` | Reference number — your own id in an archive or another program. A `2 TYPE` under it is kept (not shown) and written back on export, so the program that issued the number can recognise its own person |
| `FAMS`, `FAMC` | Links to families as spouse / as child |

A second `BIRT` or `DEAT` block does not overwrite the first: it is kept as a
labelled event, because two contradictory birth records are a research finding,
not a mistake to resolve on import.

### Dates

`5 MAY 1863`, `MAY 1863`, `1863` and `ABT 1863` all import. Strom keeps the
precision it was given — a year stays a year, and an approximation stays
marked as one rather than being rounded into a false certainty.

A date phrase keeps what can be read and the words themselves:
`INT 1900 (per census)` is stored as about 1900, `(about Easter 1900)` as no
date, and in both cases the fact's note gains the line "Date as written: …".
A date with a day or month that is not a GEDCOM one (`3 XYZ 1900`) keeps only
its year — never an invented January — and gets the same line. Use the
English month abbreviations (`JAN` … `DEC`).

### What hangs under BIRT, DEAT and MARR

These blocks carry the register entry itself, and all of it is read:

```
1 BIRT
2 DATE 5 MAY 1863
2 PLAC Lučice
2 SOUR @S4@
3 PAGE sign. 1702, kniha narozených, s. 15, snímek 11
2 NOTE Otec veden jako chalupník.
2 _WITN Marie Dvořáková, kmotra
2 RELI Římskokatolické
```

- `SOUR` (with `PAGE`, `QUAY`) — cites the person, since a birth entry is
  evidence about them.
- `NOTE` — kept on the person, labelled with the fact it sat under.
- `ASSO` / `_WITN` — the people the entry names. Godparents recorded under
  `BIRT` move to the christening when the file has one; otherwise Strom makes a
  "Birth record" event to hang them on, so they never float free of their date.
- `RELI` — the denomination written at that act. Kept as a labelled note, *not*
  as a conversion: it says what the person was, not that they changed.

### Age, cause, address and calendar

Detail the register gives about a fact beyond its date and place is read under
`BIRT`, `DEAT`, `MARR` and every event above. The model has no field for any of
it, so each becomes **one labelled line in the note of that fact** — the event's
note, or for birth and death the person's note labelled "Birth:" / "Death:",
for a marriage the couple's note.

```
1 DEAT
2 DATE @#DJULIAN@ 12 MAR 1875
2 PLAC Vavřinec
2 ADDR čp. 13
2 AGE 61y
2 CAUS tuberkulóza
```

- `AGE` — `61y`, `27y 3m`, `3m 12d`, `<1y`, `INFANT`, `STILLBORN`, `CHILD`, and a
  bare number as years; written out in words ("Age: 61 years").
- `CAUS` — the cause, as written.
- `ADDR` — the house or address **on the `ADDR` line itself**, with `CONT`
  lines. `ADR1`, `CITY` and the other address parts are not read: `CITY`
  repeats the place, and some programs fill `ADR1` with noise. Keep only the
  municipality in `PLAC` — `2 PLAC Vavřinec` with `2 ADDR čp. 13`, never
  `2 PLAC Vavřinec 13` — or every house becomes a place and a pin of its own.
- `2 HUSB` / `2 WIFE` with a `3 AGE` under `MARR` — each partner's age at the
  wedding.
- A date in another calendar (`@#DJULIAN@`, `@#DHEBREW@`, `@#DFRENCH R@`) keeps
  its numbers as the date and adds a line saying which calendar they are in.
  Convert to Gregorian yourself if you want the date field to be exact.

On export these come back as the same lines in a `NOTE`, not as `AGE` / `CAUS` /
`ADDR`. Nothing is lost on a round-trip, but a program reading Strom's export
finds them as text.

### Participants' roles

`RELA` under `ASSO` / `_WITN` names the role. Godparent, witness and officiant
are recognised in English, Czech, German, Polish, French and Spanish ("Kmotr",
"Taufpate", "świadek", "témoin", "farář", "Pfarrer" …), compared without accents
or case. Any other role — `Informant`, `Midwife`, "porodní bába" — is kept as
the role *other* with the file's own word at the start of the participant's
note, and exported as `RELA Present` with that note.

## Events

Emit each fact under its own standard tag. All of these are read, with their
`DATE`, `PLAC`, `SOUR`, `NOTE` and participants:

`BAPM` `CONF` `FCOM` `BARM` `BASM` `ORDN` `EDUC` `OCCU` `RESI` `EMIG` `IMMI`
`NATU` `RELI` `TITL` `NATI` `ADOP` `WILL` `PROB` `BURI` `CREM` `CENS` `EVEN`

Aliases fold in without a type of their own: `CHR` and `CHRA` are a christening,
`GRAD` is where schooling ended.

Military service has no GEDCOM 5.5.1 tag. Strom writes it as
`1 EVEN` / `2 TYPE Military service` (the label in the app's language) and
reads back that label in English, Czech or German, as well as the `_MILT`,
`_MILI` and `MILI` tags other programs use.

### Facts whose value rides on the tag line

`OCCU`, `RELI`, `TITL` and `NATI` carry the fact **as the tag's own value**:

```
1 OCCU mistr obuvnický
1 RELI Evangelík augsburského vyznání
1 TITL MUDr.
```

Write the fact alone — "blacksmith", not "worked in Kladno as a blacksmith".
Strom shows this value wherever the event appears, and exports it back on the
tag line. A subordinate `NOTE` instead would import as an event with no subject.

A `2 NOTE` written *underneath* one of these is read, but the model has a single
field here, so the value and the remark are joined. Strom splits them apart
again on export — the fact on the tag line, the remark back under `2 NOTE` —
which means the file survives a round-trip unchanged. A remark that belongs to
the person rather than to the fact still reads better as a `1 NOTE` on the
person.

### Anything else

`1 EVEN` with a `2 TYPE` label becomes a custom event keeping that label. A
value on the `EVEN` line itself (`1 EVEN Velký požár`) is the fact's content,
not its label, and is kept in the event's note:

```
1 EVEN
2 TYPE Požár stavení
2 DATE NOV 1905
2 PLAC Lučice 46
```

## Families

```
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 4 FEB 1781
2 PLAC Martinice
2 SOUR @S58@
3 PAGE sign. 1702, kniha oddaných, s. 15
2 _WITN Wenceslaus Saukal z Podměstí
2 NOTE Ženich veden jako 'honestus adolescens'.
```

- `MARR` / `DIV` in file order. A couple who divorced and married again is
  recorded as `MARR` / `DIV` / `MARR` in one family, and Strom reads the
  outcome from the order and the dates rather than assuming a `DIV` is final.
- `_WITN` and `ASSO` under `MARR` become the wedding's witnesses — first-class
  people in Strom, not a line inside a note.
- A child is linked by `CHIL` in the family **or** by `FAMC` on the child —
  either one is enough. The same `CHIL` twice counts once, and a second `FAM`
  of the same two people is read as the same union (children, citations,
  witnesses and missing dates join the first).
- A family with one parent gets a "?" stand-in for the other, and keeps its
  witnesses, story and everything else. A family naming two or more children
  but no parent at all gets two stand-ins, so the children stay siblings; a
  lone child without parents is left as it is.
- `PEDI` under a child's `FAMC` marks an adopted, step or foster link.
- `_FREL` / `_MREL` under `CHIL` (`Natural`, `Adopted`, `Step`, `Foster`; also
  `Birth`, `Biological`) give the child's tie to the father and to the mother
  separately, and win over `PEDI`, which speaks for both at once. A stepfather
  with the child's own mother needs these. Strom writes them back whenever the
  two ties differ, and whenever either is `Step` (which `PEDI` cannot say).
- `_STAT` names the relationship status: `Married`, `Divorced`, `Separated`,
  or `Partners` (also read: `Unmarried`, `Never married`, `Cohabiting`). It wins
  over what `MARR` / `DIV` imply. Strom writes it for partners and separated
  couples; the start and end of their relationship still ride on `MARR` /
  `DIV`, the only place other programs look for them.
- `SOUR` on the family (with `PAGE`, `QUAY`) cites the couple — a family known
  only from a grandchild's baptism is cited this way.
- `RESI` on the family becomes a line in the couple's note, `ADDR` included:
  "Residence: čp. 12 · 1910 · Kamenice nad Lipou".

## Sources

```
0 @S4@ SOUR
1 TITL Lučice, kniha narozených 1858–1870
1 REPO SOA Zámrsk
1 PAGE sign. 1702
```

A source given inline, as text instead of a pointer (`1 SOUR Vzpomínky
babičky`, `2 SOUR Farní kniha`), becomes a source record of its own with that
text as its title, cited where it stood; the same text twice is one source.
`ABBR` is the title of a record that has no `TITL`. Any other line directly on
a source record (`DATA`, `OBJE`, `REFN` …) is reported as unsupported.

Cite them from the fact they prove — `2 SOUR @S4@` with `3 PAGE` for the exact
place in the book, and `3 QUAY 0..3` for how good the reading is. A citation on
the entry is worth more than a source listed once on the person.

The source record's own lines all reach the source's note: every `NOTE`
(separated by a blank line), the transcript `TEXT` and the publication `PUBL`
with their `CONT` / `CONC` lines, the author `AUTH`, and the call number
`CALN` under `REPO` — each labelled ("Transcript: …", "Call number: …").

Two limits of the model to plan around:

- **`PAGE` and `QUAY` belong to the source, not to each citation.** The first
  citation read decides them. If one book is cited at different pages for
  different facts, give each entry a source of its own.
- **The words of the entry go on the source, as `1 TEXT`.** `DATA` / `TEXT`
  under a citation is not read: other programs put machine-made summaries of
  matched records there, which would flood the notes. One source per register
  entry, with its transcript in `1 TEXT`, says the same thing.

## Narratives (`_STORY`)

The account written *about* a person or a couple, as opposed to the facts it
was assembled from. Strom stores it, shows it in a field sized for prose, and
sets it in the family book after the facts.

```
1 _STORY
2 TYPE vypraveni
2 TITL Nemanželský syn z čp. 22
2 STAT hotovo
2 TEXT František se narodil 5. května 1863 v Lučici jako nemanžel
3 CONC ský syn Anny Krepčíkové.
3 CONT
3 CONT Otec není v matrice uveden.
2 DATA BIRT 5 MAY 1863 [M-04]
2 NOTE Odvozeno z matriky, není to pramen.
```

- `TEXT` is the prose. `CONC` joins, `CONT` breaks a line — a blank line
  between paragraphs is an empty `CONT`.
- `DATA` carries one fact the text leans on, **on the tag's own line**, as many
  times as needed; `NOTE` is the author's caveat. Both are kept and shown
  read-only, and neither is printed in the book. `2 DATA` with a `3 TEXT`
  beneath it is read too, for files written the other way round, but Strom's
  own export uses the shape above.
- `STAT` is `navrh` or `hotovo`. Strom carries it through untouched but does
  not act on it — the book prints no draft badge.
- Text wrapped in double asterisks is set in bold in the book.

## Media

`OBJE` with a `FILE` that is a data URL is taken into the tree: as the portrait
when marked `2 _STROM_KIND photo`, otherwise as an attached document. Only
`data:image/jpeg|png|webp|gif;base64,` is accepted for a portrait, and those
plus `data:application/pdf;base64,` for a document; any other embedded type is
skipped and reported (`OBJE` in the summary). A `FILE` that is a path or a URL
is offered for matching against files the user picks.

Strom's export embeds photos and documents this way unless the export dialog's
content options leave them out — other programs cannot read data URLs, so a
file meant for them is best exported without.

## Places

Write the place as the record writes it. Strom groups spellings that differ
only by case, accents or punctuation, and it can carry coordinates:

```
2 PLAC Landsberg an der Warthe
3 MAP
4 LATI N52.733
4 LONG E15.233
```

## What Strom does with the rest

Facts with no field of their own are **not dropped**. They join the person's or
the couple's note as a labelled line — "Banns: 18. 4. 1886 · Lučice".

**Which record a tag hangs on decides whether it is read at all.** Each of
these is understood in one place only:

| Under | Tags |
|---|---|
| `INDI` | `BLES` `RETI` `CAST` `DSCR` `IDNO` `NCHI` `NMR` `PROP` `SSN` `FACT` `ALIA` |
| `FAM` | `MARB` `MARC` `MARL` `MARS` `ANUL` `DIVF` `CENS` `NCHI` `RESI` |

So write the banns as `MARB` **inside the family**: on a person the tag is not
recognised and the fact is lost. The same holds for the events above — `MARR`
and `DIV` are read on a `FAM`, `OCCU`, `RESI` and `RELI` on an `INDI`. If you
are marrying someone whose spouse is not in the data, do not give them a
`MARR`; write an `EVEN` with a `TYPE` instead.

Discarded outright is the bookkeeping of the program that wrote the file:
`ANCI` `DESI` `RFN` `AFN` `RESN` are reported in the import summary, while the
platform sync ids (`RIN`, `_UID`, `CHAN`, `_UPD` and their kind) are skipped
without a word — they say nothing about a person and would only be noise.

**Any other record or fact is reported as an unsupported tag** — anything at
level 0 or level 1 that this contract does not name. If your file lists tags
there, they reached Strom and were not understood.

**Lines *below* a fact are not counted.** A subordinate tag this contract does
not name — say `3 ROLE` under a citation, or `2 PHON` under `RESI` — is skipped
without being reported, because other programs write dozens of them per person
and counting them would drown the summary. So an empty summary does not prove
that every line was read: check the subordinate tags you write against the
sections above.

## Strom Research files and opening them from outside the app

*Supported from app version 3.0.0.*

### The header that identifies a research

```
0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.4.0
2 NAME Strom Research
1 DATE 23 SEP 2026
1 _STROM_TREE 3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77
1 CHAR UTF-8
1 NOTE Víškovi
2 CONT …
```

- `1 SOUR STROM_RESEARCH` marks the file as written by Strom Research.
- `1 _STROM_TREE <uuid>` is the research tree's identifier — the `id` from its
  `strom.json`, a UUID in the canonical 8-4-4-4-12 hexadecimal form (case does
  not matter; Strom stores it in lower case). It is read **only together with**
  `1 SOUR STROM_RESEARCH`, and a value that is not a UUID is ignored.
- The **first line of the header `1 NOTE`** is the tree's name ("Víškovi");
  `CONC` continues it, `CONT` lines after it are not part of the name.
- `1 DATE` is shown as the "as of" date after opening.
- Person `REFN` values (`P0001` …) are what keeps a person the same person
  across updates, and what the live bridge's change lines refer to. Keep them
  stable and unique.

The header is read before the records; the records themselves go through the
normal importer described above, so everything else in this contract applies
unchanged.

### What happens to an opened research

1. **First time** (no tree in this app holds that `_STROM_TREE`): a new tree
   named after the header `NOTE` is created, linked to the identifier, and the
   app switches to it — not to the tree used last.
2. **Again, same identifier:** that tree is **updated**; no duplicate is
   created. People keep their app ids (matched by `REFN`), so the focus and the
   last-viewed person survive.
3. **Again, but the user changed that tree in the app since:** the app asks
   *Update* (the changes in the app are replaced; a backup is taken first) or
   *Open as new copy* (a new tree, which then carries the link; the changed
   tree is left exactly as it is).
4. **A Strom Research file without `_STROM_TREE`** always opens as a new tree.
   The app never overwrites a tree because its name matches.
5. **Any other GEDCOM** opens the normal import dialog (new tree / merge).
6. The user's other trees are never touched. A short summary follows:
   "Opened the research Víškovi from Strom Research — 42 people,
   15 families (as of 23 Sep 2026)".

### Ways to open a file

| | How | Where it works |
|---|---|---|
| A | **File handler.** The installed app (Chrome / Edge PWA) is registered for `.ged`; opening a file with it (`open -a <Strom app> tree-strom.ged`, double-click, "Open with") hands it over through `launchQueue`. If the app window is already open it is focused and switches to the file's tree. | From 3.0.0. Chromium browsers, installed app only. Not Safari, not Firefox. |
| B | **Address on this computer.** `https://stromapp.info/run/?import-url=<url>` where `<url>` is `http://127.0.0.1:<port>/…` or `http://localhost:<port>/…` (URL-encoded). The app fetches it once and imports it as above. | From 3.0.0. Anything that is not `http` on exactly `127.0.0.1` or `localhost` (no user name, no other host) is ignored with a message. |
| C | **Drag and drop.** A `.ged` dropped anywhere onto the app window. | Any desktop browser. |

For B, the local server must answer the app's origin with CORS —
`Access-Control-Allow-Origin: https://stromapp.info` — and answer a preflight
carrying `Access-Control-Request-Private-Network: true` with
`Access-Control-Allow-Private-Network: true`. Chrome may also ask the user once
whether stromapp.info may reach devices on this computer. When the browser
refuses the request anyway, the app says so and offers the manual import, so
keep showing the file's location as a fallback (C, or Import → GEDCOM).

Parameters are removed from the address after they are read.

### D. Following a running research (`?live=`)

`https://stromapp.info/run/?live=<bridge>` with `<bridge>` =
`http://127.0.0.1:<port>/<token>` (URL-encoded; the same loopback rule as B).
Supported from app version 3.0.0. The app uses these read-only endpoints:

| Endpoint | What the app reads |
|---|---|
| `<bridge>/status` | JSON. `tree.id` (the research UUID — required), `tree.name`, `head`, `working` [{`who`, `since`, `task`?}], `waiting` [{`id`, `what`, `on`}]. Other fields are ignored. |
| `<bridge>/tree.ged` | The research as GEDCOM, same format as a file. If its header carries a `_STROM_TREE` different from `status.tree.id`, following stops. |
| `<bridge>/events` | Server-Sent Events: `hello` (data = status), `change` ({`head`, `what`: [lines], `at`}), `working` (the `working` list). |

- On start the app reads `status`, then `tree.ged`, and opens the research like
  a file (first time / update / ask when changed in the app), then switches to
  it.
- While following, **that tree is read-only in the app**; every `change` (and
  every `hello` or status whose `head` differs from the last one) re-reads
  `tree.ged` and updates only that tree, without asking. A `change` whose
  `head` equals the current one is ignored, so replaying the last change on
  reconnect is harmless.
- People whose `REFN` appears in a `change` line (tokens like `P0101`) are
  highlighted, and the lines are listed ("Latest changes"). `working` and
  `waiting` are shown in a small "Research now" panel.
- When the event stream drops, the app asks `status`; if the bridge answers it
  reconnects, if it does not (twice in a row) it shows "Following ended",
  keeps the last state and makes the tree editable again. Without
  `EventSource` the app polls `status` instead.
- All text from the bridge is shown as plain text; long values and lists are
  cut.

## Checking your output

1. Import the file and read the summary. Unsupported tags mean a record or fact
   was written that this contract does not cover (lines below a fact are not
   counted — see above).
2. Export from Strom and import that again. The tree must be identical: what
   survives a round-trip is what Strom really holds.
3. Check the longest physical line is at most 255 **bytes**, and that no value
   begins or ends with a space.
