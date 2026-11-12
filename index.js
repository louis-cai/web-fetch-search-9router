/**
 * Host half of the 9router web-tools bundle — a web provider for the agent,
 * not a sidebar panel.
 *
 * It registers two providers with the Harness web seam (`ctx.web`):
 * - a search provider that proxies 9router's `/v1/search`;
 * - a fetch provider that proxies 9router's `/v1/web/fetch`.
 *
 * The composition ships `web.searchProvider = deepseek-official` and
 * `web.fetchProvider = http`. On activation this plugin points both at its own
 * provider id through the settings service (the only supported way to write the
 * web service's volatile provider selection), so the agent's built-in
 * `web_search` / `web_fetch` tools run through 9router. An explicitly chosen
 * provider is never overridden; a warning tells the operator how to pin it.
 *
 * The 9router credential stays in the Host process.
 */

/** Cordis function-plugin name (also the bundle row id). */
export const name = 'webfetch-9router'

/** The web seam is required; without it the plugin stays inactive. */
export const inject = ['web']

/** Stable provider id registered for both capabilities. */
const PROVIDER_ID = '9router'

/** Shipped defaults for the web seam's provider selection. */
const OFFICIAL_SEARCH_PROVIDER_ID = 'deepseek-official'
const OFFICIAL_FETCH_PROVIDER_ID = 'http'

/** Upper bound for one search request. */
const MAX_RESULTS_CEILING = 20

/** Configuration-bridge bodies are a few fields; anything larger is hostile. */
const MAX_BODY_BYTES = 16 * 1024

/** Longest accepted 9router API key. */
const MAX_API_KEY_LENGTH = 512

/** Exact pathname of the browser-facing configuration bridge. */
const CONFIG_ROUTE = '/webfetch-9router/config'

/** Longest accepted search query. */
const MAX_QUERY_LENGTH = 1024

/** Longest accepted page URL. */
const MAX_URL_LENGTH = 2048

/** Display caps so a hostile upstream result cannot bloat the result set. */
const MAX_RESULT_TITLE = 300
const MAX_RESULT_SNIPPET = 1000
const MAX_ANSWER_LENGTH = 4000

/** Search scopes the 9router search endpoint accepts from this provider. */
const SEARCH_TYPES = ['web', 'news']

/** Bundle defaults, overridable from the row config. */
const DEFAULTS = {
  baseUrl: 'http://localhost:20128',
  apiKey: '',
  timeoutMs: 30000,
  searchType: 'web',
  defaultMaxResults: 5,
}

/** Per-context runtime state shared across Loader re-entries of this plugin. */
const runtimes = new WeakMap()

/**
 * Read the row config defensively: the Loader passes it through untouched when
 * the plugin declares no Config schema, so every field is validated here.
 * @param {unknown} input - the row's config value.
 * @returns normalized connection settings.
 */
function normalizeConfig(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const baseUrl =
    typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== ''
      ? raw.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULTS.baseUrl
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : DEFAULTS.apiKey
  const timeout = Number(raw.timeoutMs)
  const timeoutMs =
    Number.isFinite(timeout) && timeout >= 1000 && timeout <= 120000
      ? Math.floor(timeout)
      : DEFAULTS.timeoutMs
  const searchType = SEARCH_TYPES.includes(raw.searchType) ? raw.searchType : DEFAULTS.searchType
  const candidateMaxResults = Number(raw.defaultMaxResults)
  const defaultMaxResults =
    Number.isInteger(candidateMaxResults) &&
    candidateMaxResults >= 1 &&
    candidateMaxResults <= MAX_RESULTS_CEILING
      ? candidateMaxResults
      : DEFAULTS.defaultMaxResults
  return { baseUrl, apiKey, timeoutMs, searchType, defaultMaxResults }
}

/**
 * A plain JSON object, excluding arrays and null.
 * @param {unknown} value - the candidate.
 * @returns true for a non-array object.
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A non-empty, trimmed string.
 * @param {unknown} value - the candidate.
 * @returns the string, or null.
 */
