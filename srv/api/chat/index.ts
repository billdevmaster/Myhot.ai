import { Router } from 'express'
import { loggedIn } from '../auth'
import {
  restartChat,
} from './edit'
import { getAllChats, getChatDetail, getChat } from './get'
import { generateMessageV2, countVoiceMessages, getMessages, countCredits } from './message'
import { textToSpeech } from './texttospeech'

const router = Router()

router.post('/:id/generate', generateMessageV2)
router.post('/:id/voice', textToSpeech)
router.post('/getChat', getChat)
router.get('/:id/count-voice-messages', countVoiceMessages)
router.get('/count-credits', countCredits)
router.use(loggedIn)
router.get('/:id', getChatDetail)
router.get('/:id/messages', getMessages)
router.get('/', getAllChats)
router.post('/:id/restart', restartChat)

export default router
