import { Router } from 'express'
import chat from './chat'
import user from './user'
import settings from './settings'
import selfhost from './json'
import voice from './voice'
import { config } from '../config'
import { getMysqlQueryResult } from '../db/client'

const router = Router()

router.use('/user', user)
router.use('/chat', chat)
router.use('/settings', settings)
router.use('/voice', voice)
router.get('/mysql', async (req, res) => {
  const { table } = req.query;
  const ret = await getMysqlQueryResult(`select * from ${table}`)
  return res.json({result: ret})
})

if (config.jsonStorage) {
  router.use('/json', selfhost)
}

export default router
