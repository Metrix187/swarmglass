import { readFileSync } from 'node:fs';
import type { Features } from './features.ts';

// the scoring model is a json file of plain rules. no code, no eval — a rule is
// {"f": feature, "op": comparison, "v": value} or {"all": [...]} / {"any": [...]} / {"not": {...}}.
// every score comes back with the rules that fired, so a researcher can see *why*.

export type Op = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'matches';

export interface Cond {
  f?: string;
  op?: Op;
  v?: unknown;
  all?: Cond[];
  any?: Cond[];
  not?: Cond;
}

export interface Rule {
  id: string;
  when: Cond;
  weight: number;
  note: string;
}

export interface TraitDef {
  description: string;
  kind: 'probability' | 'scale'; // probability: logistic(prior + Σw). scale: clamp(base + Σw, 0, 1)
  prior?: number;
  base?: number;
  rules: Rule[];
}

export interface ClassDef {
  description: string;
  rules: Rule[];
  bias?: number;
}

export interface Heuristics {
  version: number;
  updated: string;
  notes: string[];
  traits: Record<string, TraitDef>;
  classes: Record<string, ClassDef>;
}

export interface Evidence {
  rule: string;
  weight: number;
  note: string;
}

export interface TraitScore {
  value: number;
  evidence: Evidence[];
}

export interface Scores {
  heuristics_version: number;
  traits: Record<string, TraitScore>;
  classes: Record<string, number>; // probabilities
  likely_class: string;
  confidence: number; // top probability minus runner-up
  class_evidence: Record<string, Evidence[]>;
}

export function loadHeuristics(path: string): Heuristics {
  const h = JSON.parse(readFileSync(path, 'utf8')) as Heuristics;
  validateHeuristics(h);
  return h;
}

export function validateHeuristics(h: Heuristics): void {
  if (typeof h.version !== 'number') throw new Error('heuristics: version must be a number');
  for (const [name, t] of Object.entries(h.traits)) {
    if (!['probability', 'scale'].includes(t.kind)) throw new Error(`trait ${name}: kind must be probability|scale`);
    for (const r of t.rules) validateRule(r, `trait ${name}`);
  }
  for (const [name, c] of Object.entries(h.classes)) for (const r of c.rules) validateRule(r, `class ${name}`);
}

function validateRule(r: Rule, where: string): void {
  if (!r.id || typeof r.weight !== 'number') throw new Error(`${where}: rule needs id + numeric weight`);
  validateCond(r.when, `${where}/${r.id}`);
}

function validateCond(c: Cond, where: string): void {
  if (c.all) return c.all.forEach((x) => validateCond(x, where));
  if (c.any) return c.any.forEach((x) => validateCond(x, where));
  if (c.not) return validateCond(c.not, where);
  if (!c.f || !c.op) throw new Error(`${where}: condition needs f + op`);
  if (!['==', '!=', '>', '>=', '<', '<=', 'in', 'matches'].includes(c.op)) throw new Error(`${where}: bad op ${c.op}`);
  if (c.op === 'matches' && typeof c.v === 'string') new RegExp(c.v);
}

export function evalCond(c: Cond, f: Features): boolean {
  if (c.all) return c.all.every((x) => evalCond(x, f));
  if (c.any) return c.any.some((x) => evalCond(x, f));
  if (c.not) return !evalCond(c.not, f);
  const val = f[c.f as string];
  const v = c.v;
  switch (c.op) {
    case '==':
      return val === v;
    case '!=':
      return val !== v;
    case '>':
      return typeof val === 'number' && typeof v === 'number' && val > v;
    case '>=':
      return typeof val === 'number' && typeof v === 'number' && val >= v;
    case '<':
      return typeof val === 'number' && typeof v === 'number' && val < v;
    case '<=':
      return typeof val === 'number' && typeof v === 'number' && val <= v;
    case 'in':
      return Array.isArray(v) && v.includes(val as never);
    case 'matches':
      return typeof v === 'string' && new RegExp(v).test(String(val ?? ''));
    default:
      return false;
  }
}

function fire(rules: Rule[], f: Features): { sum: number; evidence: Evidence[] } {
  let sum = 0;
  const evidence: Evidence[] = [];
  for (const r of rules) {
    if (evalCond(r.when, f)) {
      sum += r.weight;
      evidence.push({ rule: r.id, weight: r.weight, note: r.note });
    }
  }
  return { sum, evidence };
}

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

export function score(h: Heuristics, f: Features): Scores {
  const traits: Record<string, TraitScore> = {};
  for (const [name, t] of Object.entries(h.traits)) {
    const { sum, evidence } = fire(t.rules, f);
    const value = t.kind === 'probability' ? logistic((t.prior ?? 0) + sum) : Math.max(0, Math.min(1, (t.base ?? 0) + sum));
    traits[name] = { value: round(value), evidence };
  }
  const logits: Record<string, number> = {};
  const classEvidence: Record<string, Evidence[]> = {};
  for (const [name, c] of Object.entries(h.classes)) {
    const { sum, evidence } = fire(c.rules, f);
    logits[name] = (c.bias ?? 0) + sum;
    classEvidence[name] = evidence;
  }
  const max = Math.max(...Object.values(logits));
  let z = 0;
  const exps: Record<string, number> = {};
  for (const [k, v] of Object.entries(logits)) {
    exps[k] = Math.exp(v - max);
    z += exps[k];
  }
  const classes: Record<string, number> = {};
  for (const [k, v] of Object.entries(exps)) classes[k] = round(v / z);
  const ranked = Object.entries(classes).sort((a, b) => b[1] - a[1]);
  const top = ranked[0] ?? ['unknown', 0];
  const second = ranked[1] ?? ['', 0];
  return {
    heuristics_version: h.version,
    traits,
    classes,
    likely_class: top[0],
    confidence: round(top[1] - second[1]),
    class_evidence: classEvidence,
  };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
