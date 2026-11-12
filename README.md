# 9router web provider

A DSH plugin bundle that makes 9router the Host-side web provider for the
agent. It adds **no sidebar entry**: the work happens behind the built-in
`web_search` and `web_fetch` tools, so every search or page read an agent
performs during a task goes through your 9router gateway. Its settings page
lives on the existing **Plugins** screen (Plugins → Installed plugins →
9router web provider → configure).

## What it registers

| Capability | Contribution |
| --- | --- |
| `ctx.web` search | provider id `9router` → `POST /v1/search` |
| `ctx.web` fetch | provider id `9router` → `POST /v1/web/fetch` |
| Client | configuration card registered in `plugins.row.config` / `plugins.bundle.config`, so the Plugins screen edits host, API key, scope, result count, and timeout |
| Host bridge | `GET`/`POST /webfetch-9router/config` behind the browser-trust fence, used by that card and backed by the Harness config editor |

The Host plugin (`index.js`) registers both providers and then points the web
service's provider selection at them:

```yaml
# written into the profile's cordis.patch.yml by the settings service
- id: web
  config:
    searchProvider: 9router
    fetchProvider: 9router
```

The takeover is deliberately narrow:

- **unset or shipped default** — `deepseek-official` for search, `http` for
  fetch — is claimed for `9router`;
- an **explicitly chosen other provider** is never overridden; the plugin logs a
  warning with the YAML needed to pin `9router` by hand;
- with no `apiKey` configured the plugin leaves the selection untouched (it is
  not a usable provider).

If the built-in search switch later resets the selection to the shipped
defaults, the plugin re-takes it once, so `web_search` keeps working.

## Agent experience

The shipped `web_search` / `web_fetch` tools do the rendering; this bundle only
supplies the backend:

- search returns normalized `sources[]` (`url`, `title`, `snippet`,
  `publishedAt`) plus the provider answer when 9router returns one. Snippets are
  stripped of provider HTML, and results without an http(s) URL are dropped.
- fetch returns the page's extracted markdown as a text body, so the tool can
  read long pages without an extra extraction step.
- `maxResults` is passed to 9router (capped at 20); the web seam enforces the
  bound again on the way back.
- Cancellation and the configured timeout abort the upstream request.

## Configure in the UI

Open **Plugins** in the sidebar, then either the bundle page or the
`9router web provider` row. The configuration card shows the active gateway,
whether `web_search` / `web_fetch` are served by `9router`, and these fields:

| Field | Meaning |
| --- | --- |
| 9router host | gateway base URL (http/https) |
| API key | blank keeps the current key; a new value replaces it |
| Search scope | `web` or `news` |
| Results per search | default `maxResults` passed upstream |
| Timeout (ms) | abort budget for one request |

Saving writes the values into the active profile's `cordis.patch.yml` through
the Harness config editor and reapplies the plugin immediately — no restart and
no YAML editing. The API key is never sent back to the browser; the card shows a
masked hint (`••••last4`).

The bundle declares no sidebar panel and no Settings page; the card rides the
existing Plugins screen.

## Configuration

Bundle defaults:

```yaml
- id: webfetch-9router
  name: '@local/webfetch-9router'
  config:
    baseUrl: 'http://localhost:20128'   # the 9router default local port
    apiKey: ''                          # no credential ships with the bundle
    timeoutMs: 30000
    searchType: web                     # web | news
    defaultMaxResults: 5                # 1..20
```

There is **no API key out of the box**: the bundle registers its providers but
leaves the web provider selection alone until a key is configured, so the
agent's web tools keep their previous backend. Set the gateway on the Plugins
screen (recommended) or with a profile override row targeting
`name: '@local/webfetch-9router'`; a matching override replaces the whole
config object, so repeat every field you want to keep. Once an API key is
present the plugin takes the provider selection over on the next apply.

The API key stays in the Host process: neither the agent conversation nor the
browser receives it.

### Pinning the provider by hand

To choose the provider explicitly (and to keep it even if this bundle is ever
disabled), add this to the profile patch. A patch replaces the whole `web`
config, so keep any other fields you rely on:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: 9router
    fetchProvider: 9router
```

## Install

Install the bundle once with `plugin_manager` (`action: install_bundle`, this
directory or your published source as `target`), then restart DeepSeek Harness
so the Host half loads. Configure the gateway afterwards on the Plugins screen.

## Local development

Files are plain ESM; there is no build step. After editing, reinstall the bundle
with `plugin_manager` (`action: install_bundle`) and restart DSH for Host
changes; Client changes also need a page refresh.

## Scope and limits

- One query or one URL per call; no batch mode, history, or caching.
- Provider `available()` is a local check (an API key must be configured); it
  never sends a network request.
- Fetch bodies surface as text; the seam's closed body union has no markdown arm,
  so formatting is whatever 9router's extractor produced.
- The configuration card lives on the Plugins screen; there is no dedicated
  sidebar entry. Settings → Built-in plugins stays read-only.