function nonEmptyString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * A finite number, or null.
 * @param {unknown} value - the candidate.
 * @returns the finite number, or null.
 */
function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Trim a string and cap its length.
 * @param {unknown} value - the candidate.
 * @param {number} max - maximum character count.
 * @returns the trimmed, capped string, or null.
 */
function clampText(value, max) {
  const text = nonEmptyString(value)
  if (text === null) return null
  return text.length > max ? text.slice(0, max) : text
}

/**
 * Clamp a requested result count into the provider's accepted range.
 * @param {unknown} value - the requested maximum.
 * @param {number} fallback - the configured default.
 * @returns the clamped result count.
 */
function clampMaxResults(value, fallback) {
  const candidate = Number(value)
  if (!Number.isInteger(candidate)) return fallback
  if (candidate < 1) return 1
  if (candidate > MAX_RESULTS_CEILING) return MAX_RESULTS_CEILING
  return candidate
}

/** Named HTML entities the search providers emit in snippets. */
const ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

/**
 * Decode one HTML entity reference.
 * @param {string} entity - the name or numeric form without delimiters.
 * @returns the decoded text, or the original reference when unknown.
 */
function decodeEntity(entity) {
  const lower = entity.toLowerCase()
  if (Object.hasOwn(ENTITIES, lower)) return ENTITIES[lower]
  if (lower.startsWith('#x')) {
    const code = Number.parseInt(lower.slice(2), 16)
    return Number.isInteger(code) ? safeCodePoint(code, entity) : `&${entity};`
  }
  if (lower.startsWith('#')) {
    const code = Number.parseInt(lower.slice(1), 10)
    return Number.isInteger(code) ? safeCodePoint(code, entity) : `&${entity};`
  }
  return `&${entity};`
}

/**
 * Convert a code point, falling back to the original reference when invalid.
 * @param {number} code - the candidate code point.
 * @param {string} entity - the original reference body.
 * @returns the character or the original reference.
 */
function safeCodePoint(code, entity) {
  try {
    return String.fromCodePoint(code)
  } catch {
    return `&${entity};`
  }
}

/**
 * Turn provider HTML snippets into one line of readable plain text, so the
 * agent sees clean snippets instead of markup.
 * @param {string} text - the raw snippet.
 * @returns collapsed plain text.
 */
function stripHtml(text) {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (_match, entity) => decodeEntity(String(entity)))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse and validate an absolute http(s) URL.
 * @param {unknown} value - the candidate.
 * @returns the normalized href, or null when unusable.
 */
function httpUrl(value) {
  const text = nonEmptyString(value)
  if (text === null || text.length > MAX_URL_LENGTH) return null
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.href
}

/**
 * Best-effort hostname for a URL that already passed {@link httpUrl}.
 * @param {string} href - the normalized URL.
 * @returns the hostname, or null.
 */
function hostnameOf(href) {
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

/**
 * Normalize one provider snippet: strip provider markup, collapse whitespace,
 * and cap the visible length.
 * @param {unknown} value - the raw snippet.
 * @returns the display snippet, or null.
 */
function normalizeSnippet(value) {
  const text = clampText(value, 4000)
  if (text === null) return null
  const stripped = stripHtml(text)
  if (stripped === '') return null
  return stripped.length > MAX_RESULT_SNIPPET ? stripped.slice(0, MAX_RESULT_SNIPPET) : stripped
}

/**
 * Whether an error is the caller's cancellation rather than a provider failure.
 * @param {unknown} error - the thrown error.
 * @param {AbortSignal | undefined} signal - the caller's signal.
 * @returns true when the caller cancelled the request.
 */
function isCallerAbort(error, signal) {
  return signal !== undefined && signal.aborted
}

/**
 * The detailed reason of a failed 9router call.
 * @param {unknown} error - the thrown error.
 * @param {string} baseUrl - the configured gateway.
 * @param {number} timeoutMs - the abort budget.
 * @param {AbortSignal | undefined} signal - the caller's signal.
 * @returns a provider-facing error.
 */
function transportError(error, baseUrl, timeoutMs, signal) {
  if (isCallerAbort(error, signal)) {
    return new Error('9router request was cancelled')
  }
  const name = error !== null && typeof error === 'object' && typeof error.name === 'string' ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new Error(`9router did not answer within ${timeoutMs} ms`)
  }
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`cannot reach 9router at ${baseUrl}: ${detail}`)
}

