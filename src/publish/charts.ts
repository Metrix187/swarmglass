import { esc } from '../http/html.ts';

// tiny svg chart helpers for reports. deliberately plain: they need to survive being pasted
// into an article on quantara.cv, which styles svg text with its own css classes.

const PAL = ['#D6336C', '#A78BFA', '#5E3448', '#F06595', '#8B6FE8', '#A2718A', '#E8B6CB', '#2E0F1E'];

export function barChart(title: string, rows: Array<{ label: string; value: number; ci?: [number, number] | null }>, opts: { width?: number; max?: number; format?: (v: number) => string } = {}): string {
  const W = opts.width ?? 640;
  const rowH = 26;
  const H = 40 + rows.length * rowH + 10;
  const labelW = 210;
  const max = opts.max ?? Math.max(1e-9, ...rows.map((r) => (r.ci ? r.ci[1] : r.value)));
  const fmt = opts.format ?? ((v: number) => String(Math.round(v * 100) / 100));
  const barW = W - labelW - 80;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Menlo, monospace" font-size="12">
<text x="0" y="16" class="label" font-weight="600">${esc(title)}</text>`;
  rows.forEach((r, i) => {
    const y = 34 + i * rowH;
    const w = Math.max(0, (r.value / max) * barW);
    svg += `<text x="${labelW - 8}" y="${y + 15}" text-anchor="end">${esc(r.label.slice(0, 32))}</text>`;
    svg += `<rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="18" fill="${PAL[i % PAL.length]}" opacity="0.85" rx="2"/>`;
    if (r.ci) {
      const x1 = labelW + (r.ci[0] / max) * barW;
      const x2 = labelW + (r.ci[1] / max) * barW;
      svg += `<line x1="${x1.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${y + 12}" y2="${y + 12}" stroke="#2E0F1E" stroke-width="1.5"/><line x1="${x1.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${y + 7}" y2="${y + 17}" stroke="#2E0F1E"/><line x1="${x2.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${y + 7}" y2="${y + 17}" stroke="#2E0F1E"/>`;
    }
    svg += `<text x="${labelW + barW + 8}" y="${y + 15}" class="note">${esc(fmt(r.value))}</text>`;
  });
  return svg + '</svg>';
}

export function stackedBars(title: string, rows: Array<{ label: string; parts: Record<string, number> }>, keys: string[], opts: { width?: number } = {}): string {
  const W = opts.width ?? 640;
  const rowH = 26;
  const H = 40 + rows.length * rowH + 30;
  const labelW = 210;
  const barW = W - labelW - 20;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Menlo, monospace" font-size="12">
<text x="0" y="16" class="label" font-weight="600">${esc(title)}</text>`;
  rows.forEach((r, i) => {
    const y = 34 + i * rowH;
    const total = Math.max(1, keys.reduce((a, k) => a + (r.parts[k] ?? 0), 0));
    let x = labelW;
    svg += `<text x="${labelW - 8}" y="${y + 15}" text-anchor="end">${esc(r.label.slice(0, 32))}</text>`;
    keys.forEach((k, ki) => {
      const w = ((r.parts[k] ?? 0) / total) * barW;
      if (w > 0) svg += `<rect x="${x.toFixed(1)}" y="${y + 3}" width="${w.toFixed(1)}" height="18" fill="${PAL[ki % PAL.length]}" opacity="0.85"><title>${esc(k)}: ${r.parts[k] ?? 0}</title></rect>`;
      x += w;
    });
  });
  const ly = 34 + rows.length * rowH + 14;
  let lx = labelW;
  keys.forEach((k, ki) => {
    svg += `<rect x="${lx}" y="${ly - 9}" width="10" height="10" fill="${PAL[ki % PAL.length]}"/><text x="${lx + 14}" y="${ly}" class="note">${esc(k)}</text>`;
    lx += 14 + k.length * 7 + 16;
  });
  return svg + '</svg>';
}

