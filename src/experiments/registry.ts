import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnv1a } from '../util/hash.ts';

// ---- variables the wiki renderer understands. one experiment changes exactly one. ----

export const VARIABLES = {
  link_visibility: ['visible', 'obscure', 'robots_only', 'sitemap_only', 'feed_only', 'none'],
  structured_data: ['prose', 'jsonld'],
  title_style: ['neutral', 'agent'],
  canary_mode: ['static', 'rotating'],
  link_depth: ['shallow', 'deep'],
  manifest_visibility: ['obvious', 'subtle'],
  representation: ['html', 'json', 'text'],
  deprecation_flag: ['on', 'off'],
  metadata_density: ['sparse', 'dense'],
  doc_language: ['terse', 'verbose'],
  // which head metadata carrier advertises a target url on the host page. tells a semantic open graph reader
  // from a generic "anything url-shaped in content=" miner from a structured-document ingester (SGX-011)
  metadata_carrier: ['og_see_also', 'fake_ns_see_also', 'meta_content_url', 'og_url', 'og_image', 'link_alternate', 'link_canonical', 'jsonld', 'head_text', 'html_comment', 'none'],
  // SGX-012: two fresh twin pages linked side by side, one of them disallowed in robots.txt. the arms swap
  // which twin carries the rule, so skipping one can be pinned on the rule rather than on the page
  robots_compliance: ['pair', 'swapped', 'none'],
} as const;

export type VariableName = keyof typeof VARIABLES;
export type VariableValue = (typeof VARIABLES)[VariableName][number];

export const DEFAULTS: Record<VariableName, VariableValue> = {
  link_visibility: 'visible',
  structured_data: 'jsonld',
  title_style: 'neutral',
  canary_mode: 'static',
  link_depth: 'deep',
  manifest_visibility: 'subtle',
  representation: 'html',
  deprecation_flag: 'off',
  metadata_density: 'dense',
  doc_language: 'terse',
  metadata_carrier: 'none',
  robots_compliance: 'none',
};

// variables that only make sense site-wide (they don't attach to one page)
export const GLOBAL_ONLY: VariableName[] = ['canary_mode', 'manifest_visibility', 'metadata_density'];

export interface Arm {
  id: string;
  label: string;
  weight: number;
  value: VariableValue;
  note?: string;
}

export interface Outcome {
  id: string;
  metric: 'page_reached' | 'seconds_to_page' | 'canary_reappeared' | 'alt_requested' | 'depth_reached' | 'sessions' | 'class_mix';
  page?: string;
  description?: string;
}

export interface ExperimentDef {
  id: string; // SGX-001
  name: string;
  version: number;
  status: 'active' | 'paused' | 'archived' | 'draft';
  hypothesis: string;
  variable: VariableName;
  scope: 'targets' | 'global';
  targets: string[]; // page ids
  arms: Arm[];
  assignment: { unit: 'actor' | 'session'; salt: string };
  outcomes: Outcome[];
  seed_version: string;
  created: string;
  owner?: string;
  notes?: string;
  fiction_map?: Record<string, string>; // public fictional element -> what it is for
  // link_visibility and metadata_carrier experiments say which page hosts the stimulus and what it says
  // host_page "*" (metadata_carrier only) puts the stimulus on every article except the experiment targets.
  // host_page_history records earlier hosts with the moment they stopped, so exposures before a widening are
  // still counted against the page that carried the stimulus then
  params?: { host_page?: string; host_page_history?: { until: string; host_page: string }[]; anchor_text?: string; comment_text?: string };
}

export interface Assignment {
  cohorts: Record<string, string>; // experiment id -> arm id
  // per-page variable overrides: pageId -> {variable: value}
  perPage: Map<string, Partial<Record<VariableName, VariableValue>>>;
  global: Partial<Record<VariableName, VariableValue>>;
}

