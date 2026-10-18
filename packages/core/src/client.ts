import {
  createPublicClient as createArkivPublicClient,
  createWalletClient as createArkivWalletClient,
  type PublicArkivClient,
  type WalletArkivClient,
} from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, webSocket, type Account } from "viem"
import { privateKeyToAccount } from "viem/accounts"

/**
 * `process.env` only exists under Node — this package is also imported by the browser-bundled
 * web dashboard (apps/web), where `process` is undefined. Every lookup below goes through this
 * instead of `process.env` directly, so the same client code works isomorphically: real env vars
 * under Node, always-undefined (falling through to defaults) in the browser.
 */
function envVar(name: string): string | undefined {
  if (typeof process === "undefined" || typeof process.env === "undefined") return undefined
  return process.env[name]
}

/**
 * Builds the HTTP RPC URL for Tiramisu, Arkiv's testnet (chain 7738577) — the network this
 * hackathon requires. Defaults to the public endpoint; override with ARKIV_RPC_URL for a
 * private/authenticated one.
 */
function resolveRpcUrl(): string {
  return envVar("ARKIV_RPC_URL") ?? "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
}

/** The WebSocket counterpart of {@link resolveRpcUrl} — override with ARKIV_WS_URL. */
function resolveWsUrl(): string {
  return envVar("ARKIV_WS_URL") ?? "wss://rpc.tiramisu.db-chain.testnet.arkiv.network"
}

/**
 * Extra headers to send with every RPC call — in particular an Arkiv Hub API key, for anyone
 * past the unauthenticated query budget (see arkiv/friction.md, entry on ANON_COST_LIMITED).
 *
 * The exact header name Arkiv Hub expects was not published anywhere we could confirm at the
 * time of writing (see friction.md). Rather than guess and silently send the wrong header, this
 * reads the name itself from an env var, defaulting to the industry-standard "x-api-key" — set
 * ARKIV_API_KEY_HEADER if hub.arkiv.network documents a different one for your key.
 *
 * Only usable on the HTTP transport — the browser's native WebSocket API has no way to attach
 * custom headers to the handshake at all, so an API key cannot be applied to {@link createWatchClient}
 * when it runs in a browser. It works there under Node (e.g. the CLI's `watch` command), since
 * Node's `ws` implementation does allow custom handshake headers — see {@link wsTransport}.
 */
function resolveHeaders(): Record<string, string> | undefined {
  const apiKey = envVar("ARKIV_API_KEY")
  if (!apiKey) return undefined
  const headerName = envVar("ARKIV_API_KEY_HEADER") ?? "x-api-key"
  return { [headerName]: apiKey }
}

/**
 * A viem `http` transport tuned for Tiramisu's unauthenticated rate limit.
 *
 * Without `retryCount: 0`, viem's default transport silently retries a 429 using the
 * `Retry-After` header Tiramisu sends — which we've seen reach 45 minutes (see
 * arkiv/friction.md). That turns one rate-limited call into a request that *looks* hung. With
 * `retryCount: 0` the same call throws `HttpRequestError` in well under a second, so callers can
 * catch it and decide what to do (back off, queue, or tell the user to add an API key) instead
 * of staring at a frozen process.
 */
function httpTransport() {
  return http(resolveRpcUrl(), {
    retryCount: 0,
    fetchOptions: { headers: resolveHeaders() },
  })
}

/**
 * A viem `webSocket` transport for Tiramisu — used only for {@link createWatchClient}.
 *
 * This matters more than it looks: `watchEntityEvents` is implemented on top of viem's
 * `watchEvent`, which — given an HTTP transport — has no choice but to *poll*, re-querying
 * roughly every second (see the installed SDK's `watchEntityEvents.ts`, `DEFAULT_POLLING_INTERVAL
 * = BLOCK_TIME * 1000 / 2`). Every one of those polls counts against the same anonymous query
 * budget as everything else, silently, for as long as a "live" view stays open. Given a real
 * WebSocket transport instead, viem subscribes once (`eth_subscribe`) and the node pushes new
 * events — no repeated polling, no budget drain. This is a real, confirmed-by-use fix, not a
 * micro-optimisation: our own dashboard hit `ANON_COST_LIMITED` after a long-running session with
 * the old HTTP-polling "live feed" open — see arkiv/friction.md.
 */
function wsTransport() {
  return webSocket(resolveWsUrl())
}

/** A read-only client against Tiramisu for one-off queries: `.select()`, `.getEntity()`. */
export function createReadClient(): PublicArkivClient {
  return createArkivPublicClient({
    chain: tiramisu,
    transport: httpTransport(),
  })
}

/**
 * A read-only client specifically for `.watchEntityEvents()` — over a real WebSocket, not HTTP
 * polling. Use this one for anything "live"; use {@link createReadClient} for everything else.
 * See {@link wsTransport} for why this distinction exists at all.
 */
export function createWatchClient(): PublicArkivClient {
  return createArkivPublicClient({
    chain: tiramisu,
    transport: wsTransport(),
  })
}

/**
 * A write-capable client against Tiramisu, signing with the given private key.
 *
 * @param privateKey - A `0x`-prefixed private key. Never hard-code one — read it from an env var
 * (e.g. `process.env.USALAMA_PRIVATE_KEY`) that is itself never committed. See README.md.
 */
export function createWriteClient(privateKey: `0x${string}`): WalletArkivClient {
  const account: Account = privateKeyToAccount(privateKey)
  return createArkivWalletClient({
    chain: tiramisu,
    transport: httpTransport(),
    account,
  })
}

export type { PublicArkivClient, WalletArkivClient }

export { tiramisu }
