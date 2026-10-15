import "./style.css"
// Deliberately imports only the browser-safe subpaths — never the root `@usalama/core` barrel,
// which also pulls in scan.ts's `node:fs`/`node:path` (see packages/core/src/index.ts's note).
import { createReadClient } from "@usalama/core/client"
import { ENTITY_KINDS, getLatestReports } from "@usalama/core/entities"

// ---------------------------------------------------------------------------
// Theme toggle — persisted in localStorage, defaults to the system preference.
// This is a plain static site the user deploys and hosts themselves (not a
// sandboxed chat artifact), so localStorage is the right, ordinary tool here.
// ---------------------------------------------------------------------------
const THEME_KEY = "usalama-theme"
const root = document.documentElement
const toggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle")

function applyTheme(theme: "light" | "dark") {
  root.setAttribute("data-theme", theme)
  if (toggleButton) {
    toggleButton.querySelector(".theme-toggle-icon")!.textContent = theme === "dark" ? "◐" : "◑"
  }
}

const storedTheme = localStorage.getItem(THEME_KEY)
if (storedTheme === "light" || storedTheme === "dark") {
  applyTheme(storedTheme)
} else {
  applyTheme(window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
}

toggleButton?.addEventListener("click", () => {
  const current = root.getAttribute("data-theme") === "light" ? "light" : "dark"
  const next = current === "light" ? "dark" : "light"
  applyTheme(next)
  localStorage.setItem(THEME_KEY, next)
})

// ---------------------------------------------------------------------------
// Dashboard logic
// ---------------------------------------------------------------------------
const client = createReadClient()

const form = document.querySelector<HTMLFormElement>("#search-form")
const input = document.querySelector<HTMLInputElement>("#repo-input")
const results = document.querySelector<HTMLDivElement>("#results")
const liveFeed = document.querySelector<HTMLDivElement>("#live-feed")

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  if (text !== undefined) node.textContent = text
  return node
}

function attrValue(entity: { attributes?: Record<string, { value?: unknown }> }, name: string): string {
  const v = entity.attributes?.[name]?.value
  if (v === undefined) return "—"
  return typeof v === "bigint" ? v.toString() : String(v)
}

function scoreBand(score: number): "good" | "warn" | "bad" {
  if (score >= 80) return "good"
  if (score >= 50) return "warn"
  return "bad"
}

function buildReportCard(entity: {
  key?: string
  attributes?: Record<string, { value?: unknown }>
  toJson?: () => { findings?: { ruleId: string; severity: string; message: string; file?: string }[] }
}): HTMLDivElement {
  const card = el("div", { className: "report" })
  const pillar = attrValue(entity, "pillar")
  const scoreRaw = attrValue(entity, "score")
  const score = Number(scoreRaw)
  const band = Number.isFinite(score) ? scoreBand(score) : "warn"

  const head = el("div", { className: "report-head" })
  const left = el("div", {})
  left.appendChild(el("span", { className: "pillar-label" }, pillar))
  const meta = el("div", { className: "report-meta" })
  const auditedAtRaw = entity.attributes?.["auditedAt"]?.value
  const auditedAt = typeof auditedAtRaw === "bigint" ? new Date(Number(auditedAtRaw) * 1000).toLocaleString() : "unknown time"
  meta.textContent = `${attrValue(entity, "repoUrl")} · audited ${auditedAt}`
  left.appendChild(meta)
  head.appendChild(left)
  head.appendChild(el("div", { className: `score-badge ${band}` }, `${Number.isFinite(score) ? score : scoreRaw}/100`))
  card.appendChild(head)

  try {
    const parsed = entity.toJson?.() ?? {}
    for (const finding of parsed.findings ?? []) {
      const line = el("div", { className: `finding ${finding.severity}` })
      const ruleSpan = el("span", { className: "finding-rule" }, `[${finding.severity}] ${finding.ruleId}${finding.file ? ` · ${finding.file}` : ""}`)
      line.appendChild(ruleSpan)
      line.appendChild(document.createElement("br"))
      line.appendChild(document.createTextNode(finding.message))
      card.appendChild(line)
    }
  } catch {
    card.appendChild(el("div", { className: "status" }, "(could not decode findings payload)"))
  }

  return card
}

async function runSearch(repoUrl: string) {
  if (!results) return
  results.replaceChildren(el("p", { className: "status" }, `Looking up reports for "${repoUrl}" on Tiramisu…`))

  try {
    const reports = await getLatestReports(client, repoUrl)
    if (reports.length === 0) {
      results.replaceChildren(el("p", { className: "status" }, "No published reports found for that repo yet."))
      return
    }
    results.replaceChildren(...reports.map(buildReportCard))
  } catch (err) {
    results.replaceChildren(el("p", { className: "status" }, `Lookup failed: ${err instanceof Error ? err.message : String(err)}`))
  }
}

form?.addEventListener("submit", (event) => {
  event.preventDefault()
  const value = input?.value.trim()
  if (value) void runSearch(value)
})

// --- Live feed: every newly created entity, filtered client-side to Usalama's own audit reports. ---
// Events never carry attributes (see arkiv/friction.md) — each one needs a follow-up getEntity()
// to find out what it actually was, same as the CLI's `watch` command.
if (liveFeed) {
  const seen: HTMLDivElement[] = []

  client.watchEntityEvents({
    onEntityCreated: (event) => {
      client
        .getEntity(event.entityKey)
        .then((entity) => {
          const kind = entity.attributes["kind"]?.value
          if (kind !== ENTITY_KINDS.auditReport) return // ignore everything that isn't one of ours
          seen.unshift(buildReportCard(entity))
          liveFeed.replaceChildren(...seen.slice(0, 20))
        })
        .catch(() => {
          // Entity already expired or was deleted between the event and this fetch — skip it silently.
        })
    },
    onError: (error) => {
      liveFeed.replaceChildren(el("p", { className: "status" }, `Live feed error: ${error.message}`))
    },
  })

  setTimeout(() => {
    if (liveFeed.children.length === 1 && liveFeed.textContent?.includes("Connecting")) {
      liveFeed.replaceChildren(el("p", { className: "status" }, "Connected. Waiting for new reports…"))
    }
  }, 2000)
}