export function validateExperiment(d: ExperimentDef): string[] {
  const errs: string[] = [];
  if (!/^SGX-\d{3}[a-z]?$/.test(d.id)) errs.push(`${d.id}: id must look like SGX-001`);
  if (!(d.variable in VARIABLES)) errs.push(`${d.id}: unknown variable ${d.variable}`);
  if (!['active', 'paused', 'archived', 'draft'].includes(d.status)) errs.push(`${d.id}: bad status`);
  if (!d.arms || d.arms.length < 1) errs.push(`${d.id}: needs at least one arm`);
  const allowed = (VARIABLES as Record<string, readonly string[]>)[d.variable] ?? [];
  for (const a of d.arms ?? []) {
    if (!allowed.includes(a.value)) errs.push(`${d.id}/${a.id}: value ${a.value} not allowed for ${d.variable}`);
    if (!(a.weight > 0)) errs.push(`${d.id}/${a.id}: weight must be > 0`);
  }
  if (d.scope === 'targets' && (!d.targets || !d.targets.length)) errs.push(`${d.id}: targets scope needs targets`);
  if (d.scope === 'global' && !GLOBAL_ONLY.includes(d.variable) && d.targets?.length) errs.push(`${d.id}: global scope with targets is ambiguous`);
  if (GLOBAL_ONLY.includes(d.variable) && d.scope !== 'global') errs.push(`${d.id}: ${d.variable} must be global scope`);
  if (!d.assignment || !['actor', 'session'].includes(d.assignment.unit) || !d.assignment.salt) errs.push(`${d.id}: assignment needs unit + salt`);
  return errs;
}

export class ExperimentRegistry {
  readonly defs: ExperimentDef[] = [];
  readonly errors: string[] = [];

  static load(dir: string): ExperimentRegistry {
    const reg = new ExperimentRegistry();
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
    } catch {
      return reg;
    }
    for (const f of files) {
      try {
        const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ExperimentDef;
        const errs = validateExperiment(d);
        if (errs.length) reg.errors.push(...errs);
        else reg.defs.push(d);
      } catch (e) {
        reg.errors.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    reg.errors.push(...reg.checkConflicts());
    return reg;
  }

  // one variable at a time: two active experiments may not vary the same variable on overlapping targets,
  // and only one global experiment may be active.
  checkConflicts(): string[] {
    const errs: string[] = [];
    const active = this.defs.filter((d) => d.status === 'active');
    const globals = active.filter((d) => d.scope === 'global');
    if (globals.length > 1) errs.push(`only one global-scope experiment may be active; found ${globals.map((g) => g.id).join(', ')}`);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i] as ExperimentDef;
        const b = active[j] as ExperimentDef;
        const overlap = a.targets.filter((t) => b.targets.includes(t));
        if (overlap.length) errs.push(`${a.id} and ${b.id} both target ${overlap.join(', ')} — one variable per target at a time`);
      }
    }
    return errs;
  }

  active(): ExperimentDef[] {
    return this.defs.filter((d) => d.status === 'active');
  }

  get(id: string): ExperimentDef | undefined {
    return this.defs.find((d) => d.id === id);
  }

  assign(actorHash: string, sessionId: string): Assignment {
    const cohorts: Record<string, string> = {};
    const perPage = new Map<string, Partial<Record<VariableName, VariableValue>>>();
    const global: Partial<Record<VariableName, VariableValue>> = {};
    for (const d of this.active()) {
      const key = d.assignment.unit === 'session' ? sessionId : actorHash;
      const arm = pickArm(d, key);
      cohorts[d.id] = arm.id;
      if (d.scope === 'global') {
        global[d.variable] = arm.value;
      } else {
        for (const t of d.targets) {
          const cur = perPage.get(t) ?? {};
          cur[d.variable] = arm.value;
          perPage.set(t, cur);
        }
      }
    }
    return { cohorts, perPage, global };
  }
}

