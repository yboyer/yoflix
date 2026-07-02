import fs from 'node:fs'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { cleanEnv, num, str, url } from 'envalid'

import type {
  ArrConfigResource,
  ArrField,
  ArrResource,
  ArrResourceMap,
  ArrTemplate,
  HttpWaitOptions,
  ServiceType,
  Waitable,
} from './types.ts'

//

export const BOOTSTRAP_CONFIG_DIR = path.resolve(process.cwd(), 'services/bootstrap/config')

export const env = cleanEnv(process.env, {
  BOOTSTRAP_RETRY_DELAY_MS: num({ default: 2000 }),
  BOOTSTRAP_TIMEOUT_MS: num({ default: 120000 }),
  ROOT_FOLDER: str(),
  TORRENT_FOLDER: str(),
  WATCH_FOLDER: str(),
  WEBHOOK_URL: url(),
  JACKETT_BASE_URL: url(),
  JACKETT_API_KEY: str({ default: '' }),
  JACKETT_CONFIG_DIR: str({ default: '/config/jackett/Jackett' }),
  RADARR_BASE_URL: url(),
  RADARR_CONFIG_XML: str({ default: '/config/radarr/config.xml' }),
  SONARR_BASE_URL: url(),
  SONARR_CONFIG_XML: str({ default: '/config/sonarr/config.xml' }),
  RADARR_INDEXER_MIN_SEEDERS: num({ default: 5 }),
  SONARR_INDEXER_MIN_SEEDERS: num({ default: 1 }),
  RADARR_INDEXER_CATEGORIES: str({ default: '2000,8000,102000,102060,102070,102090' }),
  SONARR_INDEXER_CATEGORIES: str({ default: '5000,105000,105080' }),
  SONARR_INDEXER_ANIME_CATEGORIES: str({ default: '102179' }),
  DOWNLOAD_CLIENT_NAME: str({ default: 'Storage' }),
  NOTIFICATION_NAME: str({ default: 'Notifier' }),
})

export function log(...args: unknown[]) {
  console.log('[bootstrap]', ...args)
}

export function normalizeUrl(requestUrl: string): string {
  return requestUrl.replace(/\/+$/, '')
}

export function normalizePath(value: string): string {
  return value.replace(/\/+$/, '')
}

export function parseNumberList(value: string): number[] {
  return value
    .split(',')
    .map(Number)
    .filter(entry => !Number.isNaN(entry))
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function readXmlTagValue(filePath: string, tag: string): string | undefined {
  const content = fs.readFileSync(filePath, 'utf8')
  const match = content.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))
  return match?.[1]
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function stripId<T extends Record<string, unknown>>(value: T): T {
  const next = clone(value)
  delete next.id
  return next
}

export function assignDefined(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      target[key] = value
    }
  }
}

export function toArrResourceMap(items: ArrResource[]): ArrResourceMap {
  return new Map(items.map(item => [item.name, item]))
}

function setTemplateFieldValue(fields: ArrField[], name: string, value: unknown): boolean {
  const field = fields.find(entry => entry.name === name)
  if (!field) return false
  field.value = value
  return true
}

export function setFieldValues(fields: ArrField[], values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    setTemplateFieldValue(fields, name, value)
  }
}

export function requireFieldValue(
  fields: ArrField[],
  name: string,
  value: unknown,
  label: string
): void {
  if (!setTemplateFieldValue(fields, name, value)) {
    throw new Error(`Missing field ${name} on ${label}`)
  }
}