export function cdfChart(title: string, series: Array<{ label: string; values: number[] }>, opts: { width?: number; xLabel?: string } = {}): string {
  const W = opts.width ?? 640;
  const H = 260;
  const pad = { l: 50, r: 20, t: 30, b: 40 };
  const all = series.flatMap((s) => s.values);
  const maxX = Math.max(1, ...all);
  const sx = (v: number) => pad.l + (Math.log10(1 + v) / Math.log10(1 + maxX)) * (W - pad.l - pad.r);
  const sy = (p: number) => pad.t + (1 - p) * (H - pad.t - pad.b);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Menlo, monospace" font-size="12">
<text x="0" y="16" class="label" font-weight="600">${esc(title)}</text>
<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="#E8B6CB"/><line x1="${pad.l}" x2="${pad.l}" y1="${sy(0)}" y2="${sy(1)}" stroke="#E8B6CB"/>`;
  for (const p of [0.25, 0.5, 0.75, 1]) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(p)}" y2="${sy(p)}" stroke="#F3CFDD" stroke-dasharray="2 4"/><text x="${pad.l - 6}" y="${sy(p) + 4}" text-anchor="end" class="note">${p}</text>`;
  for (const v of [1, 10, 60, 600, 3600].filter((x) => x <= maxX)) svg += `<text x="${sx(v)}" y="${H - pad.b + 16}" text-anchor="middle" class="note">${v}s</text>`;
  svg += `<text x="${(W + pad.l) / 2}" y="${H - 6}" text-anchor="middle" class="note">${esc(opts.xLabel ?? 'seconds (log)')}</text>`;
  series.forEach((s, i) => {
    const vals = [...s.values].sort((a, b) => a - b);
    if (!vals.length) return;
    let d = `M ${sx(0)} ${sy(0)}`;
    vals.forEach((v, k) => {
      d += ` L ${sx(v).toFixed(1)} ${sy((k + 1) / vals.length).toFixed(1)}`;
    });
    svg += `<path d="${d}" fill="none" stroke="${PAL[i % PAL.length]}" stroke-width="2"/>`;
    svg += `<rect x="${W - pad.r - 160}" y="${pad.t + i * 16 - 8}" width="10" height="10" fill="${PAL[i % PAL.length]}"/><text x="${W - pad.r - 146}" y="${pad.t + i * 16}" class="note">${esc(s.label)} (n=${vals.length})</text>`;
  });
  return svg + '</svg>';
}

export function matrixChart(title: string, rows: string[], cols: string[], cells: Record<string, Record<string, number>>, opts: { width?: number } = {}): string {
  const W = opts.width ?? 720;
  const labelW = 170;
  const cellW = Math.max(40, Math.floor((W - labelW) / Math.max(1, cols.length)));
  const cellH = 24;
  const H = 60 + rows.length * cellH;
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => cells[r]?.[c] ?? 0)));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Menlo, monospace" font-size="11">
<text x="0" y="16" class="label" font-weight="600">${esc(title)}</text>`;
  cols.forEach((c, j) => {
    svg += `<text x="${labelW + j * cellW + cellW / 2}" y="${44}" text-anchor="middle" class="note">${esc(c.replace(/_only/, '').slice(0, 9))}</text>`;
  });
  rows.forEach((r, i) => {
    const y = 50 + i * cellH;
    svg += `<text x="${labelW - 8}" y="${y + 16}" text-anchor="end">${esc(r.slice(0, 24))}</text>`;
    cols.forEach((c, j) => {
      const v = cells[r]?.[c] ?? 0;
      const a = v ? 0.15 + 0.85 * (v / max) : 0;
      svg += `<rect x="${labelW + j * cellW}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" fill="#D6336C" opacity="${a.toFixed(2)}" stroke="#F3CFDD"/>`;
      if (v) svg += `<text x="${labelW + j * cellW + cellW / 2}" y="${y + 16}" text-anchor="middle" fill="${a > 0.55 ? '#fff' : '#2E0F1E'}">${v}</text>`;
    });
  });
  return svg + '</svg>';
}

export function propagationGraph(title: string, nodes: Array<{ id: string; kind: 'canary' | 'session' | 'external' }>, edges: Array<{ from: string; to: string; label?: string }>, opts: { width?: number } = {}): string {
  const W = opts.width ?? 720;
  const cols: Record<string, number> = { canary: 0, session: 1, external: 2 };
  const byCol: Record<number, string[]> = { 0: [], 1: [], 2: [] };
  for (const n of nodes) (byCol[cols[n.kind] ?? 1] as string[]).push(n.id);
  const rowsMax = Math.max(1, ...Object.values(byCol).map((a) => a.length));
  const H = 50 + rowsMax * 26;
  const pos = new Map<string, [number, number]>();
  for (const [c, ids] of Object.entries(byCol)) ids.forEach((id, i) => pos.set(id, [90 + Number(c) * ((W - 180) / 2), 44 + i * 26]));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Menlo, monospace" font-size="11">
<text x="0" y="16" class="label" font-weight="600">${esc(title)}</text>`;
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    svg += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#A78BFA" stroke-width="1.5" opacity="0.8"/>`;
  }
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const fill = n.kind === 'canary' ? '#D6336C' : n.kind === 'external' ? '#2E0F1E' : '#F06595';
    svg += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${fill}"/><text x="${p[0] + 9}" y="${p[1] + 4}" class="note">${esc(n.id.replace('QUANTARA-SWARMGLASS-', '').slice(0, 22))}</text>`;
  }
  return svg + '</svg>';
}
