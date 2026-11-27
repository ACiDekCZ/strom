# tools/ukazka: the invented sample family and demo research

Builds the invented data the Strom sample and the website's screenshots are made of, in four languages
(cs, en, de, pl). Nothing here is real: the families, places, registers, scans and portraits are made up
and drawn by these scripts (no real records, no photographs, no generated images).

| Language | The app's family (`build-family.ts`) | The research's main person (`build-demo.ts`) |
|---|---|---|
| cs | Horákovi | Anna Horáková (*1931) |
| en | Hartley family | Emily Hartley (*1931) |
| de | Familie Weber | Anna Weber (*1931) |
| pl | Rodzina Jaworskich | Zofia Jaworska (*1931) |

## What it makes

- `build-family.ts <lang> <outdir> [YYYY-MM-DD]`: the app's family as a Strom JSON (`family.json`, 57 people,
  24 families, sources with excerpts cut from the invented register pages, stories, places with coordinates),
  `family-photos.json` (the same tree with the drawn portraits of `portraits/` as photos) and `scans/`.
  The date moves a birthday and an anniversary into the coming days (the anniversaries panel).
- `build-demo.ts <lang> <outdir>`: a real research made only through the strom CLI, as an agent would make it:
  23 people over five generations, five lines (running, paused, ended), sessions over three days, sources with
  scans and excerpts, a conflict, hypotheses, searches, tasks waiting for a person (archive, office, family,
  web), places and the edge of the tree. `<outdir>/home` is the demo's own HOME (the research in
  `home/Documents/Strom/<tree>`), `<outdir>/config` its strom config, `env.json` the environment to run strom
  in it, `tree.txt` the research's folder.
- `gen-scans.mjs` draws the register pages (Chromium), `gen-portraits.mjs` the portraits (`portraits/`, kept in
  git so a build does not need to draw them).
- The houses (`demo-houses.ts`, called by `build-demo.ts`): the mill no. 12 of the home village with its history
  (numbers over time, holders, residents, a fire, its look with its check, the village's pictures and field names, what
  is not known) and no. 5 of the other village; the people off the tree and the texts are invented, the point is the
  village's own point of the demo. `gen-houses.mjs` draws the pictures (`houses/`, in git; published at
  `https://stromapp.info/ukazka/domy/`, the shots serve them from the folder). What the research writes of a house
  needs no consent; the person's request (`strom house request … --yes`, the mill researched and no. 5 queued) and
  the tree's `strom config set houses on --for-tree` run only in a person's build (`SHOWCASE_NO_ACCEPT=0`), never in
  an agent's. Test: `node --test tools/ukazka/demo-houses.test.ts`.
- In a sample, the family of the shots (`build-family.ts`, all 57 people with their portraits, register pages and
  sources) comes into the research as the app sends it: `family-ged.ts` writes it as a GEDCOM with the research's IDs
  (the people it already has), `strom sync … --apply` takes the rest; `build-ukazka.ts` fails when a person of the
  family or a portrait is missing from the packed tree.

## Two modes of `build-demo.ts`

- **Screenshots** (default): "now" is the moment of the build, an agent stays at work (`worker.mjs`, its pid in
  `worker.pid`: kill it when done) and each session carries an invented cost.
- **Sample** (`SHOWCASE_SAMPLE=1`): a fixed moment is "now" of the whole research (`SHOWCASE_NOW`, default
  `SAMPLE_AS_OF` in `sample.ts`), strom's own clock included (`fixed-clock.cjs`: every strom command runs at its
  moment of the demo). No agent at work (the last session is closed, to be continued), no costs, no record
  edited by hand: the data as strom wrote it. The images saved by hand into the shared inbox were saved a day
  before the moment and strom took them at it, so a bridge started on the sample later finds nothing to do and
  writes nothing. `sample.json` beside `env.json` names the moment.
  `node check-sample.ts <outdir>` checks it: every time at or before the moment, nobody at work, every session
  closed, no `costUsd`, git status clean.
  Time never runs back in a sample (`SampleClock`, `sample-clock.ts`): a command comes at its moment of the demo, but
  never before the end of the command before it — strom checks a research by its operations in the order of their time,
  and an operation dated before one already written reads as a record "edited outside strom" (`strom demo` refuses the
  package). A command moved later is said on stderr. Test: `node --test tools/ukazka/sample-clock.test.ts`.

