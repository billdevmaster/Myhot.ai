import './variables.css'
import './tailwind.css'
import './app.css'
import './dots.css'
import '@melloware/coloris/dist/coloris.css'
import { Component, createMemo, JSX, Show, lazy, onMount } from 'solid-js'
import { Outlet, Route, Router, Routes, useLocation } from '@solidjs/router'
import NavBar from './shared/NavBar'
import Toasts from './Toasts'
import { settingStore } from './store/settings'
import { userStore } from './store/user'
import HomePage from './pages/Home'
import Loading from './shared/Loading'
import Button from './shared/Button'

import Maintenance from './shared/Maintenance'
import ChatDetail from './pages/Chat/ChatDetail'
import PendingPage from './pages/Chat/Pending'

import { chatStore } from './store'
import { usePane } from './shared/hooks'
import { rootModalStore } from './store/root-modal'
import { For } from 'solid-js'
import { css, getMaxChatWidth } from './shared/util'
import Modal from './shared/Modal'
import { ContextProvider } from './store/context'


const App: Component = () => {
  const state = userStore()
  const cfg = settingStore()

  return (
    <Router>
      <Routes>
        <Route path="" component={Layout}>
          <Route path="/character/:userid/:charid" component={PendingPage} />
          <Route path="/chat" component={ChatDetail} />
          <Route path="/chat/:id" component={ChatDetail} />
          <Route path="*" component={HomePage} />
        </Route>
      </Routes>
    </Router>
  )
}

const Layout: Component = () => {
  const state = userStore()
  const cfg = settingStore()
  const location = useLocation()
  const chat = chatStore()
  const paneOrPopup = usePane()
  const isPaneOpen = createMemo(() => paneOrPopup() === 'pane' && !!chat.opts.pane)

  const maxW = createMemo((): string => {
    if (isPaneOpen()) return 'max-w-full'

    return 'max-w-full'
  })
  const rootModals = rootModalStore()

  const reload = () => {
    settingStore.init()
  }

  onMount(() => {
    settingStore.init()
  })

  const isChat = createMemo(() => {
    return location.pathname.startsWith('/chat/')
  })

  const bg = createMemo(() => {
    const styles: JSX.CSSProperties = {
      'background-color': 'bg-gray-200',
    }
    return styles
  })

  return (
    <ContextProvider>
      <style>{css}</style>
      <div class="scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-[var(--hl-900)] app flex flex-col justify-between bg-gray-200">
        {/* <NavBar /> */}
        <div class="flex w-full grow flex-row overflow-y-hidden">
          <div class="w-full overflow-y-auto" data-background style={bg()}>
            <div
              class={`mx-auto h-full min-h-full ${isChat() ? maxW() : 'max-w-8xl'}`}
              classList={{
                'content-background': !isChat(),
              }}
            >
              <Show when={cfg.init}>
                <Outlet />
                <Maintenance />
              </Show>
              <Show when={!cfg.init && cfg.initLoading}>
                <div class="flex h-[80vh] items-center justify-center">
                  <Loading />
                </div>
              </Show>

              <Show when={!cfg.init && !cfg.initLoading}>
                <div class="flex flex-col items-center gap-2">
                  <div>Agnaistic failed to load</div>
                  <div>
                    <Button onClick={reload}>Try Again</Button>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>
        <Toasts />
        <For each={rootModals.modals}>{(modal) => modal.element}</For>
      </div>

      <div
        class="absolute bottom-0 left-0 right-0 top-0 z-10 h-[100vh] w-full bg-black bg-opacity-5"
        classList={{ hidden: !cfg.overlay }}
        onClick={() => settingStore.toggleOverlay(false)}
      ></div>
    </ContextProvider>
  )
}

export default App
