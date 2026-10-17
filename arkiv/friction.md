# Friction report

Arkiv SDK `@arkiv-network/sdk@0.8.1`, Tiramisu testnet (chain 7738577), built 2026-10-11/12.
Every entry below is something that actually happened while building this project, not a
guess — where something is a documented issue rather than our own discovery, we say so and link
it rather than imply we found it first.

---

## 1. `eq("$creator", address)` silently does the wrong thing with a bare value — use `.createdBy()` instead

**What we expected:** `eq("$creator", someAddress)` would behave like `eq("repoUrl", someString)`
— compare the system attribute against the given value.

**What actually happened:** system attributes have a fixed type, and a bare JS string defaults to
`str` when converted to a query value — but `$creator` is typed `addr`. Comparing an `addr`
attribute against a `str` value is a type mismatch the query layer rejects
(`InvalidPredicateError`), not something that silently matches nothing. We caught this at the
type-checking stage of our own build (see `packages/core/src/entities.ts`'s `getReportsByAuditor`
docstring) before it ever reached a runtime query, specifically because we were writing
`eq("$creator", auditorAddr)` by hand with a raw `Hex` string instead of wrapping it.

**The fix:** use the query builder's own `.createdBy(address)` / `.ownedBy(address)` methods,
which wrap the value correctly internally (`eq("$creator", addr(creator))`) — never hand-write a
system-attribute comparison. We now use `.createdBy()` everywhere we'd otherwise have written
`eq("$creator", ...)`.

**Why this matters beyond us:** this is exactly the kind of mistake that would make a "we filter
by `$creator`" security claim false in practice if someone wrote the naive version and it happened
to compile (in a looser-typed call site than ours). It's also now one of Usalama's own
Security-pillar rules (`sec-real-authority-usage` rewards `.createdBy()`/`.ownedBy()` specifically
because of this).

**Suggested fix for the SDK:** `eq()` could accept a bare address for a known system attribute and
auto-wrap it (the way `.createdBy()` already does internally), rather than requiring every caller
to either know to wrap it or use the convenience method.

---

## 2. Unauthenticated queries hit an undocumented rate limit that makes the SDK *look* hung, not rate-limited

