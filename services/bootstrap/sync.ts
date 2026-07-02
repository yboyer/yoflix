import type { ArrClient } from './runtime.ts'
import type {
  ArrConfigResource,
  ArrCustomFormatConfig,
  ArrQualityProfileConfig,
  ArrResource,
  ArrResourceMap,
  ArrTemplate,
  BootstrapArrOptions,
  IndexerOptions,
  ServiceType,
} from './types.ts'
import { loadArrBootstrapConfig } from './config.ts'
import {
  assignDefined,
  clone,
  ensureNamedResource,
  env,
  getImplementationTemplate,
  getNamedResourceMap,
  getNamedTemplate,
  log,
  normalizePath,
  normalizeUrl,
  requireFieldValue,
  resolveArrApiKey,
  setFieldValues,
  upsertNamedResource,
  waitForArrService,
} from './runtime.ts'

//

type PayloadBuilder<T> = (item: T) => Promise<ArrConfigResource>
type QualityNode = Record<string, unknown>
type QualityLeaf = { name: string; id?: number }

const NOTIFICATION_DEFAULT_FLAGS: Record<string, boolean> = {
  onGrab: true,
  onDownload: true,
  onUpgrade: true,
  onRename: false,
  onHealthIssue: false,
  onHealthRestored: false,
  onApplicationUpdate: false,
  onManualInteractionRequired: false,
}

const NOTIFICATION_SERVICE_FLAGS: Record<ServiceType, Record<string, boolean>> = {
  radarr: {
    onMovieAdded: false,
    onMovieDelete: false,
    onMovieFileDelete: false,
    onMovieFileDeleteForUpgrade: true,
  },
  sonarr: {
    onImportComplete: false,
    onSeriesAdd: false,
    onSeriesDelete: false,
    onEpisodeFileDelete: false,
    onEpisodeFileDeleteForUpgrade: true,
  },
}

const NOTIFICATION_FIELD_VALUES = {
  url: env.WEBHOOK_URL,
  method: 1,
  username: '',
  password: '',
  headers: [],
}

const INDEXER_FIELD_DEFAULTS = {
  apiPath: '/api',
  additionalParameters: '',
  'seedCriteria.seedRatio': null,
  'seedCriteria.seedTime': null,
  'seedCriteria.seasonPackSeedTime': null,
  rejectBlocklistedTorrentHashesWhileGrabbing: false,
  animeStandardFormatSearch: false,
  searchByTitle: false,
}

function applyTemplatePatch(
  template: ArrTemplate,
  values: Record<string, unknown>,
  fieldValues?: Record<string, unknown>
): void {
  Object.assign(template, values)

  if (fieldValues) {
    setFieldValues(template.fields, fieldValues)
  }
}

