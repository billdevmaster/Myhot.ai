import { db } from './client'
import { AppSchema } from '/common/types';
const uuid_1 = require("uuid");

export async function getCountVoiceMessages(chatId: string) {
  const generators = await db('voice-messages').find({ chatId }).toArray()
  return generators.length
}

export async function addVoiceMessages(chatId: string, text: string) {
  const insert: AppSchema.VoiceMessages = {
    _id: (0, uuid_1.v4)(),
    kind: 'voice-messages',
    chatId,
    text
  };
  await db('voice-messages').insertOne(insert)
}


