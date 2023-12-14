import { UnwrapBody, assertValid } from '/common/valid'
import { store } from '../../db'
import { createTextStreamV2, inferenceAsync } from '../../adapter/generate'
import { AppRequest, StatusError, errors, handle } from '../wrap'
import { sendGuest, sendMany, sendOne } from '../ws'
import { obtainLock, releaseLock } from './lock'
import { AppSchema } from '../../../common/types/schema'
import { v4 } from 'uuid'
import { Response } from 'express'
import { publishMany } from '../ws/handle'
import { runGuidance } from '/common/guidance/guidance-parser'
import { cyoaTemplate } from '/common/mode-templates'
import { fillPromptWithLines } from '/common/prompt'
import { getTokenCounter } from '/srv/tokenize'
import { getCountVoiceMessages } from '/srv/db/voiceMessages'
import { getMysqlQueryResult, isWhiteListed } from '/srv/db/client'
import { addTextMessages, getCountTextMessages } from '/srv/db/textMessages'

type GenRequest = UnwrapBody<typeof genValidator>

const genValidator = {
  parent: 'string?',
  kind: [
    'send',
    'send-event:world',
    'send-event:character',
    'send-event:hidden',
    'ooc',
    'retry',
    'continue',
    'self',
    'summary',
    'request',
  ],
  char: 'any',
  sender: 'any',
  members: ['any'],
  user: 'any',
  chat: 'any',
  replacing: 'any?',
  replyAs: 'any?',
  continuing: 'any?',
  characters: 'any?',
  impersonate: 'any?',
  parts: {
    scenario: 'string?',
    persona: 'string',
    greeting: 'string?',
    memory: 'any?',
    sampleChat: ['string?'],
    post: ['string'],
    allPersonas: 'any?',
    chatEmbeds: 'any?',
    userEmbeds: 'any?',
  },
  lines: ['string'],
  text: 'string?',
  settings: 'any?',
  lastMessage: 'string?',
  chatEmbeds: 'any?',
  userEmbeds: 'any?',
} as const

export const getMessages = handle(async ({ userId, params, query }) => {
  const chatId = params.id

  assertValid({ before: 'string' }, query)
  const before = query.before

  const messages = await store.msgs.getMessages(chatId, before)
  return { messages }
})

export const countVoiceMessages = handle(async (req) => {
  const chatId = req.params.id
  const count = await getCountVoiceMessages(chatId);
  return {count}
})