function parseResponseBody<T>(text: string): T {
  if (!text) {
    return null as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}

export class ArrClient {
  readonly name: string
  readonly baseUrl: string
  readonly apiKey: string

  constructor(name: string, baseUrl: string, apiKey: string) {
    this.name = name
    this.baseUrl = normalizeUrl(baseUrl)
    this.apiKey = apiKey
  }

  async request<T>(method: string, resource: string, json?: unknown): Promise<T> {
    let response: Response

    try {
      response = await fetch(`${this.baseUrl}/${resource.replace(/^\/+/, '')}`, {
        method,
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: json == null ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      throw new Error(`${this.name} ${method} ${resource} failed: ${getErrorMessage(error)}`)
    }

    const body = parseResponseBody<T>(await response.text())

    if (!response.ok) {
      throw new Error(`${this.name} ${method} ${resource} failed: ${JSON.stringify(body)}`)
    }

    return body
  }

  get<T>(resource: string): Promise<T> {
    return this.request('GET', resource)
  }

  post<T>(resource: string, json?: unknown): Promise<T> {
    return this.request('POST', resource, json)
  }

  put<T>(resource: string, json?: unknown): Promise<T> {
    return this.request('PUT', resource, json)
  }
}

export async function getImplementationTemplate(
  client: ArrClient,
  resource: string,
  implementation: string
): Promise<ArrTemplate> {
  const schemas = await client.get<(ArrTemplate & { implementation?: string })[]>(
    `api/v3/${resource}/schema`
  )
  const template = schemas.find(entry => entry.implementation === implementation)

  if (!template) {
    throw new Error(`${client.name} missing schema for ${resource}:${implementation}`)
  }

  const next = clone(template)
  delete next.presets
  return next
}

export async function ensureNamedResource<T extends ArrResource>(
  client: ArrClient,
  resource: string,
  name: string,
  createTemplate: () => Promise<T>,
  updatePayload: (payload: T) => void
): Promise<T> {
  const endpoint = `api/v3/${resource}`
  const existing = (await client.get<T[]>(endpoint)).find(item => item.name === name)
  const payload = existing ? clone(existing) : await createTemplate()

  updatePayload(payload)

  if (existing) {
    const updated = await client.put<T>(`${endpoint}/${existing.id}`, payload)
    log(`${client.name} ${resource} updated:`, name)
    return updated
  }

  const created = await client.post<T>(endpoint, payload)
  log(`${client.name} ${resource} created:`, name)
  return created
}

export async function upsertNamedResource(
  client: ArrClient,
  resource: string,
  payload: ArrConfigResource
): Promise<ArrResource> {
  const endpoint = `api/v3/${resource}`
  const existing = (await client.get<ArrResource[]>(endpoint)).find(
    item => item.name === payload.name
  )

  if (existing) {
    const updated = await client.put<ArrResource>(`${endpoint}/${existing.id}`, {
      ...clone(payload),
      id: existing.id,
    })
    log(`${client.name} ${resource} updated from config:`, payload.name)
    return updated
  }

  const created = await client.post<ArrResource>(endpoint, stripId(payload))
  log(`${client.name} ${resource} created from config:`, payload.name)
  return created
}

export async function getNamedResourceMap(
  client: ArrClient,
  resource: string
): Promise<ArrResourceMap> {
  return toArrResourceMap(await client.get<ArrResource[]>(`api/v3/${resource}`))
}

export async function getNamedTemplate(
  client: ArrClient,
  resource: string,
  name: string,
  errorLabel: string
): Promise<ArrConfigResource> {
  const templates = await client.get<ArrConfigResource[]>(`api/v3/${resource}`)
  const template = templates.find(entry => entry.name === name) || templates[0]

  if (!template) {
    throw new Error(`${client.name} missing ${errorLabel} template`)
  }

  return stripId(template)
}

export async function waitFor<T>(predicate: () => Waitable<T>, label: string): Promise<T> {
  const deadline = Date.now() + env.BOOTSTRAP_TIMEOUT_MS

  for (;;) {
    try {
      const value = await predicate()
      if (value) return value as T
    } catch {}

    if (Date.now() >= deadline) {
      throw new Error(`Timeout while waiting for ${label}`)
    }

    await setTimeout(env.BOOTSTRAP_RETRY_DELAY_MS)
  }
}

export function waitForFile(filePath: string): Promise<boolean> {
  return waitFor(() => fs.existsSync(filePath), filePath)
}

export function waitForHttp(requestUrl: string, options: HttpWaitOptions = {}): Promise<boolean> {
  return waitFor(async () => {
    try {
      const target = new URL(requestUrl)

      for (const [key, value] of Object.entries(options.searchParams || {})) {
        target.searchParams.set(key, String(value))
      }

      const response = await fetch(target, {
        method: options.method || 'GET',
        headers: options.headers,
        signal: AbortSignal.timeout(5000),
      })

      return response.ok
    } catch {
      return false
    }
  }, requestUrl)
}

export async function resolveJackettApiKey(): Promise<string> {
  if (env.JACKETT_API_KEY) {
    return env.JACKETT_API_KEY
  }

  const serverConfigPath = path.join(env.JACKETT_CONFIG_DIR, 'ServerConfig.json')
  await waitForFile(serverConfigPath)

  const serverConfig = readJson<{ APIKey?: string }>(serverConfigPath)
  if (!serverConfig.APIKey) {
    throw new Error(`Missing Jackett API key in ${serverConfigPath}`)
  }

  return serverConfig.APIKey
}

export async function resolveArrApiKey(filePath: string): Promise<string> {
  await waitForFile(filePath)

  return waitFor(() => readXmlTagValue(filePath, 'ApiKey') || false, `API key in ${filePath}`)
}

export async function waitForArrService(
  name: ServiceType,
  baseUrl: string,
  apiKey: string
): Promise<ArrClient> {
  const client = new ArrClient(name, baseUrl, apiKey)

  await waitFor(async () => {
    try {
      await client.get('api/v3/system/status')
      return true
    } catch {
      return false
    }
  }, `${name} API`)

  return client
}
