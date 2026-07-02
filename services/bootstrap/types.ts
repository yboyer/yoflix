export type SearchParamValue = string | number | boolean

export type Waitable<T> = T | false | null | undefined | Promise<T | false | null | undefined>

export type ArrField = {
  name: string
  value: unknown
  [key: string]: unknown
}

export type ArrResource = {
  id: number
  name: string
  [key: string]: unknown
}

export type ArrTemplate = ArrResource & {
  fields: ArrField[]
}

export type ArrConfigResource = {
  name: string
  id?: number
  [key: string]: unknown
}

export type ArrQualityProfileConfig = {
  name: string
  cutoff: string
  allowed: string[]
  formatScores?: Record<string, number>
  upgradeAllowed?: boolean
  minFormatScore?: number
  cutoffFormatScore?: number
  minUpgradeFormatScore?: number
}

export type ArrCustomFormatType = 'regex' | 'resolution'

export type ArrCustomFormatConfig = {
  name: string
  type: ArrCustomFormatType
  value: string | number
  negate?: boolean
  required?: boolean
  includeCustomFormatWhenRenaming?: boolean
  specName?: string
}

export type ArrBootstrapConfig = {
  qualityProfiles: ArrQualityProfileConfig[]
  customFormats: ArrCustomFormatConfig[]
}

export type ArrResourceMap = Map<string, ArrResource>

export type HttpWaitOptions = {
  method?: string
  headers?: Headers
  searchParams?: Record<string, SearchParamValue>
}

export type ServiceType = 'radarr' | 'sonarr'

export type IndexerOptions = {
  minimumSeeders: number
  categories: number[]
  animeCategories: number[]
  jackettApiKey: string
}

export type BootstrapArrOptions = IndexerOptions & {
  downloadClientName: string
  notificationName: string
  indexerIds?: string[]
}
