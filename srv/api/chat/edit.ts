import { store } from '../../db'
import { handle } from '../wrap'

export const restartChat = handle(async (req) => {
  const chatId = req.params.id
  await store.chats.restartChat(req.userId, chatId)
  return { success: true }
})
