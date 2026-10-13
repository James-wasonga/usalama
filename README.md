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

