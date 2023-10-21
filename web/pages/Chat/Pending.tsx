import LogoIcon from "/web/icons/LogoIcon"
import {
  createEffect
} from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { api } from "/web/store/api"
import { setAuth } from "/web/store/api"

const Pending = () => {
  const params = useParams()
  const nav = useNavigate()
  createEffect(() => {
    const getChat = async () => {
      const res = await api.post('/chat/getChat', { userId: params.userid, charId: params.charid });
      console.log(res.result.token)
      nav(`/chat/${res.result.chat._id}`)
      setAuth(res.result.token)
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