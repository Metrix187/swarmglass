import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { Catalog } from '../wiki/content.ts';
import type { ExperimentRegistry } from '../experiments/registry.ts';
import { carrierLags, compareExperiment } from '../experiments/compare.ts';
import { sanitizeSession, sanitizeSightings, assertNoLeak, type Level } from './sanitize.ts';
import { barChart, cdfChart, matrixChart, propagationGraph, stackedBars } from './charts.ts';
import { dayKey } from '../util/time.ts';

// turns telemetry into a publication folder: markdown + json + csv + svg + sanitized rows.
// nothing in the output identifies a visitor; the sanitizer is the only path out.

export interface ReportDeps {
  db: Db;
  cat: Catalog;
  registry: ExperimentRegistry;
  heuristicsVersion: number;
  appVersion: string;
}

export interface ReportOpts {
  experimentId: string | null; // null = general observation report
  range: { since: number; until: number };
  outDir: string;
  level: Level;
}

export function generateReport(deps: ReportDeps, opts: ReportOpts): { dir: string; files: string[] } {
  const { db, cat } = deps;
  const stamp = dayKey(Date.now());
  const name = opts.experimentId ? `${opts.experimentId}-${stamp}` : `observations-${stamp}`;
  const dir = join(opts.outDir, name);
  mkdirSync(join(dir, 'charts'), { recursive: true });
  const files: string[] = [];
  const write = (file: string, body: string) => {
    if (opts.level === 'public' && !file.endsWith('.svg')) assertNoLeak(body);
    writeFileSync(join(dir, file), body);
    files.push(file);
  };

  const since = opts.range.since;
  const until = opts.range.until;
  const sessions = db.all<Record<string, unknown>>('SELECT * FROM sessions WHERE started_at >= ? AND started_at <= ? AND synthetic = 0 ORDER BY started_at', since, until);
  const classes: Record<string, number> = {};
  for (const s of sessions) classes[String(s.likely_class ?? 'unscored')] = (classes[String(s.likely_class ?? 'unscored')] ?? 0) + 1;
  const events = db.get<{ n: number; err: number }>('SELECT COUNT(*) AS n, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS err FROM events WHERE ts >= ? AND ts <= ? AND synthetic = 0', since, until) ?? { n: 0, err: 0 };
  const discovery = db.all<{ cls: string | null; disc: string | null; n: number }>('SELECT s.likely_class AS cls, pd.discover_class AS disc, COUNT(DISTINCT pd.session_id) AS n FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ? AND s.synthetic = 0 GROUP BY cls, disc', since, until);
  const cells: Record<string, Record<string, number>> = {};
  for (const r of discovery) (cells[r.cls ?? 'unscored'] ??= {})[r.disc ?? 'visible'] = r.n;
  const discRows = Object.keys(cells).sort();
  const discCols = [...new Set(discovery.map((r) => r.disc ?? 'visible'))].sort();
  const sightings = db.all<Record<string, unknown>>('SELECT * FROM canary_sightings WHERE ts >= ? AND ts <= ? AND synthetic = 0 ORDER BY ts', since, until);
  const cross = sightings.filter((s) => Number(s.cross_session) === 1);
  const placements = db.all<{ placement: string; n: number }>('SELECT c.placement, COUNT(*) AS n FROM canary_sightings cs JOIN canaries c ON c.id = cs.canary_id WHERE cs.ts >= ? AND cs.ts <= ? AND cs.synthetic = 0 GROUP BY c.placement ORDER BY n DESC', since, until);
  const hiddenReach = db.all<{ disc: string; n: number }>("SELECT discover_class AS disc, COUNT(DISTINCT session_id) AS n FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE pd.ts >= ? AND pd.ts <= ? AND s.synthetic = 0 AND discover_class IS NOT NULL AND discover_class != 'visible' GROUP BY disc ORDER BY n DESC", since, until);

  const keyed = new Map<string, string>();
  const sessionRows = sessions.map((s, i) => sanitizeSession(decode(s), opts.level, keyed, i));
  const sightingRows = sanitizeSightings(sightings, opts.level, keyed);

  // ---- charts ----
  write('charts/class_mix.svg', barChart('Likely class of sessions (heuristic)', Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })), { format: (v) => String(v) }));
  write('charts/discovery_matrix.svg', matrixChart('Sessions reaching each discoverability class, by likely class', discRows, discCols, cells));
  write('charts/hidden_reach.svg', barChart('Sessions reaching hidden pages, by class of hiding place', hiddenReach.map((r) => ({ label: r.disc, value: r.n })), { format: (v) => String(v) }));
  write('charts/canary_placements.svg', barChart('Canary sightings by placement of the canary that came back', placements.map((r) => ({ label: r.placement, value: r.n })), { format: (v) => String(v) }));
  const propNodes: Array<{ id: string; kind: 'canary' | 'session' | 'external' }> = [];
  const propEdges: Array<{ from: string; to: string }> = [];
  for (const s of cross.slice(0, 40)) {
    const cid = String(s.canary_id);
    const sid = relabelId(keyed, 'S', s.session_id);
    const eid = relabelId(keyed, 'S', s.exposure_session_id);
    if (!propNodes.some((n) => n.id === cid)) propNodes.push({ id: cid, kind: 'canary' });
    if (sid && !propNodes.some((n) => n.id === sid)) propNodes.push({ id: sid, kind: Number(s.external) ? 'external' : 'session' });
    if (eid && !propNodes.some((n) => n.id === eid)) propNodes.push({ id: eid, kind: 'session' });
    if (eid) propEdges.push({ from: eid, to: cid });
    if (sid) propEdges.push({ from: cid, to: sid });
  }
  write('charts/canary_propagation.svg', propagationGraph('Cross-session canary propagation (exposed session → canary → presenting session)', propNodes, propEdges));
  write('canary_propagation.json', JSON.stringify({ nodes: propNodes, edges: propEdges }, null, 2));

  // ---- experiment section ----
  let expMd = '';
  let comparison: ReturnType<typeof compareExperiment> | null = null;
  if (opts.experimentId) {
    const def = deps.registry.get(opts.experimentId);
    if (def) {
      comparison = compareExperiment(db, cat, def, opts.range, 'real', deps.registry.active());
      const reachOutcome = def.outcomes.find((o) => o.metric === 'page_reached');
      const timeOutcome = def.outcomes.find((o) => o.metric === 'seconds_to_page');
      if (reachOutcome) {
        write(
          `charts/${def.id}_reach.svg`,
          barChart(`${def.id} — reach rate of ${reachOutcome.page ?? 'target'} per arm (Wilson 95%)`, comparison.arms.map((a) => {
            const o = a.outcomes[reachOutcome.id] as { rate: number | null; wilson95: [number, number] | null } | undefined;
            return { label: `${a.arm}: ${a.label}`, value: o?.rate ?? 0, ci: o?.wilson95 ?? null };
          }), { max: 1 }),
        );
      }
      if (timeOutcome) {
        // carriers: the clock starts when the carrier was shown, to whoever ends up fetching the url
        const carrier = def.variable === 'metadata_carrier';
        const series = comparison.arms.map((a) => {
          const like = `%"${def.id}":"${a.arm}"%`;
          const dts = carrier
            ? carrierLags(db, def, a.arm, timeOutcome.page ?? '', opts.range, 'real', deps.registry.active()).map((ms) => ms / 1000)
            : db.all<{ dt: number }>('SELECT pd.ts - s.started_at AS dt FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id WHERE s.cohorts_json LIKE ? AND pd.page_id = ? AND s.synthetic = 0 AND pd.ts >= ? AND pd.ts <= ?', like, timeOutcome.page ?? '', since, until).map((r) => r.dt / 1000);
          return { label: `${a.arm}: ${a.label}`, values: dts };
        });
        write(`charts/${def.id}_time_to_target.svg`, cdfChart(`${def.id} — time from ${carrier ? 'the carrier being shown' : 'session start'} to ${timeOutcome.page ?? 'target'}`, series));
      }
      write(`charts/${def.id}_class_mix.svg`, stackedBars(`${def.id} — likely-class mix per arm`, comparison.arms.map((a) => ({ label: `${a.arm}: ${a.label}`, parts: a.classes })), [...new Set(comparison.arms.flatMap((a) => Object.keys(a.classes)))].sort()));
      write('arms.csv', armsCsv(comparison));
      write('comparison.json', JSON.stringify(comparison, null, 2));
      expMd = experimentMarkdown(comparison);
    } else {
      expMd = `\n## Experiment\n\nNo experiment with id \`${opts.experimentId}\` is defined.\n`;
    }
  }

  // ---- summary ----
  const summary = {
    generated_at: new Date().toISOString(),
    swarmglass_version: deps.appVersion,
    seed_version: cat.version,
    heuristics_version: deps.heuristicsVersion,
    level: opts.level,
    range: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
    totals: { sessions: sessions.length, requests: events.n, errors: events.err, canary_sightings: sightings.length, cross_session_sightings: cross.length, actors: new Set(sessions.map((s) => s.actor_hash)).size },
    classes,
    discovery_matrix: { rows: discRows, cols: discCols, cells },
    hidden_reach: hiddenReach,
    canary_placements: placements,
    experiment: comparison ? { id: comparison.experiment.id, arms: comparison.arms } : null,
  };
  write('summary.json', JSON.stringify(summary, null, 2));
  write('sessions.jsonl', sessionRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  write('sightings.jsonl', sightingRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  write('summary.md', summaryMarkdown(summary, expMd, name));
  const manifest = { name, files: files.map((f) => ({ file: f, sha256: createHash('sha256').update(readBack(join(dir, f))).digest('hex') })), generated_at: summary.generated_at };
  writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  files.push('MANIFEST.json');
  return { dir, files };
}

function readBack(path: string): Buffer {
  return readFileSync(path);
}

function relabelId(map: Map<string, string>, prefix: string, id: unknown): string | null {
  if (!id) return null;
  const key = prefix + String(id);
  const hit = map.get(key);
  if (hit) return hit;
  const label = `${prefix}-${String(map.size + 1).padStart(4, '0')}`;
  map.set(key, label);
  return label;
}

function decode(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r };
  for (const k of ['cohorts_json', 'features_json', 'scores_json']) {
    if (typeof out[k] === 'string') {
      try {
        out[k.replace('_json', '')] = JSON.parse(out[k] as string);
      } catch {
        out[k.replace('_json', '')] = null;
      }
    }
    delete out[k];
  }
  return out;
}

