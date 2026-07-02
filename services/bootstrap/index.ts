import type { BootstrapArrOptions, ServiceType } from './types.ts'
import {
  env,
  getErrorMessage,
  log,
  normalizeUrl,
  parseNumberList,
  resolveJackettApiKey,
  waitForHttp,
} from './runtime.ts'
import { bootstrapArr } from './sync.ts'

//

type BootstrapTarget = {
  name: ServiceType
  baseUrl: string
  configXml: string
  options: Omit<BootstrapArrOptions, 'jackettApiKey' | 'indexerIds'>
}

const TARGETS: BootstrapTarget[] = [
  {
    name: 'radarr',
    baseUrl: env.RADARR_BASE_URL,
    configXml: env.RADARR_CONFIG_XML,
    options: {
      downloadClientName: env.DOWNLOAD_CLIENT_NAME,
      notificationName: env.NOTIFICATION_NAME,
      minimumSeeders: env.RADARR_INDEXER_MIN_SEEDERS,
      categories: parseNumberList(env.RADARR_INDEXER_CATEGORIES),
      animeCategories: [],
    },
  },
  {
    name: 'sonarr',
    baseUrl: env.SONARR_BASE_URL,
    configXml: env.SONARR_CONFIG_XML,
    options: {
      downloadClientName: env.DOWNLOAD_CLIENT_NAME,
      notificationName: env.NOTIFICATION_NAME,
      minimumSeeders: env.SONARR_INDEXER_MIN_SEEDERS,
      categories: parseNumberList(env.SONARR_INDEXER_CATEGORIES),
      animeCategories: parseNumberList(env.SONARR_INDEXER_ANIME_CATEGORIES),
    },
  },
]

function getJackettUrl(resource: string): string {
  return `${normalizeUrl(env.JACKETT_BASE_URL)}/${resource.replace(/^\/+/, '')}`
}

async function getIndexerIds(apiKey: string): Promise<string[]> {
  const indexersUrl = new URL(getJackettUrl('api/v2.0/indexers/all/results/torznab'))
  indexersUrl.searchParams.set('apikey', apiKey)
  indexersUrl.searchParams.set('t', 'indexers')
  indexersUrl.searchParams.set('configured', 'true')

  let response: Response

  try {
    response = await fetch(indexersUrl, {
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    throw new Error(`Jackett GET ${indexersUrl.pathname} failed: ${getErrorMessage(error)}`)
  }

  const body = await response.text()

  if (!response.ok) {
    throw new Error(`Jackett GET ${indexersUrl.pathname} failed: ${body}`)
  }

  const uniqueIndexerIds = [
    ...new Set([...body.matchAll(/<indexer\b[^>]*\bid="([^"]+)"/g)].map(match => match[1])),
  ]

  if (uniqueIndexerIds.length === 0) {
    throw new Error('No configured Jackett indexers found')
  }

  log('Jackett indexers found:', uniqueIndexerIds.join(', '))
  return uniqueIndexerIds
}

async function waitForJackettIndexer(apiKey: string): Promise<void> {
  await waitForHttp(getJackettUrl('api/v2.0/indexers/all/results/torznab/api'), {
    searchParams: {
      apikey: apiKey,
      t: 'caps',
    },
  })

  log('Jackett indexer ready')
}

async function main(): Promise<void> {
  log('Bootstrap started')

  const jackettApiKey = await resolveJackettApiKey()
  await waitForJackettIndexer(jackettApiKey)

  const indexerIds = await getIndexerIds(jackettApiKey)

  for (const target of TARGETS) {
    await bootstrapArr(target.name, target.baseUrl, target.configXml, {
      ...target.options,
      jackettApiKey,
      indexerIds,
    })
  }

  log('Bootstrap completed')
}

main().catch((error: unknown) => {
  console.error('[bootstrap] Failed:', getErrorMessage(error))
  process.exit(1)
})