A bridge on a sample (`strom live start` with the build's `env.json`) runs at the moment when `STROM_SAMPLE_CLOCK`
names it too (`fixed-clock.cjs` is in its `NODE_OPTIONS`).

A sample's research has the same id in every build: `sampleTreeId(lang)` in `sample.ts`, the UUIDv5 of
`https://stromapp.info/demo/showcase-<lang>` (URL namespace). `strom init` gets it through `fixed-id.cjs`
(`STROM_SAMPLE_TREE_ID`, loaded only into that command), so the file on the web and the research of `strom demo` are
one research. build-demo.ts checks the tree got it.

## The showcase files (`build-ukazka.ts`)

`node tools/ukazka/build-ukazka.ts <outdir> [cs en de pl]` makes the files the app opens as the sample (format
`strom-showcase` 1, `src/showcase-format.ts`) and the research packed for `strom demo`:

1. the sample research of the language (`build-demo.ts` with `SHOWCASE_SAMPLE=1 SHOWCASE_LINES=1`) and `check-sample.ts`;
2. its bridge at the sample's moment: `status`, `log`, `material`, the whole queue (pages of 100) and
   `tree.ged?media=app` (the images in the file), then `live stop`; the research must stay as it was (HEAD, git status);
3. the answers cleaned for a public file: no address or secret of the bridge, `spend`, `accepts`, `path`, `treesRoot`,
   `phone`, `update`, `channel`, `seal`, `sends`, `inbox`, `batches` null, `live` left out, nobody at work, no
   `costUsd` or `metrics`, the demo's HOME as `~`; the header first, with its own size;
4. the checks: at most 20 MB, the header, the research's id (`_STROM_TREE`, the fixed id), no `127.0.0.1`,
   `localhost`, secret or port of the bridge, no path of the computer, no time after the moment, hosts only of the
   invented archives (`example.org`, `.example`), the project's pages and the public map layers (ČÚZK, CENIA),
   images only JPEG/PNG/WebP; a failure ends the build (the file is kept as `.failed` to look at);
5. `strom check` of the research (an error ends the build), then `strom pack`; the package must not name the computer
   that built it: no `/Users/…`, home or build folder in its files or its history (`git log -p`).

```text
<outdir>/<lang>/strom-ukazka-<lang>.json            the file (the web serves it at /demo/<lang>/)
<outdir>/<lang>/strom-ukazka-<lang>.json.sha256     its SHA-256
<outdir>/<lang>/VERSION                             the sample's version (the app's version of this checkout)
<outdir>/<lang>/strom-ukazka-<lang>-<version>.strom  the research packed (a ZIP of strom pack) + .sha256
<outdir>/work/<lang>/                               the sample research it was made of
<outdir>/sizes.json                                 the sizes
```

The research's package needs strom-research 1.37 or newer: its `strom pack` leaves out the agents' files that name a
folder of the computer (`.claude/settings.json`, `.codex/hooks.json`, …; `strom unpack` writes them for its own). Try a package as a person would, with
the packages of `<outdir>` as the web: `STROM_DEMO_BASE=file://<outdir> strom demo <lang>` (isolated).

`SHOWCASE_NOW` alone fixes the moment of a screenshot build (the inbox's images as in the sample) and changes nothing else. `build-family.ts` takes
the day of `SHOWCASE_NOW` (or of the sample) when no date is given.

Other switches: `SHOWCASE_LINES=1` (the lines' data, `demo-lines.ts`; the screenshot set uses it),
`SHOWCASE_323=1` (`demo-323.ts`), `SHOWCASE_QUERY=1` (`demo-query.ts`, Czech only), `SHOWCASE_SEALED=1`,
`SHOWCASE_NO_ACCEPT` (default 1: no archive's terms are accepted for a person), `SHOWCASE_APP_URL`,
`SHOWCASE_PORTRAITS`.

## Build from a clean clone

Needs Node 24 or newer (strom-research's own requirement; the scripts' TypeScript is run directly), git, python3,
and strom-research's sources of the version the sample is for.

```bash
git clone https://github.com/ACiDekCZ/strom.git && cd strom
npm ci && npx playwright install chromium          # Playwright draws the scans
git clone https://github.com/ACiDekCZ/strom-research.git ../strom-research
(cd ../strom-research && npm ci)
export STROM_CLI=$PWD/../strom-research/src/cli.ts SHOWCASE_SAMPLE=1 SHOWCASE_LINES=1
for l in cs en de pl; do node tools/ukazka/build-demo.ts $l /tmp/ukazka/t-$l; done
for l in cs en de pl; do node tools/ukazka/check-sample.ts /tmp/ukazka/t-$l; done
node tools/ukazka/build-ukazka.ts /tmp/ukazka/out                 # the showcase files, all four languages
```

Each research is built in about a minute. Nothing of the user's is touched: every demo has its own HOME,
strom config and git config in `<outdir>`, and its node processes reach no network (`no-net.cjs`: only this
computer's own addresses). The invented archives live under `example.org`, which is never asked.

On macOS the handwriting of the register pages uses Snell Roundhand; elsewhere a fallback font is used, so the
scans differ from a Mac's build (the data do not).

The app's screenshots are made from these data by a separate local tool; it imports `family-data.ts`,
`demo-data.ts`, `demo-places.ts` and `demo-323.ts` from here.