function armsCsv(c: ReturnType<typeof compareExperiment>): string {
  const outcomeIds = c.experiment.outcomes.map((o) => o.id);
  const head = ['arm', 'label', 'value', 'sessions', 'actors', ...outcomeIds.map((o) => `outcome_${o}`)];
  const rows = c.arms.map((a) => [a.arm, a.label, a.value, a.sessions, a.actors, ...outcomeIds.map((o) => JSON.stringify(a.outcomes[o] ?? null).replace(/"/g, "'"))]);
  return [head.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n';
}

function experimentMarkdown(c: ReturnType<typeof compareExperiment>): string {
  const d = c.experiment;
  const lines = [
    '',
    `## Experiment ${d.id}: ${d.name}`,
    '',
    `**Hypothesis.** ${d.hypothesis}`,
    '',
    `**Variable.** \`${d.variable}\` (${d.scope}${d.targets.length ? `, targets: ${d.targets.map((t) => `\`${t}\``).join(', ')}` : ''}). Assignment per ${d.assignment.unit}, salt \`${d.assignment.salt}\`, definition version ${d.version}.`,
    '',
    '| arm | label | value | sessions | actors | ' + d.outcomes.map((o) => o.id).join(' | ') + ' |',
    '|---|---|---|---|---|' + d.outcomes.map(() => '---').join('|') + '|',
    ...c.arms.map((a) => `| ${a.arm} | ${a.label} | \`${a.value}\` | ${a.sessions} | ${a.actors} | ${d.outcomes.map((o) => fmtOutcome(a.outcomes[o.id])).join(' | ')} |`),
    '',
    ...c.notes.map((n) => `> ${n}`),
    '',
    d.fiction_map ? '**Fiction map.** ' + Object.entries(d.fiction_map).map(([k, v]) => `*${k}* — ${v}`).join('; ') + '.' : '',
  ];
  return lines.join('\n');
}

function fmtOutcome(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('exposed' in o) return `${o.reached} of ${o.exposed} exposed (${o.rate === null ? 'n/a' : Math.round(Number(o.rate) * 100) + '%'}${o.wilson95 ? `, CI ${(o.wilson95 as number[]).map((x) => Math.round(x * 100) + '%').join('–')}` : ''}), ${o.cross_actor} from another actor`;
    if ('rate' in o) return `${o.reached ?? o.sessions ?? ''} (${o.rate === null ? 'n/a' : Math.round(Number(o.rate) * 100) + '%'}${o.wilson95 ? `, CI ${(o.wilson95 as number[]).map((x) => Math.round(x * 100) + '%').join('–')}` : ''})`;
    if ('median_s' in o) return o.median_s === null ? 'n/a' : `median ${o.median_s}s, p90 ${o.p90_s}s (n=${o.n})`;
    if ('mean' in o) return `mean ${o.mean ?? 'n/a'}, max ${o.max ?? 'n/a'}`;
    return Object.entries(o).map(([k, x]) => `${k}: ${x}`).join(', ');
  }
  return String(v);
}

function summaryMarkdown(s: Record<string, unknown>, expMd: string, name: string): string {
  const totals = s.totals as Record<string, number>;
  const classes = s.classes as Record<string, number>;
  const hidden = s.hidden_reach as Array<{ disc: string; n: number }>;
  const placements = s.canary_placements as Array<{ placement: string; n: number }>;
  const range = s.range as { since: string; until: string };
  return `# Swarmglass observation report — ${name}

*Generated ${s.generated_at} · Swarmglass ${s.swarmglass_version} · seed ${s.seed_version} · heuristics v${s.heuristics_version} · level: ${s.level}*

Window: ${range.since} → ${range.until}. Synthetic traffic excluded.

## Totals

| sessions | actors | requests | errors | canary sightings | cross-session sightings |
|---|---|---|---|---|---|
| ${totals.sessions} | ${totals.actors} | ${totals.requests} | ${totals.errors} | ${totals.canary_sightings} | ${totals.cross_session_sightings} |

## Likely class of sessions

These are heuristic labels (see \`config/heuristics.json\`), not identifications.

| class | sessions |
|---|---|
${Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

![class mix](charts/class_mix.svg)

## Hidden-page reach

Sessions that reached at least one page not linked from ordinary navigation, by how that page is hidden.

| hiding place | sessions |
|---|---|
${hidden.map((h) => `| ${h.disc} | ${h.n} |`).join('\n') || '| — | 0 |'}

![discovery matrix](charts/discovery_matrix.svg)

## Canaries

Sightings by the placement of the canary that came back (where on the page it was originally shown).

| placement | sightings |
|---|---|
${placements.map((p) => `| ${p.placement} | ${p.n} |`).join('\n') || '| — | 0 |'}

![propagation](charts/canary_propagation.svg)
${expMd}

## How to read this

- Observed behaviour is reported as behaviour: what was requested, in what order, with what headers. Nothing here asserts which model, company, or person was behind a session.
- Session boundaries are inferred; actor counts are given so the reader can judge independence.
- Every number can be regenerated from the experiment definition, the seed version, the heuristics version, and the database window above. See \`docs/REPRODUCIBILITY.md\`.
`;
}
