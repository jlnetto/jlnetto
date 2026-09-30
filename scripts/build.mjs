#!/usr/bin/env node
// Builds the animated SVGs that README.md shows: the hero, the terminal, both
// stack boards and the footer, each in a light and a dark version.
//
//   node scripts/build.mjs
//
// The stack lives in scripts/stack.json. Icons missing from scripts/icons/ are
// downloaded once from the library named in their "icon" field.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(ROOT, 'scripts', 'icons');
const OUT_DIR = join(ROOT, 'assets');

const NAME = 'José Netto';
const TERMINAL = [
  ['whoami', 'José Netto, software engineer in Uberlândia, Brazil'],
  ['stack --today', 'TypeScript, React, NestJS, .NET, Python, GCP and Azure'],
  ['ai --status', 'Building LLM and computer vision pipelines'],
  ['cat ~/after-hours.txt', 'Probably playing games'],
];
const LEGEND = 'How often each one shows up in my recent projects';

// Every image shares this viewBox width, so they all scale by the same factor on the page.
const WIDTH = 720;
// The hero and footer use the geometry of GitHub's contribution graph: 53 weeks of 7 days.
const COLS = 53;
const PITCH = 13.6;
const CELL = 10.6;

// GitHub's contribution graph and text colors (Primer primitives, 2026).
const THEMES = {
  light: {
    fg: '#1f2328',
    muted: '#59636e',
    bg: '#ffffff',
    levels: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'],
    peak: '#044f1e', // one step past the top level, for the hero's passing light
  },
  dark: {
    fg: '#f0f6fc',
    muted: '#9198a1',
    bg: '#0d1117',
    levels: ['#151b23', '#033a16', '#196c2e', '#2ea043', '#56d364'],
    peak: '#aff5b4',
  },
};

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

const ICON_SOURCES = {
  'simple-icons': slug => `https://cdn.jsdelivr.net/npm/simple-icons@16.33.0/icons/${slug}.svg`,
  devicon: path => `https://cdn.jsdelivr.net/gh/devicons/devicon@v2.17.0/icons/${path}.svg`,
  lobehub: slug => `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.95.1/icons/${slug}.svg`,
};

// 5-row pixel glyphs for the hero. Add a letter here if the name needs one.
const GLYPHS = {
  J: ['...#', '...#', '...#', '#..#', '.##.'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
};

// Helvetica advance widths (1/1000 em) for printable ASCII. Labels are laid out with
// these and pinned with textLength, so every platform font lands in the same spot.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];

const fmt = n => +n.toFixed(2);
const pct = (time, total) => `${fmt((time / total) * 100)}%`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textWidth(text, size) {
  const units = [...text.normalize('NFD')].reduce((sum, ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x300 && code <= 0x36f) return sum; // combining accents take no space
    return sum + (HELVETICA[code - 32] ?? 556);
  }, 0);
  return (units * size) / 1000;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Picks whichever of the theme's text or background color reads best on a cell.
const inkOn = (fill, theme) => (contrast(fill, theme.fg) >= contrast(fill, theme.bg) ? theme.fg : theme.bg);

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wraps a drawing in an <svg>. With `card`, it sits on a dark card with `pad` of margin, so
// the phone versions read on both page themes and need no light/dark switch.
function svg({ width = WIDTH, height, pad = 0, card = false, title, css, body }) {
  const w = fmt(width);
  const h = fmt(height + pad * 2);
  const back = card
    ? `<rect x=".5" y=".5" width="${fmt(width - 1)}" height="${fmt(height + pad * 2 - 1)}" rx="10" fill="${THEMES.dark.bg}" stroke="#3d444d"/>\n`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title">
<title id="title">${esc(title)}</title>
<style>
${css.trim()}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>
${back}<g transform="translate(${pad} ${pad})">
${body.trim()}
</g>
</svg>
`;
}

// Breaks text into lines of at most `max` characters, at spaces.
function wrapWords(text, max) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const line = lines.at(-1);
    if (line && line.length + 1 + word.length > max) lines.push(word);
    else lines[lines.length - 1] = line ? `${line} ${word}` : word;
  }
  return lines;
}

async function loadIcon(spec) {
  const [source, id] = spec.split(':');
  const file = join(ICON_DIR, `${source}-${id.replaceAll('/', '-')}.svg`);
  if (!existsSync(file)) {
    const url = ICON_SOURCES[source]?.(id);
    if (!url) throw new Error(`Unknown icon source "${source}" in "${spec}"`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download "${spec}": ${res.status} from ${url}`);
    await writeFile(file, await res.text());
  }
  const raw = await readFile(file, 'utf8');
  const root = raw.match(/<svg[^>]*>/)[0];
  return {
    viewBox: root.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24',
    rules: (root.match(/\s(?:fill-rule|clip-rule)="[^"]*"/g) ?? []).join(''),
    // Keep only the shapes: the board paints every icon in one color.
    inner: raw
      .slice(raw.indexOf(root) + root.length, raw.lastIndexOf('</svg>'))
      .replace(/<title>[\s\S]*?<\/title>|<desc>[\s\S]*?<\/desc>|<!--[\s\S]*?-->/g, '')
      .replace(/\s(?:fill|style|class)="(?!none")[^"]*"/g, '')
      .replace(/>\s+</g, '><')
      .trim(),
  };
}

