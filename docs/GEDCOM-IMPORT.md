# Writing GEDCOM that Strom reads whole

This is the contract for any program that produces GEDCOM for Strom: what the
importer understands, where each fact lands, and what it does with the rest.
It describes the importer as it actually behaves — every claim here is covered
by a test in `src/__tests__/gedcom-roundtrip.test.ts`.

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
| `NAME` | Given name and surname; the surname goes between slashes |
| `NAME` (repeated) | Further spellings of the same person, kept as name variants |
| `SEX` | `M` / `F`. `U` or missing is inferred from the family role where possible |
| `BIRT`, `DEAT` | The dedicated date and place fields, not events |
| `REFN` | Reference number — your own id in an archive or another program |
| `FAMS`, `FAMC` | Links to families as spouse / as child |

A second `BIRT` or `DEAT` block does not overwrite the first: it is kept as a
labelled event, because two contradictory birth records are a research finding,
not a mistake to resolve on import.

### Dates

`5 MAY 1863`, `MAY 1863`, `1863` and `ABT 1863` all import. Strom keeps the
precision it was given — a year stays a year, and an approximation stays
marked as one rather than being rounded into a false certainty.

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

## Events

Emit each fact under its own standard tag. All of these are read, with their
`DATE`, `PLAC`, `SOUR`, `NOTE` and participants:

`BAPM` `CONF` `FCOM` `BARM` `BASM` `ORDN` `EDUC` `OCCU` `RESI` `EMIG` `IMMI`
`NATU` `RELI` `TITL` `NATI` `ADOP` `WILL` `PROB` `BURI` `CREM` `CENS` `EVEN`

Aliases fold in without a type of their own: `CHR` and `CHRA` are a christening,
`GRAD` is where schooling ended.

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

`1 EVEN` with a `2 TYPE` label becomes a custom event keeping that label:

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
- `PEDI` under a child's `FAMC` marks an adopted, step or foster link.

## Sources

```
0 @S4@ SOUR
1 TITL Lučice, kniha narozených 1858–1870
1 REPO SOA Zámrsk
1 PAGE sign. 1702
```

Cite them from the fact they prove — `2 SOUR @S4@` with `3 PAGE` for the exact
place in the book, and `3 QUAY 0..3` for how good the reading is. A citation on
the entry is worth more than a source listed once on the person.

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
| `FAM` | `MARB` `MARC` `MARL` `MARS` `ANUL` `DIVF` `CENS` `NCHI` |

So write the banns as `MARB` **inside the family**: on a person the tag is not
recognised and the fact is lost. The same holds for the events above — `MARR`
and `DIV` are read on a `FAM`, `OCCU`, `RESI` and `RELI` on an `INDI`. If you
are marrying someone whose spouse is not in the data, do not give them a
`MARR`; write an `EVEN` with a `TYPE` instead.

Discarded outright is the bookkeeping of the program that wrote the file:
`ANCI` `DESI` `RFN` `AFN` `RESN` are reported in the import summary, while the
platform sync ids (`RIN`, `_UID`, `CHAN`, `_UPD` and their kind) are skipped
without a word — they say nothing about a person and would only be noise.

**Anything else is reported as an unsupported tag.** If your file lists tags
there, they reached Strom and were not understood — the summary is the place to
check that an exporter and this contract still agree.

## Checking your output

1. Import the file and read the summary. Unsupported tags mean something was
   written that this contract does not cover.
2. Export from Strom and import that again. The tree must be identical: what
   survives a round-trip is what Strom really holds.
3. Check the longest physical line is at most 255 **bytes**, and that no value
   begins or ends with a space.
