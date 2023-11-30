import { Router } from 'express'
import { loggedIn } from '../auth'
import {
  getInitialLoad
} from './settings'

const router = Router()

router.get('/init', loggedIn, getInitialLoad)

export default router
