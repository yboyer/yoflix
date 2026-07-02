import fs from 'node:fs'
import path from 'node:path'

import type {
  ArrBootstrapConfig,
  ArrCustomFormatConfig,
  ArrCustomFormatType,
  ArrQualityProfileConfig,
  ServiceType,
} from './types.ts'
import { BOOTSTRAP_CONFIG_DIR, log, readJson } from './runtime.ts'

//

const CUSTOM_FORMAT_TYPES = ['regex', 'resolution'] as const
const EMPTY_BOOTSTRAP_CONFIG: ArrBootstrapConfig = {
  qualityProfiles: [],
  customFormats: [],
}
const BOOTSTRAP_CONFIG_FILE = path.join(BOOTSTRAP_CONFIG_DIR, 'config.json')

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid object for ${label}`)
  }

  return value
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Expected non-empty string for ${label}`)
  }

  return value
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value == null || value === '') {
    return undefined
  }

  return assertString(value, label)
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`Expected string array for ${label}`)
  }

  return [...value]
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Expected number for ${label}`)
  }

  return value
}

function assertOptionalNumber(value: unknown, label: string): number | undefined {
  return value == null ? undefined : assertNumber(value, label)
}

function assertOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value == null) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean for ${label}`)
  }

  return value
}

function assertNumberRecord(value: unknown, label: string): Record<string, number> {
  const record = assertRecord(value, label)
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, assertNumber(entry, `${label}.${key}`)])
  )
}

function assertEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`Unsupported value for ${label}: ${String(value)}`)
  }

  return value as T
}

function assertQualityProfileConfig(value: unknown, label: string): ArrQualityProfileConfig {
  const record = assertRecord(value, label)

  return {
    name: assertString(record.name, `${label}.name`),
    cutoff: assertString(record.cutoff, `${label}.cutoff`),
    allowed: assertStringArray(record.allowed, `${label}.allowed`),
    formatScores:
      record.formatScores == null
        ? undefined
        : assertNumberRecord(record.formatScores, `${label}.formatScores`),
    upgradeAllowed: assertOptionalBoolean(record.upgradeAllowed, `${label}.upgradeAllowed`),
    minFormatScore: assertOptionalNumber(record.minFormatScore, `${label}.minFormatScore`),
    cutoffFormatScore: assertOptionalNumber(record.cutoffFormatScore, `${label}.cutoffFormatScore`),
    minUpgradeFormatScore: assertOptionalNumber(
      record.minUpgradeFormatScore,
      `${label}.minUpgradeFormatScore`
    ),
  }
}

function assertCustomFormatType(value: unknown, label: string): ArrCustomFormatType {
  return assertEnum(value, CUSTOM_FORMAT_TYPES, label)
}

function assertCustomFormatValue(
  type: ArrCustomFormatType,
  value: unknown,
  label: string
): string | number {
  return type === 'regex' ? assertString(value, label) : assertNumber(value, label)
}

function assertCustomFormatConfig(value: unknown, label: string): ArrCustomFormatConfig {
  const record = assertRecord(value, label)
  const type = assertCustomFormatType(record.type, `${label}.type`)

  return {
    name: assertString(record.name, `${label}.name`),
    type,
    value: assertCustomFormatValue(type, record.value, `${label}.value`),
    negate: assertOptionalBoolean(record.negate, `${label}.negate`),
    required: assertOptionalBoolean(record.required, `${label}.required`),
    includeCustomFormatWhenRenaming: assertOptionalBoolean(
      record.includeCustomFormatWhenRenaming,
      `${label}.includeCustomFormatWhenRenaming`
    ),
    specName: assertOptionalString(record.specName, `${label}.specName`),
  }
}

function parseConfigList<T>(
  parsed: Record<string, unknown>,
  key: keyof ArrBootstrapConfig,
  serviceType: ServiceType,
  parseItem: (value: unknown, label: string) => T
): T[] {
  const items = parsed[key]

  return Array.isArray(items)
    ? items.map((entry, index) => parseItem(entry, `${serviceType}.${key}[${index}]`))
    : []
}

export function loadArrBootstrapConfig(serviceType: ServiceType): ArrBootstrapConfig {
  if (!fs.existsSync(BOOTSTRAP_CONFIG_FILE)) {
    log(
      `${serviceType} bootstrap config skipped:`,
      path.relative(process.cwd(), BOOTSTRAP_CONFIG_FILE)
    )
    return EMPTY_BOOTSTRAP_CONFIG
  }

  const parsed = assertRecord(readJson<unknown>(BOOTSTRAP_CONFIG_FILE), BOOTSTRAP_CONFIG_FILE)
  const config = {
    qualityProfiles: parseConfigList(
      parsed,
      'qualityProfiles',
      serviceType,
      assertQualityProfileConfig
    ),
    customFormats: parseConfigList(parsed, 'customFormats', serviceType, assertCustomFormatConfig),
  }

  log(
    `${serviceType} bootstrap config loaded:`,
    `quality=${config.qualityProfiles.length}`,
    `customFormats=${config.customFormats.length}`
  )

  return config
}
