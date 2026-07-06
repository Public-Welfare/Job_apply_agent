'use strict';

const { AgentOrchestrator } = require('./src/agent/orchestrator');
const { TrackerService } = require('./src/services/trackerService');
const { DiscoveryService } = require('./src/services/discoveryService');
const { loadProfile } = require('./src/models');

// Minimal ANSI colour helpers (Node writes UTF-8 by default, so no cp1252 fix
// is needed the way the Python CLI required one).
const C = {
  reset: '\x1b[0m',
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

async function crawl() {
  const profile = loadProfile();
  const locations = profile.preferences.locations;

  // The web UI can pass a chosen subset of roles via CRAWL_ROLES; otherwise use
  // every role from the profile.
  let selected = [];
  try {
    selected = JSON.parse(process.env.CRAWL_ROLES || '[]');
  } catch {
    selected = [];
  }
  const roles = selected.length ? selected : profile.preferences.roles;

  console.log(`\n${C.bold(C.cyan(' Job Apply Agent'))}\n`);
  console.log(C.dim(`Roles   : ${roles.slice(0, 3).join(', ')}${roles.length > 3 ? '…' : ''}`));
  console.log(C.dim('Sources : Indeed India + RemoteOK'));
  console.log(C.dim(`Locations: ${locations.slice(0, 3).join(', ')}\n`));

  const agent = new AgentOrchestrator();
  // Build one search instruction per selected role (cap at 5 to bound the run),
  // pairing each with a target location.
  const message =
    roles.slice(0, 5)
      .map((r, i) => `Search for "${r}" jobs in "${locations[i % locations.length] || locations[0]}" (2 pages), and process every job found.`)
      .join(' ') + ' Then report a summary of processed vs skipped.';

  console.log(C.green('Agent running...'));
  const onTool = (name, args) => {
    const preview = Object.values(args).slice(0, 2).map((v) => String(v).slice(0, 40));
    console.log(C.dim(`  [${name}] ${preview.join(' | ')}`));
  };

  const [summary, results] = await agent.run(message, onTool);

  const processed = results.filter((r) => r.tool === 'process_job' && r.result.processed);
  const skipped = results.filter((r) => r.tool === 'process_job' && r.result.skipped);
  const searches = results.filter((r) => r.tool === 'search_jobs');
  const totalFound = searches.reduce((sum, r) => sum + (r.result.found || 0), 0);

  console.log(`\n${C.bold(C.green(' Done!'))}\n`);
  console.log(`  Jobs found   : ${C.bold(String(totalFound))}`);
  console.log(`  Processed    : ${C.bold(C.green(String(processed.length)))}`);
  console.log(`  Skipped      : ${C.bold(C.yellow(String(skipped.length)))}`);

  if (processed.length) {
    console.log(`\n${C.bold(C.yellow(' Generated Resumes:'))}`);
    for (const r of processed) {
      console.log(`\n  ${C.bold(r.args.company || '')} — ${r.args.title || ''}`);
      console.log(C.dim(`  Keywords : ${(r.result.keywords_matched || []).join(', ')}`));
      console.log(C.dim(`  PDF      : ${r.result.resume_path}`));
      console.log(C.dim(`  Apply    : ${r.result.apply_url}`));
    }
  }

  if (skipped.length) {
    console.log(`\n${C.dim(' Skipped:')}`);
    for (const r of skipped) {
      const company = r.args.company || '';
      console.log(C.dim(`  • ${company} — ${r.result.reason}`));
    }
  }

  if (summary) {
    console.log(`\n${C.cyan(' Agent summary:')}\n${C.dim(summary)}`);
  }
}

function pad(s, width) {
  s = String(s == null ? '' : s);
  if (s.length > width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function status() {
  const tracker = new TrackerService();
  const apps = tracker.getAll();

  console.log(`\n${C.bold(C.cyan(' Application Tracker'))}\n`);

  if (!apps.length) {
    console.log(C.dim('No applications yet. Run: node main.js crawl'));
    return;
  }

  const byStatus = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] || 0) + 1;

  const colors = { applied: C.blue, interview: C.yellow, offer: C.green, rejected: C.red };
  for (const [s, count] of Object.entries(byStatus)) {
    const color = colors[s] || ((x) => x);
    console.log(`  ${color(pad(s, 12))} : ${count}`);
  }

  console.log(`\n  ${C.bold(pad('Date', 12))}${C.bold(pad('Company', 22))}${C.bold(pad('Role', 30))}${C.bold(pad('Source', 14))}${C.bold('Status')}`);

  const recent = apps.slice(-15).reverse();
  for (const a of recent) {
    const date = new Date(a.applied_at);
    const dateStr = Number.isNaN(date.getTime())
      ? pad('', 12)
      : pad(date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), 12);
    const color = colors[a.status] || ((x) => x);
    console.log(
      `  ${dateStr}${pad(a.company, 22)}${pad(a.title, 30)}${pad(a.source, 14)}${color(a.status)}`
    );
  }
  console.log('');
}

async function discover() {
  console.log(`\n${C.bold(C.cyan(' Job Discovery — multi-source fetch + classify'))}\n`);
  const { total, perSource, byType } = await new DiscoveryService().run((line) =>
    console.log(C.dim(line))
  );
  console.log(`\n${C.bold(C.green(` Done — ${total} jobs cached`))}`);
  console.log(`\n${C.cyan(' By source:')}`);
  for (const [s, n] of Object.entries(perSource)) console.log(`  ${s.padEnd(14)} ${n}`);
  console.log(`\n${C.cyan(' By job type:')}`);
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(14)} ${n}`);
  }
  console.log('');
}

function showHelp() {
  console.log(`\n${C.bold(C.cyan(' Job Apply Agent — Commands'))}\n`);
  console.log(`  ${C.bold('node main.js crawl')}    ${C.dim('Search jobs, tailor resumes, save tracker')}`);
  console.log(`  ${C.bold('node main.js discover')} ${C.dim('Fetch from all sources, classify by job type, cache')}`);
  console.log(`  ${C.bold('node main.js status')}   ${C.dim('Show all tracked applications')}`);
  console.log(`\n${C.cyan(' First-time setup:')}`);
  console.log(C.dim('  1. cp .env.example .env'));
  console.log(C.dim('  2. npm install'));
  console.log(C.dim('  3. npx playwright install chromium'));
  console.log(C.dim('  4. node main.js crawl\n'));
}

async function main() {
  const cmd = process.argv[2] || 'help';
  switch (cmd) {
    case 'crawl':
      await crawl();
      break;
    case 'discover':
      await discover();
      break;
    case 'status':
      status();
      break;
    default:
      showHelp();
  }
}

main().catch((e) => {
  console.error(C.red(`\nError: ${e.stack || e.message}`));
  process.exit(1);
});