/**
 * POST one JSON request to 9router and return its parsed JSON payload.
 * @param {{ baseUrl: string, apiKey: string, timeoutMs: number }} settings - connection settings.
 * @param {string} path - endpoint path below the gateway.
 * @param {unknown} body - JSON body.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @returns the parsed JSON payload.
 */
async function callRouter(settings, path, body, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs)
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  const headers = { 'content-type': 'application/json' }
  if (settings.apiKey !== '') headers.authorization = `Bearer ${settings.apiKey}`
  let response
  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combined,
    })
  } catch (error) {
    throw transportError(error, settings.baseUrl, settings.timeoutMs, signal)
  } finally {
    clearTimeout(timer)
  }
  let text
  try {
    text = await response.text()
  } catch (error) {
    throw transportError(error, settings.baseUrl, settings.timeoutMs, signal)
  }
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403
    if (unauthorized) {
      throw new Error(`9router rejected the API key (HTTP ${response.status})`)
    }
    throw new Error(`9router responded ${response.status}: ${text.slice(0, 300)}`)
  }
  if (!isPlainObject(payload)) {
    throw new Error('9router returned a non-JSON response')
  }
  return payload
}

/**
 * Project 9router's search payload onto the web seam's normalized result.
 * Results that cannot be cited as http(s) links are dropped, and the list is
 * capped to the requested maximum.
 * @param {Record<string, any>} payload - 9router's JSON response.
 * @param {number} maxResults - the requested result count.
 * @param {string} query - the request query, echoed when the payload omits it.
 * @returns the normalized web search result.
 */
function normalizeSearchResult(payload, maxResults, query) {
  const rawResults = Array.isArray(payload.results) ? payload.results : []
  const sources = []
  let available = 0
  for (const item of rawResults) {
    if (!isPlainObject(item)) continue
    const url = httpUrl(item.url)
    if (url === null) continue
    available += 1
    if (sources.length >= maxResults) continue
    sources.push({
      url,
      title: clampText(item.title, MAX_RESULT_TITLE) ?? hostnameOf(url) ?? url,
      snippet: normalizeSnippet(item.snippet) ?? undefined,
      publishedAt: clampText(item.published_at, 64) ?? undefined,
    })
  }
  const answer = clampText(payload.answer, MAX_ANSWER_LENGTH)
  const result = { sources, truncated: available > sources.length }
  if (answer !== null) result.content = answer
  return result
}

/**
 * Project 9router's fetch payload onto the web seam's normalized fetch result.
 * The seam's body union is html | text, so the extracted markdown is returned
 * as text and rendered as such by the web_fetch tool.
 * @param {Record<string, any>} payload - 9router's JSON response.
 * @param {string} requestedUrl - the URL the caller asked for.
 * @returns the normalized web fetch result.
 */
function normalizeFetchResult(payload, requestedUrl) {
  const content = isPlainObject(payload.content) ? payload.content : {}
  const text = typeof content.text === 'string' ? content.text : ''
  return {
    url: httpUrl(payload.url) ?? requestedUrl,
    statusCode: 200,
    body: { kind: 'text', content: text },
    truncated: false,
  }
}

/**
 * Read the current provider selection of the web service.
 *
 * DSH 0.2.1-rc.2+ keeps the selection in volatile config refs
 * (`web.config.searchProvider`), which can only be written through the
 * settings service. Older releases exposed plain service properties.
 * @param {any} web - the web runtime service.
 * @param {'searchProvider' | 'fetchProvider'} key - which selection to read.
 * @returns the current provider id, or undefined.
 */
function readProviderSelection(web, key) {
  const ref = web?.config?.[key]
  if (ref !== undefined && ref !== null && typeof ref.get === 'function') return ref.get()
  return key === 'searchProvider' ? web?.searchProviderId : web?.fetchProviderId
}