// Places the name on the grid: letters on rows 1-5, accents on row 0.
function namePixels(name) {
  const tokens = [];
  for (const ch of name.normalize('NFD')) {
    if (ch === ' ') tokens.push(null);
    else if (ch === '\u0301') tokens.at(-1).accent = true;
    else {
      const glyph = GLYPHS[ch.toUpperCase()];
      if (!glyph) throw new Error(`No pixel glyph for "${ch}"; add it to GLYPHS`);
      tokens.push({ glyph });
    }
  }
  const placed = [];
  let width = 0;
  tokens.forEach((token, i) => {
    if (!token) return void (width += 3);
    if (i > 0 && tokens[i - 1]) width += 1;
    placed.push({ ...token, x: width });
    width += token.glyph[0].length;
  });
  const left = Math.floor((COLS - width) / 2);
  const lit = new Set();
  for (const { glyph, accent, x } of placed) {
    glyph.forEach((row, r) => [...row].forEach((px, c) => px === '#' && lit.add(`${left + x + c},${r + 1}`)));
    if (accent) lit.add(`${left + x + Math.floor(glyph[0].length / 2)},0`);
  }
  return lit;
}

function hero(theme) {
  const lit = namePixels(NAME);
  const nearName = (c, r) => [-1, 0, 1].some(dc => [-1, 0, 1].some(dr => lit.has(`${c + dc},${r + dr}`)));
  const rand = mulberry32(21203159);
  const today = new Date().getDay(); // like the real graph, the current week stops at today
  const cells = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < 7; r++) {
      if (c === COLS - 1 && r > today) continue;
      // Keep the texture quiet (levels 0-2, sparser next to the letters) so the name reads first.
      const roll = rand();
      let level;
      if (lit.has(`${c},${r}`)) level = 4;
      else if (nearName(c, r)) level = roll < 0.2 ? 1 : 0;
      else level = roll < 0.55 ? 0 : roll < 0.9 ? 1 : 2;
      cells.push({ c, r, level });
    }
  }
  const pad = 4;
  const height = pad * 2 + 6 * PITCH + CELL;
  const left = (WIDTH - ((COLS - 1) * PITCH + CELL)) / 2;
  const box = ({ c, r }) => `x="${fmt(left + c * PITCH)}" y="${fmt(pad + r * PITCH)}" width="${CELL}" height="${CELL}" rx="2"`;
  // The name fills in left to right; then, every few seconds, a narrow band of light
  // crosses the grid and lifts each active cell one level, like sun over a solar panel.
  const reveal = ({ c, r }) => fmt(0.2 + c * 0.028 + r * 0.012);
  const sweep = ({ c, r }) => fmt(2.6 + c * 0.045 + r * 0.07);
  const shades = [...theme.levels, theme.peak];
  let css = `
@keyframes lit { from { fill: ${theme.levels[0]}; } }`;
  theme.levels.slice(1).forEach((fill, i) => {
    const level = i + 1;
    css += `
.l${level} { animation: lit .5s ease-out both, shine${level} 7s ease-in-out infinite; }
@keyframes shine${level} { 0%, 5%, 100% { fill: ${fill}; } 2% { fill: ${shades[level + 1]}; } }`;
  });
  const body = cells
    .map(cell => {
      const anim = cell.level ? ` class="l${cell.level}" style="animation-delay:${reveal(cell)}s, ${sweep(cell)}s"` : '';
      return `<rect ${box(cell)} fill="${theme.levels[cell.level]}"${anim}/>`;
    })
    .join('\n');
  return svg({ height, title: `${NAME}, written on a GitHub contribution graph`, css, body });
}

