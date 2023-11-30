import { store } from '../../db'
import { getAppConfig } from '../settings'
import { handle } from '../wrap'
import { getRegisteredAdapters } from '/srv/adapter/register'
import { config } from '/srv/config'
import { getLanguageModels } from '/srv/adapter/replicate'

export const getInitialLoad = handle(async ({ userId }) => {
  const replicate = await getLanguageModels()
  if (config.ui.maintenance) {
    const appConfig = await getAppConfig()
    return { config: appConfig, replicate }
  }

  const [profile, user, presets, books, scenarios] = await Promise.all([
    store.users.getMysqlProfile(userId!),
    getSafeUserConfig(userId!),
    store.presets.getUserPresets(userId!),
    store.memory.getBooks(userId!),
    [],
  ])

  const appConfig = await getAppConfig(user)

  return { profile, user, presets, config: appConfig, books, scenarios, replicate }
})

export async function getSafeUserConfig(userId: string) {
  const user = await store.users.getMysqluser(userId!)
  if (!user) return

  if (user.novelApiKey) {
    user.novelApiKey = ''
  }

  user.hordeKey = ''

  if (user.oaiKey) {
    user.oaiKeySet = true
    user.oaiKey = ''
  }

  if (user.scaleApiKey) {
    user.scaleApiKeySet = true
    user.scaleApiKey = ''
  }

  if (user.claudeApiKey) {
    user.claudeApiKey = ''
    user.claudeApiKeySet = true
  }

  if (user.thirdPartyPassword) {
    user.thirdPartyPassword = ''
    user.thirdPartyPasswordSet = true
  }

  if (user.elevenLabsApiKey) {
    user.elevenLabsApiKey = ''
    user.elevenLabsApiKeySet = true
  }

  for (const svc of getRegisteredAdapters()) {
    if (!user.adapterConfig) break
    if (!user.adapterConfig[svc.name]) continue

    const secrets = svc.settings.filter((opt) => opt.secret)

    for (const secret of secrets) {
      if (user.adapterConfig[svc.name]![secret.field]) {
        user.adapterConfig[svc.name]![secret.field] = ''
        user.adapterConfig[svc.name]![secret.field + 'Set'] = true
      }
    }
  }

  return user
}
