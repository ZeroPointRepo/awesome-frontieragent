#!/usr/bin/env node
// Build CATALOG.md and catalog.csv: the full machine-built index for this list.
//
// README.md is the curated, organized page and is written by hand. These two files are not: they
// are rebuilt from scratch on every run of the refresh-catalog workflow, from two live sources.
//
//   1. README.md's own catalog section - the curated entries, parsed out of the page itself so the
//      layers can never drift apart.
//   2. The GitHub repository-search API - everything in this ecosystem the search can reach, top
//      of search by stars, capped at MAX_CANDIDATES.
//
// Every candidate has to earn its row: the repo resolves through the API, is not archived, is not
// a fork, and is not a rename of the slug we point at. Anything that fails is dropped and the drop
// counts are printed, so a shrinking catalog is visible rather than silent.
//
// Reference implementation with a per-ecosystem install check bolted on:
// https://github.com/ZeroPointRepo/awesome-dsh-plugins/blob/main/.github/scripts/build-catalog.mjs
//
// Usage: GH_TOKEN=... node .github/scripts/build-catalog.mjs

import { readFileSync, writeFileSync } from 'node:fs';

// ------------------------------------------------------------------ TUNE THIS BLOCK PER REPO

// What the reader is browsing. Used in the CATALOG.md heading and the count line.
const ORG = 'ZeroPointRepo';
const REPO = 'awesome-frontieragent';
const NOUN = 'FrontierAgent project';
const NOUN_PLURAL = 'FrontierAgent projects';
const TITLE = 'FrontierAgent catalog';

// How the catalog finds candidates. Repository search, not code search: code search does not work
// with the Actions GITHUB_TOKEN. Add the topics and phrases this ecosystem actually uses.
const QUERIES = [
  "FrontierAgent",
  "ApodexAI",
  "topic:frontieragent",
];

// Owners that are the upstream project itself, or other people's list repos. Not entries.
// Kharisma1980: a verbatim re-upload of FrontierAgent (identical tree and README, pushed
// 2026-08-27, not a GitHub fork so the fork filter misses it). Licence-compliant, but a mirror
// with nothing added is not a catalog entry.
const DENY_OWNERS = new Set(['Kharisma1980']);

// OPTIONAL. If entries in this ecosystem are installed with a command, set a regex that matches a
// real one in a project's own README, e.g. /^\s*(thing\s+install\s+\S+.*?)\s*$/i. When set, the
// catalog gains an Install column and a row only counts as verified when the command comes out of
// the project's own docs. Leave null for lists where there is nothing to install.
const INSTALL_RE = null;

// ------------------------------------------------------------------ end of tunable block

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 400);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);

const H = {
  'User-Agent': 'awesome-frontieragent-catalog',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, tries = 5) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await fetch(url, { headers: H });
    if (r.ok) return r;
    // Secondary rate limiting is the normal failure here, and it is temporary. Waiting it out is
    // the difference between a good row and a row that silently reads as unverified.
    if (r.status === 403 || r.status === 429) {
      const retryAfter = Number(r.headers.get('retry-after')) || 0;
      await sleep(Math.max(retryAfter * 1000, 4000 * 2 ** i));
      continue;
    }
    return r;
  }
  return r;
}

// Some projects document a pinned ref as a shell variable rather than inline:
//   THING_REF=v2.4.0
//   thing install "github:owner/repo#${THING_REF}"
// Substituting the assignments before matching is the difference between checking that pin and
// reporting a correctly pinned entry as drift.
function expandVars(md) {
  const vars = new Map();
  for (const m of md.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})=["']?([\w.@#/-]+)["']?\s*$/gm)) {
    vars.set(m[1], m[2]);
  }
  if (!vars.size) return md;
  return md.replace(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g, (all, name) => (vars.has(name) ? vars.get(name) : all));
}

let readFailures = 0;