/**
 * Queue one provider-selection write in the form the settings service accepts.
 * @param {any} web - the web runtime service.
 * @param {'searchProvider' | 'fetchProvider'} key - which selection to write.
 * @param {string} id - the provider id to select.
 * @param {Array<{ op: string, path: string[], value: string }>} ops - collected writes.
 */
function queueProviderSelection(web, key, id, ops) {
  const ref = web?.config?.[key]
  if (ref !== undefined && ref !== null && typeof ref.get === 'function') {
    ops.push({ op: 'set', path: [key], value: id })
    return
  }
  if (key === 'searchProvider') web.searchProviderId = id
  else web.fetchProviderId = id
}

/**
 * Mask an API key for display: the browser receives a hint, never the secret.
 * @param {string} apiKey - the configured key.
 * @returns the display hint, or null when no key is configured.
 */
function apiKeyHint(apiKey) {
  if (apiKey === '') return null
  return apiKey.length <= 4 ? '••••' : `••••${apiKey.slice(-4)}`
}

/**
 * Project the plugin's effective settings and the live provider selection for
 * the configuration page.
 * @param {{ baseUrl: string, apiKey: string, timeoutMs: number, searchType: string, defaultMaxResults: number }} settings - effective settings.
 * @param {any} web - the web runtime service.
 * @returns the browser-safe configuration description.
 */
function describeConfig(settings, web) {
  return {
    baseUrl: settings.baseUrl,
    hasApiKey: settings.apiKey !== '',
    apiKeyHint: apiKeyHint(settings.apiKey),
    timeoutMs: settings.timeoutMs,
    searchType: settings.searchType,
    defaultMaxResults: settings.defaultMaxResults,
    providers: {
      search: readProviderSelection(web, 'searchProvider') ?? null,
      fetch: readProviderSelection(web, 'fetchProvider') ?? null,
    },
  }
}

/**
 * Validate one configuration update at the request boundary. Only supplied
 * fields change; an empty API key means "keep the current key", so a browser
 * that never receives the secret can still replace it.
 * @param {string} text - the raw JSON body.
 * @returns `{ patch }`, or `{ error }` when unusable.
 */
function parseConfigBody(text) {
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return { error: 'request body is not valid JSON' }
  }
  if (!isPlainObject(body)) return { error: 'request body must be a JSON object' }
  const patch = {}
  if (body.baseUrl !== undefined) {
    const raw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
    if (raw === '') return { error: 'baseUrl must be a non-empty URL' }
    if (raw.length > MAX_URL_LENGTH) {
      return { error: `baseUrl is longer than ${MAX_URL_LENGTH} characters` }
    }
    let parsed
    try {
      parsed = new URL(raw)
    } catch {
      return { error: 'baseUrl is not a valid absolute URL' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'baseUrl must use http or https' }
    }
    patch.baseUrl = parsed.href.replace(/\/+$/, '')
  }
  if (body.apiKey !== undefined) {
    if (typeof body.apiKey !== 'string') return { error: 'apiKey must be a string' }
    const trimmed = body.apiKey.trim()
    if (trimmed !== '') {
      if (trimmed.length > MAX_API_KEY_LENGTH) {
        return { error: `apiKey is longer than ${MAX_API_KEY_LENGTH} characters` }
      }
      patch.apiKey = trimmed
    }
  }
  if (body.timeoutMs !== undefined) {
    const timeout = Number(body.timeoutMs)
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) {
      return { error: 'timeoutMs must be an integer between 1000 and 120000' }
    }
    patch.timeoutMs = timeout
  }
  if (body.searchType !== undefined) {
    if (!SEARCH_TYPES.includes(body.searchType)) {
      return { error: `searchType must be one of ${SEARCH_TYPES.join(', ')}` }
    }
    patch.searchType = body.searchType
  }
  if (body.defaultMaxResults !== undefined) {
    const maxResults = Number(body.defaultMaxResults)
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS_CEILING) {
      return { error: `defaultMaxResults must be an integer between 1 and ${MAX_RESULTS_CEILING}` }
    }
    patch.defaultMaxResults = maxResults
  }
  if (Object.keys(patch).length === 0) {
    return { error: 'no configuration fields to change' }
  }
  return { patch }
}

