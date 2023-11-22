import { db } from './client'

export async function getVoiceGenerators() {
  const generators = await db('voice-generator').find({ connects: { $lte: 3 } }).sort({connects: 1}).toArray()
  return generators[0]
}

export async function addConnects(id: string) {
  await db('voice-generator').updateOne(
    { _id: id },
    { $inc: { connects: 1 } }
  )
}

export async function removeConnects(id: string) {
  await db('voice-generator').updateOne(
    { _id: id },
    { $inc: { connects: -1 } }
  )
}