// File bodies come from the raw CDN, which costs nothing against the installation's 5,000 REST
// calls an hour. That allowance is shared with every other workflow in the repo, and spending it on
// file reads is what starved a link-check job the first time this ran at full size. The REST
// contents endpoint is kept as the fallback for the one thing raw cannot do: resolve which of
// README.md, readme.md or README.rst a repo actually has.
async function rawText(slug, file) {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${slug}/HEAD/${file}`, {
      headers: { 'User-Agent': H['User-Agent'] },
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 404) return '';
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function fetchReadme(slug) {
  const quick = await rawText(slug, 'README.md');
  if (quick) return expandVars(quick);
  const r = await api(`https://api.github.com/repos/${slug}/readme`);
  if (!r.ok) {
    readFailures++;
    console.log(`  could not read ${slug}'s README (HTTP ${r.status})`);
    return null;
  }
  const j = await r.json();
  return expandVars(Buffer.from(j.content, 'base64').toString('utf8'));
}

// ---------------------------------------------------------------- README (curated entries)

const readme = readFileSync('README.md', 'utf8');
// Scoped to the catalog section only, so a Featured entry or a link inside the "Good to know"
// accordions cannot inflate the count.
const cStart = readme.indexOf('## The catalog');
const cEnd = readme.indexOf('## Good to know');
// Strip HTML comments first. The scaffold leaves the entry SHAPE in a TODO comment in every empty
// category, and that shape starts with "- **...**". Without this it parses as a phantom entry.
const catalogText = (cStart >= 0 && cEnd > cStart ? readme.slice(cStart, cEnd) : readme).replace(
  /<!--[\s\S]*?-->/g,
  ''
);
const rLines = catalogText.split('\n');