/**
 * Send one JSON response.
 * @param {import('node:http').ServerResponse} res - the response to own.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON-serializable payload.
 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Collect a bounded request body as UTF-8 text.
 * @param {import('node:http').IncomingMessage} req - the request to drain.
 * @returns the text, or null past the ceiling (the stream is drained first).
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/**
 * The composition's trust fence: reject cross-site callers and Host headers
 * that do not name this server before anything else runs.
 * @param {unknown} connection - the connection service, when present.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response to own.
 * @returns true when the request was rejected (and the response ended).
 */
function rejectedByTrustFence(connection, req, res) {
  if (connection === undefined || connection === null) return false
  if (typeof connection.requestRejection !== 'function') return false
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/**
 * Read one JSON POST payload after method, media-type, and size validation.
 * @param {import('node:http').IncomingMessage} req - the request to read.
 * @param {import('node:http').ServerResponse} res - the response to own.
 * @returns the raw body text, or null when a failure was already answered.
 */
async function readJsonPayload(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('allow', 'POST')
    res.end()
    return null
  }
  const mediaType = String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    sendJson(res, 415, {
      ok: false,
      code: 'unsupported-media-type',
      error: 'content-type must be application/json',
    })
    return null
  }
  let text
  try {
    text = await readBoundedBody(req)
  } catch {
    sendJson(res, 400, { ok: false, code: 'unreadable-body', error: 'request body unreadable' })
    return null
  }
  if (text === null) {
    sendJson(res, 413, {
      ok: false,
      code: 'body-too-large',
      error: `request body exceeds ${MAX_BODY_BYTES} bytes`,
    })
    return null
  }
  return text
}

/**
 * Register the 9router-backed providers and take over the web service's
 * provider selection when it is unset or still the shipped default.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {unknown} rawConfig - the row config.
 */
