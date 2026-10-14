import type { AuditInput, Finding, StaticRule } from "../types.js"

/**
 * Every Arkiv entity is publicly readable — there is no private toggle (see AGENTS.md's hard
 * rules). So the only way an app protects personal data is by never putting it in an attribute
 * or payload unencrypted in the first place. These patterns catch the common slip-ups: an email
 * or phone number sitting in plain text next to a `createEntity`/`attributes`/`payload` call.
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const PHONE_PATTERN = /\b(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}\b/

/** True if any Arkiv write call appears within `windowLines` lines of the match. */
function nearAnArkivWrite(text: string, matchIndex: number, windowLines = 8): boolean {
  const before = text.slice(0, matchIndex).split("\n").slice(-windowLines).join("\n")
  const after = text.slice(matchIndex).split("\n").slice(0, windowLines).join("\n")
  const nearby = before + after
  return /createEntity|patchEntity|attributes\s*:|payload\s*:|jsonToPayload/.test(nearby)
}

function findPlaintextPii(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []

  for (const [file, text] of Object.entries(sourceFiles)) {
    for (const pattern of [EMAIL_PATTERN, PHONE_PATTERN]) {
      const re = new RegExp(pattern, "g")
      for (const match of text.matchAll(re)) {
        if (match.index === undefined) continue
        if (!nearAnArkivWrite(text, match.index)) continue
        const line = text.slice(0, match.index).split("\n").length
        findings.push({
          ruleId: "priv-plaintext-pii-near-write",
          pillar: "privacy",
          severity: "fail",
          message:
            "Text that looks like an email address or phone number appears near an Arkiv write " +
            "call. Every entity is publicly readable forever (until it expires) — encrypt or " +
            "hash personal data before it goes into attributes or payload, or keep it off Arkiv " +
            "entirely. (This may be a test fixture — Usalama can't tell from the string alone.)",
          file,
          line,
        })
      }
    }
  }
  return findings
}

/** Rewards code that visibly encrypts or hashes before writing — e.g. an AES/crypto import near a write. */
function findEncryptionUsage(sourceFiles: Record<string, string>): Finding[] {
  const findings: Finding[] = []
  const cryptoPattern = /\b(?:encrypt|AES|crypto\.subtle|createCipheriv|sha256|keccak256)\b/i

  for (const [file, text] of Object.entries(sourceFiles)) {
    if (cryptoPattern.test(text) && /createEntity|attributes\s*:|payload\s*:/.test(text)) {
      findings.push({
        ruleId: "priv-encryption-near-write",
        pillar: "privacy",
        severity: "info",
        message: "References encryption or hashing in a file that also writes entities — a good sign for data that needs it.",
        file,
      })
    }
  }
  return findings
}

export const privacyRules: StaticRule[] = [
  {
    id: "priv-plaintext-pii-near-write",
    pillar: "privacy",
    description: "Flags email/phone-shaped text near an Arkiv write call.",
    check: (input: AuditInput) => findPlaintextPii(input.sourceFiles),
  },
  {
    id: "priv-encryption-near-write",
    pillar: "privacy",
    description: "Rewards visible encryption/hashing near a write call.",
    check: (input: AuditInput) => findEncryptionUsage(input.sourceFiles),
  },
]
