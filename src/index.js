

// IMPORT
// =============================================================================

require('./globals')
import Koa from 'koa'
import session from 'koa-session'
const app = new Koa()
import querystring from 'koa-qs'
import koaStatic from 'koa-static'
import router from './Router'
querystring(app)
import koaBody from 'koa-body'
import TrafficControl from './TrafficControl'
import render from 'koa-ejs'
import path from 'path'
import http from 'http'
import ws from 'ws'
import { URL } from 'url'
import logger from './logger'
import { promisify } from 'util'
const {
  APIError,
  InternalServerError,
  TooManyRequestsAPIError,
  BadRequestAPIError
} = require('./APIError')

import Permission from './permission'
import uid from 'uid-safe'
import npid from 'npid'

// Import config
import config from '../config'


// Import controllers
import Authentication from './controllers/auth'
const decal = new (require('./controllers/decal'))()
import oauth2 from './controllers/oauth2'

const statistics = new (require('./controllers/statistics'))()
const version = new (require('./controllers/version'))()
import WebSocketManager from './websocket'
import jiraDrill from './controllers/jira/drill'
import { AnopeWebhook } from './controllers/anope-webhook'
import { db } from './db/index'

try {
  npid.remove('api.pid')
  let pid = npid.create('api.pid')
  pid.removeOnExit()
} catch (err) {
  process.exit(1)
}

app.keys = [config.cookie.secret]

let sessionConfiguration = {
  key: 'fuelrats:session',
  overwrite: true,
  signed: true
}

app.use(session(sessionConfiguration, app))
app.use(koaStatic('static', {
  hidden: false,
  gzip: true
}))
app.use(koaBody())

let port = config.port || process.env.PORT

app.use(async function (ctx, next) {
  ctx.data = ctx.request.body
  ctx.meta = WebSocketManager.meta
  ctx.client = {}

  let { query } = ctx
  ctx.query = parseQuery(query)

  if (ctx.request.headers['x-forwarded-for']) {
    [ctx.inet] = ctx.request.headers['x-forwarded-for'].split(', ')
  } else {
    ctx.inet =  ctx.request.ip
  }

  await next()
})

app.use(async function (ctx, next) {
  if (Array.isArray(ctx.data) || typeof ctx.data === 'object') {
    ['id', 'createdAt', 'updatedAt', 'deletedAt'].map((cleanField) => {
      delete ctx.data[cleanField]
    })
  }
  await next()
})

const traffic = new TrafficControl()

app.use(async (ctx, next) => {
  try {
    await Authentication.authenticate(ctx)

    let rateLimit = traffic.validateRateLimit(ctx)

    ctx.set('X-API-Version', '2.0')
    ctx.set('X-Rate-Limit-Limit', rateLimit.total)
    ctx.set('X-Rate-Limit-Remaining', rateLimit.remaining)
    ctx.set('X-Rate-Limit-Reset', rateLimit.nextResetDate)

    logger.info({ tags: ['request'] }, `Request by ${ctx.inet} to ${ctx.request.path}`, {
      'ip': ctx.inet,
      'path': ctx.request.path,
      'rate-limit-limit': rateLimit.total,
      'rate-limit-remaining': rateLimit.remaining,
      'query': ctx.query,
      'body': censor(ctx.data),
      'method': ctx.request.req.method
    })

    if (rateLimit.exceeded) {
      return next(new TooManyRequestsAPIError({}))
    }

    let result = await next()
    if (result === true) {
      ctx.status = 204
    } else if (result) {
      ctx.body = result
    }
  } catch (ex) {
    let error = ex

    if ((error instanceof APIError) === false) {
      error = new InternalServerError({})
    }
    ctx.status = error.code
    ctx.body = {
      errors: [error]
    }
  }
}) 

render(app, {
  root: path.join(__dirname, 'views'),
  layout: false,
  viewExt: 'html',
  cache: false,
  debug: true
})

// ROUTES
// =============================================================================

import Rescue from './controllers/rescue'
import User from './controllers/user'
import Rats from './controllers/rat'
import Clients from './controllers/client'
import Nicknames from './controllers/nicknames'
import Ships from './controllers/ship'
import Login from './controllers/login'
import Register from './controllers/register'
import Profile from './controllers/profile'
import Reset from './controllers/reset'