export const generateMessageV2 = handle(async (req, res) => {
  const { body, params, log } = req
  let userId: any = req.userId
  const requestId = v4()
  const chatId = params.id
  assertValid(genValidator, body)
  if (!userId) {
    throw errors.NotFound
  }
  const chat = await store.chats.getChatOnly(chatId)
  const is_white_listed = await isWhiteListed(userId)
  if (is_white_listed) {
    userId = chat?.userId
  }
  const impersonate: AppSchema.Character | undefined = body.impersonate
  const user = await store.users.getMysqluser(userId)
  if (!user.loginStatus) {
    throw errors.LoginError
  }
  body.user = user
  console.log(body.user)
  if (!chat) throw errors.NotFound
  if (body.kind === 'request' && chat.userId !== userId) {
    throw errors.Forbidden
  }
  
  // Coalesce for backwards compatibly while new UI rolls out
  const replyAs = body.replyAs._id.startsWith('temp-')
    ? body.replyAs
    : await store.characters.getCharacter(chat.userId, body.replyAs._id || body.char._id)
  const members = chat.memberIds.concat(chat.userId)
  // check the credits.
  let query = `SELECT * FROM AI WHERE ID=${replyAs.characterId}`;
  const AI: any = await getMysqlQueryResult(query);
  if (AI[0].payment_enabled == 'yes') {
    let query = `SELECT SUM(text_tokens) as text_credit, SUM(voice_tokens) as voice_credit FROM credits where userId=${chat.userId} and characterId=${replyAs.characterId};`;
    const credit: any = await getMysqlQueryResult(query);
    const textCredit = credit[0].text_credit;
    const textMessageCount = await getCountTextMessages(chat._id);
    if (textMessageCount >= textCredit) {
      sendMany(members, {
        type: 'message-error',
        requestId,
        error: `Your credit is not enough`,
        chatId,
      })
      await releaseLock(chatId)
      return
    }
  }

  if (chat.userId !== userId) {
    const isAllowed = await store.chats.canViewChat(userId, chat)
    if (!isAllowed) throw errors.Forbidden
  }
  

  if (body.kind === 'retry' && userId !== chat.userId) {
    throw errors.Forbidden
  }
  
  if (body.kind === 'continue' && userId !== chat.userId) {
    throw errors.Forbidden
  }

  // For authenticated users we will verify parts of the payload
  let userMsg: AppSchema.ChatMessage | undefined
  if (body.kind === 'send' || body.kind === 'ooc') {
    await ensureBotMembership(chat, members, impersonate)
    console.log("body.text", body.text!)
    userMsg = await store.msgs.createChatMessage({
      chatId,
      message: body.text!,
      characterId: impersonate?._id,
      senderId: userId,
      ooc: body.kind === 'ooc',
      event: undefined,
    })

    if (body.parent) {
      await store.tree.assignMessageParent({
        chatId: chat._id,
        parentId: body.parent,
        messageId: userMsg._id,
      })
    }

    sendOne(userId, { type: 'message-created', msg: userMsg, chatId })
  } else if (body.kind.startsWith('send-event:')) {
    userMsg = await store.msgs.createChatMessage({
      chatId,
      message: body.text!,
      characterId: replyAs?._id,
      senderId: undefined,
      ooc: false,
      event: body.kind.split(':')[1] as AppSchema.EventTypes,
    })
    sendOne(userId, { type: 'message-created', msg: userMsg, chatId })
  }

  if (body.kind === 'ooc' || !replyAs) {
    return { success: true }
  }
  /**
   * For group chats we won't worry about lock integrity.
   * We still need to create the user message and broadcast it,
   * but if there is a lock in place do not attempt to generate a message.
   */
  try {
    await obtainLock(chatId)
  } catch (ex) {
    if (members.length === 1) throw ex
    return res.json({
      requestId,
      success: true,
      generating: false,
      message: 'User message created',
    })
  }

  sendMany(members, {
    type: 'message-creating',
    chatId,
    mode: body.kind,
    senderId: userId,
    characterId: replyAs._id,
  })
  res.json({ requestId, success: true, generating: true, message: 'Generating message' })
  const { stream, adapter, ...entities } = await createTextStreamV2(
    { ...body, chat, replyAs, impersonate, requestId },
    log
  )

  log.setBindings({ adapter })

  let generated = ''
  let error = false
  let meta = { ctx: entities.settings.maxContextLength, char: entities.size }

  const messageId =
    body.kind === 'retry'
      ? body.replacing?._id ?? requestId
      : body.kind === 'continue'
      ? body.continuing?._id
      : requestId

  try {
    for await (const gen of stream) {
      if (typeof gen === 'string') {
        generated = gen
        continue
      }

      if ('partial' in gen) {
        const prefix = body.kind === 'continue' ? `${body.continuing.msg} ` : ''
        sendMany(members, {
          type: 'message-partial',
          partial: `${prefix}${gen.partial}`,
          adapter,
          chatId,
        })
        continue
      }

      if ('meta' in gen) {
        Object.assign(meta, gen.meta)
        continue
      }

      if ('prompt' in gen) {
        sendOne(userId, { type: 'service-prompt', id: messageId, prompt: gen.prompt })
        continue
      }

      if ('error' in gen) {
        error = true
        sendMany(members, { type: 'message-error', requestId, error: gen.error, adapter, chatId })
        continue
      }

      if ('warning' in gen) {
        sendOne(userId, { type: 'message-warning', requestId, warning: gen.warning })
      }
    }
  } catch (ex: any) {
    error = true

    if (ex instanceof StatusError) {
      log.warn({ err: ex }, `[${ex.status}] Stream handler exception`)
      sendMany(members, {
        type: 'message-error',
        requestId,
        error: `[${ex.status}] Message failed: ${ex?.message || ex}`,
        adapter,
        chatId,
      })
    } else {
      log.error({ err: ex }, 'Unhandled exception occurred during stream handler')
      sendMany(members, {
        type: 'message-error',
        requestId,
        error: `Unhandled exception: ${ex?.message || ex}`,
        adapter,
        chatId,
      })
    }
  }

  if (error) {
    await releaseLock(chatId)
    return
  }

  const responseText = body.kind === 'continue' ? `${body.continuing.msg} ${generated}` : generated

  const actions: AppSchema.ChatAction[] = []

  if (chat.mode === 'adventure') {
    const lines = fillPromptWithLines(
      getTokenCounter('main'),
      1024,
      '',
      body.lines.concat(`${body.replyAs.name}: ${responseText}`)
    )

    const prompt = cyoaTemplate(
      body.settings.service,
      body.settings.service === 'openai' ? body.settings.oaiModel : ''
    )

    const infer = async (text: string) => {
      const res = await inferenceAsync({
        prompt: text,
        log,
        service: entities.settings.service!,
        user: entities.user,
      })
      return res.generated
    }

    const { values } = await runGuidance(prompt, {
      infer,
      placeholders: {
        history: lines.join('\n'),
        user: body.impersonate?.name || body.sender.handle,
      },
    })
    actions.push({ emote: values.emote1, action: values.action1 })
    actions.push({ emote: values.emote2, action: values.action2 })
    actions.push({ emote: values.emote3, action: values.action3 })
  }

  await releaseLock(chatId)

  switch (body.kind) {
    case 'summary': {
      sendOne(userId, { type: 'chat-summary', chatId, summary: generated })
      break
    }

    case 'self':
    case 'request':
    case 'send-event:world':
    case 'send-event:character':
    case 'send-event:hidden':
    case 'send': {
      const msg = await store.msgs.createChatMessage({
        _id: requestId,
        chatId,
        characterId: replyAs._id,
        senderId: body.kind === 'self' ? userId : undefined,
        message: responseText,
        adapter,
        ooc: false,
        actions,
        meta,
        event: undefined,
      })

      if (body.parent && userMsg) {
        await store.tree.assignMessageParent({
          chatId: chat._id,
          parentId: userMsg._id,
          messageId: msg._id,
        })
      }

      await addTextMessages(chatId, msg.msg);

      sendOne(userId, {
        type: 'message-created',
        requestId,
        msg,
        chatId,
        adapter,
        generate: true,
        actions,
      })
      break
    }

    case 'retry': {
      if (body.replacing) {
        await store.msgs.editMessage(body.replacing._id, {
          msg: responseText,
          actions,
          adapter,
          meta,
          state: 'retried',
        })
        sendOne(userId, {
          type: 'message-retry',
          requestId,
          chatId,
          messageId: body.replacing._id,
          message: responseText,
          actions,
          adapter,
          generate: true,
          meta,
        })
      } else {
        const msg = await store.msgs.createChatMessage({
          _id: requestId,
          chatId,
          characterId: replyAs._id,
          message: responseText,
          adapter,
          actions,
          ooc: false,
          meta,
          event: undefined,
        })
        sendOne(userId, {
          type: 'message-created',
          requestId,
          msg,
          chatId,
          adapter,
          generate: true,
          actions,
        })
      }
      break
    }

    case 'continue': {
      await store.msgs.editMessage(body.continuing._id, {
        msg: responseText,
        adapter,
        meta,
        state: 'continued',
      })
      sendMany(members, {
        type: 'message-retry',
        requestId,
        chatId,
        messageId: body.continuing._id,
        message: responseText,
        adapter,
        generate: true,
        meta,
      })
      break
    }
  }

  await store.chats.update(chatId, {})
})