function terminal(theme, { width = WIDTH, pad = 0, card = false, size = 13 } = {}) {
  const advance = size * 0.6; // monospace advance; textLength pins every font to it
  const lineHeight = size * 1.7;
  const baseline = card ? size : 25; // on the page, leaves room between the hero and the prompt
  const columns = Math.floor((width - pad * 2) / advance);
  const outputs = TERMINAL.map(([, out]) => wrapWords(out, columns));
  const prompt = '~ $';
  const start = (prompt.length + 1) * advance;
  const slot = 6; // seconds each command stays on screen
  const cycle = slot * TERMINAL.length;
  const typing = 0.075; // seconds per character

  let css = `
text { font-family: ${MONO}; font-size: ${size}px; white-space: pre; }
.prompt, .cursor { fill: ${theme.levels[4]}; }
.cmd, .out { fill: ${theme.fg}; }
.hidden, .caret { opacity: 0; }
.blink { animation: blink 1s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }`;

  const entries = TERMINAL.map(([cmd], i) => {
    const from = i * slot;
    const typeStart = from + 0.6;
    const typeEnd = typeStart + cmd.length * typing;
    const shown = typeEnd + 0.45;
    const until = from + slot - 0.25;
    css += `
.e${i} { animation: e${i} ${cycle}s step-end infinite; }
@keyframes e${i} { 0% { opacity: 0; } ${pct(from, cycle)} { opacity: 1; } ${pct(until, cycle)} { opacity: 0; } }
.c${i} { animation: c${i} ${cycle}s step-end infinite both; }
@keyframes c${i} { 0% { opacity: 0; } ${pct(typeStart, cycle)} { opacity: 1; } ${pct(until, cycle)} { opacity: 0; } }
.o${i} { animation: o${i} ${cycle}s step-end infinite; }
@keyframes o${i} { 0% { opacity: 0; } ${pct(shown, cycle)} { opacity: 1; } ${pct(until, cycle)} { opacity: 0; } }
.k${i} { animation: k${i} ${cycle}s step-end infinite; }
@keyframes k${i} { 0% { opacity: 0; } ${pct(from, cycle)} { opacity: 1; } ${pct(shown, cycle)} { opacity: 0; } }
.m${i} { animation: m${i} ${cycle}s infinite; }
@keyframes m${i} {
  0%, ${pct(typeStart, cycle)} { transform: translateX(0); animation-timing-function: steps(${cmd.length}, jump-start); }
  ${pct(typeEnd, cycle)}, 100% { transform: translateX(${fmt(cmd.length * advance)}px); }
}`;
    const chars = [...cmd]
      .map((ch, k) => `<text class="cmd c${i}" x="${fmt(start + k * advance)}" y="${baseline}" style="animation-delay:${fmt(k * typing)}s">${esc(ch)}</text>`)
      .join('');
    // Without animation (reduced motion), only the first command shows, fully typed.
    return `<g class="e${i}${i ? ' hidden' : ''}">${chars}
${outputs[i]
  .map((line, n) => `<text class="out o${i}" x="0" y="${fmt(baseline + lineHeight * (n + 1))}" textLength="${fmt([...line].length * advance)}" lengthAdjust="spacingAndGlyphs">${esc(line)}</text>`)
  .join('')}
<g class="caret k${i}"><g class="m${i}"><rect class="cursor blink" x="${fmt(start)}" y="${baseline - size * 0.82}" width="${fmt(advance * 0.9)}" height="${fmt(size * 1.05)}"/></g></g></g>`;
  });

  const body = `<text class="prompt" x="0" y="${baseline}">${esc(prompt)}</text>\n${entries.join('\n')}`;
  const title = TERMINAL.map(([cmd, out]) => `$ ${cmd}: ${out}`).join('. ');
  const lines = Math.max(...outputs.map(o => o.length));
  return svg({ width, pad, card, height: baseline + lineHeight * lines + (card ? 2 : 8), title, css, body });
}

// Splits chips into as few lines as fit, then evens the lines out so none is left alone.
function balance(widths, max, gap) {
  const wrap = limit => {
    const lines = [[]];
    let x = 0;
    widths.forEach((w, i) => {
      const line = lines.at(-1);
      if (line.length && x + gap + w > limit) {
        lines.push([i]);
        x = w;
      } else {
        x += (line.length ? gap : 0) + w;
        line.push(i);
      }
    });
    return lines;
  };
  const count = wrap(max).length;
  let lo = Math.max(...widths);
  let hi = max;
  for (let step = 0; step < 24; step++) {
    const mid = (lo + hi) / 2;
    if (wrap(mid).length <= count) hi = mid;
    else lo = mid;
  }
  return wrap(hi);
}