**This is a previously reported issue, not our own discovery** — filed as
[Arkiv-Network/reported-issues#17](https://github.com/Arkiv-Network/reported-issues/issues/17).
We designed around it rather than hitting it blind, but it directly shaped
`packages/core/src/client.ts`, so it belongs here.

**Expected:** an unauthenticated query that exceeds Tiramisu's anonymous budget returns an error
promptly.

**Actual (per the filed issue, and consistent with viem's default retry behaviour, which we
verified by reading viem's `http` transport source):** the RPC returns `429` with a `Retry-After`
header, and viem's default transport retries automatically using that value — which the filed
issue reports reaching roughly 40 minutes. A caller sees a call that never resolves, not an error
they can catch.

**Our fix:** every client we create passes `retryCount: 0` to the transport (see
`client.ts`'s `transport()`), so a `429` throws `HttpRequestError` immediately instead of being
silently retried. We also added `ARKIV_API_KEY` / `ARKIV_API_KEY_HEADER` support so anyone running
this past the anonymous budget can authenticate — see the next entry for why the header name is
configurable rather than hardcoded.

---

## 3. No documented header name for an Arkiv Hub API key

**What we looked for:** the exact HTTP header hub.arkiv.network expects for an API key, so
`client.ts` could send it automatically.

**What we found:** confirmation that API keys exist and raise the query quota (referenced in the
same reported-issues discussion above), but no published header name we could find at
hub.arkiv.network or in the SDK's own source/README at the time of writing.

**What we did instead of guessing:** `client.ts` reads the header name from
`ARKIV_API_KEY_HEADER`, defaulting to the conventional `x-api-key` rather than asserting that's
correct. If this is wrong for your key, set the env var — see `README.md`.

**Suggested fix:** document the header name (or, better, have the SDK itself accept an `apiKey`
option and set the right header internally, the way many RPC SDKs do).

---

## 4. Entity events carry no attributes — "what was created" needs a follow-up `getEntity()` call

**Expected:** `watchEntityEvents({ onEntityCreated })` would let us show *what* was created (e.g.
"a new audit report, security pillar, score 82") directly from the event.

**Actual:** `EntityCreatedEvent` carries `entityKey`, `owner`, `expiresAt`, and `creationFlags` —
never attributes or payload (confirmed by reading `types/events.ts` and
`actions/public/watchEntityEvents.ts` directly in the installed package). To show anything
meaningful, every handler needs a second round trip: `client.getEntity(event.entityKey)`.

**Where this bit us twice:** both the CLI's `watch` command and the web dashboard's live feed
need this extra call, and both need to handle it throwing — a short-lived entity (our own
`auditRequest`, 24h) can expire between the event firing and the follow-up `getEntity()` landing,
which throws `NoEntityFoundError`. Both call sites catch that specifically and degrade to showing
just the key/owner rather than crashing — see `onEntityCreated` in `packages/cli/src/index.ts`
and `apps/web/src/main.ts`.

**Suggested fix:** an opt-in `includeAttributes` (or similar) on `watchEntityEvents` for callers
willing to pay the extra RPC cost per event, so a live feed over short-lived entities isn't
racing its own data source.

---

## 5. No `orderBy` in the query language — every "most recent" query sorts client-side

**Expected:** something like `.orderBy("auditedAt", "desc")` on the query builder.

**Actual:** confirmed by reading `query/queryBuilder.ts` directly — the builder supports `where`,
`ownedBy`, `createdBy`, `limit`, `cursor`, and pagination, but no server-side ordering. "Give me
the latest report for this repo" has to fetch a page of candidates and sort them in JS — see
`getLatestReports()` in `entities.ts`.

**Why this is a real constraint, not just an inconvenience:** without `orderBy`, "latest" is only
as correct as `limit` is generous — if more than `limit` reports exist for one repo and the true
latest one isn't in the first page the server happens to return, client-side sorting silently
picks the wrong "latest" from an incomplete set. We used a `limit` of 10 for a single-repo lookup,
which only works because in practice one repo won't accumulate dozens of reports (90-day expiry,
one per pillar). A high-cardinality "most recent across everything" query would need a different
approach entirely — we didn't need to solve that here, but would have hit it immediately in a
busier dataset.

---

...
busy dataset.

---

## 6. The client-side attribute-name validator accepts uppercase letters; the chain rejects them

**This one cost a real, funded transaction to discover** — the clearest example in this report of
something that only surfaces once you actually publish, not from reading source or running a
local test.

**Expected:** `packages/core/src/entities.ts` named attributes in camelCase (`repoUrl`,
`auditedAt`, `findingsCount`, `ruleId`). The installed SDK's own client-side validator
(`attr/names.ts`) explicitly documents and enforces this regex for attribute names:

const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/


That pattern allows uppercase letters (`A-Z`) by design — nothing in the SDK warned, and
`npm run build` / `npm run typecheck` both passed cleanly, since this is a runtime value check,
not a type-level one.

**Actual:** the real `--publish` transaction against Tiramisu reverted:
EntityMutationError: Transaction failed: an attribute name holds “A” (0x41) at byte 7, which is

outside the name charset (“A”-“Z”, “a”-“z”, “0”-“9”, “.”, “-” and “_”, with a letter first)

Error: Ident32InvalidByte(uint256 position, bytes1 value)

(7, 0x41)


Byte 7 of `"auditedAt"` is exactly `'A'` (0x41) — `a(0) u(1) d(2) i(3) t(4) e(5) d(6) A(7) t(8)`.
The error message's own stated charset still lists `"A"-"Z"` as allowed, which makes this doubly
confusing from the caller's side: the message describing *why* it failed names the very character
it's rejecting as acceptable. Whatever the precise on-chain identifier packing rule actually is
(we didn't dig into the contract bytecode to find out), the practical result was unambiguous:
**the client-side check and the chain's real enforcement disagree**, and the client-side one is
strictly more permissive, so it cannot catch this before a real, gas-spending transaction does.

**Our fix:** renamed every attribute name used in `entities.ts` to all-lowercase snake_case —
`repo_url`, `findings_count`, `audited_at`, `rule_id` — which is unambiguously safe under both the
documented client-side charset and whatever the chain's stricter real rule turns out to be. This
was a full pass across `entities.ts`, the matching `eq()` query calls, and every place the web
dashboard (`apps/web/src/main.ts`) read these attributes back out, since a rename on the write
side silently breaks every read site that still references the old name.

**What this means for anyone else building on Arkiv:** don't trust `isValidAttributeName()` /
`validateAttributeName()` as proof a name will actually be accepted on-chain. We'd suggest either
tightening the client-side regex to match the chain's real rule, or — if uppercase genuinely is
meant to work and we simply hit an unrelated edge case — making the revert's own error message
name the *actual* disallowed character set instead of repeating the client-side one, since right
now the error text actively misleads about its own cause.

---

## Honest gap we did not solve

`auditReport` is deliberately **not** `readonly` (see `arkiv/schema.md`), so a correction can be
published if a rule turns out to have a bug. That same openness means a compromised auditor
private key could patch a real failure into a false pass. We considered requiring every patch to
preserve the original `findings` array and only append a `correctionNote`, enforced client-side —
but client-side enforcement isn't enforcement, and we ran out of build time to design a cleaner
answer (e.g., a separate, append-only `auditCorrection` entity type that references the original
by key, so the original attributes truly never change and a correction is additive, queryable
history instead of an edit). That's the first thing we'd build next.
