import logger from '../loggly/logger'
import {
  NotFoundAPIError
} from './APIError'
import ws from 'ws'

import { URL } from 'url'
import uid from 'uid-safe'
import Authentication from './Authentication'
import Permission from './Permission'

const apiEvents = [
  'rescueCreated',
  'rescueUpdated',
  'rescueDeleted',
  'ratCreated',
  'ratUpdated',
  'ratDeleted',
  'userCreated',
  'userUpdated',
  'userDeleted',
  'clientCreated',
  'clientUpdated',
  'clientDeleted',
  'shipCreated',
  'shipUpdated',
  'shipDeleted',
  'connection'
]

const routes = {}

export default class WebSocket {
  constructor (server, trafficManager) {
    this.wss = new ws.Server({server})
    this.traffic = trafficManager

    this.wss.on('connection', async (client, req) => {
      let url = new URL(`http://localhost:8082${req.url}`)
      client.req = req
      client.clientId = uid.sync(GLOBAL.WEBSOCKET_IDENTIFIER_ROUNDS)
      client.subscriptions = []

      let bearer = url.searchParams.get('bearer')
      if (bearer) {
        let {user, scope} = await Authentication.bearerAuthenticate(bearer)
        if (user) {
          client.user = user
          client.scope = scope
        }
      }

      this.onConnection(client)

      client.on('message', (message) => {
        try {
          let request = JSON.parse(String(message))
          this.onMessage(client, request)
        } catch (ex) {
          logger.info('Failed to parse incoming websocket message')
        }
      })

      for (let event of apiEvents) {
        process.on(event, (ctx, result, permissions) => {
          this.onEvent.call(this, event, ctx, result, permissions)
        })
      }

      process.on('apiBroadcast', (id, ctx, result) => {
        this.onBroadcast.call(this, id, ctx, result)
      })
    })
  }

  async onConnection (client) {
    let ctx = new Context(client, {})
    let result = await WebSocket.getRoute('version', 'read')
    let meta = {
      event: 'connection'
    }

    let rateLimit = this.traffic.validateRateLimit(ctx, false)
    Object.assign(meta, {
      'API-Version': 'v2.0',
      'Rate-Limit-Limit': rateLimit.total,
      'Rate-Limit-Remaining': rateLimit.remaining,
      'Rate-Limit-Reset':  this.traffic.nextResetDate
    })
    this.send(client, { result:  result.data, meta: meta })
  }

  async onMessage (client, request) {
    try {
      let { result, meta } = await this.route(client, request)
      if (!result.meta) {
        result.meta = {}
      }
      Object.assign(result.meta, meta)
      this.send(client, result)
    } catch (ex) {
      this.send(client, ex)
    }
  }

  async route (client, request) {
    let ctx = new Context(client, request)

    let rateLimit = this.traffic.validateRateLimit(ctx)

    let meta = Object.assign(request.meta || {}, {
      'API-Version': 'v2.0',
      'Rate-Limit-Limit': rateLimit.total,
      'Rate-Limit-Remaining': rateLimit.remaining,
      'Rate-Limit-Reset':  this.traffic.nextResetDate
    })

    let [endpointName, methodName] = request.action || []
    let result = await WebSocket.getRoute(endpointName, methodName)(ctx)

    return { result:  result, meta: meta }
  }

  onBroadcast (id, ctx, result) {
    let clients = [...this.socket.clients].filter((client) => {
      return client.subscriptions.includes(id)
    })
    this.broadcast(clients, result)
  }

  onEvent (event, ctx, result, permissions = null) {
    let clients = [...this.socket.clients].filter((client) => {
      if (client.clientId !== ctx.client.clientId) {
        return (!permissions || Permission.granted(permissions, client.user, client.scope))
      }
      return false
    })
    if (!result.meta) {
      result.meta = {}
    }

    Object.assign(result.meta, { event })
    this.broadcast(clients, result)
  }

  send (client, message) {
    try {
      client.send(JSON.stringify(message))
    } catch (ex) {
      logger.info('Failed to send websocket message')
    }
  }

  broadcast (clients, message) {
    for (let client of clients) {
      this.send(client, message)
    }
  }

  static addRoute (endpointName, methodName, method) {
    if (routes.hasOwnProperty(endpointName) === false) {
      routes[endpointName] = {}
    }

    routes[endpointName][methodName] = method
  }

  static getRoute (endpointName, methodName) {
    if (routes.hasOwnProperty(endpointName) === false || routes[endpointName].hasOwnProperty(methodName)) {
      throw NotFoundAPIError({ parameter: 'action' })
    }
    return routes[endpointName][methodName]
  }
}

export class Context {
  constructor (client, request) {
    this.inet = client.req.headers['X-Forwarded-for'] || client.req.connection.remoteAddress

    this.client = client
    this.state = {}
    this.state.scope = client.scope
    this.state.user = client.user

    this.query = {}
    Object.assign(this.query, request)
    Object.assign(this.meta, this.query)
    this.data = request.data

    delete this.query.data
    delete this.query.meta
    delete this.query.action
    this.params = this.query
  }
}

export class Meta {
  constructor (result, query = null, additionalParameters = {}) {
    let meta = {
      meta: {}
    }
    if (query) {
      if (Array.isArray(result)) {
        meta.meta = {
          count: result.length,
          limit: query._limit || 0,
          offset: query._offset || 0,
        }
      } else {
        meta.meta = {
          count: result.rows.length,
          limit: query._limit || 0,
          offset: query._offset || 0,
          total: result.count
        }
      }
    }

    meta.meta = Object.assign(meta.meta, additionalParameters)
    return meta
  }
}


/**
 * ESNext Decorator for routing this method for websocket requests
 * @param endpointName The endpoint name to route websocket requests for
 * @param methodName The method name to route websocket requests for
 * @returns {Function} An ESNext decorator function
 */
export function websocket (endpointName, methodName) {
  return function (target, name, descriptor) {
    WebSocket.addRoute(endpointName, methodName, descriptor.value)
  }
}