function stackBoard(theme, groups, { title, width = WIDTH, pad = 0, card = false, labelWidth = 0, stacked = false, animate, legend }) {
  // On phones the category sits above its chips, and everything is a notch smaller.
  const dense = stacked;
  const cell = dense ? 20 : 24;
  const icon = dense ? 12 : 15;
  const size = dense ? 12 : 13;
  const labelGap = dense ? 6 : 8;
  const chipGap = dense ? 14 : 20;
  const rowGap = dense ? 8 : 12;
  const groupGap = dense ? 12 : 10;
  const inner = width - pad * 2;
  const centerline = cell / 2 + size * 0.35;
  const parts = [];
  let y = 0;
  let order = 0;

  for (const group of groups) {
    if (group.category && stacked) {
      parts.push(`<text class="cat" x="0" y="${fmt(y + size)}">${esc(group.category)}</text>`);
      y += size + 8;
    } else if (group.category) {
      parts.push(`<text class="cat" x="0" y="${fmt(y + centerline)}">${esc(group.category)}</text>`);
    }
    const chips = group.items.map(item => ({ item, label: textWidth(item.name, size) }));
    for (const line of balance(chips.map(chip => cell + labelGap + chip.label), inner - labelWidth, chipGap)) {
      let x = labelWidth;
      for (const index of line) {
        const { item, label } = chips[index];
        const fill = theme.levels[animate ? item.level : 0];
        const ink = animate ? inkOn(fill, theme) : theme.muted;
        const anim = animate ? ` style="animation-delay:${fmt(0.15 + order++ * 0.035)}s"` : '';
        parts.push(`<g transform="translate(${fmt(x)} ${fmt(y)})">
<rect${animate ? ' class="cell"' : ''} width="${cell}" height="${cell}" rx="${cell / 5}" fill="${fill}"${anim}/>
<svg${animate ? ' class="ico"' : ''} x="${(cell - icon) / 2}" y="${(cell - icon) / 2}" width="${icon}" height="${icon}" viewBox="${item.svg.viewBox}" fill="${ink}"${item.svg.rules}${anim}>${item.svg.inner}</svg>
<text class="name" x="${cell + labelGap}" y="${fmt(centerline)}" textLength="${fmt(label)}" lengthAdjust="spacing">${esc(item.name)}</text>
</g>`);
        x += cell + labelGap + label + chipGap;
      }
      y += cell + rowGap;
    }
    y += groupGap;
  }

  if (legend) {
    // GitHub's own legend: a note on the left, "Less ▪▪▪▪▪ More" on the right. When both
    // don't fit on one line, the scale drops below the note.
    const note = 12;
    const square = 10;
    const noteWidth = textWidth(legend, note);
    const scaleWidth = textWidth('Less', note) + textWidth('More', note) + 10 + 5 * square + 4 * 3;
    const noteBase = y + 4;
    const scaleBase = noteWidth + 24 + scaleWidth > inner ? noteBase + 20 : noteBase;
    const squaresLeft = inner - textWidth('More', note) - 5 - (5 * square + 4 * 3);
    const squares = theme.levels
      .map((fill, i) => `<rect x="${fmt(squaresLeft + i * (square + 3))}" y="${fmt(scaleBase - 9)}" width="${square}" height="${square}" rx="2" fill="${fill}"/>`)
      .join('');
    parts.push(`<text class="note" x="0" y="${fmt(noteBase)}" textLength="${fmt(noteWidth)}" lengthAdjust="spacing">${esc(legend)}</text>
<text class="note" x="${fmt(squaresLeft - 5)}" y="${fmt(scaleBase)}" text-anchor="end">Less</text>${squares}
<text class="note" x="${fmt(inner)}" y="${fmt(scaleBase)}" text-anchor="end">More</text>`);
    y = scaleBase + 8;
  } else {
    y -= rowGap + groupGap;
  }

  const css = `
text { font-family: ${SANS}; }
.cat { font-size: ${size}px; fill: ${theme.muted}; }
.name { font-size: ${size}px; fill: ${animate ? theme.fg : theme.muted}; }
.note { font-size: 12px; fill: ${theme.muted}; }
.cell { animation: lit .6s ease-out both; }
.ico { animation: show .6s ease-out both; }
@keyframes lit { from { fill: ${theme.levels[0]}; } }
@keyframes show { from { opacity: 0; } }`;
  return svg({ width, pad, card, height: y, title, css, body: parts.join('\n') });
}

