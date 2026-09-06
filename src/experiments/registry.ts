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
  // link_visibility experiments say where the visible/obscure link is injected and what it says
  params?: { host_page?: string; anchor_text?: string; comment_text?: string };
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

// resolves the effective variables for a page under an assignment
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