export function apply(ctx, rawConfig) {
  // A configuration edit can re-enter apply() on the same Loader context.
  // Keep one runtime object per context and refresh its settings in place, so
  // an already-registered provider immediately serves the new gateway; a fresh
  // context (real restart) registers its own provider once the previous
  // registration is gone.
  const previous = runtimes.get(ctx)
  const runtime = previous ?? { settings: normalizeConfig(rawConfig) }
  if (previous === undefined) {
    runtimes.set(ctx, runtime)
  } else {
    runtime.settings = normalizeConfig(rawConfig)
    ctx.logger?.info?.('webfetch-9router: re-applied on the same context — settings refreshed in place')
  }
  const readSettings = () => runtime.settings
  const available = () => readSettings().apiKey !== ''

  // Registration ownership: the seam ties a provider to the fiber that
  // registered it. When a configuration edit restarts this row, the new fiber
  // can run before the old one finishes disposing, so the first registration
  // attempt sees a duplicate and must retry until the previous registration is
  // gone. Without the retry the provider would disappear for the rest of the
  // generation and every agent web call would fail with
  // "configured web provider \"9router\" is not registered".
  const reentered = previous !== undefined
  let registrationDisposed = false
  ctx.effect(
    () => () => {
      registrationDisposed = true
    },
    'webfetch-9router: provider registration guard',
  )

  /**
   * Register one provider, waiting out a registration owned by the previous
   * generation of this row.
   * @param {() => () => void} register - the registration call.
   * @param {string} label - diagnostic label.
   */
  const registerWhenFree = (register, label) => {
    let attempts = 0
    const attempt = () => {
      if (registrationDisposed) return
      try {
        register()
        ctx.logger?.info?.(`webfetch-9router: ${label} "${PROVIDER_ID}" registered`)
      } catch (error) {
        const message = String(error?.message ?? error)
        const duplicate =
          error?.code === 'WEB_DUPLICATE_PROVIDER' || /already registered|duplicate/i.test(message)
        if (!duplicate) {
          ctx.logger?.warn?.(`webfetch-9router: ${label} registration failed — ${message}`)
          return
        }
        // Same-context re-entry: the registration made by the previous apply()
        // is still ours and now reads the refreshed settings through the shared
        // runtime object, so keep it.
        if (reentered) {
          ctx.logger?.info?.(`webfetch-9router: ${label} already registered for this context — keeping it`)
          return
        }
        if (attempts >= 100) {
          ctx.logger?.warn?.(
            `webfetch-9router: ${label} "${PROVIDER_ID}" is still registered by another fiber; keeping that registration`,
          )
          return
        }
        attempts += 1
        setTimeout(attempt, 50)
      }
    }
    attempt()
  }

  const searchProvider = {
    id: PROVIDER_ID,
    /** Cheap local usability check; never makes a network call. */
    available,
    /**
     * Run one web search through 9router.
     * @param {{ query: string, maxResults?: number }} request - the seam request.
     * @param {AbortSignal | undefined} signal - cancellation.
     * @returns the normalized search result.
     */
    async search(request, signal) {
      const settings = readSettings()
      const query = typeof request?.query === 'string' ? request.query.trim() : ''
      if (query === '') throw new Error('query is required')
      if (query.length > MAX_QUERY_LENGTH) {
        throw new Error(`query is longer than ${MAX_QUERY_LENGTH} characters`)
      }
      const maxResults = clampMaxResults(request.maxResults, settings.defaultMaxResults)
      const payload = await callRouter(
        settings,
        '/v1/search',
        {
          model: 'search',
          query,
          search_type: settings.searchType,
          max_results: maxResults,
        },
        signal,
      )
      return normalizeSearchResult(payload, maxResults, query)
    },
  }

  const fetchProvider = {
    id: PROVIDER_ID,
    /** Cheap local usability check; never makes a network call. */
    available,
    /**
     * Retrieve one page through 9router.
     * @param {{ url: string }} request - the seam request.
     * @param {AbortSignal | undefined} signal - cancellation.
     * @returns the normalized fetch result.
     */
    async fetch(request, signal) {
      const settings = readSettings()
      const url = typeof request?.url === 'string' ? request.url.trim() : ''
      const normalizedUrl = url === '' || url.length > MAX_URL_LENGTH ? null : httpUrl(url)
      if (normalizedUrl === null) {
        throw new Error('url must be an absolute http(s) URL')
      }
      const payload = await callRouter(
        settings,
        '/v1/web/fetch',
        { model: 'fetch', url: normalizedUrl, format: 'markdown' },
        signal,
      )
      return normalizeFetchResult(payload, normalizedUrl)
    },
  }

  registerWhenFree(() => ctx.web.registerSearchProvider(searchProvider), 'search provider')
  registerWhenFree(() => ctx.web.registerFetchProvider(fetchProvider), 'fetch provider')

  // Provider selection can only be written through the settings service, which
  // may not be mounted yet during apply(). Re-take over if the shipped defaults
  // reappear later (for example after toggling the built-in search switch).
  ctx.inject(['settings'], (sctx) => {
    let reclaiming = false
    const reclaim = () => {
      if (reclaiming) return
      if (!available()) {
        ctx.logger?.info?.(
          'webfetch-9router: no API key configured — leaving web.searchProvider/web.fetchProvider untouched',
        )
        return
      }
      const searchCurrent = readProviderSelection(ctx.web, 'searchProvider')
      const fetchCurrent = readProviderSelection(ctx.web, 'fetchProvider')
      const ops = []
      if (searchCurrent === undefined || searchCurrent === null || searchCurrent === OFFICIAL_SEARCH_PROVIDER_ID) {
        queueProviderSelection(ctx.web, 'searchProvider', PROVIDER_ID, ops)
      } else if (searchCurrent !== PROVIDER_ID) {
        ctx.logger?.warn?.(
          `webfetch-9router: web_search is served by provider "${searchCurrent}", not "${PROVIDER_ID}"; leaving it. ` +
            'Pin it explicitly with a profile patch row: - id: web / config: { searchProvider: 9router }',
        )
      }
      if (fetchCurrent === undefined || fetchCurrent === null || fetchCurrent === OFFICIAL_FETCH_PROVIDER_ID) {
        queueProviderSelection(ctx.web, 'fetchProvider', PROVIDER_ID, ops)
      } else if (fetchCurrent !== PROVIDER_ID) {
        ctx.logger?.warn?.(
          `webfetch-9router: web_fetch is served by provider "${fetchCurrent}", not "${PROVIDER_ID}"; leaving it. ` +
            'Pin it explicitly with a profile patch row: - id: web / config: { fetchProvider: 9router }',
        )
      }
      if (ops.length === 0) return
      if (typeof sctx.settings?.mutate !== 'function') {
        ctx.logger?.warn?.('webfetch-9router: cannot take over the web providers — the settings service is unavailable')
        return
      }
      reclaiming = true
      Promise.resolve(sctx.settings.mutate('web', ops)).then(
        () => {
          reclaiming = false
          ctx.logger?.info?.(
            `webfetch-9router: agent web tools now use 9router (${ops
              .map((op) => `${op.path[0]}=${op.value}`)
              .join(', ')})`,
          )
        },
        (error) => {
          reclaiming = false
          ctx.logger?.warn?.(
            `webfetch-9router: could not take over the web providers (${error?.message ?? error}); ` +
              'set web.searchProvider/web.fetchProvider = 9router in the profile patch',
          )
        },
      )
    }
    reclaim()
    // Our own mutate emits this event too; reclaim() is a no-op once the
    // selection is ours, and the timer leaves the settings emit stack.
    sctx.on?.('settings/document-updated', (ns) => {
      if (String(ns) !== 'web') return
      setTimeout(() => {
        try {
          reclaim()
        } catch (error) {
          ctx.logger?.warn?.(`webfetch-9router: provider re-check failed — ${error?.message ?? error}`)
        }
      }, 0)
    })
  })

  // Browser bridge for the configuration page on the Plugins screen. The page
  // is a client plugin registering into the plugins.row.config slot; it reads
  // the effective settings here and saves changes through the Harness config
  // editor, which persists them to the profile patch and reconciles this row.
  ctx.inject(['webServer', 'connection'], (wctx) => {
    const webServer = wctx.get('webServer')
    const connection = wctx.get('connection')
    if (webServer === undefined || webServer === null) return

    const handler = async (req, res) => {
      if (rejectedByTrustFence(connection, req, res)) return
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, config: describeConfig(readSettings(), ctx.web) })
        return
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'GET, POST')
        res.end()
        return
      }
      const text = await readJsonPayload(req, res)
      if (text === null) return
      const parsed = parseConfigBody(text)
      if (parsed.error !== undefined) {
        sendJson(res, 400, { ok: false, code: 'invalid-request', error: parsed.error })
        return
      }
      const editor = ctx.get('configEditor')
      const entry = ctx.fiber?.entry
      if (editor === undefined || entry === undefined) {
        sendJson(res, 503, {
          ok: false,
          code: 'config-unavailable',
          error: 'this profile cannot persist plugin configuration',
        })
        return
      }
      try {
        await editor.edit(entry, (current) => ({ ...current, ...parsed.patch }))
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.(`webfetch-9router: config save failed - ${detail}`)
        sendJson(res, 500, {
          ok: false,
          code: 'config-save-failed',
          error: 'could not save the 9router configuration',
          detail,
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        config: describeConfig({ ...readSettings(), ...parsed.patch }, ctx.web),
      })
    }

    // A re-entry on the same context can still overlap the previous route
    // disposal; keep the existing registration instead of failing the apply.
    try {
      wctx.effect(
        () => webServer.register({ kind: 'exact', path: CONFIG_ROUTE, handler }),
        `webfetch-9router: GET/POST ${CONFIG_ROUTE}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/duplicate .*route/i.test(message)) throw error
      ctx.logger?.info?.('webfetch-9router: configuration route already registered — keeping it')
    }
  })
}
