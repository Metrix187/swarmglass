import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseArgs, str, usage } from './_cli.ts';

// turns a report folder (summary.md + charts/*.svg) into a quantara.cv article using the site's
// own template, so a finding can go from telemetry to /articles/ without hand-copying html.
//   npm run article -- --report reports/SGX-001-2026-09-05 --slug swarmglass-discovery-channels --title "…" [--template D:/quantara-site/templates/article.html]
const { flags } = parseArgs(process.argv.slice(2));
const reportDir = str(flags, 'report', '');
const slug = str(flags, 'slug', '');
const title = str(flags, 'title', '');
if (!reportDir || !slug || !title) usage(['usage: article --report DIR --slug my-article --title "Title" [--summary "…"] [--template PATH] [--out DIR]']);
const template = str(flags, 'template', 'D:/quantara-site/templates/article.html');
if (!existsSync(template)) usage([`template not found: ${template} (pass --template)`]);
const md = readFileSync(join(reportDir, 'summary.md'), 'utf8');
let html = readFileSync(template, 'utf8');

// strip the template's own header comment and the optional blocks we don't use
html = html.replace(/<!--\s*\n\s*quantara article template\.[\s\S]*?-->\n/, '');
html = html.replace(/[ \t]*<!--\s*OPTIONAL:pdf\b[\s\S]*?\/OPTIONAL:pdf\s*-->[ \t]*\r?\n?/, '');
html = html.replace(/[ \t]*<!--\s*OPTIONAL:audio\b[\s\S]*?\/OPTIONAL:audio\s*-->[ \t]*\r?\n?/, '');

// body: the markdown summary → article html, charts inlined as viz blocks
const body = mdToArticleHtml(md, reportDir);
html = html.replace(/<div class="content-body">[\s\S]*?<div class="article-footer">/, `<div class="content-body">\n${body}\n<div class="article-footer">`);
const today = new Date();
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const tokens: Record<string, string> = {
  TITLE: title,
  SUMMARY: str(flags, 'summary', 'Observations from the Swarmglass passive agent-behaviour observatory. Heuristic labels, stated evidence, no identity claims.'),
  CATEGORY: 'Research',
  KIND: 'Swarmglass findings',
  DATE: `${months[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`,
  YEAR: String(today.getFullYear()),
  PDF: '',
  AUDIO: '',
};
for (const [k, v] of Object.entries(tokens)) html = html.split(`{{${k}}}`).join(v);
const outDir = str(flags, 'out', reportDir);
const file = join(outDir, `${slug}.html`);
writeFileSync(file, html);
console.log(`article written: ${file}\ncopy it to D:/quantara-site/site/articles/${slug}.html, add a card on the homepage, then push.`);

function mdToArticleHtml(src: string, dir: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const out: string[] = [];
  const lines = src.split(/\r?\n/);
  let i = 0;
  let sec = 0;
  while (i < lines.length) {
    const l = lines[i] as string;
    if (/^# /.test(l)) {
      i++;
      continue; // title handled by the template
    }
    const h2 = l.match(/^## (.+)/);
    if (h2) {
      sec++;
      out.push(`<h2 id="sec-${sec}">${inline(h2[1] as string).toLowerCase()}</h2>`);
      i++;
      continue;
    }
    const img = l.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (img) {
      const svgPath = join(dir, img[2] as string);
      const svg = existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : '';
      out.push(`<div class="viz-block"><div class="viz-title">${esc(img[1] as string)}</div><div class="chart-scroll">${svg}</div></div>`);
      i++;
      continue;
    }
    if (/^\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i] as string)) {
        rows.push((lines[i] as string).replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      const head = rows[0] ?? [];
      const bodyRows = rows.slice(2);
      out.push(`<div class="viz-block"><table class="wikitable" style="width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12px"><thead><tr>${head.map((c) => `<th style="text-align:left;border-bottom:1px solid var(--hair);padding:6px">${inline(c)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid var(--hair);padding:6px">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^> /.test(l)) {
      out.push(`<p class="pull-quote">${inline(l.slice(2))}</p>`);
      i++;
      continue;
    }
    if (/^- /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i] as string)) {
        items.push(`<li>${inline((lines[i] as string).slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (l.trim() === '') {
      i++;
      continue;
    }
    out.push(`<p>${inline(l)}</p>`);
    i++;
  }
  return out.join('\n');
}

void basename;
void readdirSync;
