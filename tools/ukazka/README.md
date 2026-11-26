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

A bridge on a sample (`strom live start` with the build's `env.json`) runs at the moment when `STROM_SAMPLE_CLOCK`
names it too (`fixed-clock.cjs` is in its `NODE_OPTIONS`).

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
```

Each research is built in about a minute. Nothing of the user's is touched: every demo has its own HOME,
strom config and git config in `<outdir>`, and its node processes reach no network (`no-net.cjs`: only this
computer's own addresses). The invented archives live under `example.org`, which is never asked.

On macOS the handwriting of the register pages uses Snell Roundhand; elsewhere a fallback font is used, so the
scans differ from a Mac's build (the data do not).

The app's screenshots are made from these data by a separate local tool; it imports `family-data.ts`,
`demo-data.ts`, `demo-places.ts` and `demo-323.ts` from here.