function newMessage(
  messageId: string,
  chatId: string,
  text: string,
  props: {
    userId?: string
    characterId?: string
    ooc: boolean
    meta?: any
    event: undefined | AppSchema.EventTypes
  }
) {
  const userMsg: AppSchema.ChatMessage = {
    _id: messageId,
    chatId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    kind: 'chat-message',
    msg: text,
    ...props,
  }
  return userMsg
}

async function ensureBotMembership(
  chat: AppSchema.Chat,
  members: string[],
  impersonate: AppSchema.Character | undefined
) {
  const update: Partial<AppSchema.Chat> = {}

  // Ignore ownership of temporary characters
  const characters = chat.characters || {}
  if (
    impersonate &&
    characters[impersonate._id] === undefined &&
    !impersonate._id.startsWith('temp-')
  ) {
    const actual = await store.characters.getCharacter(impersonate.userId, impersonate._id)
    if (!actual) {
      throw new StatusError(
        'Could not create message: Impersonation character does not belong to you',
        403
      )
    }

    // Ensure the caller's character is up to date
    Object.assign(impersonate, actual)
    characters[impersonate._id] = false
    publishMany(members, {
      type: 'chat-character-added',
      chatId: chat._id,
      character: actual,
      active: false,
    })
  }

  update.characters = characters
  await store.chats.update(chat._id, update)
}

