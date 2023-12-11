import './chat-detail.css'
import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { VenetianMask, AlertTriangle } from 'lucide-solid'
import ChatExport from './ChatExport'
import Button from '../../shared/Button'
import { CharacterPill } from '../../shared/CharacterPill'
import { getMaxChatWidth, setComponentPageTitle } from '../../shared/util'
import { characterStore, chatStore, settingStore, userStore } from '../../store'
import { msgStore } from '../../store'
import InputBar from './components/InputBar'
import Message from './components/Message'
import PromptModal from './components/PromptModal'
import DeleteMsgModal from './DeleteMsgModal'
import { devCycleAvatarSettings, isDevCommand } from './dev-util'
import ForcePresetModal from './ForcePreset'
import DeleteChatModal from './components/DeleteChat'
import { cycleArray } from '/common/util'
import { useEffect, usePane, useResizeObserver } from '/web/shared/hooks'
import {
  emptyMsg,
  getChatWidth,
  InfiniteScroll,
  insertImageMessages,
  SwipeMessage,
} from './helpers'
import { useAutoExpression } from '/web/shared/Avatar/hooks'
import AvatarContainer from '/web/shared/Avatar/Container'
import { eventStore } from '/web/store/event'
import Slot from '/web/shared/Slot'
import { useAppContext } from '/web/store/context'
import AvatarIcon from '/web/shared/AvatarIcon'
import LogoIcon from '/web/icons/LogoIcon'
import { ConfirmModal } from '/web/shared/Modal'
import { TitleCard } from '/web/shared/Card'

