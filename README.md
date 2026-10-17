# Usalama

**The Arkiv security & trust auditor.** Usalama checks whether a project's *claimed* Arkiv usage
matches its *actual* on-chain behaviour, then publishes a tamper-proof, creator-signed verdict —
as an Arkiv entity itself, so the verdict can't be quietly edited by the auditor, or by the
project being audited.

Built for the **Arkiv Global Tour Stop** pre-Devcon hackathon (CROPS theme), entered under the
**Security** pillar, secondarily **Open Source**. Network: Tiramisu testnet (chain `7738577`).

> *Usalama* is Swahili for "safety" / "security".

---

## Why this exists

Every project in this hackathon has to claim things like *"we filter by `$creator`, not a
writable field"* and *"our entity lifetimes are differentiated and follow product logic."*
Nobody checks those claims against the actual repo and the actual on-chain data — judges read
`schema.md` and trust it, or spend their own time manually verifying it.

Usalama is that check, automated, and published somewhere nobody involved can secretly alter.

**What it actually does:**
1. Statically scans a project's source and `arkiv/schema.md` for known good and bad patterns —
   see [`packages/core/src/rules/`](packages/core/src/rules).
2. Optionally queries a project's *disclosed* wallet addresses directly on Tiramisu, to check
   whether their real entities match what the schema claims — see
   [`liveProbe.ts`](packages/core/src/liveProbe.ts).
3. Publishes the resulting score as an Arkiv entity, signed by the auditor's own wallet — see
   [`entities.ts`](packages/core/src/entities.ts) and [`arkiv/schema.md`](arkiv/schema.md).

