// The family of the shots (build-family.ts: family-photos.json, its portraits and register pages) as the Strom app
// sends it to a research (a GEDCOM with its files in it, as POST /sync?media=app): the people the research already
// has carry their research ID (REFN P…, TYPE strom-research), so `strom sync` takes the rest of the family, the
// portraits and the sources as additions and leaves what the research has.
//
//   node family-ged.ts <family-photos.json> <people.json> <tree id> <out.ged>
//
// <people.json>: the research's people (strom person list --json: data.persons [{id, name}]); a person of the family
// is the research's when their full name is the research's for exactly one person.
import fs from "node:fs";
import { migrateData } from "../../src/data.ts";
import { exportToGedcom } from "../../src/ged-exporter.ts";

const [famFile, peopleFile, treeId, outFile] = process.argv.slice(2);
if (!famFile || !peopleFile || !treeId || !outFile) {
  console.error("usage: node family-ged.ts <family-photos.json> <people.json> <tree id> <out.ged>");
  process.exit(2);
}
const data = migrateData(JSON.parse(fs.readFileSync(famFile, "utf8")));
const said = JSON.parse(fs.readFileSync(peopleFile, "utf8")) as { data?: { persons?: { id: string; name: string }[] }; persons?: { id: string; name: string }[] };
const theirs = said.data?.persons ?? said.persons ?? [];
const byName = new Map<string, string[]>();
for (const p of theirs) byName.set(p.name, [...(byName.get(p.name) ?? []), p.id]);

const linked: Record<string, string> = {};
for (const p of Object.values(data.persons)) {
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.replace(/\s+/g, " ").trim();
  const ids = byName.get(name) ?? [];
  if (ids.length > 1) throw new Error(`family-ged: ${name} is ${ids.join(", ")} in the research`);
  if (ids.length === 1) {
    p.refn = ids[0];
    p.refnType = "strom-research";
    linked[p.id] = ids[0]!;
  }
}
const r = exportToGedcom(data, undefined, { research: { id: treeId } });
fs.writeFileSync(outFile, r.content);
console.log(JSON.stringify({ persons: Object.keys(data.persons).length, linked: Object.keys(linked).length, photos: Object.values(data.persons).filter((p) => p.photo).length }));
