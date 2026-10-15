# Usalama — Arkiv schema

Three entity kinds, discriminated by a `kind` attribute. Every write goes through
`packages/core/src/entities.ts` — this file documents what that code does and why.

## auditReport

One per `(repoUrl, pillar)` pair, published by whichever wallet ran the audit.

| Attribute | Type | Why |
|---|---|---|
| `kind` | `str` | `"auditReport"` — lets a query select just this kind |
| `repoUrl` | `str` | What was audited |
| `pillar` | `str` | `security` / `privacy` / `dataDesign` / `openSource` / `censorship` |
| `score` | `i32` | 0–100. **Typed as i32, not str**, specifically so `getFailingReports()` can run a real `lt("score", ...)` range query instead of fetching every report and filtering in JS |
| `findingsCount` | `i32` | How many findings this pillar had |
| `auditedAt` | `u64` | Unix seconds. Also typed numeric, so reports could be range-queried by time if a future query needs it |

Payload (`application/json`): `{ findings: Finding[] }` — the full finding list for this pillar,
each with `ruleId`, `severity`, `message`, and optionally `file`/`line`. This lives in the payload,
not attributes, because findings are free-form and not something a query filters on directly.

**Expiry: 90 days.** An audit is a claim about a point in time. Code changes; a passing report
from six months ago says nothing about what's in the repo today. 90 days is long enough that a
small, slow-moving project isn't re-audited constantly, short enough that a stale "pass" can't
be waved around indefinitely.

**Flags: `permissionlessExtension: true`, `readonly` NOT set.**
- `permissionlessExtension` lets the *audited* project's own wallet call `extendEntity` to keep a
  passing report fresh by re-requesting an audit, without being able to touch the score itself —
  extension only resets the clock, it cannot alter attributes or payload (see the installed SDK's
  `entity/flags.ts`).
- **Why not `readonly`:** we considered it, since it would make a report tamper-proof in the
  strongest sense. We left it off on purpose: if an auditor publishes a report and later finds a
  bug in a rule that produced a false positive, there needs to be a way to correct the record —
  and Arkiv's own model for that is `patchEntity`, not deleting and recreating. A `readonly`
  report would force every correction to be a brand new entity with no link back to the one it
  superseded. The trade-off is real (a compromised auditor key could patch a report to hide a
  real failure) — see `arkiv/friction.md` for how we're thinking about that, since it isn't fully
  resolved.

## auditRequest

A queue ticket, not part of the permanent record.

| Attribute | Type |
|---|---|
| `kind` | `str` — `"auditRequest"` |
| `repoUrl` | `str` |
| `status` | `str` — `"queued"` |

Who requested it is **not** a separate attribute — it's already on-chain as the write
transaction's `$creator`, set automatically by whichever wallet signs the call. A redundant
`requestedBy` attribute would just duplicate what `$creator` already proves, and — unlike
`$creator` — it would be a plain writable field, exactly the anti-pattern Usalama's own Security
rule (`sec-writable-authority-filter`) flags in *other* projects.

**Expiry: 24 hours.** A request is only meaningful until it's picked up or abandoned.

## ruleDefinition

The public registry of what Usalama actually checks for — published once, read by anyone who
wants to build a different dashboard against the same reports without asking permission.

| Attribute | Type |
|---|---|
| `kind` | `str` — `"ruleDefinition"` |
| `ruleId` | `str` |
| `pillar` | `str` |

Payload: `{ description: string }`.

**Expiry: 2 years.** This is reference data, not a transaction record — it should outlive almost
every audit report it describes.

**Flags: `readonly: true`.** A rule definition, once published, should never quietly change
meaning out from under a report that cited it. If a rule's logic changes, we publish a new
`ruleDefinition` entity rather than mutating the old one.

## Access control — the pillar this project is entered under

Every read that matters uses `$creator`/`$owner`, never a plain attribute:

- `getReportsByAuditor()` uses `.createdBy(wallet)` — the SDK's built-in shorthand for
  `eq("$creator", addr(wallet))` — to prove an auditor's track record. **We originally wrote this
  by hand as `eq("$creator", auditorAddr)` with a bare address string, which is wrong** — see
  `arkiv/friction.md`'s first entry for exactly what happened and why `.createdBy()` is the
  correct form.
- `probeWallet()` (the live on-chain verifier) uses `.createdBy(wallet)` for the same reason: a
  target project's *disclosed* wallet is checked against what it actually, provably created —
  not a self-reported attribute that wallet could set to anything.

## Why Arkiv, not Postgres / IPFS / a subgraph / our own API

If audit reports lived in a database Usalama's own backend controlled, the single biggest claim
this project makes — "not even the auditor can quietly change a score" — would be false. Anyone
who compromised (or simply ran) that backend could edit a failing score to a passing one with no
trace. Because every report is an Arkiv entity with an immutable `$creator`, that specific failure
mode is structurally impossible: the explorer shows exactly which wallet wrote exactly this score
at exactly this time, independent of trusting Usalama's server at all.

What we deliberately **kept off Arkiv**: the static-analysis computation itself (parsing source,
running the rule engine — see `packages/core/src/engine.ts`) runs locally or in CI, never on
Arkiv; only the *result* becomes an entity. The target's raw source code is never stored on Arkiv
— only a `repoUrl` reference and a findings summary, since putting someone else's full codebase
into a public, (mostly) un-deletable record would be its own problem.
