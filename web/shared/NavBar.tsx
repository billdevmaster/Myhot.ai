import { Component, Show } from 'solid-js'
import LogoIcon from '../icons/LogoIcon'

const NavBar: Component = () => {
  return (
    <Show when={true}>
      <span
        data-header=""
        class={`flex items-center bg-white h-[60px]`}
      >
        <span class="ml-5">
          <LogoIcon/>
        </span>
        <p class="text-gray-900">Myhotai</p>
      </span>
    </Show>
  )
}
export default NavBar
