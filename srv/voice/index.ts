import {
  TextToSpeechAdapterResponse,
  TextToSpeechHandler,
  TextToSpeechRequest,
  VoiceListResponse,
  VoicesListRequest,
} from './types'
import { AppLog } from '../logger'
import { store } from '../db'
import { v4 } from 'uuid'
import axios from 'axios'
import { saveFile } from '../api/upload'
import { sendGuest, sendMany } from '../api/ws'
import { StatusError } from '../api/wrap'
import { elevenlabsHandler } from './elevenlabs'
import { novelTtsHandler } from './novel'
import { webSpeechSynthesisHandler } from './webspeechsynthesis'
import { TTSService, VoiceSettings } from '../../common/types/texttospeech-schema'
import { AppSchema } from '../../common/types/schema'
import { addConnects, getVoiceGenerators, removeConnects } from '../db/voiceGenerator'
import { getChat } from '../db/chats'
import { getCharacter } from '../db/characters'
import { addVoiceMessages, getCountVoiceMessages } from '../db/voiceMessages'
import { getMysqlQueryResult } from '../db/client'

export async function getVoicesList(
  { user, ttsService }: VoicesListRequest,
  log: AppLog,
  guestId?: string
): Promise<VoiceListResponse> {
  const service = getVoiceService(ttsService)
  if (!service) return { voices: [] }

  try {
    return { voices: await service.getVoices(user, guestId) }
  } catch (ex: any) {
    throw new StatusError(ex.message, 500)
  }
}

export async function generateTextToSpeech(
  user: AppSchema.User,
  log: AppLog,
  guestId: string | undefined,
  text: string,
  voice: VoiceSettings
) {
  const service = getVoiceService(voice.service)
  if (!service) return { output: undefined }

  let audio: TextToSpeechAdapterResponse | undefined
  let output: string = ''
  const processedText = processText(text, user.texttospeech?.filterActions ?? true)

  try {
    audio = await service.generateVoice({ user, text: processedText, voice }, log, guestId)
  } catch (ex: any) {
    log.error({ err: ex }, 'Failed to generate audio')
    throw new StatusError(`Could not generate audio: ${ex.message || ex}`, 400)
  }

  if (!audio) {
    return { output }
  }

  try {
    output = await saveFile(`temp-${v4()}.${audio.ext}`, audio.content, 300)
  } catch (ex: any) {
    log.error({ err: ex }, 'Failed to generate audio')
    throw new StatusError(`Could not generate audio: ${ex.message || ex}`, 500)
  }

  return { output }
}

export async function generateVoice(
  { user, chatId, messageId, voice, culture, ...opts }: TextToSpeechRequest,
  log: AppLog,
  guestId?: string
) {
  const broadcastIds: string[] = []

  if (!guestId) {
    broadcastIds.push(user._id)
    const members = await store.chats.getActiveMembers(chatId)
    broadcastIds.push(...members, user._id)
  }
  let error: any
  
  
  
  let audio: TextToSpeechAdapterResponse | undefined
  let output: string = ''
  const text = processText(opts.text, user.texttospeech?.filterActions ?? true)
  log.debug({ text, service: voice.service }, 'Text to speech')

  const generatingMessage = { chatId, messageId, type: 'voice-generating' }
  if (broadcastIds.length) {
    sendMany(broadcastIds, generatingMessage)
  } else if (guestId) {
    sendGuest(guestId, generatingMessage)
  }
  
  const chatData = await getChat(chatId)
  let character = null

  if (chatData?.chat.characterId) {
    character = await getCharacter("", chatData?.chat.characterId)
    console.log(chatData?.chat.userId, character?.characterId)
    let query = `SELECT * FROM AI WHERE ID=${character?.characterId}`;
    const AI: any = await getMysqlQueryResult(query);
    if (AI[0].payment_enabled == 'yes') { 
      let query = `SELECT SUM(text_tokens) as text_credit, SUM(voice_tokens) as voice_credit FROM credits where userId=${chatData?.chat.userId} and characterId=${character?.characterId};`;
      const credit: any = await getMysqlQueryResult(query);
      const voiceCredit = credit[0].voice_credit;
      const voiceMessageCount = await getCountVoiceMessages(chatData.chat._id);
      if (voiceMessageCount >= voiceCredit) { 
        error = `Your voice credit is not enough`
        send(broadcastIds, guestId, {
          type: 'voice-failed',
          chatId,
          messageId,
          error,
        })
        return { output: undefined }
      }
    }
  } else {
    error = `Something is wrong`
    send(broadcastIds, guestId, {
      type: 'voice-failed',
      chatId,
      messageId,
      error,
    })
    return { output: undefined }
  }
  const service = getVoiceService(voice.service)
  if (!service) return { output: undefined }
  
  const voiceGenerator = await getVoiceGenerators();
  if (!voiceGenerator) {
    error = `Too many voice generating connects`
    send(broadcastIds, guestId, {
      type: 'voice-failed',
      chatId,
      messageId,
      error,
    })
    return { output: undefined }
  }
  
  let voiceSample: string;

  if (character) {
    voiceSample = character.voiceSample ? character.voiceSample : "my.mp3"
  } else {
    voiceSample = "my.mp3"
  }

  let audioBuffer: any;
  try {
    await addConnects(voiceGenerator._id);
    const ret: any = await axios.post(`${voiceGenerator.host}/voice-generate`, { text, speaker: voiceSample ? voiceSample : "my.mp3" });
    audioBuffer = Buffer.from(ret.data.content, 'latin1');
  } catch (e) {
    console.log(e)
  } finally {
    await removeConnects(voiceGenerator._id);
  }

  audio = {
    content: audioBuffer,
    ext: "wav"
  }

  if (!audio) {
    error = `Failed to generate audio: ${
      error || 'Invalid text to speech settings (No handler found)'
    }`
    send(broadcastIds, guestId, {
      type: 'voice-failed',
      chatId,
      messageId,
      error,
    })
    return { output: undefined }
  }
  
  try {
    output = await saveFile(`temp-${v4()}.${audio.ext}`, audio.content, 300)
  } catch (ex: any) {
    send(broadcastIds, guestId, {
      type: 'voice-failed',
      chatId,
      messageId,
      error: `Failed to save generated audio file: ${ex.message}`,
    })
    return { output: undefined }
  }

  send(broadcastIds, guestId, { type: 'voice-generated', chatId, messageId, url: output })
  await addVoiceMessages(chatId, text)
  return { output }
}

export function getVoiceService(ttsService?: TTSService): TextToSpeechHandler | undefined {
  switch (ttsService) {
    case 'webspeechsynthesis':
      return webSpeechSynthesisHandler

    case 'elevenlabs':
      return elevenlabsHandler

    case 'novel':
      return novelTtsHandler

    default:
      return
  }
}

function send(broadcastIds: string[], guestId: string | undefined, message: any) {
  if (broadcastIds.length) {
    sendMany(broadcastIds, message)
  } else if (guestId) {
    sendGuest(guestId, message)
  }
}

const filterActionsRegex = /\*[^*]*\*|\([^)]*\)/g
function processText(text: string, filterActions: boolean) {
  if (!text) return ''
  text = text.trim()
  if (filterActions) {
    text = text.replace(filterActionsRegex, '')
  }
  text = text.replace(/[~]/g, ' ')
  return text
}