Every rule, every entity, every query in this repo is real, working code — not a mockup. See
["Verifying it works"](#verifying-it-works) to prove that to yourself in under two minutes,
with no wallet and no network required.

---

## Project structure

```
usalama/
├── arkiv/
│   ├── schema.md            Required submission file — the entity schema, explained
│   └── friction.md          Required submission file — real issues hit while building
├── packages/
│   ├── core/                 The rule engine + Arkiv client (the real engineering)
│   │   └── src/
│   │       ├── client.ts         Read/write Arkiv clients, tuned for Tiramisu's rate limit
│   │       ├── rules/             Static analysis rules, one file per CROPS pillar
│   │       ├── engine.ts         Runs every rule, turns findings into 0-100 scores
│   │       ├── scan.ts            Reads a local repo checkout into the shape rules need
│   │       ├── entities.ts        Publishes/reads Usalama's own Arkiv entities
│   │       └── liveProbe.ts       Queries a target's real on-chain entities
│   └── cli/                  The `usalama` command-line tool
├── apps/
│   └── web/                  A static, backend-free dashboard (Vite + vanilla TS)
├── scripts/
│   ├── smoke-test.ts              Proves the rule engine is correct — no network needed
│   ├── run-sample-audit.ts        The fastest path to your first real on-chain entity
│   └── seed-rule-definitions.ts   Publishes the public rule registry once
└── fixtures/
    ├── good-project/          A fixture written to pass every rule
    └── bad-project/           A fixture written to fail every rule, on purpose
```

---

## Prerequisites

- **Node.js 22.10 or newer** (this project uses Node's native `--experimental-strip-types`, so no
  `ts-node`/`tsx` dependency is needed for the standalone scripts). Check with `node -v`.
- **npm 10+** (ships with Node 22).
- A **Tiramisu testnet wallet with test funds**, only once you want to actually publish anything
  (static scanning and the smoke test need neither) — see [below](#getting-a-funded-wallet).

---

## Installation

```bash
# From the folder this README is in:
npm install
```

This installs every workspace package's dependencies in one pass (npm workspaces — see the root
`package.json`'s `"workspaces"` field).

Then build everything once:

```bash
npm run build
```

---

## Verifying it works (no wallet, no network, under 2 minutes)

A correctness check that proves the rule engine actually works, by running it against two
fixture projects — one deliberately clean, one deliberately full of the exact anti-patterns the
rules are meant to catch:

```bash
npm test
```

Expected output:

```
Usalama smoke test

good-project: score 100/100, 5 findings, 0 failures ✓
bad-project: score 60/100, 9 findings, all 7 planted issues caught ✓

All assertions passed. good=100 bad=60
```

You can also run the compiled CLI directly against either fixture, with no wallet:

```bash
node packages/cli/bin/usalama.js audit fixtures/bad-project --repo "example/bad-project"
```

---

## Getting a funded wallet

Only needed once you want to **publish** a report (`--publish`, or either script with
`USALAMA_PRIVATE_KEY` set). Scanning, the smoke test, and reading already-published reports all
work without one.

1. Generate a fresh private key for this purpose only — **never reuse a key that holds real
   funds on any network.** One way: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
   then prefix the result with `0x`.
2. Get its address (you can derive this from viem, or any wallet tool you trust).
3. Go to your metamask or any evm compatible wallet and `Add wallet` then `import the private key`
4. Go to [hub.arkiv.network](https://hub.arkiv.network/faucet) and request Tiramisu testnet funds for
   that address. (The hub's exact faucet flow allows sign in with evm wallet,ensure the wallet address reads the one you imported)
5. Set the key as an environment variable (see below) — never commit it.

### Setting your environment variables

Copy the template and fill it in:

```bash
cp .env.example .env
```

These scripts read `process.env` directly — they do **not** auto-load `.env` files (no
`dotenv` dependency, to keep the dependency tree small). Either export the variables in your
shell, or run commands prefixed, e.g.:

```bash
USALAMA_PRIVATE_KEY=0xyourkey npm run audit -- fixtures/bad-project --publish
```

If you'd rather auto-load `.env`, add `node --env-file=.env` to the relevant commands (Node 22
supports this natively) — e.g. `node --env-file=.env --experimental-strip-types scripts/run-sample-audit.ts`.

---

## Your first audit, and your first real Arkiv entity

With a funded wallet set up:

```bash
USALAMA_PRIVATE_KEY=0xyourkey node --experimental-strip-types scripts/run-sample-audit.ts
```

This audits the bundled `fixtures/bad-project`, prints the report, then publishes one
`auditReport` entity per pillar to Tiramisu and prints each entity's key and transaction hash.
Paste either into [tiramisu.explorer.arkiv.network](https://tiramisu.explorer.arkiv.network) to
see it for yourself.

### Publishing the public rule registry (optional, once)

```bash
USALAMA_PRIVATE_KEY=0xyourkey node --experimental-strip-types scripts/seed-rule-definitions.ts
```

Publishes every rule Usalama ships as a `ruleDefinition` entity — see
[`arkiv/schema.md`](arkiv/schema.md) for why this exists.

---

## Using the CLI

```bash
# Audit a local project directory
node packages/cli/bin/usalama.js audit ./path/to/some/project

# ...label the report with a real URL, since the local path isn't one
node packages/cli/bin/usalama.js audit ./path/to/some/project --repo github.com/you/some-project

# ...and also check its disclosed wallets' real on-chain data
node packages/cli/bin/usalama.js audit ./path/to/some/project \
  --repo github.com/you/some-project \
  --wallets 0xabc...,0xdef...

# ...then publish it (needs USALAMA_PRIVATE_KEY)
node packages/cli/bin/usalama.js audit ./path/to/some/project --repo github.com/you/some-project --publish

# Machine-readable output
node packages/cli/bin/usalama.js audit ./path/to/some/project --json

# Look up whatever's already published for a repo
node packages/cli/bin/usalama.js list github.com/you/some-project

# Stream new entities landing on Tiramisu, live
node packages/cli/bin/usalama.js watch
```

Once you've run `npm install` at the root, you can also install the CLI globally from this repo
(`npm install -g .` inside `packages/cli`) to get a plain `usalama` command — optional, the
`node packages/cli/bin/usalama.js` form above always works without it.

---

## Running the web dashboard

A static, backend-free page that reads Tiramisu directly from the browser — no server, no API
route, nothing to deploy except static files.

```bash
cd apps/web
npm run dev
```

Open the printed local URL. Paste a `repoUrl` to look up its published reports, or just watch the
live feed for anything newly published.

### Deploying it

It's a static build — deploy the output anywhere that serves static files.

**Vercel:**
```bash
cd apps/web
npm run build
npx vercel deploy --prebuilt dist
```
(Or connect the repo in Vercel's dashboard, set the root directory to `apps/web`, build command
`npm run build`, output directory `dist`.)

**GitHub Pages:**
```bash
cd apps/web
npm run build
# Commit dist/ to a gh-pages branch, or use actions/deploy-pages in a workflow —
# either way, dist/ is the entire deployable output.
```

**Netlify, Cloudflare Pages, or any static host:** same pattern — `npm run build` in `apps/web`,
serve the `dist/` folder.

---

## How Usalama uses Arkiv

A concrete checklist, since the rubric scores *how* Arkiv's features are used, not how many are
name-dropped:

| Feature | Where | What for |
|---|---|---|
| Typed attributes (`i32`, `u64`, `str`, `addr`) | `entities.ts` | `score`/`findingsCount`/`auditedAt` are numeric so they're actually range-queryable, not just displayable |
| Range queries (`lt`) | `entities.ts`'s `getFailingReports` | A real `lt("score", ...)` query, not fetch-everything-then-filter |
| `$creator` via `.createdBy()` | `entities.ts`'s `getReportsByAuditor`, `liveProbe.ts`'s `probeWallet` | Proves an auditor's track record and a target's real on-chain data, unspoofably |
| Entity Expiration, differentiated per type | `entities.ts` | 90 days (reports) / 24 hours (requests) / 2 years (rule registry) — three different lifetimes for three different reasons, documented in `arkiv/schema.md` |
| Lifetime Extension (`extendEntity`) | `entities.ts`'s `reaudit` | Re-running an audit renews freshness instead of creating a duplicate |
| Creation flags (`permissionlessExtension`, `readonly`) | `entities.ts` | An audited project can keep its own report fresh without being able to edit the score; the rule registry can't be altered after publishing |
| Payload vs. attributes | `entities.ts` | Findings (free-form, not filtered on) live in the JSON payload; score/pillar/repoUrl (filtered on) live in typed attributes |
| `watchEntityEvents` (WebSocket) | CLI's `watch`, web dashboard's live feed | Live-updating views with no polling |
| Batch-free simplicity where it's honest | — | We did **not** force `executeBatch` in anywhere it wasn't genuinely needed, to avoid padding this list |

---

## Testing / typechecking everything

```bash
npm run typecheck    # every package, against the real installed SDK types
npm test             # the rule-engine smoke test
npm run build         # compiles core + cli; builds the web app with Vite
```

---

## Known limitations

See the end of [`arkiv/friction.md`](arkiv/friction.md) for the one gap we're aware of and
haven't fully solved: `auditReport` is intentionally patchable (not `readonly`), which allows
corrections but also means a compromised auditor key could, in principle, patch a real failure
into a false pass. Our best next step is described there.

Static rules work on regex/text heuristics over source, not a real AST — they're designed to
flag things worth a human looking at, not to be a sound, zero-false-positive analyzer. Several
rules say so explicitly in their own finding messages.

---

## License

MIT — see [`LICENSE`](LICENSE).