function footer(theme) {
  const rows = [
    { reach: 0.14, level: 3 }, // top row: only the crest reaches it
    { reach: 0.25, level: 2 },
    { reach: 0.36, level: 1 },
  ];
  const period = 4;
  const wavelength = 20;
  const pad = 2;
  const left = (WIDTH - ((COLS - 1) * PITCH + CELL)) / 2;
  const cells = [];
  let css = '';
  rows.forEach(({ reach, level }, r) => {
    const crest = theme.levels[level];
    css += `
.w${r} { animation: w${r} ${period}s ease-in-out infinite; }
@keyframes w${r} { 0%, 100% { fill: ${crest}; } ${fmt(reach * 100)}%, ${fmt((1 - reach) * 100)}% { fill: ${theme.levels[0]}; } }`;
    for (let c = 0; c < COLS; c++) {
      // A negative delay starts each column mid-wave, so the crest travels left to right.
      const phase = (1 - ((c / wavelength) % 1)) % 1;
      const still = Math.min(phase, 1 - phase) < reach ? crest : theme.levels[0];
      cells.push(`<rect class="w${r}" x="${fmt(left + c * PITCH)}" y="${fmt(pad + r * PITCH)}" width="${CELL}" height="${CELL}" rx="2" fill="${still}" style="animation-delay:${fmt(-phase * period)}s"/>`);
    }
  });
  return svg({ height: pad * 2 + 2 * PITCH + CELL, title: 'A wave moving across contribution graph cells', css, body: cells.join('\n') });
}

async function main() {
  const stack = JSON.parse(await readFile(join(ROOT, 'scripts', 'stack.json'), 'utf8'));
  await mkdir(ICON_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const withIcons = async items => Promise.all(items.map(async item => ({ ...item, svg: await loadIcon(item.icon) })));
  const now = await Promise.all(stack.now.map(async group => ({ ...group, items: await withIcons(group.items) })));
  const before = [{ items: await withIcons(stack.before) }];
  const names = items => items.map(item => item.name).join(', ');
  const nowTitle = `Tech I use today. ${now.map(g => `${g.category}: ${names(g.items)}`).join('. ')}`;
  const beforeTitle = `Tech I have worked with before: ${names(stack.before)}`;
  const write = async (file, content) => {
    await writeFile(join(OUT_DIR, file), content);
    console.log(`assets/${file}  ${(content.length / 1024).toFixed(1)} KB`);
  };

  for (const [name, theme] of Object.entries(THEMES)) {
    const files = {
      [`hero-${name}.svg`]: hero(theme),
      [`terminal-${name}.svg`]: terminal(theme),
      [`stack-now-${name}.svg`]: stackBoard(theme, now, { title: nowTitle, labelWidth: 132, animate: true, legend: LEGEND }),
      [`stack-before-${name}.svg`]: stackBoard(theme, before, { title: beforeTitle, labelWidth: 0, animate: false }),
      [`footer-${name}.svg`]: footer(theme),
    };
    for (const [file, content] of Object.entries(files)) await write(file, content);
  }

  // Phones get narrower versions of the text-heavy images, so their labels stay readable.
  const phone = { width: 360, pad: 16, card: true };
  await write('terminal-mobile.svg', terminal(THEMES.dark, { ...phone, size: 11.5 }));
  await write('stack-now-mobile.svg', stackBoard(THEMES.dark, now, { ...phone, title: nowTitle, stacked: true, animate: true, legend: LEGEND }));
  await write('stack-before-mobile.svg', stackBoard(THEMES.dark, before, { ...phone, title: beforeTitle, stacked: true, animate: false }));

  // Screen readers get the README's alt text, not the SVG title, so keep both in sync.
  const readmePath = join(ROOT, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const synced = readme
    .replace(/(stack-now-light\.svg"[^>]*? alt=")[^"]*/, `$1${esc(nowTitle)}`)
    .replace(/(stack-before-light\.svg"[^>]*? alt=")[^"]*/, `$1${esc(beforeTitle)}`);
  if (synced !== readme) {
    await writeFile(readmePath, synced);
    console.log('README.md  alt text updated');
  }
}

await main();