function expectQualityNode(value: unknown, label: string): QualityNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid object for ${label}`)
  }

  return value as QualityNode
}

function expectQualityList(items: unknown, label: string): unknown[] {
  if (!Array.isArray(items)) {
    throw new Error(`Expected array for ${label}`)
  }

  return items
}

function readQualityLeaf(node: QualityNode, label: string): QualityLeaf | undefined {
  if (node.quality == null) {
    return undefined
  }

  const quality = expectQualityNode(node.quality, `${label}.quality`)
  const name = quality.name

  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`Expected non-empty string for ${label}.quality.name`)
  }

  const id = quality.id
  if (id !== null && (typeof id !== 'number' || Number.isNaN(id))) {
    throw new Error(`Expected numeric quality id for ${label}.${name}`)
  }

  return { name, id: id as number }
}

function visitQualityTree(
  items: unknown,
  label: string,
  onLeaf: (leaf: QualityLeaf, node: QualityNode) => boolean,
  markGroups = false
): boolean {
  let hasMatch = false

  for (const item of expectQualityList(items, label)) {
    const node = expectQualityNode(item, label)
    const leaf = readQualityLeaf(node, label)

    if (leaf) {
      hasMatch ||= onLeaf(leaf, node)
      continue
    }

    if (Array.isArray(node.items)) {
      const childMatch = visitQualityTree(node.items, label, onLeaf, markGroups)

      if (markGroups) {
        node.allowed = childMatch
      }

      hasMatch ||= childMatch
    }
  }

  return hasMatch
}

async function ensureRootFolder(client: ArrClient): Promise<ArrResource> {
  const folders = await client.get<(ArrResource & { path: string })[]>('api/v3/rootfolder')
  const existing = folders.find(
    folder => normalizePath(folder.path) === normalizePath(env.ROOT_FOLDER)
  )

  if (existing) {
    log(`${client.name} root folder ok:`, existing.path)
    return existing
  }

  const created = await client.post<ArrResource & { path: string }>('api/v3/rootfolder', {
    path: env.ROOT_FOLDER,
  })

  log(`${client.name} root folder created:`, created.path)
  return created
}

async function ensureDownloadClient(client: ArrClient, name: string): Promise<ArrTemplate> {
  return ensureNamedResource(
    client,
    'downloadclient',
    name,
    () => getImplementationTemplate(client, 'downloadclient', 'TorrentBlackhole'),
    template => {
      applyTemplatePatch(
        template,
        {
          enable: true,
          priority: 1,
          removeCompletedDownloads: true,
          removeFailedDownloads: true,
          name,
          tags: [],
        },
        {
          torrentFolder: `${normalizePath(env.TORRENT_FOLDER)}/`,
          watchFolder: `${normalizePath(env.WATCH_FOLDER)}/`,
          saveMagnetFiles: false,
          magnetFileExtension: '.magnet',
          readOnly: false,
        }
      )
    }
  )
}

async function ensureNotification(
  client: ArrClient,
  name: string,
  serviceType: ServiceType
): Promise<ArrTemplate> {
  return ensureNamedResource(
    client,
    'notification',
    name,
    () => getImplementationTemplate(client, 'notification', 'Webhook'),
    template => {
      applyTemplatePatch(
        template,
        {
          name,
          includeHealthWarnings: serviceType === 'radarr',
          tags: [],
          ...NOTIFICATION_DEFAULT_FLAGS,
          ...NOTIFICATION_SERVICE_FLAGS[serviceType],
        },
        NOTIFICATION_FIELD_VALUES
      )
    }
  )
}

async function ensureIndexer(
  client: ArrClient,
  name: string,
  downloadClientId: number,
  options: IndexerOptions
): Promise<ArrTemplate> {
  return ensureNamedResource(
    client,
    'indexer',
    name,
    () => getImplementationTemplate(client, 'indexer', 'Torznab'),
    template => {
      applyTemplatePatch(
        template,
        {
          name,
          enableRss: true,
          enableAutomaticSearch: true,
          enableInteractiveSearch: true,
          priority: 25,
          tags: [],
          downloadClientId,
        },
        {
          baseUrl: `${normalizeUrl(env.JACKETT_BASE_URL)}/api/v2.0/indexers/${name}/results/torznab/`,
          apiKey: options.jackettApiKey,
          categories: options.categories,
          animeCategories: options.animeCategories,
          minimumSeeders: options.minimumSeeders,
          ...INDEXER_FIELD_DEFAULTS,
        }
      )
    }
  )
}

function collectQualityResources(
  items: unknown,
  label: string,
  resources = new Map<string, ArrResource>()
): ArrResourceMap {
  visitQualityTree(items, label, leaf => {
    if (typeof leaf.id !== 'number') {
      throw new Error(`Expected numeric quality id for ${label}.${leaf.name}`)
    }

    resources.set(leaf.name, { name: leaf.name, id: leaf.id })
    return false
  })

  return resources
}

function markAllowedQualities(items: unknown, allowedNames: Set<string>, label: string): boolean {
  return visitQualityTree(
    items,
    label,
    (leaf, node) => {
      const allowed = allowedNames.has(leaf.name)
      node.allowed = allowed
      return allowed
    },
    true
  )
}

function buildQualityProfileFormatItems(
  formatScores: Record<string, number> | undefined,
  customFormats: ArrResourceMap,
  label: string
): Array<{ format: number; name: string; score: number }> {
  if (!formatScores) {
    return []
  }

  return Object.entries(formatScores).map(([name, score]) => {
    const customFormat = customFormats.get(name)
    if (!customFormat) {
      throw new Error(`${label} references missing custom format: ${name}`)
    }

    return {
      format: customFormat.id,
      name,
      score,
    }
  })
}

function assertKnownResources(
  available: ArrResourceMap,
  names: Iterable<string>,
  label: string,
  resourceName: string
): void {
  for (const name of names) {
    if (!available.has(name)) {
      throw new Error(`${label} references missing ${resourceName}: ${name}`)
    }
  }
}

async function buildCustomFormatPayload(
  client: ArrClient,
  customFormat: ArrCustomFormatConfig
): Promise<ArrConfigResource> {
  const implementation =
    customFormat.type === 'regex' ? 'ReleaseTitleSpecification' : 'ResolutionSpecification'
  const specification = await getImplementationTemplate(client, 'customformat', implementation)
  const payload: ArrConfigResource = {
    name: customFormat.name,
    includeCustomFormatWhenRenaming: customFormat.includeCustomFormatWhenRenaming ?? false,
    specifications: [specification],
  }

  const [entry] = payload.specifications as ArrTemplate[]
  applyTemplatePatch(entry, {
    name: customFormat.specName || String(customFormat.value),
    negate: customFormat.negate ?? false,
    required: customFormat.required ?? false,
  })
  requireFieldValue(entry.fields, 'value', customFormat.value, `${client.name} customformat schema`)

  return payload
}

async function buildQualityProfilePayload(
  client: ArrClient,
  serviceType: ServiceType,
  qualityProfile: ArrQualityProfileConfig,
  customFormats: ArrResourceMap
): Promise<ArrConfigResource> {
  const payload = await getNamedTemplate(
    client,
    'qualityprofile',
    qualityProfile.name,
    'quality profile'
  )
  const label = `${serviceType} quality profile ${qualityProfile.name}`
  const availableQualities = collectQualityResources(payload.items, label)
  const allowedNames = new Set(qualityProfile.allowed)

  assertKnownResources(availableQualities, allowedNames, label, 'quality')

  const cutoffQuality = availableQualities.get(qualityProfile.cutoff)
  if (!cutoffQuality) {
    throw new Error(`${label} references missing cutoff quality: ${qualityProfile.cutoff}`)
  }

  payload.name = qualityProfile.name
  payload.upgradeAllowed = qualityProfile.upgradeAllowed ?? payload.upgradeAllowed ?? true
  payload.cutoff = cutoffQuality.id
  payload.items = clone(payload.items)
  markAllowedQualities(payload.items, allowedNames, label)
  payload.formatItems = buildQualityProfileFormatItems(
    qualityProfile.formatScores,
    customFormats,
    label
  )
  assignDefined(payload, {
    minFormatScore: qualityProfile.minFormatScore,
    cutoffFormatScore: qualityProfile.cutoffFormatScore,
    minUpgradeFormatScore: qualityProfile.minUpgradeFormatScore,
  })

  return payload
}

async function syncResourcesFromConfig<T>(
  client: ArrClient,
  resource: string,
  items: T[],
  buildPayload: PayloadBuilder<T>,
  logLabel: string,
  serviceName = client.name
): Promise<ArrResourceMap> {
  for (const item of items) {
    await upsertNamedResource(client, resource, await buildPayload(item))
  }

  if (items.length > 0) {
    log(`${serviceName} ${logLabel} synchronized:`, items.length)
  }

  return getNamedResourceMap(client, resource)
}

export async function syncBootstrapConfig(
  client: ArrClient,
  serviceType: ServiceType
): Promise<void> {
  const { customFormats, qualityProfiles } = loadArrBootstrapConfig(serviceType)

  if (customFormats.length === 0 && qualityProfiles.length === 0) {
    return
  }

  const customFormatMap = await syncResourcesFromConfig(
    client,
    'customformat',
    customFormats,
    customFormat => buildCustomFormatPayload(client, customFormat),
    'custom formats',
    serviceType
  )

  await syncResourcesFromConfig(
    client,
    'qualityprofile',
    qualityProfiles,
    qualityProfile =>
      buildQualityProfilePayload(client, serviceType, qualityProfile, customFormatMap),
    'quality profiles',
    serviceType
  )
}

export async function bootstrapArr(
  name: ServiceType,
  baseUrl: string,
  configXml: string,
  options: BootstrapArrOptions
): Promise<void> {
  const apiKey = await resolveArrApiKey(configXml)
  const client = await waitForArrService(name, baseUrl, apiKey)

  await ensureRootFolder(client)
  const downloadClient = await ensureDownloadClient(client, options.downloadClientName)
  await ensureNotification(client, options.notificationName, name)

  if (!options.indexerIds?.length) {
    throw new Error(`No Jackett indexers to configure for ${name}`)
  }

  for (const indexerId of options.indexerIds) {
    await ensureIndexer(client, indexerId, downloadClient.id, {
      minimumSeeders: options.minimumSeeders,
      categories: options.categories,
      animeCategories: options.animeCategories,
      jackettApiKey: options.jackettApiKey,
    })
  }

  await syncBootstrapConfig(client, name)
}