export function pickArm(d: ExperimentDef, key: string): Arm {
  const total = d.arms.reduce((acc, a) => acc + a.weight, 0);
  const h = fnv1a(`${d.assignment.salt}|${d.id}|v${d.version}|${key}`);
  let x = (h / 4294967296) * total;
  for (const a of d.arms) {
    if (x < a.weight) return a;
    x -= a.weight;
  }
  return d.arms[d.arms.length - 1] as Arm;
}

// the query key a metadata_carrier url carries its arm in. ?oldid= is what the mirror's own permalinks use
// and the article route answers any revision id, so the target reads as a permalink, not a tracking link
export const CARRIER_TOKEN_KEY = 'oldid';

// one fake revision id per arm. the swarm in F-001 hands urls from the address that saw the carrier to
// another address that does the fetching, so the fetching session's own cohort says nothing about which
// carrier did the work; the id in the url does. six digits so it can never collide with the seed's real
// revision ids (1000..91006) or the permalink route numbers
export function armTokens(d: ExperimentDef): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const a of d.arms) {
    let tok = '';
    for (let n = 0; ; n++) {
      tok = String(100000 + (fnv1a(`${d.assignment.salt}|${d.id}|v${d.version}|arm:${a.id}|${n}`) % 900000));
      if (!used.has(tok)) break;
    }
    used.add(tok);
    out.set(a.id, tok);
  }
  return out;
}

// the reverse lookup: which arm handed out this revision id
export function armByToken(d: ExperimentDef): Map<string, string> {
  const out = new Map<string, string>();
  for (const [arm, tok] of armTokens(d)) out.set(tok, arm);
  return out;
}

// where a metadata_carrier experiment shows its stimulus. host_page "*" means every article render except the
// target itself and the targets of the other active experiments, so one variable still changes one page.
// a member of the F-001 pool renders Main_Page about once an hour; on every article it is every request
export interface CarrierHosts {
  all: boolean;
  only: string | null;
  exclude: string[];
}

export function carrierHosts(host: string | undefined, d: ExperimentDef, active: ExperimentDef[]): CarrierHosts {
  if (host !== '*') return { all: false, only: host || null, exclude: [] };
  const exclude = new Set<string>(d.targets);
  for (const o of active) if (o.id !== d.id) for (const t of o.targets) exclude.add(t);
  return { all: true, only: null, exclude: [...exclude] };
}

export function isCarrierHost(d: ExperimentDef, active: ExperimentDef[], pageId: string): boolean {
  const h = carrierHosts(d.params?.host_page, d, active);
  return h.all ? !h.exclude.includes(pageId) : h.only === pageId;
}

// resolves the effective variables for a page under an assignment
// SGX-012: which twin robots.txt tells this actor to keep out of. the arms swap it so a page that goes
// unfetched can be blamed on the rule and not on its title, url shape or anything else about it.
// note the thing this cannot separate on its own: a crawler running on a robots.txt cached from before the
// twins existed sees no rule about them either, and looks exactly like one that read the rule and ignored it.
// the allowed twin is what breaks the tie — skip one and take the other and you are working from current rules
export function complianceDisallowed(d: ExperimentDef, armValue: string): string | null {
  if (d.variable !== 'robots_compliance') return null;
  // the control arm gets no rule at all. shipped it the other way at first and that was just wrong:
  // a Disallow line names the url, so the control was quietly handing out the very thing it exists not to give
  if (armValue === 'none') return null;
  const [first, second] = d.targets;
  if (!first || !second) return null;
  return armValue === 'swapped' ? first : second;
}

export function variablesFor(a: Assignment | null, pageId: string | null): Record<VariableName, VariableValue> {
  const out: Record<VariableName, VariableValue> = { ...DEFAULTS };
  if (!a) return out;
  for (const [k, v] of Object.entries(a.global)) out[k as VariableName] = v as VariableValue;
  if (pageId) {
    const p = a.perPage.get(pageId);
    if (p) for (const [k, v] of Object.entries(p)) out[k as VariableName] = v as VariableValue;
  }
  return out;
}
