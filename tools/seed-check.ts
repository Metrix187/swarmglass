import { join } from 'node:path';
import { loadCatalog, resolveAlias } from '../src/wiki/content.ts';
import { ExperimentRegistry } from '../src/experiments/registry.ts';
import { SERVED_SPECIALS } from '../src/wiki/special.ts';
import { cfgFor, parseArgs } from './_cli.ts';

// lints the seed: broken links that are not deliberate, experiment targets that leak,
// pages without categories, canary placeholders in attachments, and a discoverability census.

const { flags } = parseArgs(process.argv.slice(2));
const cfg = cfgFor(flags);
const cat = loadCatalog(cfg.seedDir);
const reg = ExperimentRegistry.load(join(cfg.configDir, 'experiments'));
const problems: string[] = [];
const warnings: string[] = [];

const DELIBERATE_DEAD = new Set(['Antc_Internals', 'Cluster_Topology_2011']); // {{dead:...}} handles most; these are [[links]] we want red

for (const p of cat.pages.values()) {
  for (const l of p.links) {
    const [target] = l.split('#');
    if (!target) continue;
    // the Special: namespace belongs to the router, not the catalog, so check it against what the router answers
    if (target.startsWith('Special:')) {
      if (!SERVED_SPECIALS.has(target)) warnings.push(`${p.id}: link to a special page nothing serves [[${target}]]`);
      continue;
    }
    if (!resolveAlias(cat.pages, target) && !DELIBERATE_DEAD.has(target)) warnings.push(`${p.id}: link to missing page [[${target}]] (fine if deliberate; add to DELIBERATE_DEAD)`);
  }
  if (!p.categories.length && p.kind === 'article' && !p.id.includes(':')) warnings.push(`${p.id}: no categories`);
  if (!p.authors.length) warnings.push(`${p.id}: no authors`);
  if (p.kind === 'article' && p.body.length < 200) warnings.push(`${p.id}: very short body (${p.body.length} chars)`);
}

// experiment targets with link_visibility must not be linked from visible prose
for (const d of reg.defs) {
  if (d.variable !== 'link_visibility') continue;
  for (const t of d.targets) {
    const page = cat.pages.get(t);
    if (!page) {
      problems.push(`${d.id}: target ${t} does not exist`);
      continue;
    }
    if (page.discover !== 'experiment') problems.push(`${d.id}: target ${t} has discover=${page.discover}; a link_visibility target must be discover: experiment (unlinked, no channels)`);
    for (const p of cat.pages.values()) if (p.links.some((l) => resolveAlias(cat.pages, l) === t)) problems.push(`${d.id}: ${p.id} links to target ${t} in visible prose`);
  }
  if (d.params?.host_page && !cat.pages.has(d.params.host_page)) problems.push(`${d.id}: host_page ${d.params.host_page} does not exist`);
}
for (const d of reg.defs) for (const t of d.targets) if (!cat.pages.has(t)) problems.push(`${d.id}: target ${t} does not exist`);
// metadata_carrier targets: the only pointer may be the carrier itself, so the page has to start unreachable
for (const d of reg.defs) {
  if (d.variable !== 'metadata_carrier') continue;
  for (const t of d.targets) {
    const page = cat.pages.get(t);
    if (!page) continue;
    if (page.discover !== 'experiment' && page.discover !== 'orphan') problems.push(`${d.id}: target ${t} has discover=${page.discover}; a metadata_carrier target must be an experiment or orphan page`);
    for (const p of cat.pages.values()) if (p.links.some((l) => resolveAlias(cat.pages, l) === t)) problems.push(`${d.id}: ${p.id} links to target ${t} in visible prose`);
  }
  // "*" is every article except the experiment targets; anything else has to be a real page, and so does every earlier host
  const hosts = [d.params?.host_page, ...(d.params?.host_page_history ?? []).map((h) => h.host_page)];
  if (!d.params?.host_page) problems.push(`${d.id}: metadata_carrier needs params.host_page`);
  for (const h of hosts) if (h && h !== '*' && !cat.pages.has(h)) problems.push(`${d.id}: host_page ${h} does not exist`);
  for (const h of d.params?.host_page_history ?? []) if (Number.isNaN(Date.parse(h.until))) problems.push(`${d.id}: host_page_history until "${h.until}" is not a date`);
}
problems.push(...reg.errors);

for (const a of cat.attachments.values()) if (!a.body.includes('{{canary}}')) warnings.push(`attachment ${a.name}: no {{canary}} placeholder`);

const census = new Map<string, number>();
for (const p of cat.pages.values()) census.set(p.discover, (census.get(p.discover) ?? 0) + 1);

console.log(`seed ${cat.version}: ${cat.pages.size} pages, ${cat.attachments.size} attachments, ${cat.aliases.size} aliases, ${cat.categories.size} categories`);
console.log('discoverability census:');
for (const [k, v] of [...census.entries()].sort()) console.log(`  ${k.padEnd(18)} ${v}`);
console.log(`experiments: ${reg.defs.length} defined, ${reg.active().length} active`);
if (warnings.length) {
  console.log(`\nwarnings (${warnings.length}):`);
  for (const w of warnings) console.log('  - ' + w);
}
if (problems.length) {
  console.log(`\nproblems (${problems.length}):`);
  for (const p of problems) console.log('  ! ' + p);
  process.exit(1);
}
console.log('\nok');
