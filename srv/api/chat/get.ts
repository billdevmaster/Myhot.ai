import { Document } from 'mongodb'
import { store } from '../../db'
import { getMysqlQueryResult } from '/srv/db/client'
import { errors, handle } from '../wrap'
import { unserialize } from 'php-serialize'
import { createFEAccessToken } from '/srv/db/user'
import axios from 'axios'
import { config } from '/srv/config'

export const getChatDetail = handle(async ({ headers, userId, params }) => {
  const clientIP = headers['x-real-ip'];
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
    // check the client ipaddress
    if (clientIP) {
      const user: any = await getMysqlQueryResult(`SELECT * from users where ID=${userId}`)
      if (!user[0].login_status) {
        throw errors.Forbidden
      }
      let query = `SELECT * FROM chat_session where user_id=${userId} and ai_id=${character?.characterId} order by timestamp desc limit 1`;
      const chatSession: any = await getMysqlQueryResult(query);
      if (chatSession.length == 0 || chatSession[0].ip != clientIP) {
        throw errors.Forbidden
      }
    }
    
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
  const clientIP = req.headers['x-real-ip'];
  const userId = req.body.userId
  const charId = req.body.charId
  const user: any = await getMysqlQueryResult(`SELECT * from users where ID=${userId}`)
  const character: any = await getMysqlQueryResult(`SELECT * from AI where ID=${charId}`)
  let chatSession: any = [];
  if (!user || !character) {
    return {success: false, msg: "User or Model is not correct"}
  }

  // check the client ipaddress
  if (clientIP) {
    if (!user[0].login_status) {
      return {success: false, msg: "You are logout"}
    }
    let query = `SELECT * FROM chat_session where user_id=${userId} and ai_id=${charId} order by timestamp desc limit 1`;
    chatSession = await getMysqlQueryResult(query);
    if (chatSession.length == 0 || chatSession[0].ip != clientIP) {
      return {success: false, msg: "Your Ipaddress is wrong"}
    }
  }

  let moods = "";
  if (character[0].moods.length > 0) {
    const moodsencoded = Buffer.from(character[0].moods, 'base64')
    moods = unserialize(moodsencoded.toString())
  }
  // copy character to my db

  // uploading mp3 file and get voice id from elevenlab
  // const testAudioUrl = "https://od.lk/d/NTRfMjUxNDgwNjVf/voice_preview_Valentino.mp3"
  const testAudioUrl = "https://myhot.ai/uploads/audio/" + character[0].voice_sample

  const characterInfo: any = {
    characterId: character[0].ID,
    name: character[0].fullName,
    persona: {kind: "attributes", attributes: {"personality": moods, "carrer": [character[0].Description]}},
    sampleChat: "",
    description: "",
    appearance: undefined,
    culture: undefined,
    scenario: character[0].Description ? character[0].Description : "",
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
      similarityBoost: 0.75,
      rate: character[0].rate ? character[0].rate : 1
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

  const oldchar: any = await store.characters.getCharacterByCharId(character[0].ID)
  let char: any = null
  if (!oldchar) {
    // upload voice file to elevenlab
    if (character[0].voice_sample) {
      const response: any = await axios.get(testAudioUrl, { responseType: 'arraybuffer' });
      const audioBuffer: any = response.data;
      var file = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const formData = new FormData();
      const fileName = character[0].voice_sample.split(".")[0];
      formData.append('file', file, fileName + ".mp3");
      try {
        const ret: any = await axios.post(`${config.uploadSampleUrl}upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
        })
        characterInfo.voice.voiceId = ret.data.voice_id
        characterInfo.voiceSample = fileName + ".mp3"
      } catch(e) {
        console.log(e)
      }
    }
    char = await store.characters.createCharacter("all", characterInfo)
  } else {
    if (character[0].voice_sample) {
      const fileName = character[0].voice_sample.split(".")[0];
      if (oldchar.voiceSample != fileName + ".mp3") {
        const response: any = await axios.get(testAudioUrl, { responseType: 'arraybuffer' });
        const audioBuffer: any = response.data;
        var file = new Blob([audioBuffer], { type: 'audio/mpeg' });
        const formData = new FormData();
        formData.append('file', file, fileName + ".mp3");
        try {
          const ret: any = await axios.post(`${config.uploadSampleUrl}upload`, formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            },
          })
      
          characterInfo.voice.voiceId = ret.data.voice_id
          characterInfo.voiceSample = fileName + ".mp3"
        } catch (e) {
          console.log(e)          
        }

      } else {
        characterInfo.voice.voiceId = oldchar.voice.voiceId
        characterInfo.voiceSample = oldchar.voiceSample
      }
    }
    // create or get chat with userId and character ID
    char = await store.characters.updateCharacter(oldchar._id, "all", characterInfo)
  }
  const chatInfo: any = {
    characterId: char._id,
    name: 'Chat',
    genPreset: 'a7aceeec-5e55-4135-90ce-549aebcf3657',
    elevenKey: user[0].elevenKey ? user[0].elevenKey : null
  }
  const oldchat: any = await store.chats.getChatByUserAndChar(userId, char._id)
  let chat: any = null
  if (oldchat) {
    chat = await store.chats.update(oldchat._id, {
      ...chatInfo,
      userId: userId,
    })
  } else {
    chat = await store.chats.create(char._id, {
      ...chatInfo,
      userId: userId,
    })
  }
  if (chatSession.length > 0) {
    const query = `Update chat_session set chat_url='https://thisservice.net/chat/${chat._id}' where id=${chatSession[0].id}`
    await getMysqlQueryResult(query)
  }

  const token = await createFEAccessToken(`${user[0].Fname} ${user[0].Lname}`, userId)
  return { success: true, token, chat }
})
