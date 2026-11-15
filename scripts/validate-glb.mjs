import { readFileSync } from 'node:fs';
import validator from 'gltf-validator';
let failed = false;
for (const name of process.argv.slice(2)) {
  const report = await validator.validateBytes(new Uint8Array(readFileSync(name)));
  const { numErrors, numWarnings, numInfos } = report.issues;
  console.log(name, `errors ${numErrors}, warnings ${numWarnings}, infos ${numInfos}`);
  for (const m of report.issues.messages.filter(m => m.severity <= 1).slice(0, 10)) console.log('  ', m.severity ? 'warn' : 'ERROR', m.code, m.message, m.pointer ?? '');
  if (numErrors) failed = true;
}
process.exit(failed ? 1 : 0);
