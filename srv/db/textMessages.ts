import { db } from './client'
import { AppSchema } from '/common/types';
const uuid_1 = require("uuid");

export async function getCountTextMessages(chatId: string) {
  const generators = await db('text-messages').find({ chatId }).toArray()
  return generators.length
}

export async function addTextMessages(chatId: string, text: string) {
  const insert: AppSchema.TextMessages = {
    _id: (0, uuid_1.v4)(),
    kind: 'text-messages',
    chatId,
    text
  };
  await db('text-messages').insertOne(insert)
}


