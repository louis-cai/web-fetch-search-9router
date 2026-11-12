/**
 * Client half of the 9router web-provider bundle.
 *
 * It adds no sidebar entry. It registers a configuration page for this bundle
 * on the existing **Plugins** screen: the row config page (`plugins.row.config`,
 * key `<package>#<rowId>`) and the bundle page (`plugins.bundle.config`). The
 * card reads the effective settings from the Host bridge and saves changes
 * through the Harness config editor, so the 9router host and API key can be
 * edited without touching YAML.
 */

window.__ModuleLoader__.load({
  id: '@local/webfetch-9router',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Client locale namespace for this bundle's copy. */
    const NS = 'webfetch-9router'
    /** Row config slot key: package name + '#' + the patch row id. */
    const ROW_CONFIG_KEY = '@local/webfetch-9router#webfetch-9router'
    /** Bundle config slot key: the package name. */
    const BUNDLE_CONFIG_KEY = '@local/webfetch-9router'
    /** Host bridge this bundle registers (see index.js). */
    const CONFIG_ENDPOINT = '/webfetch-9router/config'
    /** Search scopes the Host accepts. */
    const SEARCH_TYPE_IDS = ['web', 'news']
    /** Offered result counts; the Host caps at 20. */
    const RESULT_COUNT_IDS = [3, 5, 10]

    /** Plugin-prefixed stylesheet; host theme tokens carry every color. */
    const CSS = `
.wf9-card{display:flex;flex-direction:column;gap:14px;box-sizing:border-box;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wf9-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px}
.wf9-title{margin:0;font-size:14px;font-weight:600;line-height:1.5}
.wf9-subtitle{margin:2px 0 0;max-width:560px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.wf9-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.wf9-chip{max-width:100%;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf9-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.wf9-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.wf9-field-wide{grid-column:1/-1}
.wf9-label{font-size:12px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.wf9-input{height:32px;min-width:0;box-sizing:border-box;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.wf9-input:focus{border-color:var(--dsw-alias-brand-primary)}
.wf9-input:disabled{opacity:.6}
.wf9-note{grid-column:1/-1;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.wf9-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.wf9-button{display:inline-flex;align-items:center;justify-content:center;height:32px;box-sizing:border-box;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-weight:500;cursor:pointer}
.wf9-button:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover);background:var(--dsw-alias-button-primary-hover)}
.wf9-button:disabled{opacity:.55;cursor:default}
.wf9-loading{margin:0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.wf9-error{margin:0;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.wf9-saved{margin:0;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-brand-primary)}
.wf9-summary{color:var(--dsw-alias-label-secondary);font-size:12.5px}
`

    /** English copy. */
    const EN = {
      'card.title': '9router gateway',
      'card.subtitle':
        "The agent's web_search and web_fetch tools call this gateway. Saving writes the values to this profile and applies them immediately.",
      'card.hostLabel': '9router host',
      'card.hostPlaceholder': 'https://9router.example.com',
      'card.keyLabel': 'API key',
      'card.keyPlaceholder': 'Enter a new API key',
      'card.keyPlaceholderConfigured': 'Configured {hint}. Enter a new key to replace it',
      'card.keyNote': 'Leave the key blank to keep the current one. The key stays in the Host process.',
      'card.searchTypeLabel': 'Search scope',
      'card.searchType.web': 'Web',
      'card.searchType.news': 'News',
      'card.maxResultsLabel': 'Results per search',
      'card.timeoutLabel': 'Timeout (ms)',
      'card.save': 'Save',
      'card.saving': 'Saving…',
      'card.saved': 'Saved. New searches use this gateway.',
      'card.loading': 'Loading current settings…',
      'card.loadError': 'Could not load the current settings.',
      'card.saveError': 'Could not save the settings.',
      'card.invalidHost': 'Enter a full http:// or https:// host.',
      'card.invalidTimeout': 'Enter a timeout between 1000 and 120000 ms.',
      'card.invalidMaxResults': 'Enter a result count between 1 and 20.',
      'card.searchProvider': 'web_search: {value}',
      'card.fetchProvider': 'web_fetch: {value}',
      'card.providerNone': 'not set',
      'card.summary': '9router · {host}',
      'card.summaryShort': '9router web search and fetch',
    }

    /** Chinese copy. */
    const ZH = {
      'card.title': '9router 网关',
      'card.subtitle': 'agent 的 web_search / web_fetch 会调用该网关。保存后会写入当前 profile 并立即生效。',
      'card.hostLabel': '9router 地址',
      'card.hostPlaceholder': 'https://9router.example.com',
      'card.keyLabel': 'API key',
      'card.keyPlaceholder': '输入新的 API key',
      'card.keyPlaceholderConfigured': '已配置 {hint}，输入新值可替换',
      'card.keyNote': '留空则保留当前 key。key 只保存在 Host 进程内。',
      'card.searchTypeLabel': '搜索范围',
      'card.searchType.web': '网页',
      'card.searchType.news': '新闻',
      'card.maxResultsLabel': '每次搜索条数',
      'card.timeoutLabel': '超时（毫秒）',
      'card.save': '保存',
      'card.saving': '保存中…',
      'card.saved': '已保存，新的搜索会使用该网关。',
      'card.loading': '正在读取当前设置…',
      'card.loadError': '无法读取当前设置。',
      'card.saveError': '无法保存设置。',
      'card.invalidHost': '请输入完整的 http:// 或 https:// 地址。',
      'card.invalidTimeout': '请输入 1000 到 120000 之间的超时毫秒数。',
      'card.invalidMaxResults': '请输入 1 到 20 之间的结果条数。',
      'card.searchProvider': 'web_search：{value}',
      'card.fetchProvider': 'web_fetch：{value}',
      'card.providerNone': '未设置',
      'card.summary': '9router · {host}',
      'card.summaryShort': '9router 网页搜索与抓取',
    }

    /**
     * Read a response body as JSON, or null when it is not JSON.
     * @param {Response} response - the response to read.
     * @returns the parsed payload or null.
     */
    async function readJson(response) {
      try {
        return await response.json()
      } catch {
        return null
      }
    }

    /**
     * Extract a human-readable detail from a failed bridge response.
     * @param {any} payload - the parsed response body.
     * @param {number} status - the HTTP status.
     * @returns the detail text.
     */
    function failureDetail(payload, status) {
      if (payload !== null && typeof payload === 'object') {
        if (typeof payload.detail === 'string' && payload.detail !== '') return payload.detail
        if (typeof payload.error === 'string' && payload.error !== '') return payload.error
      }
      return `HTTP ${status}`
    }

    /**
     * Build the configuration card used by both Plugins slots.
     * @param {import('@deepseek-ai/cordis').Context} ctx - the client plugin context.
     * @returns the card component.
     */
    function makeCard(ctx) {
      const subscribeLocale = (onChange) => ctx.locale.subscribe(onChange)
      const readLocale = () => ctx.locale.getSnapshot()

      return function ConnectionCard(props) {
        React.useSyncExternalStore(subscribeLocale, readLocale)
        const tr = ctx.locale.bind(NS)

        const [config, setConfig] = React.useState(null)
        const [phase, setPhase] = React.useState('loading')
        const [failure, setFailure] = React.useState(null)
        const [saved, setSaved] = React.useState(false)
        const [host, setHost] = React.useState('')
        const [keyInput, setKeyInput] = React.useState('')
        const [searchType, setSearchType] = React.useState('web')
        const [maxResults, setMaxResults] = React.useState(5)
        const [timeoutMs, setTimeoutMs] = React.useState(30000)

        const applyConfig = (next) => {
          if (next === null || typeof next !== 'object') return
          setConfig(next)
          if (typeof next.baseUrl === 'string') setHost(next.baseUrl)
          if (SEARCH_TYPE_IDS.includes(next.searchType)) setSearchType(next.searchType)
          if (Number.isInteger(next.defaultMaxResults)) setMaxResults(next.defaultMaxResults)
          if (Number.isInteger(next.timeoutMs)) setTimeoutMs(next.timeoutMs)
        }

        React.useEffect(() => {
          let cancelled = false
          ;(async () => {
            try {
              const response = await fetch(CONFIG_ENDPOINT, { method: 'GET' })
              const payload = await readJson(response)
              if (cancelled) return
              if (!response.ok || payload === null || payload.ok !== true) {
                setPhase('error')
                setFailure({
                  message: payload?.code === 'config-unavailable' ? tr('card.saveError') : tr('card.loadError'),
                  detail: failureDetail(payload, response.status),
                })
                return
              }
              applyConfig(payload.config)
              setPhase('idle')
            } catch (error) {
              if (cancelled) return
              setPhase('error')
              setFailure({
                message: tr('card.loadError'),
                detail: error instanceof Error ? error.message : String(error),
              })
            }
          })()
          return () => {
            cancelled = true
          }
          // Loads once per mount; a locale switch only re-renders.
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])

        const save = React.useCallback(
          async (event) => {
            if (event !== undefined) event.preventDefault()
            const trimmedHost = host.trim()
            if (!/^https?:\/\/\S+$/i.test(trimmedHost)) {
              setPhase('error')
              setFailure({ message: tr('card.invalidHost'), detail: null })
              return
            }
            const parsedTimeout = Number(timeoutMs)
            if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
              setPhase('error')
              setFailure({ message: tr('card.invalidTimeout'), detail: null })
              return
            }
            const parsedMaxResults = Number(maxResults)
            if (!Number.isInteger(parsedMaxResults) || parsedMaxResults < 1 || parsedMaxResults > 20) {
              setPhase('error')
              setFailure({ message: tr('card.invalidMaxResults'), detail: null })
              return
            }
            setPhase('saving')
            setFailure(null)
            setSaved(false)
            const body = {
              baseUrl: trimmedHost,
              searchType,
              defaultMaxResults: parsedMaxResults,
              timeoutMs: parsedTimeout,
            }
            const trimmedKey = keyInput.trim()
            if (trimmedKey !== '') body.apiKey = trimmedKey
            try {
              const response = await fetch(CONFIG_ENDPOINT, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              })
              const payload = await readJson(response)
              if (!response.ok || payload === null || payload.ok !== true) {
                setPhase('error')
                setFailure({
                  message: tr('card.saveError'),
                  detail: failureDetail(payload, response.status),
                })
                return
              }
              applyConfig(payload.config)
              setKeyInput('')
              setSaved(true)
              setPhase('idle')
            } catch (error) {
              setPhase('error')
              setFailure({
                message: tr('card.saveError'),
                detail: error instanceof Error ? error.message : String(error),
              })
            }
          },
          [host, keyInput, searchType, maxResults, timeoutMs, tr],
        )

        if (props !== null && typeof props === 'object' && props.view === 'summary') {
          return h(
            'span',
            { className: 'wf9-summary' },
            config !== null && typeof config.baseUrl === 'string' && config.baseUrl !== ''
              ? tr('card.summary', { host: config.baseUrl })
              : tr('card.summaryShort'),
          )
        }

        const resultOptions = RESULT_COUNT_IDS.includes(maxResults)
          ? RESULT_COUNT_IDS
          : [...RESULT_COUNT_IDS, maxResults].sort((left, right) => left - right)
        const chips =
          config === null
            ? null
            : h(
                'div',
                { className: 'wf9-chips' },
                h('span', { className: 'wf9-chip', key: 'host' }, config.baseUrl),
                h(
                  'span',
                  { className: 'wf9-chip', key: 'search' },
                  tr('card.searchProvider', { value: config.providers?.search ?? tr('card.providerNone') }),
                ),
                h(
                  'span',
                  { className: 'wf9-chip', key: 'fetch' },
                  tr('card.fetchProvider', { value: config.providers?.fetch ?? tr('card.providerNone') }),
                ),
              )

        const fields =
          phase === 'loading'
            ? h('p', { className: 'wf9-loading' }, tr('card.loading'))
            : h(
                'form',
                { className: 'wf9-form', onSubmit: save },
                h(
                  'label',
                  { className: 'wf9-field wf9-field-wide' },
                  h('span', { className: 'wf9-label' }, tr('card.hostLabel')),
                  h('input', {
                    className: 'wf9-input',
                    type: 'text',
                    inputMode: 'url',
                    autoComplete: 'off',
                    spellCheck: false,
                    value: host,
                    placeholder: tr('card.hostPlaceholder'),
                    'aria-label': tr('card.hostLabel'),
                    disabled: phase === 'saving',
                    onChange: (event) => setHost(event.target.value),
                  }),
                ),
                h(
                  'label',
                  { className: 'wf9-field wf9-field-wide' },
                  h('span', { className: 'wf9-label' }, tr('card.keyLabel')),
                  h('input', {
                    className: 'wf9-input',
                    type: 'password',
                    autoComplete: 'off',
                    spellCheck: false,
                    value: keyInput,
                    placeholder:
                      config !== null && typeof config.apiKeyHint === 'string'
                        ? tr('card.keyPlaceholderConfigured', { hint: config.apiKeyHint })
                        : tr('card.keyPlaceholder'),
                    'aria-label': tr('card.keyLabel'),
                    disabled: phase === 'saving',
                    onChange: (event) => setKeyInput(event.target.value),
                  }),
                ),
                h(
                  'label',
                  { className: 'wf9-field' },
                  h('span', { className: 'wf9-label' }, tr('card.searchTypeLabel')),
                  h(
                    'select',
                    {
                      className: 'wf9-input',
                      value: searchType,
                      'aria-label': tr('card.searchTypeLabel'),
                      disabled: phase === 'saving',
                      onChange: (event) => setSearchType(event.target.value),
                    },
                    SEARCH_TYPE_IDS.map((id) =>
                      h('option', { key: id, value: id }, tr(`card.searchType.${id}`)),
                    ),
                  ),
                ),
                h(
                  'label',
                  { className: 'wf9-field' },
                  h('span', { className: 'wf9-label' }, tr('card.maxResultsLabel')),
                  h(
                    'select',
                    {
                      className: 'wf9-input',
                      value: String(maxResults),
                      'aria-label': tr('card.maxResultsLabel'),
                      disabled: phase === 'saving',
                      onChange: (event) => setMaxResults(Number(event.target.value)),
                    },
                    resultOptions.map((count) => h('option', { key: count, value: String(count) }, String(count))),
                  ),
                ),
                h(
                  'label',
                  { className: 'wf9-field' },
                  h('span', { className: 'wf9-label' }, tr('card.timeoutLabel')),
                  h('input', {
                    className: 'wf9-input',
                    type: 'number',
                    min: 1000,
                    max: 120000,
                    step: 1000,
                    value: String(timeoutMs),
                    'aria-label': tr('card.timeoutLabel'),
                    disabled: phase === 'saving',
                    onChange: (event) => setTimeoutMs(Number(event.target.value)),
                  }),
                ),
                h('p', { className: 'wf9-note' }, tr('card.keyNote')),
                failure === null
                  ? null
                  : h(
                      'p',
                      { className: 'wf9-error', role: 'alert' },
                      failure.detail === null ? failure.message : `${failure.message} ${failure.detail}`,
                    ),
                saved ? h('p', { className: 'wf9-saved' }, tr('card.saved')) : null,
                h(
                  'div',
                  { className: 'wf9-actions' },
                  h(
                    'button',
                    { type: 'submit', className: 'wf9-button', disabled: phase === 'saving' },
                    phase === 'saving' ? tr('card.saving') : tr('card.save'),
                  ),
                ),
              )

        return h(
          'div',
          { className: 'wf9-card' },
          h('style', { key: 'wf9-styles' }, CSS),
          h(
            'div',
            { className: 'wf9-head' },
            h(
              'div',
              null,
              h('h3', { className: 'wf9-title' }, tr('card.title')),
              h('p', { className: 'wf9-subtitle' }, tr('card.subtitle')),
            ),
            chips,
          ),
          fields,
        )
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { en: EN, zh: ZH }),
          'webfetch-9router: dictionaries',
        )
        const ConnectionCard = makeCard(ctx)
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register({ name: 'plugins.row.config', key: ROW_CONFIG_KEY }, ConnectionCard),
        )
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register({ name: 'plugins.bundle.config', key: BUNDLE_CONFIG_KEY }, ConnectionCard),
        )
      },
    }
  },
})
