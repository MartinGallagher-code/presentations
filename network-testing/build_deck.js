// build_deck.js -- generates network_testing.pptx
// A talk on network testing with iperf_orchestrator, matrix_orchestrator (mx)
// and netmesh, with binnacle's `reachable` keeping the server list honest.
'use strict';

const pptxgen = require('pptxgenjs');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const Fi = require('react-icons/fi');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- palette --
const NAVY   = '0F1C2E';  // dominant dark (title/section/closing)
const NAVY2  = '16283E';  // card on dark
const CODEBG = '13233A';  // code block background
const INK    = '1C2B3A';  // body text on light
const MUTED  = '5C6B7A';  // secondary text on light
const FOG    = '9FB0C1';  // secondary text on dark
const PAPER  = 'FFFFFF';
const FAINT  = 'F1F4F8';  // card tint on light
const LINE   = 'DCE4EC';

const AMBER  = 'D97C1F';  // iperf_orchestrator -- bandwidth heat
const AMBERD = 'B4651A';
const CRIM   = 'BE3B4E';  // matrix_orchestrator -- pps
const CRIMD  = '9C2F40';
const TEAL   = '12897B';  // netmesh -- idle baseline
const TEALD  = '0E6E63';
const GREEN  = '3D8B4F';  // reachable -- list hygiene
const SLATE  = '3E5C76';  // neutral accent

const F  = 'Calibri';
const FM = 'Courier New';

const W = 13.33, H = 7.5, MARG = 0.62;

// ------------------------------------------------------------------- icons --
const ICON_DIR = path.join(__dirname, '.icons');
const ICONS = {
  terminal: Fi.FiTerminal,  shield:  Fi.FiShield,   trash:   Fi.FiTrash2,
  check:    Fi.FiCheckCircle, file:  Fi.FiFileText, server:  Fi.FiServer,
  layers:   Fi.FiLayers,    activity: Fi.FiActivity, cpu:    Fi.FiCpu,
  clock:    Fi.FiClock,     zap:     Fi.FiZap,      sliders: Fi.FiSliders,
  shuffle:  Fi.FiShuffle,   key:     Fi.FiKey,      search:  Fi.FiSearch,
  alert:    Fi.FiAlertTriangle, list: Fi.FiList,    compass: Fi.FiCompass,
  wifi:     Fi.FiWifi,      arrow:   Fi.FiArrowRight, target: Fi.FiTarget,
  gitmerge: Fi.FiGitMerge,  eye:     Fi.FiEye,      refresh: Fi.FiRefreshCw,
};

async function renderIcons() {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  for (const [name, Comp] of Object.entries(ICONS)) {
    const svg = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Comp, { color: '#FFFFFF', size: 256, strokeWidth: 1.8 })
    );
    await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(path.join(ICON_DIR, name + '.png'));
  }
}

// ----------------------------------------------------------------- helpers --
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Martin Gallagher';
pres.title = 'Network Testing at Fleet Scale';

function darkSlide() { const s = pres.addSlide(); s.background = { color: NAVY }; return s; }
function lightSlide() { const s = pres.addSlide(); s.background = { color: PAPER }; return s; }

// kicker + title header on light slides
function header(s, kicker, title, accent) {
  s.addText(kicker.toUpperCase(), {
    x: MARG, y: 0.42, w: W - 2 * MARG, h: 0.3, fontFace: F, fontSize: 11,
    bold: true, color: accent, charSpacing: 3, margin: 0,
  });
  s.addText(title, {
    x: MARG, y: 0.68, w: W - 2 * MARG, h: 0.62, fontFace: F, fontSize: 29,
    bold: true, color: INK, margin: 0,
  });
}

// deterministic mini-heatmap motif
function heatGrid(s, x, y, n, cell, gap, opts) {
  const o = opts || {};
  const base = o.base || 'E8EEF5';
  const hot = o.hot || AMBER;
  const mid = o.mid || SLATE;
  const seed = o.seed || 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const r = (i * 7 + j * 13 + seed * 5) % 17;
      let c = base;
      if (r === 3 || r === 11) c = hot;
      else if (r === 6 || r === 14) c = mid;
      s.addShape('roundRect', {
        x: x + j * (cell + gap), y: y + i * (cell + gap), w: cell, h: cell,
        fill: { color: c }, rectRadius: cell * 0.18, line: { type: 'none' },
      });
    }
  }
}

function iconChip(s, name, x, y, d, color) {
  s.addShape('ellipse', { x: x, y: y, w: d, h: d, fill: { color: color }, line: { type: 'none' } });
  const pad = d * 0.26;
  s.addImage({ path: path.join(ICON_DIR, name + '.png'), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad });
}

// rows of icon + bold header + description
function iconRows(s, rows, x, y, w, rowH, accent) {
  rows.forEach((r, i) => {
    const ry = y + i * rowH;
    iconChip(s, r.icon, x, ry + 0.02, 0.44, r.color || accent);
    s.addText(r.head, { x: x + 0.62, y: ry - 0.06, w: w - 0.62, h: 0.32, fontFace: F, fontSize: 14.5, bold: true, color: INK, margin: 0 });
    s.addText(r.body, { x: x + 0.62, y: ry + 0.24, w: w - 0.62, h: rowH - 0.28, fontFace: F, fontSize: 12, color: MUTED, margin: 0 });
  });
}

function card(s, x, y, w, h, fill) {
  s.addShape('roundRect', { x: x, y: y, w: w, h: h, fill: { color: fill || FAINT }, line: { type: 'none' }, rectRadius: 0.09 });
}

// code block: lines = arrays of {t, c, b}
function codeBlock(s, x, y, w, h, lines, fsz) {
  s.addShape('roundRect', { x: x, y: y, w: w, h: h, fill: { color: CODEBG }, line: { type: 'none' }, rectRadius: 0.09 });
  const runs = [];
  lines.forEach((line, li) => {
    line.forEach((seg, si) => {
      runs.push({
        text: seg.t,
        options: {
          color: seg.c || 'E8EEF6', bold: !!seg.b,
          breakLine: si === line.length - 1 && li !== lines.length - 1 ? true : (si === line.length - 1),
        },
      });
    });
  });
  // last run should not force an extra line; simplest: set breakLine true on all line-enders except final
  s.addText(runs, {
    x: x + 0.22, y: y + 0.14, w: w - 0.44, h: h - 0.28, fontFace: FM,
    fontSize: fsz || 11.5, color: 'E8EEF6', margin: 0, valign: 'top', lineSpacingMultiple: 1.12,
  });
}

function bullets(s, items, x, y, w, h, opt) {
  const o = opt || {};
  const arr = items.map((it, i) => ({
    text: it,
    options: { bullet: { code: '2022', indent: 12 }, breakLine: i !== items.length - 1, paraSpaceAfter: o.space == null ? 8 : o.space },
  }));
  s.addText(arr, { x: x, y: y, w: w, h: h, fontFace: F, fontSize: o.size || 13, color: o.color || INK, margin: 0, valign: 'top' });
}

function noteText(s, txt) { s.addNotes(txt); }

// section divider
function divider(num, title, sub, accent, notes) {
  const s = darkSlide();
  heatGrid(s, 9.0, 1.5, 7, 0.52, 0.12, { base: NAVY2, hot: accent, mid: '223650', seed: num });
  s.addText(num < 10 ? '0' + num : String(num), { x: MARG, y: 1.7, w: 3, h: 1.4, fontFace: F, fontSize: 84, bold: true, color: accent, margin: 0 });
  s.addText(title, { x: MARG, y: 3.15, w: 8.2, h: 0.85, fontFace: F, fontSize: 40, bold: true, color: PAPER, margin: 0 });
  s.addText(sub, { x: MARG, y: 4.05, w: 7.9, h: 0.9, fontFace: F, fontSize: 16, color: FOG, margin: 0 });
  if (notes) noteText(s, notes);
  return s;
}

// small tool tag used on content slides (top-right)
function toolTag(s, label, accent) {
  const w = 2.5;
  s.addText(label, {
    x: W - MARG - w, y: 0.46, w: w, h: 0.3, align: 'right', fontFace: FM,
    fontSize: 11, bold: true, color: accent, margin: 0,
  });
}