const ChatDetail: Component = () => {
  const { updateTitle } = setComponentPageTitle('Chat')

  let container: HTMLDivElement
  let slotContainer: HTMLDivElement

  const params = useParams()
  const nav = useNavigate()
  const user = userStore()
  const chars = characterStore((s) => ({
    chatBots: s.characters.list,
    botMap: s.characters.map,
    impersonate: s.impersonating,
    ready: s.characters.loaded > 0,
  }))
  
  const isPaneOrPopup = usePane()
  const slots = useResizeObserver()

  const [ctx] = useAppContext()

  const chats = chatStore((s) => ({
    ...(s.active?.chat._id === params.id ? s.active : undefined),
    lastId: s.lastChatId,
    members: s.chatProfiles,
    loaded: s.loaded,
    opts: s.opts,
  }))

  const msgs = msgStore((s) => ({
    msgs: s.msgs,
    images: s.images,
    partial: s.partial,
    waiting: s.waiting,
    retries: s.retries,
    speaking: s.speaking,
    retrying: s.retrying,
    inference: s.lastInference,
  }))

  const isGroupChat = createMemo(() => {
    if (!chats.participantIds?.length) return false
    return true
  })

  const express = useAutoExpression()

  const viewHeight = createMemo(() => {
    const mode = chats.char?.visualType === 'sprite' ? 'sprite' : 'avatar'
    const id = chats.char?._id || ''
    if (mode === 'sprite' && !chars.botMap[id]?.sprite) {
      return 0
    }

    if (mode === 'avatar' && !chars.botMap[id]?.avatar) {
      return 0
    }

    const percent = user.ui.viewHeight || 40
    return `calc(${percent}vh - 24px)`
  })

  const chatGrid = createMemo(() => (user.ui.chatAvatarMode ? 'avatar-chat-detail' : 'chat-detail'))
  const isGreetingOnlyMsg = createMemo(() => msgs.msgs.length === 1)
  const botGreeting = createMemo(() => chats.char?.greeting || '')
  const altGreetings = createMemo(() => chats.char?.alternateGreetings ?? [])

  let [evented, setEvented] = createSignal(false)
  const retries = createMemo(() => {
    const last = msgs.msgs.slice(-1)[0]
    if (!last && !isGreetingOnlyMsg()) return

    return { msgId: last._id, list: msgs.retries?.[last._id] || [] }
  })

  const [swipe, setSwipe] = createSignal(0)
  const [removeId, setRemoveId] = createSignal('')
  const [ooc, setOoc] = createSignal<boolean>()
  const [showHiddenEvents, setShowHiddenEvents] = createSignal(false)
  const [restart, setRestart] = createSignal(false)

  const chatMsgs = createMemo(() => {
    const messages = msgs.msgs
    if (!chats.chat || !chats.char) return []
    const doShowHiddenEvents = showHiddenEvents()
    return insertImageMessages(messages, msgs.images[params.id]).filter((msg) => {
      if (chats.opts.hideOoc && msg.ooc) return false
      if (msg.event === 'hidden' && !doShowHiddenEvents) return false
      return true
    })
  })

  createEffect(() => {
    // On Connect Events
    if (evented() || !chats.chat || !chats.char || !chars.ready) return
    setEvented(true)

    const messages = msgs.msgs
    const isNonEvent = !msgs.msgs[0]?.event
    if (isNonEvent && messages.length <= 1) {
      eventStore.onGreeting(chats.chat)
    } else {
      eventStore.onChatOpened(chats.chat, new Date(messages[messages.length - 1].createdAt))
    }
  })

  const isOwner = createMemo(() => chats.chat?.userId === user.user?._id)
  const chatWidth = createMemo(() =>
    getChatWidth(user.ui.chatWidth, !!chats.opts.pane && isPaneOrPopup() === 'pane')
  )
  const tts = createMemo(() => (user.user?.texttospeech?.enabled ?? true) && !!chats.char?.voice)

  const waitingMsg = createMemo(() => {
    if (!msgs.waiting) return
    if (msgs.retrying) return

    return emptyMsg({
      id: 'partial',
      charId: msgs.waiting?.mode !== 'self' ? msgs.waiting.characterId : undefined,
      userId: msgs.waiting?.mode === 'self' ? msgs.waiting.userId || user.user?._id : undefined,
      message: msgs.partial || '',
      adapter: 'partial',
    })
  })

  const clearModal = () => {
    chatStore.option('modal', 'none')
  }

  const clickSwipe = (dir: -1 | 1) => () => {
    const ret = retries()
    if (!ret || !ret.list.length) return
    const prev = swipe()
    const max = ret.list.length - 1

    let next = prev + dir
    if (next < 0) next = max
    else if (next > max) next = 0

    setSwipe(next)
  }

  createEffect(() => {
    if (!msgs.inference) return
    if (!ctx.info) return

    // express.classify(opts.preset, msgs.inference.text)
    msgStore.clearLastInference()
  })

  createEffect(() => {
    if (isGreetingOnlyMsg() && botGreeting() && altGreetings().length > 0) {
      const currentChoice = msgs.msgs[0].msg
      const allGreetings = [botGreeting(), ...altGreetings()].filter((text) => !!text)
      const currentChoiceIndex = allGreetings.findIndex((greeting) => greeting === currentChoice)
      const greetingsWithCurrentChoiceFirst = cycleArray(allGreetings, currentChoiceIndex)
      msgStore.setGreetingSwipes(msgs.msgs[0]._id, greetingsWithCurrentChoiceFirst)
    }
  })

  createEffect(() => {
    const charName = chats.char?.name
    updateTitle(charName ? `Chat with ${charName}` : 'Chat')
    if (!params.id) {
      if (!chats.lastId) return nav('/character/list')
      return nav(`/chat/${chats.lastId}`)
    }

    if (params.id !== chats.chat?._id) {
      chatStore.getChat(params.id)
    }
  })

  const sendMessage = (message: string, ooc: boolean, onSuccess?: () => void) => {
    if (isDevCommand(message)) {
      switch (message) {
        case '/devCycleAvatarSettings':
          devCycleAvatarSettings(user)
          onSuccess?.()
          return

        case '/devShowHiddenEvents':
          setShowHiddenEvents(!showHiddenEvents())
          break
      }
    }

    // If the number of active bots is 1 or fewer then always request a response
    const kind = ooc ? 'ooc' : chats.replyAs || ctx.activeBots.length <= 1 ? 'send' : 'send-noreply'
    if (!ooc) setSwipe(0)
    msgStore.send(chats.chat?._id!, message, kind, onSuccess)
    return
  }

  const moreMessage = () => msgStore.continuation(chats.chat?._id!)
  const requestMessage = (charId: string) => msgStore.request(chats.chat?._id!, charId)
  const cancelSwipe = () => setSwipe(0)

  const confirmSwipe = (msgId: string) => {
    msgStore.confirmSwipe(msgId, swipe(), () => setSwipe(0))
  }

  const indexOfLastRPMessage = createMemo(() => {
    return msgs.msgs.reduceRight(
      (prev, curr, i) => (prev > -1 ? prev : !curr.ooc && curr.adapter !== 'image' ? i : -1),
      -1
    )
  })

  const generateFirst = () => {
    msgStore.retry(chats.chat?._id!)
  }

  const chatMargin = createMemo(() => ' ' || (!!chats.opts.pane ? 'xs:mr-auto mx-auto' : 'mx-auto'))

  const characterPills = createMemo(() => {
    const bots = ctx.activeBots.filter((bot) => {
      if (ctx.tempMap[bot._id]?.favorite === false) return false
      return true
    })
    return bots
  })

  useEffect(() => {
    function keyboardShortcuts(ev: KeyboardEvent) {
      if (!ev.altKey) return

      const num = +ev.key
      if (num >= 1) {
        const pill = characterPills()[num - 1]
        if (!pill) return

        ev.preventDefault()
        if (msgs.retrying || msgs.partial) return
        requestMessage(pill._id)
      }

      if (ev.key === 'r') {
        ev.preventDefault()
        if (msgs.retrying || msgs.partial) return
        const last = indexOfLastRPMessage()
        const msg = msgs.msgs[last]
        if (!msg) return
        if (msg.adapter === 'image') {
          msgStore.createImage(msg._id)
        } else if (msg.characterId) {
          msgStore.retry(msg.chatId, msg._id)
        } else {
          msgStore.resend(msg.chatId, msg._id)
        }
      }

      if (ev.key === 'i') {
        ev.preventDefault()
        settingStore.toggleImpersonate(true)
      }

      if (ev.key === 'a') {
        ev.preventDefault()
        const last = indexOfLastRPMessage()
        const msg = msgs.msgs[last]
        if (!msg?.characterId) return

        msgStore.request(msg.chatId, msg.characterId)
      }
    }

    document.addEventListener('keydown', keyboardShortcuts)

    return () => document.removeEventListener('keydown', keyboardShortcuts)
  })

  const contentStyles = createMemo((): JSX.CSSProperties => {
    if (chats.opts.pane && isPaneOrPopup() === 'pane') {
      return {
        gap: '4px',
        'justify-self': 'center',
        'flex-direction': 'row',
      }
    }

    return {}
  })

  const msgsMaxWidth = createMemo(() => (chats.opts.pane ? getMaxChatWidth(user.ui.chatWidth) : ''))
  const msgsAndPaneJustifyContent = createMemo(() => {
    if (!chats.opts.pane) return 'justify-center'
    switch (isPaneOrPopup()) {
      case 'popup':
        return 'justify-center'
      case 'pane':
        return 'justify-end'
    }
  })

  onCleanup(clearScrollMonitor)

  return (
    <>
      <Show when={!chats.loaded && !chats.chat}>
        <div>
          <div class="text-gray-900">Loading conversation...</div>
        </div>
      </Show>
      <Show when={chats.chat}>
        <main class="mx-auto flex w-full justify-between gap-4">
          <div
            class={`${chatGrid()} gap-1 ${chatMargin()} ${chatWidth()} mx-auto flex flex-col pb-1 xs:flex`}
          >
            <header
              data-header=""
              class={` bg-white h-[60px]`}
            >
              <div class="flex items-center m-auto max-w-7xl">
                <span>
                  <LogoIcon/>
                </span>
                <p class="text-gray-900 text-3xl font-bold">{chats.char?.name}</p>
              </div>
            </header>
            
            <section
              class={`max-w-7xl m-auto w-full h-full gap-1 overflow-y-auto ${msgsAndPaneJustifyContent()}`}
              style={contentStyles()}
            >
              <section class="flex h-full w-full flex-col justify-between gap-2">
                <div class="flex flex-col sm:flex-row overflow-y-auto h-full">
                  <div class="sm:mr-2 flex flex-row sm:flex-col items-center justify-around sm:justify-start">
                    <AvatarIcon
                      format={{ corners: 'lg', size: '3xl' }}
                      avatarUrl={chats.char?.avatar!}
                    />
                    <div class="sm:w-full flex justify-center sm:mt-5">
                      <button class="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-full flex gap-2" onClick={() => setRestart(true)}>
                        <AlertTriangle /> Restart Chat <AlertTriangle />
                        {/* Restart Chat */}
                      </button>
                    </div>
                  </div>
                  <div class="flex w-full flex-col justify-end gap-2 overflow-y-auto">
                    <div
                      ref={(ref) => {
                        slotContainer = ref
                        slots.load(ref)
                      }}
                      class="sticky top-0 flex h-fit w-full justify-center"
                    >
                      <Switch>
                        <Match when={slots.size().w === 0}>{null}</Match>
                        <Match when={slotContainer!}>
                          <Slot sticky="always" slot="content" parent={slotContainer!} />
                        </Match>
                      </Switch>
                    </div>
                    <Show when={user.ui.viewMode === 'split'}>
                      <section
                        data-avatar-container
                        ref={container!}
                        class="flex items-end justify-center"
                        style={{ height: `${viewHeight()}`, 'min-height': viewHeight() }}
                      >
                        <Show when={chats.char?.visualType === 'sprite'}>
                          <AvatarContainer
                            container={container!}
                            body={chars.botMap[chats.char?._id!]?.sprite}
                            expression={express.expr()}
                          />
                        </Show>
                        <Show when={chats.char?.visualType !== 'sprite' && chats.char?.avatar}>
                          <div class="flex h-full w-full justify-center">
                            <img
                              src={chats.char?.avatar!}
                              class="flex h-full justify-center rounded-lg object-cover"
                            />
                          </div>
                        </Show>
                      </section>
                    </Show>
                    <section
                      data-messages
                      class={`mx-auto flex flex-col-reverse gap-4 overflow-y-auto ${msgsMaxWidth()} w-full`}
                      ref={monitorScroll}
                    >
                      <div id="chat-messages" class="flex w-full flex-col gap-2">
                        {/* <Show when={chats.loaded && chatMsgs().length < 2 && chats.char?.description}>
                          <div class="mb-4 flex flex-col items-center text-[var(--text-500)]">
                            <div class="font-bold">Notes from the creator of {chats.char?.name}</div>
                            {descriptionText()}
                          </div>
                        </Show> */}
                        <Show when={chats.loaded && chatMsgs().length === 0 && !msgs.waiting}>
                          <div class="flex justify-center">
                            <Button onClick={generateFirst}>Generate Message</Button>
                          </div>
                        </Show>
                        {/* Original Slot location */}
                        <InfiniteScroll />
                        <For each={chatMsgs()}>
                          {(msg, i) => (
                            <Message
                              msg={msg}
                              editing={chats.opts.editing}
                              last={i() === indexOfLastRPMessage()}
                              onRemove={() => setRemoveId(msg._id)}
                              swipe={
                                msg._id === retries()?.msgId && swipe() > 0 && retries()?.list[swipe()]
                              }
                              confirmSwipe={() => confirmSwipe(msg._id)}
                              cancelSwipe={cancelSwipe}
                              tts={tts()}
                              retrying={msgs.retrying}
                              partial={msgs.partial}
                              sendMessage={sendMessage}
                              isPaneOpen={!!chats.opts.pane}
                            >
                              {isOwner() &&
                                retries()?.list?.length! > 1 &&
                                i() === indexOfLastRPMessage() && (
                                  <SwipeMessage
                                    chatId={chats.chat?._id!}
                                    pos={swipe()}
                                    prev={clickSwipe(-1)}
                                    next={clickSwipe(1)}
                                    list={retries()?.list || []}
                                  />
                                )}
                            </Message>
                          )}
                        </For>
                        <Show when={waitingMsg()}>
                          <Message
                            msg={waitingMsg()!}
                            onRemove={() => {}}
                            editing={chats.opts.editing}
                            sendMessage={sendMessage}
                            isPaneOpen={!!chats.opts.pane}
                          />
                        </Show>
                      </div>
                    </section>

                    <Show when={isOwner() && ctx.activeBots.length > 1}>
                      <div
                        class={`flex min-h-[42px] justify-center gap-2 overflow-x-auto py-1 ${
                          msgs.waiting ? 'opacity-70 saturate-0' : ''
                        }`}
                      >
                        <Button
                          size="md"
                          schema="bordered"
                          onClick={() => settingStore.toggleImpersonate(true)}
                          classList={{ 'impersonate-btn': true }}
                        >
                          <VenetianMask size={16} />
                        </Button>
                        <For each={characterPills()}>
                          {(bot) => (
                            <CharacterPill
                              char={bot}
                              onClick={requestMessage}
                              disabled={!!msgs.waiting}
                              active={chats.replyAs === bot._id}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </div>
                <InputBar
                  chat={chats.chat!}
                  swiped={swipe() !== 0}
                  send={sendMessage}
                  more={moreMessage}
                  char={chats.char}
                  ooc={ooc() ?? isGroupChat()}
                  setOoc={setOoc}
                  showOocToggle={isGroupChat()}
                  request={requestMessage}
                  bots={ctx.activeBots}
                  botMap={chars.botMap}
                />
              </section>
            </section>
          </div>
        </main>
      </Show>

      <Show when={chats.opts.modal === 'export'}>
        <ChatExport show={true} close={clearModal} />
      </Show>

      <Show when={chats.opts.modal === 'delete'}>
        <DeleteChatModal show={true} chat={chats.chat!} redirect={true} close={clearModal} />
      </Show>

      <Show when={!!removeId()}>
        <DeleteMsgModal show={!!removeId()} messageId={removeId()} close={() => setRemoveId('')} />
      </Show>

      <Show
        when={
          chats.chat &&
          !chats.chat.genPreset &&
          !chats.chat.genSettings &&
          !user.user?.defaultPreset
        }
      >
        <ForcePresetModal chat={chats.chat!} show={true} close={() => {}} />
      </Show>

      <PromptModal />

      <ConfirmModal
        message={
          <TitleCard type="rose" class="flex flex-col gap-4">
            <div class="flex justify-center font-bold">Are you sure?</div>
            <div>This will delete ALL messages in this conversation.</div>
          </TitleCard>
        }
        show={restart()}
        close={() => setRestart(false)}
        confirm={() => {
          chatStore.restartChat(chats.chat!._id)
        }}
      />
    </>
  )
}

export default ChatDetail

let scrollMonitor: any

function monitorScroll(ref: HTMLElement) {
  let bottom = true

  ref.onscroll = (ev) => {
    const pos = ref.scrollTop

    if (pos >= 0) {
      bottom = true
    } else {
      bottom = false
    }
  }

  scrollMonitor = setInterval(() => {
    if (bottom && ref.scrollTop !== 0) {
      ref.scrollTop = 0
    }
  }, 1000 / 30)
}

function clearScrollMonitor() {
  clearInterval(scrollMonitor)
}