// An entry starts on a bold action line and its links and command follow within a few lines:
//   - **What it does for the reader** with
//     [name](https://github.com/owner/repo) by [author](author-url). Description. N★, LICENSE.
// The project's own repo link is the FIRST github.com link in the block; the author link is second.
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const curated = [];
let section = null;
for (let i = 0; i < rLines.length; i++) {
  const h = rLines[i].match(/^### (.+?)\s*$/);
  if (h) section = h[1];
  if (!/^- \*\*/.test(rLines[i])) continue;
  const headline = (rLines[i].match(/^- \*\*(.+?)\*\*/) || [])[1] || null;
  let name = null;
  let slug = null;
  let cmd = null;
  for (let j = i; j < Math.min(i + 12, rLines.length); j++) {
    if (j > i && /^- \*\*/.test(rLines[j])) break; // next entry started
    if (!slug) {
      const m = rLines[j].match(/\[([^\]]+)\]\(https:\/\/github\.com\/([^/)]+)\/([^/)#]+)\)/);
      if (m) {
        name = m[1];
        slug = `${m[2]}/${m[3].replace(/\.git$/i, '')}`;
      }
    }
    if (/^\s*```/.test(rLines[j])) {
      cmd = (rLines[j + 1] || '').trim();
      break;
    }
  }
  if (!slug) continue;
  curated.push({ name, slug, desc: headline, cmd, section, curated: true });
}
console.log(`Curated entries parsed from README.md: ${curated.length}`);

// ---------------------------------------------------------------- discovery (repo search)

const isList = (fullName) => /^awesome[-_]/i.test(fullName.split('/')[1] || '');

const found = new Map();
let searchPages = 0;
for (const q of QUERIES) {
  for (let page = 1; page <= 3; page++) {
    const r = await api(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`
    );
    searchPages++;
    if (!r.ok) {
      console.log(`  search "${q}" page ${page}: HTTP ${r.status}, skipping rest of this query`);
      break;
    }
    const j = await r.json();
    const items = j.items || [];
    for (const it of items) {
      if (it.archived || it.fork) continue;
      if (DENY_OWNERS.has(it.full_name.split('/')[0])) continue;
      if (isList(it.full_name)) continue;
      if (!found.has(it.full_name)) found.set(it.full_name, it);
    }
    if (items.length < 100) break;
    await sleep(2500); // search API is 30 req/min
  }
  await sleep(2500);
}
console.log(`Discovery: ${found.size} unique candidate repos from ${searchPages} search requests`);
if (found.size === 0) {
  console.error('Search returned nothing. Keeping the existing catalog instead of shrinking it.');
  process.exit(1);
}

const curatedSlugs = new Set(curated.map((e) => e.slug.toLowerCase()));
const ranked = [...found.values()]
  .filter((it) => !curatedSlugs.has(it.full_name.toLowerCase()))
  .sort((a, b) => b.stargazers_count - a.stargazers_count);
const shortlist = ranked.slice(0, MAX_CANDIDATES);

// Every candidate discovery turned up has to end this run in exactly one bucket. A candidate that
// is capped away, or skipped because the REST budget ran low, is not "dropped" and is not "listed",
// and if it lands in neither it disappears: the page then reads as if we checked everything, which
// is the exact failure the cap and the budget guard exist to prevent. The reconciliation at the end
// is asserted, so a bucket added later and left out of it fails the run rather than quietly
// shrinking the visible total.
const discovery = {
  candidates: ranked.length,
  notReachedByCap: ranked.length - shortlist.length,
  skippedForBudget: 0,
  droppedUnreadable: 0,
  droppedNoCommand: 0,
  listed: 0,
};
if (discovery.notReachedByCap > 0) {
  console.log(
    `Capped at MAX_CANDIDATES=${MAX_CANDIDATES}: ${discovery.notReachedByCap} lower-starred candidates not reached this run`
  );
}

// ---------------------------------------------------------------- install-command handling

const PLACEHOLDER =
  /[<>]|path\/to|\/Users\/|(?:^|[\s"'(])[A-Za-z]:[\\/]|%[A-Za-z_]+%|your[-_]|YOUR[-_]|\.\.\/|~\/|link:\.|file:/;

function selfRefScore(fullName, line) {
  const [owner, repo] = fullName.toLowerCase().split('/');
  const l = line.toLowerCase();
  let score = 0;
  if (l.includes(repo)) score += 2;
  if (l.includes(owner)) score += 1;
  const compact = repo.replace(/[-_.]/g, '');
  if (compact.length > 3 && l.replace(/[-_.]/g, '').includes(compact)) score += 1;
  return score;
}

function extractCommand(fullName, md) {
  if (!INSTALL_RE) return null;
  const hits = [];
  for (const raw of md.split('\n')) {
    const m = raw.match(INSTALL_RE);
    if (!m) continue;
    const line = m[1].trim().replace(/\s+#.*$/, '');
    if (PLACEHOLDER.test(line)) continue;
    if (/^\.{0,2}\//.test(line.split(/\s+/).pop())) continue;
    hits.push({ line, score: selfRefScore(fullName, line) });
  }
  hits.sort((a, b) => b.score - a.score || a.line.length - b.line.length);
  return hits[0] && hits[0].score >= 2 ? hits[0].line : null;
}

// ---------------------------------------------------------------- screenshots (data capture only)

// Collected now, displayed nowhere. CATALOG.md stays a text table; an image strip built from
// whatever a README happens to contain would be a wall of broken and mismatched art, which is the
// empty-state rule in reverse. This just future-proofs the data for a consumer that does not exist
// yet, so the discipline is: only URLs the project itself published, only GitHub-hosted, never a
// guess and never a hotlink to someone else's image host.
const GH_IMAGE_HOST =
  /^https:\/\/(raw\.githubusercontent\.com\/|user-images\.githubusercontent\.com\/|camo\.githubusercontent\.com\/|private-user-images\.githubusercontent\.com\/|repository-images\.githubusercontent\.com\/|github\.com\/user-attachments\/)/;
const MAX_SHOTS = 4;

// A repo's social preview counts only when the maintainer uploaded one. GitHub serves an
// auto-generated card (opengraph.githubassets.com) for every other repo, and that card is a
// rendered title block, not a screenshot. usesCustomOpenGraphImage is the only honest way to tell
// them apart, and it exists on the GraphQL API only.
async function fetchOgImages(slugs) {
  const out = new Map();
  if (!TOKEN) return out;
  for (let i = 0; i < slugs.length; i += 50) {
    const batch = slugs.slice(i, i + 50);
    const query = `query {${batch
      .map(
        (s, n) =>
          ` r${n}: repository(owner:${JSON.stringify(s.split('/')[0])}, name:${JSON.stringify(
            s.split('/')[1]
          )}) { openGraphImageUrl usesCustomOpenGraphImage }`
      )
      .join('')} }`;
    let r;
    try {
      r = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
    } catch {
      console.log('  social-preview lookup failed (network), continuing without it');
      return out;
    }
    if (!r.ok) {
      console.log(`  social-preview lookup unavailable (HTTP ${r.status}), continuing without it`);
      return out;
    }
    const j = await r.json();
    batch.forEach((slug, n) => {
      const d = j.data && j.data[`r${n}`];
      if (d && d.usesCustomOpenGraphImage && GH_IMAGE_HOST.test(d.openGraphImageUrl || '')) {
        out.set(slug, d.openGraphImageUrl);
      }
    });
  }
  return out;
}

// Images the project's own README points at. Relative paths are resolved against the repo's default
// branch, which is where the README already says the file lives; nothing is fabricated.
function extractImages(slug, md) {
  if (!md) return [];
  const found = [];
  const add = (raw) => {
    if (!raw) return;
    let u = raw.trim().replace(/^<|>$/g, '').replace(/["')]+$/, '').split(/\s+/)[0];
    if (!u || u.startsWith('#') || u.startsWith('data:') || u.startsWith('mailto:')) return;
    if (/^https?:\/\//i.test(u)) {
      if (!GH_IMAGE_HOST.test(u)) return; // third-party image host, never hotlink it
    } else {
      if (/^\/\//.test(u)) return; // protocol-relative, host unknown
      u = `https://raw.githubusercontent.com/${slug}/HEAD/${u.replace(/^\.?\//, '')}`;
    }
    if (!found.includes(u)) found.push(u);
  };
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) add(m[1]);
  for (const m of md.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  return found.slice(0, MAX_SHOTS);
}

// ---------------------------------------------------------------- verify + assemble

// The Actions token gets 5,000 REST calls an hour for the WHOLE installation, shared with every
// other workflow in the repo. A full discovery pass can eat most of that, and the first time one
// did, the link-check job an hour later failed on a rate limit it had no part in causing. So
// discovery stops while there is still budget for the other jobs, and every candidate it did not
// reach is reported rather than dropped on the floor.
const RESERVE = Number(process.env.RATE_RESERVE || 600);
let budgetLeft = Infinity;
async function refreshBudget() {
  try {
    const r = await fetch('https://api.github.com/rate_limit', { headers: H });
    if (!r.ok) return;
    const j = await r.json();
    budgetLeft = j.resources?.core?.remaining ?? Infinity;
  } catch { /* leave the last reading in place */ }
}
await refreshBudget();
console.log(`REST budget at start: ${budgetLeft === Infinity ? 'unknown' : budgetLeft} (reserving ${RESERVE} for other jobs)`);

const rows = [];
const dropped = { unresolved: 0, archived: 0, renamed: 0, noCommand: 0 };

async function run(items, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

// The curated list is the product, so an entry that could not be CHECKED is not the same as an
// entry that failed a check, and calling it a drop is how a low-allowance run quietly turns a
// readable repo into a missing one. It gets its own state and it stops the run.
let curatedUnchecked = 0;
await run(curated, async (e) => {
  if (budgetLeft <= RESERVE) { curatedUnchecked++; return; }
  budgetLeft -= 2; // the repo lookup; file bodies come off the raw CDN
  if (budgetLeft % 250 < 3) await refreshBudget();
  const r = await api(`https://api.github.com/repos/${e.slug}`);
  if (!r.ok) return void dropped.unresolved++;
  const j = await r.json();
  if (j.archived) return void dropped.archived++;
  if (j.full_name.toLowerCase() !== e.slug.toLowerCase()) return void dropped.renamed++;

  const md = await fetchReadme(e.slug);
  let verified = true;
  if (INSTALL_RE && e.cmd) {
    const tok = e.cmd.split(/\s+/).pop().replace(/^['"]|['"]$/g, '');
    verified = md
      ? md.includes(/^https:\/\/github\.com\//.test(tok) ? tok.split('/').slice(-2).join('/') : tok)
      : false;
  }
  rows.push({
    name: e.name,
    slug: j.full_name,
    blurb: e.desc || j.description || '',
    stars: j.stargazers_count,
    cmd: e.cmd,
    verified,
    shots: extractImages(j.full_name, md),
    section: e.section,
    curated: true,
  });
});

await run(shortlist, async (it) => {
  if (budgetLeft <= RESERVE) { discovery.skippedForBudget++; return; }
  budgetLeft -= 1; // the README comes off the raw CDN; this is headroom for the calls around it
  if (budgetLeft % 250 < 2) await refreshBudget();
  const md = await fetchReadme(it.full_name);
  let cmd = null;
  if (INSTALL_RE) {
    if (!md) { discovery.droppedUnreadable++; dropped.unresolved++; return; }
    cmd = extractCommand(it.full_name, md);
    if (!cmd) { discovery.droppedNoCommand++; dropped.noCommand++; return; }
  }
  rows.push({
    name: it.full_name.split('/')[1],
    slug: it.full_name,
    blurb: it.description || '',
    stars: it.stargazers_count,
    cmd,
    verified: true,
    shots: extractImages(it.full_name, md),
    curated: false,
  });
});

// One batched pass, after the rows exist, so a repo with a real uploaded social preview leads with
// it and README images fill in behind.
const og = await fetchOgImages(rows.map((r) => r.slug));
for (const r of rows) {
  const lead = og.get(r.slug);
  r.shots = (lead ? [lead, ...r.shots.filter((u) => u !== lead)] : r.shots).slice(0, MAX_SHOTS);
}
console.log(
  `Screenshots collected: ${rows.filter((r) => r.shots.length).length}/${rows.length} rows have at least one ` +
    `(${og.size} from an uploaded social preview). Data capture only, CATALOG.md is unchanged.`
);

rows.sort((a, b) => b.stars - a.stars || a.slug.localeCompare(b.slug));

discovery.listed = rows.filter((r) => !r.curated).length;

console.log(
  `Rows: ${rows.length} (${rows.filter((r) => r.curated).length} curated, ${discovery.listed} discovered). ` +
    `Curated drops: ${dropped.unresolved} unresolved, ${dropped.archived} archived, ${dropped.renamed} renamed.`
);
if (discovery.skippedForBudget > 0 || curatedUnchecked > 0) {
  console.log(
    `Stopped short to leave ${RESERVE} REST calls for the other jobs in this repo: ` +
      `${curatedUnchecked} curated entries and ${discovery.skippedForBudget} candidates were not checked.`
  );
}
console.log(
  `Discovery coverage of ${discovery.candidates} candidates: ${discovery.listed} listed, ` +
    `${discovery.droppedNoCommand} no usable install command, ${discovery.droppedUnreadable} unreadable, ` +
    `${discovery.skippedForBudget} skipped for REST budget, ${discovery.notReachedByCap} not reached by the MAX_CANDIDATES cap.`
);
const accounted =
  discovery.listed + discovery.droppedNoCommand + discovery.droppedUnreadable +
  discovery.skippedForBudget + discovery.notReachedByCap;
if (accounted !== discovery.candidates) {
  console.error(
    `Coverage does not reconcile: ${accounted} accounted for out of ${discovery.candidates} candidates. ` +
      `Every candidate must end in exactly one bucket, so this is a bug in the buckets, not in the data.`
  );
  process.exit(1);
}

if (curatedUnchecked > 0) {
  console.error(
    `${curatedUnchecked} of ${curated.length} curated entries could not be checked: the REST allowance was ` +
      `already down to the ${RESERVE}-call reserve when this run started. Keeping the existing catalog. ` +
      `This is contention with another workflow, not a data problem, and it clears on the next run.`
  );
  process.exit(1);
}

if (rows.length < curated.length) {
  console.error(`Refusing to write a catalog smaller than the curated list (${rows.length} < ${curated.length}).`);
  process.exit(1);
}

// The curated-list floor is a low bar: a run can lose a third of the catalog and still clear it.
// A big shrink is almost always this run being unable to look properly rather than the ecosystem
// losing a hundred projects overnight, so it has to be asked for out loud.
const previousRows = (() => {
  try { return (readFileSync('CATALOG.md', 'utf8').match(/^\| \[/gm) || []).length; } catch { return 0; }
})();
const SHRINK_FLOOR = Number(process.env.SHRINK_FLOOR || 0.9);
if (previousRows > 0 && rows.length < previousRows * SHRINK_FLOOR) {
  console.error(
    `Refusing to shrink the catalog from ${previousRows} rows to ${rows.length}, below the ` +
      `${Math.round(SHRINK_FLOOR * 100)}% floor. If this is deliberate, say so with SHRINK_FLOOR, and ` +
      `check MAX_CANDIDATES first: lowering it shrinks the catalog and is the usual cause.`
  );
  process.exit(1);
}

// A README we could not read is an unknown, not a failed check. A handful is normal API weather; a
// pile of them means the run is unreliable and would publish false "unverified" marks.
const readFailureBudget = Math.max(5, Math.round(rows.length * 0.05));
console.log(`README reads that failed: ${readFailures} (budget ${readFailureBudget})`);
if (readFailures > readFailureBudget) {
  console.error('Too many README reads failed. Keeping the existing catalog rather than publishing false marks.');
  process.exit(1);
}

// ---------------------------------------------------------------- render

const esc = (s) =>
  String(s || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();

function oneLine(s, max = 120) {
  const t = esc(s);
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

const starsHuman = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

const header = INSTALL_RE ? '| Name | What it does | ★ | Install | ✅ |\n|---|---|---|---|---|' : '| Name | What it does | ★ | ✅ |\n|---|---|---|---|';

const body = rows
  .map((r) => {
    const cells = [`[${esc(r.name)}](https://github.com/${r.slug})`, oneLine(r.blurb), starsHuman(r.stars)];
    if (INSTALL_RE) cells.push(r.cmd ? `\`${esc(r.cmd)}\`` : '—');
    cells.push(r.verified ? '✅' : '—');
    return `| ${cells.join(' | ')} |`;
  })
  .join('\n');

writeFileSync(
  'CATALOG.md',
  `# ${TITLE}

Auto-generated index of every ${NOUN} this repo can resolve and check. The curated, organized list
is [README.md](README.md).

${header}
${body}

<sub>${rows.length} ${NOUN_PLURAL} · same rows as data in [catalog.csv](catalog.csv) · rebuilt by
[\`build-catalog.mjs\`](.github/scripts/build-catalog.mjs) on every
[refresh-catalog](.github/workflows/refresh-catalog.yml) run · edits here are overwritten, send them
to [README.md](README.md).</sub>
`
);
console.log(`Wrote CATALOG.md (${rows.length} ${NOUN_PLURAL})`);

// The same rows as data, for anyone consuming the list programmatically. Full untruncated
// description, exact star count, RFC 4180 quoting.
const csvCell = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// screenshots is semicolon-joined so the column stays one CSV field and splits without a parser.
const cols = INSTALL_RE
  ? ['name', 'description', 'stars', 'install_command', 'verified', 'repo_url', 'screenshots']
  : ['name', 'description', 'stars', 'verified', 'repo_url', 'screenshots'];
const csv =
  [cols.join(',')]
    .concat(
      rows.map((r) => {
        const v = [r.name, r.blurb, r.stars];
        if (INSTALL_RE) v.push(r.cmd || '');
        v.push(r.verified, `https://github.com/${r.slug}`, r.shots.join(';'));
        return v.map(csvCell).join(',');
      })
    )
    .join('\n') + '\n';

writeFileSync('catalog.csv', csv);
console.log(`Wrote catalog.csv (${rows.length} rows)`);

// ---------------------------------------------------------------- plugins.json (registry feed)

// dsh-market's own schema, so a market user can point DSHM_REGISTRY_URL at this file and get our
// verified list instead of theirs. Their catalog is a static file too, so this raw URL is the whole
// endpoint. Fields we cannot fill honestly are left out rather than guessed; their type marks them
// optional and their code reads a missing value the same as null.

// An npm name only goes in when the package exists AND its own repository field points back at the
// repo we list. Anything looser attaches someone else's download count to our entry, which is the
// exact claim-jacking their contributing doc warns about.
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function npmSpecOf(cmd) {
  if (!cmd) return null;
  let tok = cmd.trim().split(/\s+/).pop().replace(/^['"]|['"]$/g, '').replace(/^npm:/, '');
  if (/^(github:|git\+|https?:|file:|link:|npm-|\.)/i.test(tok)) return null;
  const m = tok.match(/^((?:@[^@/]+\/)?[^@/]+)(?:@[^@]+)?$/);
  return m && NPM_NAME.test(m[1]) ? m[1] : null;
}

async function resolveNpm(rowsIn) {
  const out = new Map();
  let checked = 0;
  let rejected = 0;
  await run(rowsIn, async (r) => {
    const pkg = npmSpecOf(r.cmd);
    if (!pkg) return;
    checked++;
    let res;
    try {
      res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}`, {
        headers: { 'User-Agent': H['User-Agent'] },
      });
    } catch {
      return;
    }
    if (!res.ok) return void rejected++;
    const j = await res.json();
    const repoField = j.repository && (j.repository.url || j.repository);
    const m = String(repoField || '').match(/github\.com[/:]([^/]+)\/([^/.#?]+)/i);
    const claims = m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
    if (claims && claims === r.slug.toLowerCase()) out.set(r.slug, pkg);
    else rejected++;
  });
  console.log(
    `npm linkage: ${out.size} of ${checked} npm-shaped install specs verified back to their own repo ` +
      `(${rejected} rejected: unpublished, or the package points at a different repository).`
  );
  return out;
}

const npmBySlug = await resolveNpm(rows);

// First-seen ledger. The GitHub API can tell us when a repo was created but not when WE first
// listed it, so this is recorded from now on and never back-dated.
const LEDGER = '.github/data/first-seen.json';
const today = new Date().toISOString().slice(0, 10);
let ledger = { _note: '', seen: {} };
try {
  const parsed = JSON.parse(readFileSync(LEDGER, 'utf8'));
  if (parsed && parsed.seen) ledger = parsed;
} catch {
  /* first run */
}
ledger._note =
  'When this catalog first listed each entry, keyed by owner/repo. Written by ' +
  '.github/scripts/build-catalog.mjs and never edited by hand. The ledger starts on 2026-08-24: ' +
  'every entry present that day carries that date because it is the first date we actually ' +
  'recorded, not the date we listed it. Nothing here is back-dated.';
let firstSeenNew = 0;
for (const r of rows) {
  if (!ledger.seen[r.slug]) {
    ledger.seen[r.slug] = today;
    firstSeenNew++;
  }
}
ledger.seen = Object.fromEntries(Object.entries(ledger.seen).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');

// Categories are the README's own section headings. A discovered row has no section, so it says so
// rather than being filed under a guess.
const UNSORTED = 'unsorted';
const categories = {};
for (const r of rows) {
  const key = r.section ? slugify(r.section) : UNSORTED;
  r.category = key;
  if (!categories[key]) categories[key] = { en: r.section || 'Unsorted' };
}

const REPO_URL = `https://github.com/${ORG}/${REPO}`;
const feed = {
  name: REPO,
  url: REPO_URL,
  source: REPO_URL,
  updated: today,
  count: rows.length,
  coverage: {
    _note:
      'What this run actually looked at. `listed` plus every other field equals `candidates`: a ' +
      'candidate the run did not reach is reported here rather than omitted, because a cap that is ' +
      'not published reads as if everything was checked.',
    candidates: discovery.candidates,
    listed: discovery.listed,
    curated: rows.filter((r) => r.curated).length,
    dropped_no_install_command: discovery.droppedNoCommand,
    dropped_unreadable: discovery.droppedUnreadable,
    skipped_for_rest_budget: discovery.skippedForBudget,
    not_reached_by_cap: discovery.notReachedByCap,
    curated_unchecked_for_rest_budget: curatedUnchecked,
  },
  categories,
  plugins: rows.map((r) => {
    const [owner] = r.slug.split('/');
    const p = {
      name: r.name,
      owner,
      url: `https://github.com/${r.slug}`,
      category: r.category,
      description: { en: esc(r.blurb) },
      stars: r.stars,
      install: r.cmd || '',
      added: ledger.seen[r.slug],
    };
    const pkg = npmBySlug.get(r.slug);
    if (pkg) p.npm = pkg;
    if (r.shots.length) p.screenshots = r.shots;
    return p;
  }),
};

writeFileSync('plugins.json', JSON.stringify(feed, null, 2) + '\n');
console.log(
  `Wrote plugins.json (${rows.length} plugins, ${Object.keys(categories).length} categories, ` +
    `${firstSeenNew} newly added to the first-seen ledger)`
);

// Keep the README's pointer line honest about the count.
const line = `- **Full catalog:** every verified ${NOUN} (${rows.length}) in [CATALOG.md](CATALOG.md)`;
const reNoun = NOUN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const updated = readme.replace(
  new RegExp(`^- \\*\\*Full catalog:\\*\\* every verified ${reNoun} \\(\\d+\\) in \\[CATALOG\\.md\\]\\(CATALOG\\.md\\)$`, 'm'),
  line
);
if (updated !== readme) {
  writeFileSync('README.md', updated);
  console.log('Refreshed the README catalog count');
} else if (!readme.includes('CATALOG.md')) {
  console.error('README.md has no "Full catalog" line to update.');
  process.exit(1);
}