// ================================================================== SLIDES ==
async function build() {
  await renderIcons();

  // -- 1 · Title ------------------------------------------------------------
  {
    const s = darkSlide();
    heatGrid(s, 8.35, 0.95, 8, 0.6, 0.13, { base: NAVY2, hot: AMBER, mid: '25405E', seed: 2 });
    heatGrid(s, 10.9, 4.6, 4, 0.42, 0.1, { base: NAVY2, hot: TEAL, mid: '223650', seed: 7 });
    s.addText('FLEET NETWORK TESTING', { x: MARG, y: 1.55, w: 7.4, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: AMBER, charSpacing: 4, margin: 0 });
    s.addText('Load it. Measure it.\nLeave no trace.', { x: MARG, y: 1.95, w: 7.6, h: 1.95, fontFace: F, fontSize: 44, bold: true, color: PAPER, margin: 0, lineSpacingMultiple: 1.02 });
    s.addText([
      { text: 'iperf_orchestrator', options: { color: AMBER, bold: true } },
      { text: '  ·  ', options: { color: FOG } },
      { text: 'matrix_orchestrator', options: { color: CRIM, bold: true } },
      { text: '  ·  ', options: { color: FOG } },
      { text: 'netmesh', options: { color: TEAL, bold: true } },
    ], { x: MARG, y: 4.1, w: 7.8, h: 0.4, fontFace: FM, fontSize: 16, margin: 0 });
    s.addText('…with binnacle’s reachable keeping the server list honest,\nso the run survives the servers that are down.', {
      x: MARG, y: 4.62, w: 7.6, h: 0.8, fontFace: F, fontSize: 14.5, italic: true, color: FOG, margin: 0 });
    s.addText('Martin Gallagher', { x: MARG, y: 6.35, w: 5, h: 0.3, fontFace: F, fontSize: 13, bold: true, color: PAPER, margin: 0 });
    noteText(s,
      'Welcome. This talk is about answering one question -- "is the network the problem?" -- at fleet scale, with three small tools that share one design language. ' +
      'iperf_orchestrator measures TCP bandwidth under load. matrix_orchestrator measures request/response packets per second under load. netmesh measures the idle baseline that the other two numbers have to be read against. ' +
      'And because every one of them fans out over a server list, binnacle’s reachable keeps that list true, so a run still works when several servers are down -- a theme we’ll return to.');
  }

  // -- 2 · Overview: three questions ---------------------------------------
  {
    const s = lightSlide();
    header(s, 'Overview', 'Three questions, one family of tools', SLATE);
    const cw = 3.9, ch = 4.35, gap = 0.2, y0 = 1.62;
    const cards = [
      { name: 'netmesh', color: TEAL, icon: 'activity', q: 'What does the network do when it is idle?',
        pts: ['RTT, jitter, loss, path MTU between hosts', 'UDP echoes between temporary agents', '~10 small packets/s per pair — safe on production', 'The baseline every other number is read against'] },
      { name: 'iperf_orchestrator', color: AMBER, icon: 'zap', q: 'How much TCP bandwidth, everywhere at once?',
        pts: ['Full-mesh iperf2 throughput sweep', 'Every link loaded in both directions', 'CSV, pivot table, heatmap + CPU samples', 'Fabric stress testing: find what breaks'] },
      { name: 'matrix_orchestrator', color: CRIM, icon: 'shuffle', q: 'How many packets per second, when every packet is answered?',
        pts: ['Request/response UDP traffic matrix', 'pps headline, loss split by direction', 'Round-trip time falls out for free', 'The shape of real RPC / storage traffic'] },
    ];
    cards.forEach((c, i) => {
      const x = MARG + i * (cw + gap);
      card(s, x, y0, cw, ch, FAINT);
      iconChip(s, c.icon, x + 0.3, y0 + 0.3, 0.52, c.color);
      s.addText(c.name, { x: x + 0.98, y: y0 + 0.36, w: cw - 1.1, h: 0.4, fontFace: FM, fontSize: 13.5, bold: true, color: c.color, margin: 0 });
      s.addText(c.q, { x: x + 0.3, y: y0 + 1.02, w: cw - 0.6, h: 0.95, fontFace: F, fontSize: 14.5, bold: true, color: INK, margin: 0 });
      bullets(s, c.pts, x + 0.3, y0 + 2.05, cw - 0.55, ch - 2.2, { size: 11.5, color: MUTED, space: 6 });
    });
    s.addText('Same servers.txt grammar · same ssh-only model · grids that open in the same spreadsheet and read the same way', {
      x: MARG, y: 6.35, w: W - 2 * MARG, h: 0.4, align: 'center', fontFace: F, fontSize: 13, italic: true, color: SLATE, margin: 0 });
    noteText(s,
      'The frame for the whole talk. Network testing here means measuring the fabric between a fleet of Linux boxes over plain ssh. ' +
      'Three different questions: the idle baseline (netmesh), TCP bandwidth under load (iperf_orchestrator), and request/response packet rate under load (matrix_orchestrator). ' +
      'They are deliberately one family: the same host-list grammar, the same deploy-over-ssh model, and N-by-N grid outputs that read identically -- a dark row is a sick sender, a dark column a sick receiver.');
  }

  // -- 3 · Why these tools --------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'Overview', 'Why these tools', SLATE);
    const colW = (W - 2 * MARG - 0.5) / 2;
    const rowsL = [
      { icon: 'shield', color: SLATE, head: 'No agents, no daemons, no root', body: 'Plain Python + ssh. Nothing is installed on the servers, no package, no sysctl, no unit file.' },
      { icon: 'trash', color: SLATE, head: 'Leave no trace', body: 'Everything lives in one remote directory. clean deletes it and refuses to report success until it is verifiably gone.' },
      { icon: 'check', color: SLATE, head: 'Honest numbers', body: 'Blank means "not measured", never zero. DELIVERED (what arrived) outranks what was sent. Causes outrank symptoms.' },
    ];
    const rowsR = [
      { icon: 'file', color: SLATE, head: 'One self-contained file each', body: 'scp-able, stdlib-only. Run from a checkout with zero install, or pip install for a PATH command.' },
      { icon: 'server', color: SLATE, head: 'Built for fleets', body: 'Capped parallel ssh fan-out, balanced load assignment, batched collection — patterns proven at N=100+.' },
      { icon: 'layers', color: SLATE, head: 'They compose', body: 'Shared servers.txt grammar and matching grid outputs — prune with reachable, baseline with netmesh, then load.' },
    ];
    iconRows(s, rowsL, MARG, 1.75, colW, 1.55, SLATE);
    iconRows(s, rowsR, MARG + colW + 0.5, 1.75, colW, 1.55, SLATE);
    s.addText('The alternative is a week of hand-run iperf, ad-hoc pssh loops, and numbers nobody trusts.', {
      x: MARG, y: 6.5, w: W - 2 * MARG, h: 0.4, align: 'center', fontFace: F, fontSize: 13.5, italic: true, color: MUTED, margin: 0 });
    noteText(s,
      'Why these tools rather than vendor test suites or hand-driven iperf? Three design rules run through all of them. ' +
      'First, they drop onto any host you can ssh to -- no agents, no root, and they clean up after themselves, which is what makes them usable on production fleets. ' +
      'Second, the numbers are honest by construction: missing data is blank rather than zero, and the receiver’s count is the headline, not the sender’s. ' +
      'Third, they compose: one server list drives all of them, so a pipeline like reachable, then netmesh, then a load test is three commands, not three integrations.');
  }

  // -- 4 · What each measures ----------------------------------------------
  {
    const s = lightSlide();
    header(s, 'Overview', 'What each tool is actually measuring', SLATE);
    const rows = [
      [
        { text: 'Tool', options: { bold: true, color: PAPER } },
        { text: 'Traffic', options: { bold: true, color: PAPER } },
        { text: 'Headline number', options: { bold: true, color: PAPER } },
        { text: 'Network state', options: { bold: true, color: PAPER } },
        { text: 'Footprint', options: { bold: true, color: PAPER } },
      ],
      ['netmesh', 'UDP echo probes\n(agents both ends)', 'RTT p50/p99, jitter, loss split, path MTU', 'Idle — the baseline', '~10 pkts/s per pair;\nsafe during incidents'],
      ['iperf_orchestrator', 'TCP, full-duplex\n(iperf2)', 'Mbps per direction, per pair + peak CPU', 'Saturated — as loaded as it gets', 'Line-rate flood;\nschedule a window'],
      ['matrix_orchestrator', 'UDP request/response\n(paced)', 'pps + Gbps wire, loss by leg, true RTT', 'Loaded at the rate you asked for', 'Tunable, from gentle\nto torture test'],
    ];
    const accents = [null, TEAL, AMBER, CRIM];
    const tbl = rows.map((r, ri) => r.map((c, ci) => {
      if (ri === 0) return { text: c.text, options: { fill: { color: NAVY }, color: PAPER, bold: true, fontSize: 12.5, valign: 'middle' } };
      const base = { fontSize: 12, color: ci === 0 ? accents[ri] : INK, bold: ci === 0, fontFace: ci === 0 ? FM : F, valign: 'middle', fill: { color: ri % 2 ? PAPER : FAINT } };
      return { text: c, options: base };
    }));
    s.addTable(tbl, {
      x: MARG, y: 1.75, w: W - 2 * MARG, colW: [2.5, 2.35, 3.35, 2.35, 1.54].map(v => v * (W - 2 * MARG) / 12.09),
      border: { type: 'solid', color: LINE, pt: 0.75 }, rowH: [0.5, 1.0, 1.0, 1.0], fontFace: F, margin: 0.09, valign: 'middle',
    });
    s.addText([
      { text: 'Different layers of the same fabric.  ', options: { bold: true, color: INK } },
      { text: 'A 9.4 Gbit/s iperf result at 300 µs idle RTT and one at 42 ms are different results — you need more than one of these numbers to know which you have.', options: { color: MUTED } },
    ], { x: MARG, y: 6.15, w: W - 2 * MARG, h: 0.75, fontFace: F, fontSize: 13, margin: 0 });
    noteText(s,
      'The differences in one view. netmesh is latency-and-loss on an idle network -- cheap enough to run during an incident. ' +
      'iperf_orchestrator is TCP goodput with everything saturated -- that is a flood, so you schedule it. ' +
      'mx is packet rate with a reply required for every request -- paced at whatever rate you choose, and because the reply carries the request’s timestamp back, RTT comes out with no clock sync. ' +
      'Point to make: these are complements, not competitors. Bandwidth, packet rate, and latency fail independently, and each tool sees what the others cannot.');
  }

  // -- 5 · When to use which ------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'Overview', 'When to reach for which', SLATE);
    const rows = [
      { color: GREEN, tool: 'reachable', when: 'Before any fan-out — every time', why: 'Prune dead entries so the run measures the fleet, not the list.' },
      { color: TEAL, tool: 'netmesh', when: '“Is it the network?” — incidents, new fabric, before blaming anything', why: 'Idle baseline; prod-safe; splits loss by direction; finds MTU black holes and sick LAG members.' },
      { color: AMBER, tool: 'iperf_orchestrator', when: 'Fabric acceptance & stress — “will it carry line rate?”', why: 'Loads every link both directions at once; heatmap shows the slow rows/columns.' },
      { color: CRIM, tool: 'matrix_orchestrator', when: 'RPC-shaped capacity — “how many answered packets/sec?”', why: 'Small packets at rate is where fabrics and NICs actually fall over.' },
    ];
    let y = 1.65;
    rows.forEach(r => {
      card(s, MARG, y, W - 2 * MARG, 1.02, FAINT);
      s.addShape('roundRect', { x: MARG + 0.18, y: y + 0.18, w: 2.5, h: 0.66, fill: { color: r.color }, line: { type: 'none' }, rectRadius: 0.07 });
      s.addText(r.tool, { x: MARG + 0.18, y: y + 0.18, w: 2.5, h: 0.66, align: 'center', valign: 'middle', fontFace: FM, fontSize: 13, bold: true, color: PAPER, margin: 0 });
      s.addText(r.when, { x: MARG + 2.95, y: y + 0.12, w: 4.75, h: 0.82, fontFace: F, fontSize: 12.5, bold: true, color: INK, margin: 0, valign: 'middle' });
      s.addText(r.why, { x: MARG + 7.9, y: y + 0.12, w: W - 2 * MARG - 8.1, h: 0.82, fontFace: F, fontSize: 11.5, color: MUTED, margin: 0, valign: 'middle' });
      y += 1.14;
    });
    s.addText([
      { text: 'Commissioning a new fabric?  Run them in order:  ', options: { color: INK, bold: true } },
      { text: 'reachable → netmesh → iperf_orchestrator → mx → netmesh under load', options: { color: SLATE, bold: true, fontFace: FM } },
    ], { x: MARG, y: 6.42, w: W - 2 * MARG, h: 0.45, fontFace: F, fontSize: 13.5, margin: 0, align: 'center' });
    noteText(s,
      'The decision guide. reachable is not optional ceremony -- it is what makes the rest reliable on a real, decaying server list. ' +
      'netmesh answers "is it the network at all, and which link" -- it is the one you can run mid-incident. ' +
      'iperf_orchestrator is the acceptance and stress tool: schedule it, flood everything, read the heatmap. ' +
      'mx is for request/response capacity -- pps, not bytes -- which is how RPC, storage and control-plane traffic actually stresses a fabric. ' +
      'For a new fabric, run all of them in that order; each one’s output tells you whether the next one’s numbers make sense.');
  }

  // -- 6 · reachable --------------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'binnacle · reachable', 'A run that survives dead servers', GREEN);
    toolTag(s, 'pip install binnacle', GREEN);
    bullets(s, [
      'Server lists rot: boxes get decommissioned, renamed, rebuilt without your key. A fan-out that silently skips 11 of 200 hosts looks identical to one that had nothing to say.',
      'reachable pings and ssh’s every entry, then comments out failures — with the reason and date — leaving a file every other tool still reads.',
      'ssh is the gate, ping is the explanation: a host answering ssh is kept even with ICMP blocked; auth / refused / dns / no-route / timeout / down are distinguished.',
      'Run it again and commented hosts are re-tested and uncommented when they return — the list converges instead of decaying. Your own comments are never touched.',
      'Exit codes for cron: 0 all usable, 1 something wasn’t. Ranges like node[01-24] expand; mixed results split per host.',
    ], MARG, 1.7, 6.35, 4.3, { size: 12.5, space: 10 });
    codeBlock(s, 7.25, 1.7, W - MARG - 7.25, 3.6, [
      [{ t: '# production web tier', c: '7C8CA0' }],
      [{ t: 'web01', c: 'E8EEF6' }],
      [{ t: '# db07  #[unreachable] pings but ssh does', c: '6FCF97' }],
      [{ t: '#       not answer - 2026-08-15', c: '6FCF97' }],
      [{ t: 'cache02  # the slow one', c: 'E8EEF6' }],
      [{ t: '# ghost  #[unreachable] name does not', c: '6FCF97' }],
      [{ t: '#        resolve - 2026-08-15', c: '6FCF97' }],
      [{ t: 'noicmp   # ICMP blocked here by policy', c: 'E8EEF6' }],
      [{ t: '', c: 'E8EEF6' }],
      [{ t: '$ ', c: '6FCF97', b: true }, { t: 'reachable prod.txt -i', c: 'FFFFFF', b: true }, { t: '   # atomic, keeps .bak', c: '7C8CA0' }],
    ], 11);
    card(s, 7.25, 5.5, W - MARG - 7.25, 1.15, FAINT);
    s.addText([
      { text: 'Belt and braces: ', options: { bold: true, color: INK } },
      { text: 'the orchestrators also fail open — per-host failures are tracked and reported, and iperf_orchestrator’s --keep-going finishes the fleet past a bad host.', options: { color: MUTED } },
    ], { x: 7.45, y: 5.62, w: W - MARG - 7.65, h: 0.95, fontFace: F, fontSize: 11.5, margin: 0 });
    noteText(s,
      'This is the resilience slide: how do you make sure the test can run even when several servers are down? Two layers. ' +
      'First, prune the list: reachable rewrites servers.txt, commenting out dead entries with the reason, so the fan-out is never half wasted -- and because it un-comments hosts that come back and never touches your own comments, it is safe to run on a schedule. ' +
      'Second, the orchestrators themselves fail open: one dead host is reported and skipped, not allowed to abort a 100-host run. ' +
      'Together: reachable prod.txt -i before every big run, and the run itself tolerates whatever died since.');
  }

  // ======================= SECTION 1: iperf_orchestrator ===================
  divider(1, 'iperf_orchestrator', 'TCP bandwidth, every link, both directions, all at once — full-mesh iperf2 with the numbers you can defend.', AMBER,
    'Section one: iperf_orchestrator. We’ll cover what it is, what iperf itself is and why the orchestrator had to exist, what it does and does not do, setup, the run/collect/interpret/clean lifecycle, the four run modes and why they exist.');

  // -- 7 · What is it -------------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'What it is, and why you run it', AMBER);
    toolTag(s, 'pip install iperf-orchestrator', AMBER);
    bullets(s, [
      'A single self-contained bash script (plus embedded Python) that runs a full-mesh iperf2 throughput test across a list of servers.',
      'Samples per-host CPU during the run, then parses everything into a CSV, a pivot table, and a heatmap + bar chart.',
      'Built for fabric stress testing: load every link in both directions simultaneously and find out what breaks or degrades.',
      'Also a one-off “is the network healthy?” survey for a fleet — one command, one picture.',
      'Stateless: each run gets a timestamped results/<run-id>/ directory; results/latest always points at the newest.',
    ], MARG, 1.72, 6.7, 4.4, { size: 13, space: 11 });
    // output pipeline mini-diagram
    const dx = 7.85, dw = W - MARG - dx;
    card(s, dx, 1.72, dw, 4.9, FAINT);
    s.addText('one command in …', { x: dx + 0.3, y: 1.95, w: dw - 0.6, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: MUTED, margin: 0 });
    codeBlock(s, dx + 0.3, 2.28, dw - 0.6, 0.55, [[{ t: '$ ', c: 'F2A65A', b: true }, { t: 'iperf-orchestrator --servers servers.txt all', c: 'FFFFFF', b: true }]], 10.5);
    s.addText('… four artifacts out', { x: dx + 0.3, y: 3.0, w: dw - 0.6, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: MUTED, margin: 0 });
    const arts = [
      ['iperf_results.csv', 'every test, both directions, parsed'],
      ['cpu_summary.csv', 'per-host CPU peaks during the run'],
      ['iperf_pivot.txt', 'text pivot of throughput'],
      ['iperf_heatmap.png', 'heatmap + ranked bars, CPU annotated'],
    ];
    arts.forEach((a, i) => {
      const ay = 3.35 + i * 0.78;
      s.addShape('roundRect', { x: dx + 0.3, y: ay, w: dw - 0.6, h: 0.66, fill: { color: PAPER }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
      s.addText(a[0], { x: dx + 0.5, y: ay + 0.07, w: dw - 1.0, h: 0.26, fontFace: FM, fontSize: 11.5, bold: true, color: AMBERD, margin: 0 });
      s.addText(a[1], { x: dx + 0.5, y: ay + 0.33, w: dw - 1.0, h: 0.26, fontFace: F, fontSize: 10.5, color: MUTED, margin: 0 });
    });
    noteText(s,
      'What is it: a bash orchestrator around iperf2. You hand it a server list; it starts iperf2 servers everywhere, schedules every pair, runs the mesh, collects the logs, and renders the results. ' +
      'Why run it: two reasons. Stress -- load every link in both directions at once and see what breaks, which is the acceptance test for a new fabric or a change window. And survey -- a quick "is this fleet’s network healthy" snapshot. ' +
      'The four artifacts on the right are the whole deliverable; the heatmap is usually the one you open first.');
  }

  // -- 8 · What is iperf / why iperf2 --------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'What is iperf — and why iperf2, not iperf3', AMBER);
    const colW = (W - 2 * MARG - 0.4) / 2;
    card(s, MARG, 1.7, colW, 4.75, FAINT);
    s.addText('iperf, in one breath', { x: MARG + 0.3, y: 1.95, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 16, bold: true, color: INK, margin: 0 });
    bullets(s, [
      'The standard network throughput tool: a client opens a TCP connection to a server and pushes bytes as fast as it can for N seconds.',
      'The report is the achieved bandwidth — what the path actually carried, end to end.',
      'iperf2 and iperf3 are different codebases with different behavior, not versions of each other.',
      'The orchestrator uses iperf2’s --full-duplex: both directions concurrently on a single TCP socket — one test per pair, and closer to real traffic.',
    ], MARG + 0.3, 2.4, colW - 0.6, 3.9, { size: 12.5, space: 9 });
    card(s, MARG + colW + 0.4, 1.7, colW, 4.75, 'FBF1E4');
    s.addText('Why not iperf3?', { x: MARG + colW + 0.7, y: 1.95, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 16, bold: true, color: AMBERD, margin: 0 });
    bullets(s, [
      'iperf3’s server is single-threaded and accepts one client at a time — in a mesh, everyone else gets “the server is busy”.',
      'Working around that at N=100 means 100 daemons per host, on 100 ports, with 100× the firewall holes, plus a port-assignment scheme.',
      'iperf2’s multi-threaded server takes concurrent clients on one port: one daemon per host on 5001, done.',
      'Lesson learned the hard way — the first version used iperf3 and the architecture collapsed under its own workarounds.',
    ], MARG + colW + 0.7, 2.4, colW - 0.6, 3.9, { size: 12.5, space: 9 });
    s.addText('Watch out: some distros ship “iperf” as a symlink to iperf3 — check-iperf catches WRONG_VERSION for you.', {
      x: MARG, y: 6.6, w: W - 2 * MARG, h: 0.35, align: 'center', fontFace: F, fontSize: 12, italic: true, color: MUTED, margin: 0 });
    noteText(s,
      'Quick grounding for anyone who hasn’t used iperf: client pushes bytes to a server for ten seconds, the achieved bandwidth is the answer. ' +
      'The subtle part is iperf2 versus iperf3 -- different projects, and the choice matters enormously for a mesh. iperf3’s single-threaded, one-client-at-a-time server means a 100-host mesh needs a hundred daemons and ports per host. iperf2 handles concurrent clients on one port, and its --full-duplex mode tests both directions on one socket, which halves the test count and looks more like real traffic to switch buffers. ' +
      'This is a design decision the tool encodes so you never have to re-discover it.');
  }

  // -- 9 · Why the orchestrator was necessary -------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'Why an orchestrator was necessary', AMBER);
    const stats = [
      { n: '4,950', l: 'pairs at N=100 — nobody runs that by hand', c: AMBER },
      { n: '<1 s', l: 'start spread: one future epoch pushed to all hosts — no coordination protocol', c: SLATE },
      { n: '49–50', l: 'clients per host under the parity rule — naive lex-order gives one host 99 and another 0', c: SLATE },
      { n: '~17×', l: 'faster collection: one tar + scp per host instead of N² scp calls', c: SLATE },
    ];
    const cw = (W - 2 * MARG - 3 * 0.25) / 4;
    stats.forEach((st, i) => {
      const x = MARG + i * (cw + 0.25);
      card(s, x, 1.7, cw, 2.35, FAINT);
      s.addText(st.n, { x: x + 0.22, y: 1.92, w: cw - 0.44, h: 0.8, fontFace: F, fontSize: 34, bold: true, color: st.c, margin: 0 });
      s.addText(st.l, { x: x + 0.22, y: 2.78, w: cw - 0.44, h: 1.15, fontFace: F, fontSize: 11, color: MUTED, margin: 0 });
    });
    bullets(s, [
      'A mesh is not N tests — it is N(N−1)/2 pairs that must start together, share the load fairly, and not trample each other’s logs.',
      'Synchronized start: compute start_time = now + 30 s once, push the timestamp; every host busy-waits and fires within a fraction of a second. No locks, no barrier protocol — just a number.',
      'Balanced pair assignment: for pair {i, j}, the client is the smaller index when i+j is even, the larger when odd. Both ends compute it independently and agree.',
      'CPU is sampled on every host during the run — because a throughput number without the CPU next to it is routinely misread (more on that shortly).',
    ], MARG, 4.35, W - 2 * MARG, 2.6, { size: 12.5, space: 8 });
    noteText(s,
      'Why was the orchestrator necessary? Because a full mesh has quadratic moving parts. At 100 hosts it’s 4,950 pair tests. ' +
      'They need to start simultaneously for a stress test to mean anything -- solved with a single future timestamp rather than any coordination protocol. ' +
      'Someone has to be the client for each pair, and the naive rule gives one host 99 client jobs and another zero -- the parity rule spreads it to 49-or-50 each, computed independently at both ends. ' +
      'And collecting the results naively is eighty minutes of ssh handshakes -- tar-batching cuts it to minutes. Each of these was a real problem hit and fixed; the tool is the accumulated answers.');
  }

  // -- 10 · Does / doesn't --------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'What it does — and deliberately doesn’t', AMBER);
    const colW = (W - 2 * MARG - 0.4) / 2;
    card(s, MARG, 1.7, colW, 4.9, 'EFF7EF');
    s.addText('It does', { x: MARG + 0.3, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: GREEN, margin: 0 });
    bullets(s, [
      'Full-duplex TCP mesh with synchronized start and balanced client assignment',
      'Per-host CPU sampling (mpstat, with a /proc/stat fallback) alongside every run',
      'Parse → CSV → pivot → heatmap, re-runnable per run-id at any time',
      'Capped-concurrency ssh fan-out (--jobs), optional --retries with back-off',
      'Fails open: per-host failures are tracked and reported, not fatal — one bad host doesn’t abort a 100-host run',
    ], MARG + 0.3, 2.35, colW - 0.6, 4.1, { size: 12.5, space: 9 });
    card(s, MARG + colW + 0.4, 1.7, colW, 4.9, 'FDF0F0');
    s.addText('It doesn’t', { x: MARG + colW + 0.7, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: CRIMD, margin: 0 });
    bullets(s, [
      'No UDP, no latency, no packet rate — that’s netmesh and mx territory',
      'Doesn’t install iperf2 or distribute ssh keys — check-iperf and doctor verify, you provision',
      'No normalization for mixed NIC speeds — a 1G/10G fleet makes the 1G hosts look red',
      'Heatmap past ~60 hosts drops cell labels by design — read the CSV for exact values',
      'sequential-pair at N=100 is ~14 hours — the cleanest mode is priced accordingly',
    ], MARG + colW + 0.7, 2.35, colW - 0.6, 4.1, { size: 12.5, space: 9 });
    noteText(s,
      'Scope, honestly stated. It does the whole mesh lifecycle -- schedule, synchronize, sample CPU, collect, render -- and it fails open, because at fleet scale something is always broken and the run must survive it. ' +
      'It doesn’t do UDP or latency; those questions belong to netmesh and mx. It doesn’t provision hosts -- iperf2 and ssh keys are on you, though it verifies both before running. ' +
      'And it has known, documented gaps: heterogeneous NIC fleets skew the colormap, and the ultra-clean sequential-pair mode costs hours at scale.');
  }

  // -- 11 · Setup -----------------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'What setup actually needs', AMBER);
    const colW = (W - 2 * MARG - 0.4) / 2;
    card(s, MARG, 1.7, colW, 3.1, FAINT);
    s.addText('On the orchestrator host', { x: MARG + 0.3, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 14.5, bold: true, color: INK, margin: 0 });
    bullets(s, [
      'bash 4+, ssh/scp, tar, gzip',
      'Python 3.6+ — stdlib only, except numpy + matplotlib for the heatmap step',
      'pip install iperf-orchestrator, or just run the script from a checkout',
    ], MARG + 0.3, 2.35, colW - 0.6, 2.3, { size: 12.5, space: 8 });
    card(s, MARG + colW + 0.4, 1.7, colW, 3.1, FAINT);
    s.addText('On every server in the mesh', { x: MARG + colW + 0.7, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 14.5, bold: true, color: INK, margin: 0 });
    bullets(s, [
      'iperf2 — binary named iperf, not iperf3; 2.0.13+ for --full-duplex',
      'sysstat’s mpstat recommended — falls back to /proc/stat sampling',
      'Key-based ssh from the orchestrator (BatchMode — a password prompt is a failure)',
    ], MARG + colW + 0.7, 2.35, colW - 0.6, 2.3, { size: 12.5, space: 8 });
    codeBlock(s, MARG, 5.05, W - 2 * MARG, 1.6, [
      [{ t: '$ ', c: 'F2A65A', b: true }, { t: 'for h in $(grep -v \'^#\' servers.txt); do ssh-copy-id "$h"; done', c: 'FFFFFF' }, { t: '   # keys first', c: '7C8CA0' }],
      [{ t: '$ ', c: 'F2A65A', b: true }, { t: 'iperf-orchestrator doctor', c: 'FFFFFF', b: true }, { t: '        # local prerequisites, with install hints', c: '7C8CA0' }],
      [{ t: '$ ', c: 'F2A65A', b: true }, { t: 'iperf-orchestrator --servers servers.txt check-iperf', c: 'FFFFFF', b: true }, { t: '   # iperf2 + mpstat on every host', c: '7C8CA0' }],
    ], 12);
    noteText(s,
      'Setup is deliberately thin. The orchestrator host needs bash, ssh, and Python -- numpy and matplotlib only if you want the heatmap. Servers need exactly two things: iperf2 and, ideally, mpstat. ' +
      'The one hard prerequisite is key-based ssh everywhere; every connection uses BatchMode, so a password prompt is treated as a failure rather than a hang. ' +
      'The tool gives you three preflight commands: doctor for local deps, check-iperf for the fleet -- which also catches the distro trap where iperf is secretly iperf3 -- and check-servers to see what’s already running.');
  }

  // -- 12 · Lifecycle -------------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'Run → collect → interpret → clean', AMBER);
    // pipeline steps
    const steps = ['start-servers', 'run-tests', 'collect-results', 'parse + pivot\n+ heatmap', 'stop-servers', 'cleanup --yes'];
    const sw = 1.86, sh = 0.78, gy = 1.78; const gapx = (W - 2 * MARG - 6 * sw) / 5;
    steps.forEach((st, i) => {
      const x = MARG + i * (sw + gapx);
      s.addShape('roundRect', { x: x, y: gy, w: sw, h: sh, fill: { color: i === 5 ? NAVY : AMBER }, line: { type: 'none' }, rectRadius: 0.08 });
      s.addText(st, { x: x, y: gy, w: sw, h: sh, align: 'center', valign: 'middle', fontFace: FM, fontSize: 10.5, bold: true, color: PAPER, margin: 0 });
      if (i < 5) s.addText('→', { x: x + sw - 0.04, y: gy + 0.14, w: gapx + 0.1, h: 0.5, align: 'center', fontFace: F, fontSize: 18, bold: true, color: MUTED, margin: 0 });
    });
    s.addText([
      { text: 'all', options: { fontFace: FM, bold: true, color: AMBERD } },
      { text: ' runs the whole pipeline; every step is also a standalone subcommand, safe to re-run individually.', options: { color: MUTED } },
    ], { x: MARG, y: 2.72, w: W - 2 * MARG, h: 0.35, fontFace: F, fontSize: 12.5, margin: 0 });
    bullets(s, [
      'Each producing run gets results/<run-id>/ (timestamped); results/latest follows the newest. Analysis re-runs any time: --run-id addresses old runs.',
      'Collection is tar-batched: one ssh + one scp + one untar per host — minutes, not the ~80 minutes N² scp would cost at N=100.',
      'Interpreting starts with iperf_heatmap.png and results-summary (P50/P95/min/mean/max + the 5 slowest pairs); exact numbers live in iperf_results.csv.',
      'stop-servers kills the daemons; cleanup --yes removes the remote dir — scoped to the run-id, so parallel runs on a shared filesystem never collide.',
      'A run died halfway? all --resume skips completed steps; all --keep-going barrels past a flaky host.',
    ], MARG, 3.25, W - 2 * MARG, 3.4, { size: 12.5, space: 9 });
    noteText(s,
      'The lifecycle. In practice you type one command -- all -- and it does start, run, collect, parse, render, stop. But every stage is a first-class subcommand, which matters on day two: re-render a heatmap for last week’s run, re-collect from a host that was slow, re-run only the analysis. ' +
      'Results are immutable timestamped directories with a latest symlink -- so runs compare cleanly over time. ' +
      'Cleanup is explicit and scoped: it removes the remote working dir for this run only, and --resume / --keep-going give you the recovery story when a fleet misbehaves mid-run.');
  }

  // -- 13 · Reading the heatmap ---------------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'Interpreting: read the heatmap, then check the CPU', AMBER);
    // heatmap graphic with sick row/col
    const hx = MARG + 0.15, hy = 1.95, n = 8, cell = 0.42, gp = 0.07;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let c = 'F5C77E';
      const r = (i * 5 + j * 11) % 13;
      if (r < 4) c = 'F2A65A'; if (r >= 10) c = 'FBE3C4';
      if (i === 5) c = 'C0392B';           // sick row
      if (j === 2 && i !== 5) c = 'D95F4B'; // sick column
      s.addShape('roundRect', { x: hx + j * (cell + gp), y: hy + i * (cell + gp), w: cell, h: cell, fill: { color: c }, line: { type: 'none' }, rectRadius: 0.05 });
    }
    s.addText('rows = sender →', { x: hx, y: hy + n * (cell + gp) + 0.08, w: 3.9, h: 0.3, fontFace: F, fontSize: 11, color: MUTED, margin: 0 });
    s.addText('← red row: that host’s outbound is sick', { x: hx + n * (cell + gp) + 0.15, y: hy + 5 * (cell + gp) - 0.02, w: 2.6, h: 0.6, fontFace: F, fontSize: 11, bold: true, color: CRIMD, margin: 0 });
    s.addText('red column: sick inbound ↓', { x: hx - 0.1, y: hy - 0.34, w: 3.5, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: 'D95F4B', margin: 0 });
    const tx = 7.0, tw = W - MARG - tx;
    bullets(s, [
      'Cell (A, B) = throughput A→B during the full-duplex test. All-red row → bad outbound; all-red column → bad inbound; a red block → a congested leaf pair.',
      'The bar chart underneath ranks hosts by mean outgoing Mbps — with peak CPU% written on each bar.',
    ], tx, 1.8, tw, 2.1, { size: 12.5, space: 9 });
    card(s, tx, 3.95, tw, 2.75, 'FDF0F0');
    s.addText('The classic misread', { x: tx + 0.28, y: 4.15, w: tw - 0.56, h: 0.32, fontFace: F, fontSize: 14, bold: true, color: CRIMD, margin: 0 });
    bullets(s, [
      'Slow host on the heatmap + peak_total_pct ≈ 100% in cpu_summary.csv ⇒ you measured the CPU, not the fabric.',
      'Box-wide CPU 30% but softirq pinned at 100% on core 0 ⇒ RSS isn’t spreading NIC interrupts — invisible without per-core data, which is why mpstat -P ALL is preferred.',
    ], tx + 0.28, 4.55, tw - 0.56, 2.0, { size: 12, space: 8 });
    noteText(s,
      'How to read the results. The heatmap is rows-send, columns-receive: a red row means that host transmits badly to everyone, a red column means everyone struggles to send to it. That asymmetry instantly localizes the fault to a direction on a host. ' +
      'But before you blame the network: the most common surprise on first runs is a "slow" host whose CPU was pegged for the whole test -- the number measured the CPU. Second most common: total CPU looks fine but one core is drowning in softirq, because RSS is hashing every flow to core 0. ' +
      'This is exactly why the orchestrator samples CPU on every host and prints peak CPU on the bar chart -- so the misread is caught on the same page.');
  }

  // -- 14 · Run modes -------------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'Four run modes — and why they exist', AMBER);
    const hdr = ['Mode', 'What runs concurrently', '@ N=100, 10 s tests', 'Use it when'];
    const body = [
      ['parallel  (default)', 'every host fires all its clients after one synchronized start', '~50 s', 'Stress: load the whole fabric at once, see what breaks'],
      ['sequential-host', 'one host at a time runs all its clients', '~17 min', 'Clean per-host numbers, no inter-host interference'],
      ['sequential-pair', 'exactly one connection on the wire', '~14 h', 'Cleanest per-pair numbers — usually overkill'],
      ['rolling', 'each host keeps picking its least-tested peer; ≤ --flows tests at once, for --total-time', 'bounded by --total-time', 'Very large N: per-host load stays constant regardless of fleet size'],
    ];
    const tbl = [hdr.map(hh => ({ text: hh, options: { fill: { color: NAVY }, color: PAPER, bold: true, fontSize: 12 } }))]
      .concat(body.map((r, ri) => r.map((c, ci) => ({
        text: c,
        options: { fontSize: 11.5, fontFace: ci === 0 ? FM : F, bold: ci === 0 || ci === 2, color: ci === 0 ? AMBERD : (ci === 2 ? INK : (ci === 3 ? MUTED : INK)), fill: { color: ri % 2 ? FAINT : PAPER }, valign: 'middle' },
      }))));
    s.addTable(tbl, { x: MARG, y: 1.72, w: W - 2 * MARG, colW: [2.35, 4.35, 1.85, 3.54].map(v => v * (W - 2 * MARG) / 12.09), border: { type: 'solid', color: LINE, pt: 0.75 }, rowH: [0.42, 0.78, 0.78, 0.78, 0.95], fontFace: F, margin: 0.08, valign: 'middle' });
    s.addText([
      { text: 'Why modes at all?  ', options: { bold: true, color: INK } },
      { text: 'One knob — how much traffic shares the wire at once — trades realism against isolation against wall-clock. parallel answers “what breaks under load?”; the sequential modes answer “what is each host / pair capable of?”; rolling exists because at very large N even parallel setup cost and full-mesh load become the problem, so each host just keeps a few flows rolling for a fixed time.', options: { color: MUTED } },
    ], { x: MARG, y: 5.85, w: W - 2 * MARG, h: 1.15, fontFace: F, fontSize: 12.5, margin: 0 });
    noteText(s,
      'The modes, and why they exist. They all answer the same question at different isolation levels. parallel is the stress test: everything at once, done in about a minute. ' +
      'sequential-host isolates each host so its numbers aren’t polluted by neighbors -- good for "what can this box do". sequential-pair puts one connection on the wire at a time -- the cleanest possible pair numbers, but quadratic time, so it’s rarely worth it. ' +
      'rolling is the odd one out: instead of a fixed schedule, every host independently keeps testing its least-tested peer for a wall-clock budget. Per-host load is constant no matter how big the fleet is, which makes it the only practical mode at very large N. ' +
      'Pick the mode by the question: stress = parallel, capability = sequential-host, forensic = sequential-pair, huge fleet = rolling.');
  }

  // -- 15 · Day-2 controls --------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'iperf_orchestrator', 'Different ways to run it', AMBER);
    const colW = (W - 2 * MARG - 0.5) / 3;
    const groups = [
      { t: 'Scale it', c: AMBER, items: ['--jobs 64 — cap on parallel ssh fan-out (setup/teardown only)', '--retries N — re-try flaky hosts with linear back-off', '--duration / -P — seconds per test, parallel streams within it', 'rolling: --total-time, --flows'] },
      { t: 'Trust it', c: SLATE, items: ['--dry-run — print every ssh/scp command instead of executing', '--keep-going — finish the fleet past per-host failures', '--resume — pick up an aborted all where it stopped', 'status — probe hosts live, list runs'] },
      { t: 'Fit it in', c: SLATE, items: ['Every flag is also an env var (IPERF_DURATION=60 …) — script it either way', '--run-id — address any historical run', 'REMOTE_DIR safe on shared filesystems — files embed host + run-id', 'Stateless: state is derived by probing, never stored'] },
    ];
    groups.forEach((g, i) => {
      const x = MARG + i * (colW + 0.25);
      card(s, x, 1.7, colW, 4.75, FAINT);
      s.addText(g.t, { x: x + 0.28, y: 1.92, w: colW - 0.56, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: g.c, margin: 0 });
      bullets(s, g.items, x + 0.28, 2.4, colW - 0.56, 3.9, { size: 11.5, space: 9 });
    });
    s.addText('One-liner to remember:  iperf-orchestrator --servers servers.txt all   — everything else is refinement.', {
      x: MARG, y: 6.6, w: W - 2 * MARG, h: 0.35, align: 'center', fontFace: FM, fontSize: 12, bold: true, color: AMBERD, margin: 0 });
    noteText(s,
      'Ways to run it, grouped by what you’re optimizing. Scale: the ssh fan-out is capped and tunable, retries handle flaky hosts, and rolling mode has its own budget knobs. ' +
      'Trust: --dry-run prints exactly what would be executed -- worth showing before unleashing anything on a production fleet -- and --keep-going / --resume are the recovery story. ' +
      'Fit: everything is flag or env var, results are addressable by run-id, and there’s no hidden state anywhere -- you can always reason about what a re-run will do. ' +
      'But the honest summary: most days it’s one command, all.');
  }

  // ======================= SECTION 2: matrix_orchestrator ==================
  divider(2, 'matrix_orchestrator', 'mx — a request/response traffic matrix over the whole fleet, with packets per second as the headline number.', CRIM,
    'Section two: matrix_orchestrator, or mx. Why it exists beyond iperf_orchestrator, what it does and doesn’t, the six commands, editing the matrix mid-stream, reading the summary, scaling knobs, and how to shape a run for small, large and huge fleets.');

  // -- 16 · Why mx ----------------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'The question iperf can’t answer', CRIM);
    toolTag(s, 'pip install matrix-orchestrator', CRIM);
    bullets(s, [
      'iperf_orchestrator tells you each pair’s maximum TCP bandwidth. But real traffic isn’t bulk bytes — it’s RPCs, storage reads, control planes: small requests, sized answers, measured in packets.',
      'mx runs that shape: every host sends x-byte requests at a target rate to every peer, and every request gets a y-byte reply. That’s the whole model.',
      'Headline number: packets per second the fleet can exchange when every packet must be answered — where fabrics and NICs actually fall over.',
      'RTT falls out for free: the reply carries the request’s timestamp back, so it’s a true round trip with no clock sync anywhere.',
      'Asymmetric by design: --tx-size 128 --rx-size 8192 is an RPC — equal pps both ways, 64× the bandwidth on the reply path. That asymmetry is usually what breaks first, and the report keeps the directions separate.',
    ], MARG, 1.72, 7.7, 4.9, { size: 13, space: 11 });
    card(s, 8.7, 1.72, W - MARG - 8.7, 3.1, 'FDF0F0');
    s.addText('Why UDP only?', { x: 8.98, y: 1.94, w: W - MARG - 9.26, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: CRIMD, margin: 0 });
    s.addText('“Every x-byte request gets a y-byte reply” is a statement about packets. TCP would coalesce and re-segment them — the pps number would be fiction. Want TCP goodput? That’s iperf_orchestrator.', {
      x: 8.98, y: 2.4, w: W - MARG - 9.26, h: 2.3, fontFace: F, fontSize: 12.5, color: INK, margin: 0 });
    card(s, 8.7, 5.0, W - MARG - 8.7, 1.62, FAINT);
    s.addText([
      { text: 'Zero footprint: ', options: { bold: true, color: INK } },
      { text: 'stdlib-only Python, one file, no dependencies — nothing installed on servers, no root.', options: { color: MUTED } },
    ], { x: 8.98, y: 5.2, w: W - MARG - 9.26, h: 1.3, fontFace: F, fontSize: 12.5, margin: 0 });
    noteText(s,
      'Why does mx exist when we already had iperf_orchestrator? Because bandwidth and packet rate fail differently. A fabric can carry 100 gigabits of bulk TCP and still collapse at two million answered packets per second -- and request/response at rate is what RPC, storage and control-plane traffic actually looks like. ' +
      'The model is one sentence: x bytes out, y bytes back, at a target rate, between every pair. Because the reply echoes the request’s timestamp, you get honest round-trip latency with no clock synchronization. ' +
      'And it is UDP on purpose -- TCP would merge your packets and make the pps number meaningless. The two tools are the two halves of the load story.');
  }

  // -- 17 · mx does / doesn't ----------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'What it does — and where it stops', CRIM);
    const colW = (W - 2 * MARG - 0.4) / 2;
    card(s, MARG, 1.7, colW, 4.9, 'EFF7EF');
    s.addText('It does', { x: MARG + 0.3, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: GREEN, margin: 0 });
    bullets(s, [
      'Paced request/response matrix — per-pair rates, sizes and port all live in one editable CSV',
      'Reports both payload and wire rate (+66 B framing per packet) — the number a NIC actually carries',
      'Loss split into forward and return legs; DELIVERED (receiver-counted) as the honest headline',
      'RTT avg/p50/p99/max per flow; per-host CPU including the agent’s own share',
      'Multi-process agents, SO_REUSEPORT, fd limits raised automatically; preflight via mx check and mx doctor',
    ], MARG + 0.3, 2.35, colW - 0.6, 4.1, { size: 12, space: 9 });
    card(s, MARG + colW + 0.4, 1.7, colW, 4.9, 'FDF0F0');
    s.addText('It doesn’t', { x: MARG + colW + 0.7, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: CRIMD, margin: 0 });
    bullets(s, [
      'No TCP — by design (goodput → iperf_orchestrator)',
      'No one-way delay — it would need clock sync it refuses to pretend it has',
      'Not a kernel-bypass blaster: ~200k pps per worker, 1–4 Mpps per typical host — beyond that the kernel UDP path is the wall and you want AF_XDP / DPDK',
      'Payload sizes 32–65507 bytes — it’s a packet tool, not a file-transfer tool',
      'Won’t hide its own limits: when a worker saturates, the summary says you’re measuring the tool — and names the fix',
    ], MARG + colW + 0.7, 2.35, colW - 0.6, 4.1, { size: 12, space: 9 });
    noteText(s,
      'What it does: the full request/response lifecycle with honest accounting -- wire rate as well as payload, receiver-counted delivery, loss split by direction, latency percentiles, and its own CPU cost reported next to the network numbers. ' +
      'What it doesn’t: TCP, one-way delay, and heroic packet rates. It is ordinary Python on the ordinary kernel socket path -- around 200k packets per second per worker process, a few million per host. That ceiling is documented, measured, and most importantly self-reported: when you hit it, the summary tells you to stop believing the number and add workers or hosts. ' +
      'A load tool that can quietly become its own bottleneck without telling you is worse than no tool.');
  }

  // -- 18 · Six commands ----------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'Six commands drive it', CRIM);
    const cmds = [
      ['mx gen', 'build matrix.csv from your server list'],
      ['mx start', 'copy the agent + matrix to every host, start them'],
      ['mx status', 'one line per host: live ticker, or NOT-RUNNING'],
      ['mx summarize', 'collect reports → pps / Gbps / loss / RTT + what to do next'],
      ['mx stop', 'stop the agents — reports and logs stay on the hosts'],
      ['mx clean', 'stop, delete everything, verify no trace is left'],
    ];
    cmds.forEach((c, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const cw = (W - 2 * MARG - 0.3) / 2;
      const x = MARG + col * (cw + 0.3), y = 1.7 + row * 0.92;
      card(s, x, y, cw, 0.8, FAINT);
      s.addText(String(i + 1), { x: x + 0.18, y: y + 0.16, w: 0.5, h: 0.5, fontFace: F, fontSize: 22, bold: true, color: CRIM, margin: 0 });
      s.addText(c[0], { x: x + 0.75, y: y + 0.12, w: 2.2, h: 0.56, fontFace: FM, fontSize: 13.5, bold: true, color: INK, margin: 0, valign: 'middle' });
      s.addText(c[1], { x: x + 2.95, y: y + 0.12, w: cw - 3.1, h: 0.56, fontFace: F, fontSize: 11.5, color: MUTED, margin: 0, valign: 'middle' });
    });
    codeBlock(s, MARG, 4.6, 7.2, 2.05, [
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'printf \'%s\\n\' 10.0.0.10 10.0.0.11 10.0.0.12 > servers.txt', c: 'FFFFFF' }],
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'mx gen --servers servers.txt --pps 20000', c: 'FFFFFF', b: true }],
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'mx run --for 60', c: 'FFFFFF', b: true }, { t: '     # or: the whole lifecycle in one shot', c: '7C8CA0' }],
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'mx hints --pps-per-host 2000000', c: 'FFFFFF' }, { t: '   # goal -> the command for it', c: '7C8CA0' }],
    ], 12);
    card(s, 7.95, 4.6, W - MARG - 7.95, 2.05, FAINT);
    s.addText('vs. iperf_orchestrator', { x: 8.2, y: 4.78, w: W - MARG - 8.45, h: 0.3, fontFace: F, fontSize: 13, bold: true, color: INK, margin: 0 });
    bullets(s, [
      'Nothing needed on servers but Python — no iperf2 to install',
      'Config lives in matrix.csv, not in flags you re-type',
      'Plus: run, check, hints, logs, doctor',
    ], 8.2, 5.14, W - MARG - 8.45, 1.45, { size: 11.5, space: 6 });
    noteText(s,
      'How you run it -- and it is deliberately simpler than iperf_orchestrator. Six verbs: gen builds the matrix file, start deploys and launches agents over ssh, status is the live ticker, summarize collects and analyzes, stop halts, clean erases. mx run wraps the whole lifecycle with a duration. ' +
      'Two differences from iperf_orchestrator worth calling out: servers need nothing but Python -- there is no iperf2 dependency to install fleet-wide -- and everything about the traffic lives in the matrix file rather than in command-line flags, which sets up the next slide. ' +
      'And when you don’t know what to ask for, mx hints turns a goal into the command that gets you there.');
  }

  // -- 19 · Matrix file / mid-stream ---------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'The matrix file — and changing the run mid-stream', CRIM);
    codeBlock(s, MARG, 1.72, 6.6, 2.6, [
      [{ t: '# mx matrix v1 -- rows send, columns receive,', c: '7C8CA0' }],
      [{ t: '#   cells are packets/sec', c: '7C8CA0' }],
      [{ t: '# tx_size=64 rx_size=512 port=5300', c: 'E98C99' }],
      [{ t: 'src\\dst,10.0.0.10,10.0.0.11,10.0.0.12', c: 'E8EEF6' }],
      [{ t: '10.0.0.10,,', c: 'E8EEF6' }, { t: '20000', c: 'FFFFFF', b: true }, { t: ',', c: 'E8EEF6' }, { t: '20000', c: 'FFFFFF', b: true }],
      [{ t: '10.0.0.11,', c: 'E8EEF6' }, { t: '5000', c: 'F2C94C', b: true }, { t: ',,', c: 'E8EEF6' }, { t: 'max', c: 'F2C94C', b: true }],
      [{ t: '10.0.0.12,', c: 'E8EEF6' }, { t: '20000', c: 'FFFFFF', b: true }, { t: ',', c: 'E8EEF6' }, { t: '', c: 'E8EEF6' }, { t: ' ,', c: 'E8EEF6' }],
    ], 12);
    bullets(s, [
      'mx gen writes it; everything about the traffic lives here — hosts, per-pair rates, sizes, port. No command needs those flags again.',
      'Host tokens: name[=addr[:port]] — bare IPs work; so does hostA=10.0.0.10:5399.',
    ], MARG, 4.55, 6.6, 1.9, { size: 12.5, space: 9 });
    const rx = 7.55, rw = W - MARG - rx;
    card(s, rx, 1.72, rw, 3.6, 'FDF0F0');
    s.addText('Mid-stream changes = edit + restart', { x: rx + 0.28, y: 1.94, w: rw - 0.56, h: 0.35, fontFace: F, fontSize: 14.5, bold: true, color: CRIMD, margin: 0 });
    bullets(s, [
      'Blank a cell → that flow is gone',
      'Change a cell → that pair gets its own rate',
      'Write max → that pair runs unpaced',
      'Edit the header → reshape sizes / port',
      'Then mx start again — agents redeploy with the new matrix; reports keep accumulating',
    ], rx + 0.28, 2.4, rw - 0.56, 2.9, { size: 12.5, space: 8 });
    card(s, rx, 5.5, rw, 1.15, FAINT);
    s.addText([
      { text: 'The file is the interface. ', options: { bold: true, color: INK } },
      { text: 'Non-uniform tests — hot pairs, quiet pairs, one unpaced probe — are hand edits, not new features.', options: { color: MUTED } },
    ], { x: rx + 0.28, y: 5.64, w: rw - 0.56, h: 0.9, fontFace: F, fontSize: 12, margin: 0 });
    noteText(s,
      'The matrix file is the tool’s real interface. gen writes a plain grid CSV -- rows send, columns receive, each cell a packet rate -- with the sizes and port in the header. ' +
      'Changing a run mid-stream is: edit the file, mx start again. Blank a cell to silence a pair, raise one cell to make a hot pair, write max to let one pair run unpaced, change the header to reshape every packet. The agents redeploy in seconds. ' +
      'This means an investigation -- "what if only the cross-rack pairs run?", "what if this one pair goes unpaced?" -- is a text edit, not a new command line you have to reconstruct.');
  }

  // -- 20 · Getting results -------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'Getting results out', CRIM);
    const rows = [
      { cmd: 'mx status --watch 5', body: 'Live: one ticker line per host every 5 s — is it running, and how fast?' },
      { cmd: 'mx summarize', body: 'The analysis: fleet totals, per-host table (worst first), worst flows, and a computed WHAT TO DO NEXT.' },
      { cmd: 'mx summarize --grid g', body: 'N×N CSVs in the matrix’s own shape: pps, delivered, loss, rtt_p99. Dark row = sick sender · dark column = sick receiver · dark block = congested pair of leaves.' },
      { cmd: 'reports/<host>.csv', body: 'The raw record: one row per flow per interval (pps, loss, RTT percentiles, CPU, workers). Plain CSV — take it to whatever you plot with.' },
      { cmd: 'mx logs', body: 'Each agent’s own log, for when a host did something strange.' },
    ];
    let y = 1.7;
    rows.forEach(r => {
      card(s, MARG, y, W - 2 * MARG, 0.88, FAINT);
      s.addText(r.cmd, { x: MARG + 0.25, y: y + 0.1, w: 3.35, h: 0.68, fontFace: FM, fontSize: 12.5, bold: true, color: CRIMD, margin: 0, valign: 'middle' });
      s.addText(r.body, { x: MARG + 3.75, y: y + 0.1, w: W - 2 * MARG - 4.0, h: 0.68, fontFace: F, fontSize: 11.5, color: INK, margin: 0, valign: 'middle' });
      y += 0.99;
    });
    s.addText('Reports survive mx stop — collect and summarize as long as you like; only mx clean removes them.', {
      x: MARG, y: 6.68, w: W - 2 * MARG, h: 0.35, align: 'center', fontFace: F, fontSize: 12, italic: true, color: MUTED, margin: 0 });
    noteText(s,
      'Getting results. While it runs, mx status is a live per-host ticker. mx summarize is the real product: it pulls every host’s report and prints fleet totals, the per-host table sorted worst-first, the worst individual flows, and a computed what-to-do-next section that reads the numbers and points at the responsible knob. ' +
      '--grid writes N-by-N CSVs shaped like the matrix itself, so a sick sender is literally a dark row in a spreadsheet -- and these grids match netmesh’s grid layout, so the two tools’ outputs read the same way. ' +
      'And underneath it all is one plain CSV per host, per flow, per interval -- nothing proprietary, plot it with anything.');
  }

  // -- 21 · Interpreting the summary ---------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'Interpreting the summary', CRIM);
    codeBlock(s, MARG, 1.7, 7.3, 3.35, [
      [{ t: 'mx summarize -- last 60s, 12 hosts, 132 flows', c: '7C8CA0' }],
      [{ t: '  REQUESTS    2.640 Mpps   2.75 Gbps wire', c: 'E8EEF6' }],
      [{ t: '  DELIVERED   2.601 Mpps   98.52% of what was sent', c: 'FFFFFF', b: true }],
      [{ t: '  REPLIES     2.598 Mpps   2.71 Gbps wire', c: 'E8EEF6' }],
      [{ t: '  TARGET      2.640 Mpps   100.0% achieved', c: 'E8EEF6' }],
      [{ t: '  LOSS        1.59% round trip', c: 'F2C94C', b: true }],
      [{ t: '              (1.48% forward, 0.11% on the way back)', c: 'F2C94C' }],
      [{ t: '  RTT         avg 240us; worst flow p50 190us', c: 'E8EEF6' }],
      [{ t: '              p99 4.1ms  max 31ms', c: 'E8EEF6' }],
      [{ t: '  WHAT TO DO NEXT ...', c: '6FCF97', b: true }],
    ], 11.5);
    const rx2 = 8.25, rw2 = W - MARG - rx2;
    iconRows(s, [
      { icon: 'check', color: CRIM, head: 'DELIVERED is the honest number', body: 'Senders can’t see their own drops — the receivers’ count is the headline.' },
      { icon: 'shuffle', color: CRIM, head: 'Loss is split by leg', body: 'Dropping 64 B requests and dropping 8 KB replies need different fixes.' },
      { icon: 'clock', color: CRIM, head: 'RTT is a true round trip', body: 'The request’s stamp comes back in the reply — no clock sync involved.' },
      { icon: 'compass', color: CRIM, head: 'It tells you what’s next', body: 'WHAT TO DO NEXT reads the numbers and names the knob they point at.' },
    ], rx2, 1.8, rw2, 1.28, CRIM);
    noteText(s,
      'Reading the summary. REQUESTS is what senders put on the wire; DELIVERED is what receivers actually counted -- and delivered is the honest number, because a sender cannot see its own drops. ' +
      'Loss is split into the forward leg and the return leg -- with asymmetric sizes those stress completely different things, and they need different fixes. ' +
      'RTT is a genuine round trip measured on one clock. And the summary ends by interpreting itself: what-to-do-next tells you whether the numbers point at rate, at workers, at a host, or at the fabric.');
  }

  // -- 22 · Measuring the tool ---------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'The agent column — or, when you’re measuring the tool', CRIM);
    const stats2 = [
      { n: '~200k', l: 'pps per worker, request + reply, one ordinary core', c: CRIM },
      { n: '× workers', l: 'per host — --workers auto starts one per core', c: SLATE },
      { n: '× hosts', l: 'per fleet — mx hints does this arithmetic for you', c: SLATE },
    ];
    const cw2 = (W - 2 * MARG - 2 * 0.25) / 3;
    stats2.forEach((st, i) => {
      const x = MARG + i * (cw2 + 0.25);
      card(s, x, 1.7, cw2, 1.75, FAINT);
      s.addText(st.n, { x: x + 0.25, y: 1.88, w: cw2 - 0.5, h: 0.7, fontFace: F, fontSize: 30, bold: true, color: st.c, margin: 0 });
      s.addText(st.l, { x: x + 0.25, y: 2.62, w: cw2 - 0.5, h: 0.7, fontFace: F, fontSize: 11.5, color: MUTED, margin: 0 });
    });
    bullets(s, [
      'The per-host table carries cpu (whole box), 1 core (busiest core), and agent — the busiest agent worker as a share of one core. The third one matters most.',
      'Each worker is one Python process; the GIL holds it near 100% of a core. When agent ≈ 100%, that worker is the ceiling: you are measuring the tool, not the network — and mx summarize says so in as many words.',
      'Processes, not threads — measured: one thread 300k pps, four threads 57k (they convoy on the GIL); four processes 1.09M pps.',
      'One core pegged while the box idles? Workers can’t outnumber flows — --streams N gives each pair N sockets (rate split, not multiplied), creating tuples for workers, NIC RSS queues and ECMP to spread. The recipe for a big box on a small mesh: mx start --streams 8 --workers 32.',
      'File descriptors: the agent raises its own soft limit to what the run needs; only a too-low hard limit needs an admin — and mx doctor flags those hosts before you deploy.',
    ], MARG, 3.7, W - 2 * MARG, 3.1, { size: 12, space: 8 });
    noteText(s,
      'The most important interpretation rule in mx: know when the tool itself is the bottleneck. The arithmetic is public -- about 200 thousand packets per second per worker, times workers, times hosts. ' +
      'The summary’s per-host table has an agent column: the busiest worker’s share of one core. As it approaches 100 percent, the worker is saturated and the pps number is a measurement of Python, not of your fabric -- and the tool says exactly that in the output. ' +
      'Fixes, in order: more workers if there are spare cores, --streams to give a small mesh enough sockets for the workers and the NIC queues to spread across, or more hosts. This is also a nice war story about the GIL: four threads are three times slower than one; four processes are three and a half times faster.');
  }

  // -- 23 · Finding the limit ----------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'Finding the fleet’s limit', CRIM);
    codeBlock(s, MARG, 1.7, 6.9, 2.5, [
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'mx check --nic-gbps 25 --nic-mpps 15', c: 'FFFFFF' }, { t: '  # possible at all?', c: '7C8CA0' }],
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'mx gen --servers s.txt --pps 50000  && mx run --for 120', c: 'FFFFFF' }],
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'mx gen --servers s.txt --pps 100000 && mx run --for 120', c: 'FFFFFF' }],
      [{ t: '  ...raise until delivery stops keeping up', c: '7C8CA0' }],
      [{ t: '$ ', c: 'E98C99', b: true }, { t: 'mx gen --servers s.txt --pps max', c: 'FFFFFF' }, { t: '   # unpaced: fastest, tells less', c: '7C8CA0' }],
    ], 11.5);
    card(s, MARG, 4.5, 6.9, 2.15, FAINT);
    s.addText('Watch for, in this order:', { x: MARG + 0.28, y: 4.68, w: 6.3, h: 0.32, fontFace: F, fontSize: 13.5, bold: true, color: INK, margin: 0 });
    bullets(s, [
      'p99 lifting off the p50 — queues are filling; this usually happens before loss does',
      'DELIVERED falling behind REQUESTS — something is now dropping',
    ], MARG + 0.28, 5.1, 6.35, 1.45, { size: 12.5, space: 8 });
    const rx3 = 7.85, rw3 = W - MARG - rx3;
    card(s, rx3, 1.7, rw3, 4.95, FAINT);
    s.addText('Common shapes', { x: rx3 + 0.28, y: 1.9, w: rw3 - 0.56, h: 0.33, fontFace: F, fontSize: 14, bold: true, color: CRIMD, margin: 0 });
    const shapes = [
      ['--tx-size 64 --rx-size 64 --pps max', 'small-packet torture test'],
      ['--tx-size 128 --rx-size 8192', 'RPC-shaped: small ask, big answer'],
      ['--gbps 10 --tx-size 1400', 'size the rate from a bandwidth budget'],
      ['mx start --bind eth1', 'pin to the data NIC — retargets peers’ addresses too, both halves of the job'],
    ];
    shapes.forEach((sh, i) => {
      const yy = 2.35 + i * 1.06;
      s.addText(sh[0], { x: rx3 + 0.28, y: yy, w: rw3 - 0.56, h: 0.3, fontFace: FM, fontSize: 11, bold: true, color: INK, margin: 0 });
      s.addText(sh[1], { x: rx3 + 0.28, y: yy + 0.3, w: rw3 - 0.56, h: 0.6, fontFace: F, fontSize: 11, color: MUTED, margin: 0 });
    });
    noteText(s,
      'The classic use: find the sustainable all-to-all packet rate. Sanity-check with mx check first -- it knows what the NICs can carry, so you don’t blame the network for physics. Then ramp: fifty thousand, one hundred thousand, and so on; the last rate that delivers cleanly is the answer. ' +
      'Two tells, in order: p99 latency lifting off the p50 means queues are filling -- that happens before loss. Then delivered falls behind requests. pps max skips the ramp and finds the ceiling fastest, but tells you less about where the knee is. ' +
      'On the right, the run shapes you’ll actually type -- including --bind for two-NIC fleets, which retargets the destination addresses too, because binding only your own socket to the data NIC would send every packet to an address nobody listens on.');
  }

  // -- 24 · Scale shapes ----------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'Best run at every fleet size', CRIM);
    const cols = [
      { t: 'Small fleet (≤ ~30)', sub: 'Full mesh', c: CRIM, items: ['Every pair measured, all the time — the default mx gen', 'Big box, few peers? Add --streams so every core and NIC queue gets work', 'This is the forensic shape: per-pair truth, continuously'] },
      { t: 'Large fleet', sub: '--peers K  (k-regular shuffle)', c: CRIM, items: ['Each host talks to exactly K shuffled peers — equal load by construction, K sockets instead of N−1', 'Same per-host and fabric load as full mesh; seeded + replayable (--seed)', '--streams S multiplies 4-tuples for ECMP path coverage — K×S sockets per host'] },
      { t: 'Huge fleet / full coverage', sub: '--peers K --dwell T  (layered rotation)', c: CRIM, items: ['The K-peer graph rotates through ⌈(N−1)/K⌉ disjoint layers: every ordered pair measured exactly once per cycle', 'Per-host load never changes; no control channel — agents derive the schedule from the seed', '1000 hosts: full every-pair coverage every ~6 min, 8 sockets per host — COVERAGE reported, --equal-layers for dip-free soaks'] },
    ];
    const cw3 = (W - 2 * MARG - 2 * 0.25) / 3;
    cols.forEach((c, i) => {
      const x = MARG + i * (cw3 + 0.25);
      card(s, x, 1.7, cw3, 4.6, FAINT);
      s.addText(c.t, { x: x + 0.26, y: 1.9, w: cw3 - 0.52, h: 0.32, fontFace: F, fontSize: 13.5, bold: true, color: INK, margin: 0 });
      s.addText(c.sub, { x: x + 0.26, y: 2.24, w: cw3 - 0.52, h: 0.32, fontFace: FM, fontSize: 11.5, bold: true, color: c.c, margin: 0 });
      bullets(s, c.items, x + 0.26, 2.7, cw3 - 0.52, 3.5, { size: 11, space: 9 });
    });
    s.addText('Not sure? mx hints --servers s.txt --pps-per-host N does the arithmetic and prints the command.', {
      x: MARG, y: 6.5, w: W - 2 * MARG, h: 0.35, align: 'center', fontFace: FM, fontSize: 12, bold: true, color: CRIMD, margin: 0 });
    noteText(s,
      'How to get the best run out of different fleet sizes. Small fleets: just run the full mesh -- every pair, continuously -- and use --streams when a big box faces few peers. ' +
      'At larger N, a full mesh means N-minus-1 sockets and thin per-flow rates; --peers K builds a k-regular shuffle instead -- every host carries exactly K flows in and out, so per-host load is equal by construction, not statistically, and the seed makes it replayable. ' +
      'When you need every pair measured -- "show me the sick pair" -- but can’t afford the mesh, add --dwell: the K-peer graph rotates through disjoint layers until every ordered pair has been measured exactly once per cycle, with per-host load constant throughout and no coordination channel at all. A thousand hosts get full coverage every six minutes on eight sockets. ' +
      'And mx hints exists precisely so you don’t have to remember this slide.');
  }

  // -- 25 · Stop, clean, limits --------------------------------------------
  {
    const s = lightSlide();
    header(s, 'matrix_orchestrator', 'Stopping, cleaning up, and the honest limits', CRIM);
    const colW = (W - 2 * MARG - 0.4) / 2;
    card(s, MARG, 1.7, colW, 4.6, FAINT);
    s.addText('Leaving no trace', { x: MARG + 0.3, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: INK, margin: 0 });
    bullets(s, [
      'Everything on a server lives in one directory (/var/tmp/mx) — agent, matrix, log, report. No package, no sysctl, no unit file.',
      'mx stop halts the agents; reports and logs stay for later collection.',
      'mx logs and mx summarize first — then mx clean.',
      'mx clean refuses to report success until the directory is verifiably gone and no agent still runs.',
      'Agents flush their current interval on SIGTERM — stopping doesn’t discard the last seconds of data.',
    ], MARG + 0.3, 2.38, colW - 0.6, 3.8, { size: 12, space: 9 });
    card(s, MARG + colW + 0.4, 1.7, colW, 4.6, 'FDF0F0');
    s.addText('Limitations to respect', { x: MARG + colW + 0.7, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: CRIMD, margin: 0 });
    bullets(s, [
      'UDP request/response only — the design, not an oversight.',
      '1–4 Mpps per typical host; beyond a few Mpps the kernel UDP path is the wall as much as Python — wider fleet, or AF_XDP/DPDK.',
      'Key-based ssh assumed everywhere (mx doctor checks the fleet).',
      'Watch the agent column — the tool tells you when it has become the bottleneck; believe it.',
      'A hard fd limit too low still needs an admin: agent refuses to start, doctor names the hosts (FDS-TOO-LOW).',
    ], MARG + colW + 0.7, 2.38, colW - 0.6, 3.8, { size: 12, space: 9 });
    noteText(s,
      'Winding a run down. stop and clean are different verbs on purpose: stop leaves every report and log on the hosts so you can keep summarizing; clean is the scorched-earth verb, and it verifies its own work -- it will not claim success while a directory or an agent survives. ' +
      'The limitations are the same ones from the does/doesn’t slide, but worth restating at the end of the section: it’s UDP by design, a few Mpps per host is the honest ceiling for a stdlib Python tool on the kernel socket path, and the tool self-reports when it saturates. If you need tens of Mpps per host, you have graduated to kernel-bypass tooling -- and you’ll still want mx for the answered-packet truth at sane rates.');
  }

  // =========================== SECTION 3: netmesh ==========================
  divider(3, 'netmesh', 'The idle-network baseline from binnacle — RTT, jitter, loss and path MTU between machines when nothing else is running.', TEAL,
    'Section three: netmesh, from the binnacle toolbox. How it completes the other two, why it probes the way it does, how to run it, read it, clean up after it, and what to do with what it finds.');

  // -- 26 · What & fit ------------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'netmesh', 'The baseline the other two need', TEAL);
    toolTag(s, 'pip install binnacle', TEAL);
    bullets(s, [
      'One of binnacle’s eight diagnostic tools; its question: “is it the network, and which link is sick?”',
      'Measures RTT, jitter, loss and path MTU between machines when nothing else is running — the idle baseline.',
      'iperf_orchestrator answers bandwidth under load; mx answers pps under load. Neither says what the network does idle — and that is the number both of theirs must be read against.',
      'Deliberately the cheapest of the three: ~10 small packets per second per pair. Safe to run on production during an incident.',
      'Two hosts and one line is the design centre — the mesh file, grids and layered scale-up exist, but someone with two boxes never sees them.',
    ], MARG, 1.72, 7.15, 4.6, { size: 13, space: 11 });
    const rx4 = 8.15, rw4 = W - MARG - rx4;
    card(s, rx4, 1.72, rw4, 4.6, 'EAF5F3');
    s.addText('Where it sits', { x: rx4 + 0.28, y: 1.94, w: rw4 - 0.56, h: 0.33, fontFace: F, fontSize: 14, bold: true, color: TEALD, margin: 0 });
    const trio = [
      ['netmesh', 'idle · latency & loss', TEAL],
      ['iperf_orchestrator', 'loaded · TCP bandwidth', AMBER],
      ['matrix_orchestrator', 'loaded · packets/sec', CRIM],
    ];
    trio.forEach((t, i) => {
      const yy = 2.42 + i * 0.95;
      s.addShape('roundRect', { x: rx4 + 0.28, y: yy, w: rw4 - 0.56, h: 0.8, fill: { color: PAPER }, line: { color: LINE, width: 1 }, rectRadius: 0.07 });
      s.addText(t[0], { x: rx4 + 0.5, y: yy + 0.1, w: rw4 - 1.0, h: 0.3, fontFace: FM, fontSize: 11.5, bold: true, color: t[2], margin: 0 });
      s.addText(t[1], { x: rx4 + 0.5, y: yy + 0.4, w: rw4 - 1.0, h: 0.3, fontFace: F, fontSize: 10.5, color: MUTED, margin: 0 });
    });
    s.addText('…and with --baseline it keeps probing while they load, measuring what the load does to latency.', {
      x: rx4 + 0.28, y: 5.35, w: rw4 - 0.56, h: 0.85, fontFace: F, fontSize: 11, italic: true, color: TEALD, margin: 0 });
    noteText(s,
      'netmesh completes the family. The load tools tell you what the fabric can carry; netmesh tells you what the fabric is like when nothing is asked of it -- and a 9.4-gigabit result over a 300-microsecond path and the same result over a 42-millisecond path are different results. ' +
      'Why run it: before blaming the network in an incident, before commissioning load tests, and as the recurring health probe -- it is light enough, ten small packets a second per pair, to run against production. ' +
      'It also bridges the two worlds: run it with --baseline around a load test and it reports what the load did to latency, which is the number everyone else sharing that path experiences.');
  }

  // -- 27 · How it probes ---------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'netmesh', 'UDP echoes between temporary agents — not ping', TEAL);
    iconRows(s, [
      { icon: 'shield', color: TEAL, head: 'No root, anywhere', body: 'Ordinary unprivileged UDP sockets both ends. Raw ICMP needs root or capabilities — which would break “drops onto any host”.' },
      { icon: 'clock', color: TEAL, head: 'Exact RTT, one clock', body: 'The sender writes its own monotonic timestamp into the packet; the responder echoes it untouched. No NTP assumptions, ever.' },
      { icon: 'shuffle', color: TEAL, head: 'Loss split into legs', body: 'The responder independently counts what arrived — a sick sender and a sick receiver are different findings. ping cannot do this.' },
      { icon: 'activity', color: TEAL, head: 'It measures the data plane', body: 'ICMP is answered by router control planes — rate-limited, deprioritised — so it systematically lies about what application traffic sees.' },
    ], MARG, 1.8, 7.2, 1.22, TEAL);
    const rx5 = 8.2, rw5 = W - MARG - rx5;
    card(s, rx5, 1.8, rw5, 2.5, FAINT);
    s.addText('One-way delay: deliberately absent', { x: rx5 + 0.26, y: 2.0, w: rw5 - 0.52, h: 0.55, fontFace: F, fontSize: 13.5, bold: true, color: INK, margin: 0 });
    s.addText('Without PTP, clock offset would swamp the microseconds that matter. Instead: two separate round trips (A→B timed by A, B→A timed by B), compared. Every number quoted is one that is actually true.', {
      x: rx5 + 0.26, y: 2.5, w: rw5 - 0.52, h: 1.7, fontFace: F, fontSize: 11.5, color: MUTED, margin: 0 });
    card(s, rx5, 4.5, rw5, 2.15, 'EAF5F3');
    s.addText('Can’t deploy an agent?', { x: rx5 + 0.26, y: 4.68, w: rw5 - 0.52, h: 0.32, fontFace: F, fontSize: 13.5, bold: true, color: TEALD, margin: 0 });
    s.addText('Prefix a token with ~ (a VIP, a router, an appliance) and it’s probed with ping instead — but segregated in the report as ONE-SIDED, because those rows carry materially less truth.', {
      x: rx5 + 0.26, y: 5.05, w: rw5 - 0.52, h: 1.5, fontFace: F, fontSize: 11.5, color: MUTED, margin: 0 });
    noteText(s,
      'How it measures, because the mechanism is the credibility. UDP echoes between temporary agents give four things at once that ping cannot: no privileges anywhere; RTT read from a single clock, since the sender’s own timestamp comes back in the echo; loss split into forward and return legs, because the responder counts what actually arrived; and data-plane truth, since ICMP is handled by exactly the router path that gets rate-limited. ' +
      'One-way delay is deliberately not reported -- without hardware time sync it would be a number that is not true. And for endpoints you can’t ssh to -- a VIP, a gateway -- the tilde prefix falls back to ping, clearly quarantined in the report rather than silently mixed in.');
  }

  // -- 28 · Running netmesh -------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'netmesh', 'Running it', TEAL);
    codeBlock(s, MARG, 1.7, 7.35, 3.15, [
      [{ t: '$ ', c: '6FCF97', b: true }, { t: 'netmesh selftest', c: 'FFFFFF' }, { t: '            # prove it works here first', c: '7C8CA0' }],
      [{ t: '$ ', c: '6FCF97', b: true }, { t: 'netmesh check web01 db01', c: 'FFFFFF', b: true }, { t: '    # one-shot: gen, deploy, probe,', c: '7C8CA0' }],
      [{ t: '', c: 'E8EEF6' }, { t: '                             # summarize, clean', c: '7C8CA0' }],
      [{ t: '$ ', c: '6FCF97', b: true }, { t: 'netmesh gen --servers prod.txt', c: 'FFFFFF' }, { t: '   # a mesh file for repeat runs', c: '7C8CA0' }],
      [{ t: '$ ', c: '6FCF97', b: true }, { t: 'netmesh run --for 300 --grid grids/', c: 'FFFFFF' }],
      [{ t: '$ ', c: '6FCF97', b: true }, { t: 'netmesh check web03 db01 --flows 8', c: 'FFFFFF' }, { t: ' # sweep ECMP/LAG paths', c: '7C8CA0' }],
      [{ t: '$ ', c: '6FCF97', b: true }, { t: 'netmesh run --baseline 20 -- ./iperf_orchestrator.sh all', c: 'FFFFFF' }],
      [{ t: '', c: 'E8EEF6' }, { t: '                             # idle first, then probe under load', c: '7C8CA0' }],
    ], 11.5);
    bullets(s, [
      'Same verb set as mx — gen / start / status / summarize / stop / clean, plus run, doctor, collect, logs — and the mesh file shares mx’s matrix grammar.',
      'check is the headline verb: everything from deploy to cleanup in one shot, mesh file written to a temp dir and deleted. --keep-mesh graduates it into a repeatable run.',
    ], MARG, 5.1, 7.35, 1.6, { size: 12, space: 9 });
    const rx6 = 8.3, rw6 = W - MARG - rx6;
    card(s, rx6, 1.7, rw6, 4.95, 'EAF5F3');
    s.addText('Why --flows matters', { x: rx6 + 0.26, y: 1.9, w: rw6 - 0.52, h: 0.33, fontFace: F, fontSize: 13.5, bold: true, color: TEALD, margin: 0 });
    s.addText('One source port = one 5-tuple = one path through a LAG or ECMP bundle. A sick member gets hit — or missed — by luck: the fault that never reproduces. --flows N sweeps the source port across N buckets (splitting the rate, not multiplying it) and compares them: “port 40008 sees p50 4.1 ms where the median flow sees 142 µs — same pair, same instant, so what differs is the bundle member.”', {
      x: rx6 + 0.26, y: 2.34, w: rw6 - 0.52, h: 4.2, fontFace: F, fontSize: 11.5, color: INK, margin: 0 });
    noteText(s,
      'Running it. The design centre is two hosts, one line: netmesh check, which generates a throwaway mesh, deploys, probes, summarizes and cleans up behind itself. selftest proves the machinery on loopback before you involve a second machine. ' +
      'For repeatable runs the verbs mirror mx exactly, and the mesh file shares the matrix grammar -- learn one, know the other. ' +
      'The flag to remember is --flows: single-flow tests take one path through a LAG or ECMP bundle, so a sick member is hit or missed by luck. Sweeping source ports pins it: same pair, same moment, one bucket 29 times slower -- that is a bundle member, not a fabric. It splits the probe rate rather than multiplying it, so looking harder never adds load.');
  }

  // -- 29 · Reading netmesh -------------------------------------------------
  {
    const s = lightSlide();
    header(s, 'netmesh', 'Reading the report', TEAL);
    const findings = [
      { h: 'BASELINE', b: 'Headline = median of pair p50s — one sick pair can’t move it or hide inside it. Worst pairs ranked by p99.', c: TEAL },
      { h: 'ASYMMETRY', b: 'A→B slower than B→A ⇒ look at A’s egress — the return path just proved itself fine. Diagnosis is computed: shared source → egress; shared destination → ingress; group boundary → the path between.', c: TEAL },
      { h: 'PATH MTU · BLACKHOLE', b: 'Small packets echo, large ones vanish, no error comes back: apps hang on big transfers, work on small ones. Found without root, via a binary search where only an end-to-end echo counts.', c: TEAL },
      { h: 'PATH SPREAD', b: 'One source-port bucket 28.9× slower than the median ⇒ a sick LAG/ECMP member, named while the run is fresh.', c: TEAL },
      { h: 'UNDER LOAD', b: 'p99 210 µs idle → 42 ms loaded: the queue in front of the bottleneck — what everything sharing the path paid for the throughput number. Loss that only appears under load gets its own finding.', c: TEAL },
    ];
    let y = 1.68;
    findings.forEach(f => {
      card(s, MARG, y, W - 2 * MARG, 0.9, FAINT);
      s.addText(f.h, { x: MARG + 0.25, y: y + 0.1, w: 2.85, h: 0.7, fontFace: FM, fontSize: 11.5, bold: true, color: TEALD, margin: 0, valign: 'middle' });
      s.addText(f.b, { x: MARG + 3.2, y: y + 0.08, w: W - 2 * MARG - 3.45, h: 0.76, fontFace: F, fontSize: 11, color: INK, margin: 0, valign: 'middle' });
      y += 1.0;
    });
    s.addText('And a clean run says so plainly — “the network is not your problem” — then points you at mx and iperf_orchestrator for the load question.', {
      x: MARG, y: 6.7, w: W - 2 * MARG, h: 0.35, align: 'center', fontFace: F, fontSize: 12, italic: true, color: TEALD, margin: 0 });
    noteText(s,
      'How to interpret it. The headline is the median of the pair p50s -- deliberately robust, so one sick pair neither drags the fleet number nor hides. The interesting sections are the findings: asymmetry localizes a fault to one host’s egress or ingress, because the opposite direction just proved the rest of the path; the MTU blackhole is the classic "small requests work, large transfers hang" bug, caught without root; path spread names a sick LAG member; and the under-load section prices the load test in latency terms. ' +
      'Every diagnosis is computed from rules, not canned prose -- and a healthy network is stated in as many words, because no output should read like breakage.');
  }

  // -- 30 · netmesh cleanup & follow-up ------------------------------------
  {
    const s = lightSlide();
    header(s, 'netmesh', 'Cleaning up, and following up', TEAL);
    const colW = (W - 2 * MARG - 0.4) / 2;
    card(s, MARG, 1.7, colW, 4.7, FAINT);
    s.addText('Stopping & cleaning', { x: MARG + 0.3, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: INK, margin: 0 });
    bullets(s, [
      'check cleans up after itself — the two-host case never leaves anything behind.',
      'For managed runs: stop keeps reports; clean stops and removes every trace. No package, no daemon, no dotdir, no sysctl — ever.',
      'Agents flush the current interval on SIGTERM — no data loss at shutdown.',
      'Old reports replay: summarize --reports ./reports — even re-split around a load window after the fact (--load-split).',
    ], MARG + 0.3, 2.38, colW - 0.6, 3.9, { size: 12, space: 9 });
    card(s, MARG + colW + 0.4, 1.7, colW, 4.7, 'EAF5F3');
    s.addText('Following up on findings', { x: MARG + colW + 0.7, y: 1.92, w: colW - 0.6, h: 0.35, fontFace: F, fontSize: 15, bold: true, color: TEALD, margin: 0 });
    bullets(s, [
      'Sick pair? netmesh paths --compare sick:pair healthy:pair — hop lists side by side, first divergent hop marked. That hop is where to look.',
      'Grids (--grid) drop into the same spreadsheet as mx’s — line up idle RTT against loaded loss, pair by pair.',
      'Clean baseline? Then the network isn’t the problem — go load it: mx run --for 60, iperf-orchestrator all.',
      'Suspicious latency floor? The report flags when a NIC’s rx-usecs coalescing timer is what you measured — with the ethtool line to fix it.',
      'Box slow anyway? binnacle’s why-slow checks the host before you blame the network again.',
    ], MARG + colW + 0.7, 2.38, colW - 0.6, 3.9, { size: 12, space: 9 });
    noteText(s,
      'Cleanup mirrors the rest of the family: check leaves literally nothing, and clean verifies removal for managed runs. Reports are replayable artifacts -- you can re-analyze last month’s run, even re-split it around a load window after the fact. ' +
      'Following up is where netmesh shines: paths --compare diffs the route of a sick pair against a healthy one and marks the first divergent hop -- that hop is where to look. If the baseline is clean, the network is not your problem, and the report itself tells you to go run the load tools. And when a host, not the network, is the suspect, binnacle’s why-slow is one command away. ' +
      'Also worth a beat: the tool audits its own measurement -- if a NIC’s interrupt-coalescing timer is the floor you measured, it says so and prints the ethtool line.');
  }

  // -- 31 · Closing ---------------------------------------------------------
  {
    const s = darkSlide();
    heatGrid(s, 10.35, 4.35, 5, 0.46, 0.11, { base: NAVY2, hot: TEAL, mid: '223650', seed: 4 });
    s.addText('PUTTING IT TOGETHER', { x: MARG, y: 0.55, w: 9, h: 0.35, fontFace: F, fontSize: 12, bold: true, color: TEAL, charSpacing: 4, margin: 0 });
    s.addText('One list, four tools, a fabric you can vouch for', { x: MARG, y: 0.92, w: W - 2 * MARG, h: 0.6, fontFace: F, fontSize: 27, bold: true, color: PAPER, margin: 0 });
    const flow = [
      ['reachable prod.txt -i', 'prune the list — the run survives the dead', GREEN],
      ['netmesh check …', 'idle baseline: RTT, loss, MTU — is the fabric even healthy?', TEAL],
      ['iperf-orchestrator all', 'TCP bandwidth, every link both ways — what breaks under load?', AMBER],
      ['mx run --for 300', 'answered packets/sec — the RPC-shaped ceiling', CRIM],
      ['netmesh run --baseline 20 -- <load>', 'what the load did to latency — the number everyone else pays', TEAL],
    ];
    let y = 1.8;
    flow.forEach((f, i) => {
      s.addShape('roundRect', { x: MARG, y: y, w: 4.6, h: 0.62, fill: { color: NAVY2 }, line: { color: f[2], width: 1.25 }, rectRadius: 0.08 });
      s.addText(f[0], { x: MARG + 0.2, y: y, w: 4.3, h: 0.62, fontFace: FM, fontSize: 11.5, bold: true, color: f[2], margin: 0, valign: 'middle' });
      s.addText(f[1], { x: MARG + 4.85, y: y, w: 5.7, h: 0.62, fontFace: F, fontSize: 11.5, color: FOG, margin: 0, valign: 'middle' });
      y += 0.76;
    });
    s.addText('Take these home', { x: MARG, y: 5.85, w: 4, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: PAPER, margin: 0 });
    s.addText([
      { text: 'Baseline before load — a throughput number without its idle RTT is half a result.   ', options: { breakLine: true, color: FOG } },
      { text: 'Trust what arrived, not what was sent — and watch the CPU, or you’re measuring the tool.   ', options: { breakLine: true, color: FOG } },
      { text: 'Keep the list real — reachable is why the whole pipeline still runs when servers are down.', options: { color: FOG } },
    ], { x: MARG, y: 6.25, w: 9.6, h: 1.0, fontFace: F, fontSize: 12, margin: 0 });
    noteText(s,
      'The closing picture: one server list drives the whole pipeline. Prune it with reachable so dead hosts can’t sabotage the run. Baseline with netmesh so every later number has context. Flood with iperf_orchestrator to find what breaks. Rate-test with mx to find the answered-packet ceiling. And wrap netmesh around the load to see what the load costs everyone else on the path. ' +
      'Three takeaways: baseline before load; trust receiver-side numbers and keep the tool’s own CPU in view; and keep the list honest -- that is what makes all of this runnable on a real, imperfect fleet on any given day. ' +
      'Everything shown is pip-installable: iperf-orchestrator, matrix-orchestrator, binnacle. Questions welcome.');
  }

  await pres.writeFile({ fileName: path.join(__dirname, 'network_testing.pptx') });
  console.log('wrote network_testing.pptx');
}

build().catch(e => { console.error(e); process.exit(1); });
