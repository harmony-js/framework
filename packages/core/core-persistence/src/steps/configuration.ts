import { PersistenceConfig } from '@harmonyjs/types-persistence'

// eslint-disable-next-line import/prefer-default-export
export function configurePersistence({
  config,
} : {
  config: Partial<PersistenceConfig>
}) : PersistenceConfig {
  const configuration = config
  configuration.models = config.models || {}
  configuration.adapters = config.adapters || {}
  configuration.scalars = config.scalars || {}
  configuration.log = config.log || {}
  configuration.strict = !!config.strict
  configuration.prefix = config.prefix || ''

  return configuration as PersistenceConfig
}
