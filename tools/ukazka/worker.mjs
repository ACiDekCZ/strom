// Keeps an agent "at work" in the demo research: present as strom's worker
// (.strom/workers/<id>.json, held by this process while it lives), since the
// given time. The builder starts it; stop it with kill <pid> (worker.pid).
//   node worker.mjs <tree> <id> <label> <since-ms>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [tree, id, label, since] = process.argv.slice(2);
const file = path.join(tree, '.strom', 'workers', `${id}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date(Number(since)).toISOString(), owner: label }));
const bye = () => { fs.rmSync(file, { force: true }); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
setInterval(() => {}, 1 << 30);