export let routes = [
  new Rescue(),
  new User(),
  new Rats(),
  new Clients(),
  new Nicknames(),
  new Ships(),
  new Login(),
  new Register(),
  new Profile(),
  new Reset()
]

// WELCOME
router.get('/welcome', (ctx) => {
  ctx.redirect('https://fuelrats.com/profile')
  ctx.status = 301
})

// ANOPE
router.post('/anope',
  Authentication.isWhitelisted,
  AnopeWebhook.update)

// OAUTH2
router.get('/oauth2/authorize',
  Authentication.isAuthenticated,
  oauth2.authorizationValidateRedirect,
  oauth2.authorizationRender
)

router.post('/oauth2/authorize',
  Authentication.isAuthenticated,
  ...oauth2.server.decision())

router.post('/oauth2/token',
  Authentication.isClientAuthenticated,
  oauth2.server.token(),
  oauth2.server.errorHandler())

router.post('/oauth2/revoke',
  Authentication.isClientAuthenticated,
  oauth2.revoke)
router.post('/oauth2/revokeall',
  Authentication.isClientAuthenticated,
  oauth2.revokeAll)


// STATISTICS
router.get('/statistics/rescues',
  statistics.rescues)

router.get('/statistics/systems',
  statistics.systems)

router.get('/statistics/rats',
  statistics.rats)


// VERSION
router.get('/version', version.read)


// DECALS
router.get('/decals/check',
  Authentication.isAuthenticated,
  decal.check)

router.get('/decals/redeem',
  Authentication.isAuthenticated,
  decal.redeem)


// JIRA
router.post('/jira/drill',
  Authentication.isAuthenticated,
  Permission.required(['user.write']),
  jiraDrill.update)


app.use(router.routes())
app.use(router.allowedMethods())


/**
 * Parses an object of URL query parameters and builds a nested object by delimiting periods into sub objects.
 * @param query an array of URL query parameters
 * @returns {{}} a nested object
 */
function parseQuery (query) {
  let queryObj = {}

  // Iterate over each individual query item
  for (let key of Object.keys(query)) {
    // Split them into period delimited arrays
    let keys = key.split('.')
    let target = queryObj

    // Iterate over the period delimited arrays to construct a nested hierarchy
    for (let keyPair of keys.entries()) {
      let [, subkey ] = keyPair
      if (keyPair[0] === keys.length - 1) {
        // We have reached the end of the delimited array which means we can insert the value

        target[subkey] = query[key]
      } else if (!target[subkey]) {
        /* We have not reached the end of the delimited array so we need to create a nested object unless
        it already exists */
        target[subkey] = {}
        target = target[subkey]
      }
    }
  }
  return queryObj
}

let server = http.createServer(app.callback())
const wss = new ws.Server({ server })

const websocketManager = new WebSocketManager(wss, traffic)

wss.on('connection', async function connection (client, req) {
  let url = new URL(`http://localhost:8082${req.url}`)
  client.req = req
  client.clientId = uid.sync(GLOBAL.WEBSOCKET_IDENTIFIER_ROUNDS)
  client.subscriptions = []

  let bearer = url.searchParams.get('bearer')
  if (bearer) {
    let { user, scope } = await Authentication.bearerAuthenticate(bearer)
    if (user) {
      client.user = user
      client.scope = scope
    }
  }

  websocketManager.onConnection(client)

  client.on('message', (message) => {
    client.websocket = wss
    try {
      let request = JSON.parse(message)
      websocketManager.onMessage(client, request)
    } catch (ex) {
      logger.info('Failed to parse incoming websocket message')
    }
  })
})

/**
 * Goes through an object and sets properties commonly usde to hold sensitive information to a static value.
 * @param obj The object to censor
 * @returns {{}} A censored object
 */
function censor (obj) {
  let censoredObj = {}
  Object.assign(censoredObj, obj)

  if (censoredObj.password) {
    censoredObj.password = '[CENSORED]'
  }
  if (censoredObj.secret) {
    censoredObj.secret = '[CENSORED]'
  }

  return censoredObj
}

(async function startServer () {
  try {
    await db.sync()
    const listen = promisify(server.listen.bind(server))
    await listen(port, config.hostname)
    logger.info(`HTTP Server listening on ${config.hostname} port ${port}`)
  } catch (error) {
    logger.error(error)
  }
})()

// allow launch of app from unit tests
module.exports = server