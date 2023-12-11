import LogoIcon from "/web/icons/LogoIcon"
import {
  createEffect
} from 'solid-js'
import { useParams } from '@solidjs/router'
import { api } from "/web/store/api"
import { setAuth } from "/web/store/api"
import { toastStore } from "/web/store"

const Pending = () => {
  const params = useParams()
  createEffect(() => {
    const getChat = async () => {
      const res = await api.post('/chat/getChat', { userId: params.userid, charId: params.charid });
      if (res.result.success) {
        setAuth(res.result.token)
        window.location.href = `/chat/${res.result.chat._id}`
      } else {
        toastStore.error(res.result.msg)
      }
    }
    getChat();
  })

  return (
    <>
      <div class="flex justify-center items-center h-screen">
        <LogoIcon />
      </div>
    </>
  )
}

export default Pending