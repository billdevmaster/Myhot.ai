import * as chats from './chats'
import * as characters from './characters'
import * as users from './user'
import * as admin from './admin'
import * as presets from './presets'
import * as msgs from './messages'
import * as memory from './memory'
import * as oauth from './oauth'
import * as tree from './tree'
import * as subs from './subscriptions'

export { db } from './client'

export const store = {
  chats,
  characters,
  users,
  admin,
  presets,
  msgs,
  memory,
  oauth,
  tree,
  subs,
}
