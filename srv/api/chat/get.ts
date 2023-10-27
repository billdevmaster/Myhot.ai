import { Document } from 'mongodb'
import { store } from '../../db'
import { getMysqlQueryResult } from '/srv/db/client'
import { errors, handle } from '../wrap'
import { unserialize } from 'php-serialize'
import { createFEAccessToken } from '/srv/db/user'
import axios from 'axios'
import fs from 'fs/promises'
import { config } from '/srv/config'

export const getCharacterChats = handle(async (req) => {
  const character = await store.characters.getCharacter(req.userId!, req.params.id)
  if (!character) {
    throw errors.NotFound
  }

  const list = await store.chats.listByCharacter(req.userId, req.params.id)
  return { character, chats: list }
})

export const getChatDetail = handle(async ({ userId, params }) => {
  const id = params.id
  const detail = await store.chats.getChat(id)

  if (!detail) throw errors.NotFound

  // const canView = await store.chats.canViewChat(userId, detail.chat)
  // console.log("okay", canView)
  // if (!canView) {
  //   throw errors.Forbidden
  // }

  const [members, active] = await Promise.all([
    store.users.getMysqlProfiles(detail.chat.userId, detail.chat.memberIds),
    store.chats.getActiveMembers(detail.chat._id),
  ])
  const character = detail.characters.find((ch) => ch._id === detail.chat.characterId)

  const messages = await store.msgs.getChatMessages(detail.chat)
  // await store.chats.createChatTree(detail.chat)

  return { messages, character, members, active, ...detail }
})

export const getAllChats = handle(async (req) => {
  const chats = await store.chats.getAllChats(req.userId!)
  const charIds = getCharacterIds(chats)
  const characters = await store.characters.getCharacterList(Array.from(charIds), req.userId!)
  return { chats, characters }
})

function getCharacterIds(chats: Document[]) {
  const charIds = new Set<string>()

  for (const chat of chats) {
    charIds.add(chat.characterId)

    for (const [id, enabled] of Object.entries(chat.characters || {})) {
      if (enabled) charIds.add(id)
    }
  }

  return Array.from(charIds)
}

export const getChat = handle(async (req) => {
  const userId = req.body.userId
  const charId = req.body.charId
  const user: any = await getMysqlQueryResult(`SELECT * from users where ID=${userId}`)
  const character: any = await getMysqlQueryResult(`SELECT * from AI where ID=${charId}`)
  if (!user || !character) {
    return {success: false}
  }
  const moodsencoded = Buffer.from(character[0].moods, 'base64')
  const moods = unserialize(moodsencoded.toString())
  // copy character to my db

  // uploading mp3 file and get voice id from elevenlab
  const testAudioUrl = "https://od.lk/d/NTRfMjUxNDgwNjVf/voice_preview_Valentino.mp3"

  const characterInfo: any = {
    characterId: character[0].ID,
    name: character[0].fullName,
    persona: {kind: "attributes", attributes: {personality: moods}},
    sampleChat: "",
    description: character[0].Description,
    appearance: undefined,
    culture: undefined,
    scenario: character[0].summaryForUser,
    greeting: "",
    visualType: undefined,
    // sprite: "",
    avatar: character[0].image,
    favorite: false,
    voice: {
      service : "elevenlabs",
      voiceId : "21m00Tcm4TlvDq8ikWAM",
      model : "eleven_monolingual_v1",
      stability : 0.75,
      similarityBoost : 0.75
    },
    tags: undefined,
    alternateGreetings: undefined,
    characterBook: undefined,
    systemPrompt: undefined,
    postHistoryInstructions: undefined,
    creator: undefined,
    characterVersion: undefined,
    insert: undefined,
  }
  const oldchar = await store.characters.getCharacterByCharId(character[0].ID)
  let char: any = null
  if (!oldchar) {
    // upload voice file to elevenlab
    if (character[0].voice_sample) {
      const response = await axios.get(testAudioUrl, { responseType: 'blob' });
      const audioBuffer: any = response.data;
      var file = new Blob([audioBuffer], { type: 'audio/mp3' });
      // Create a FormData object and append the audio file
      // const files = [];
      // files.push(file)
      const formData = new FormData();
      formData.append('name', 'sample')
      formData.append('files[]', file);
      const ret: any = await axios.post('https://api.elevenlabs.io/v1/voices/add', formData, {
        headers: {
          'Xi-Api-Key': config.elevenKey,
          'Content-Type': 'multipart/form-data'
        },
      })
  
      characterInfo.voice.voiceId = ret.data.voice_id
      characterInfo.voiceSample = character[0].voice_sample
    }
    char = await store.characters.createCharacter("all", characterInfo)
  } else {
    if (!oldchar.voiceSample || oldchar.voiceSample != character[0].voice_sample) {
      const response = await axios.get(testAudioUrl, { responseType: 'blob' });
      const audioBuffer: any = response.data;
      var file = new Blob([audioBuffer], { type: 'audio/mp3' });
      // Create a FormData object and append the audio file
      // const files = [];
      // files.push(file)
      const formData = new FormData();
      formData.append('name', 'sample')
      formData.append('files[]', file);
      const ret: any = await axios.post('https://api.elevenlabs.io/v1/voices/add', formData, {
        headers: {
          'Xi-Api-Key': config.elevenKey,
          'Content-Type': 'multipart/form-data'
        },
      })
  
      characterInfo.voice.voiceId = ret.data.voice_id
      characterInfo.voiceSample = character[0].voice_sample
    }
    // create or get chat with userId and character ID
    char = await store.characters.updateCharacter(oldchar._id, "all", characterInfo)
  }
  const chatInfo: any = {
    characterId: char._id,
    name: 'Chat',
    genPreset: 'd4d0b94e-a794-4589-98d5-4502a8d1e309',
  }
  const oldchat = await store.chats.getChatByUserAndChar(userId, char._id)
  let chat: any = null
  if (!oldchat) {
    chat = await store.chats.create(char._id, {
      ...chatInfo,
      userId: userId,
    })
  } else {
    chat = await store.chats.update(oldchat._id, {
      ...chatInfo,
      userId: userId,
    })
  }
  const token = await createFEAccessToken(`${user.Fname} ${user.Lname}`, userId)
  return { success: true, token, chat }
})
