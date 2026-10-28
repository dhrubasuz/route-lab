// Author and maintainer: Dhruba Poudel.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { trace, validateTopology } from '../src/engine/index.ts';

const directory = new URL('../docs/evidence/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
assert.equal(files.length, 8, 'Retain one actual live report for each supplied scenario.');
for (const file of files) {
  const report = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
  assert.equal(report.author, 'Dhruba Poudel');
  assert.equal(report.creator, 'Dhruba Poudel');
  assert.equal(report.lastModifiedBy, 'Dhruba Poudel');
  assert.equal(validateTopology(report.topology).valid, true);
  const recomputed = trace(report.topology, report.request);
  assert.deepEqual(report.trace, recomputed, `${file}: exported trace must match the engine.`);
  assert.equal(
    recomputed.delivered,
    true,
    `${file}: the verified repair must complete both paths.`,
  );
  if (report.comparison) {
    assert.deepEqual(report.comparison.after, recomputed);
    assert.deepEqual(report.comparison.before, trace(report.baselineTopology, report.request));
    assert.equal(report.comparison.before.delivered, false);
  }
}
console.log(
  `Recomputed all ${files.length} hosted reports: request, response and repair evidence match.`,
);
