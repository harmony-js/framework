// Require Hapi
import Hapi from '@hapi/hapi'

// Require types
import { Controller } from '@harmonyjs/types-server'

// Require SocketIO
import IO from 'socket.io'
import IORedis from 'socket.io-redis'

// Require logger
import { LogConfig } from '@harmonyjs/types-logger'
import Logger from '@harmonyjs/logger'

// Require utils
import { getPluginsFromControllers, registerControllers, registerPlugins } from './utils/controllers'

// Require Auth Controller
import ControllerAuth from './auth'

type ServerConfig = {
  endpoint?: {
    host: string,
    port: number,
    autoListen?: boolean,
  },
  controllers?: Controller[],
  authentication?: {
    secret: string,
    validate?: (any) => Promise<boolean>,
  },
  cluster?: {
    redis: {
      key?: string,
      host?: string,
      port?: string,
    },
  },
  log?: LogConfig,
}

export default class Server {
  config: ServerConfig = {}

  logger = null

  server = null

  constructor(config: ServerConfig) {
    this.initializeProperties(config)

    this.createLogger()
  }

  async start() {
    try {
      await this.launch()
    } catch (err) {
      this.logger.error(err)
      throw new Error('Error while creating server')
    }

    return true
  }

  async init(config: ServerConfig = this.config) {
    this.initializeProperties(config)

    this.createLogger()

    this.logger.warn(
      'Deprecation Notice: Server::init function is deprecated and will be removed in the next minor. '
      + 'Use Server::start instead.',
    )

    await this.launch()
  }

  private initializeProperties(config: ServerConfig = this.config) {
    const {
      endpoint, controllers, authentication, cluster, log,
    } = config

    this.config = this.config || {}
    this.config.endpoint = endpoint || this.config.endpoint || { host: 'localhost', port: 3000 }
    this.config.controllers = controllers || this.config.controllers
    this.config.authentication = authentication || this.config.authentication
    this.config.cluster = cluster || this.config.cluster
    this.config.log = log || this.config.log
  }

  private async launch() {
    const { endpoint } = this.config

    await this.logBanner()

    await this.createServer()

    await this.configureSocketIO()

    await this.configureAuthentication()

    await this.configureControllers()

    await this.separateUpgradeRequests()

    // Start the server
    await this.server.start()

    this.logger.info(`Main server created on port ${endpoint.host}:${endpoint.port}`)
  }

  private async createServer() {
    const { endpoint } = this.config

    this.logger.info('Initializing Hapi Server')
    this.server = new Hapi.Server(endpoint)
  }

  private async configureSocketIO() {
    const { cluster } = this.config

    // Create Socket.IO instance
    const io = IO(this.server.listener, {
      path: '/harmonyjs-socket',
      serveClient: false,
    })

    // Add Redis layer if required
    if (cluster && cluster.redis) {
      const redis = {
        key: cluster.redis.key || 'harmony',
        host: cluster.redis.host || 'localhost',
        port: cluster.redis.port || 6379,
      }

      io.adapter(IORedis(redis))
    }

    this.server.io = io
  }

  private async configureAuthentication() {
    const { authentication } = this.config

    // Add Authentication
    this.logger.info('Initializing Authentication service...')
    const secret = authentication ? authentication.secret || '-' : '-'
    await ControllerAuth(this.server, authentication || { secret, validate: undefined })
    this.logger.info('Authentication service initialized successfully')
  }

  private async configureControllers() {
    const { controllers, log } = this.config

    // Check if any custom controllers need to be initialized
    if (controllers && controllers.length) {
      const plugins = getPluginsFromControllers({ controllers })

      await registerPlugins({ plugins, server: this.server })

      await registerControllers({
        controllers, server: this.server, log: this.logger, logConfig: log,
      })
    }
  }

  private async separateUpgradeRequests() {
    const listeners = this.server.listener.listeners('upgrade')
    const harmonyListener = listeners.shift()

    this.server.listener.removeAllListeners('upgrade')
    this.server.listener.on('upgrade', (req, socket, head) => {
      if (req.url.startsWith('/harmonyjs-socket/')) {
        // If the path starts with /harmonyjs-socket, forward it to the
        // harmony socket-io listener
        harmonyListener(req, socket, head)
      } else {
        // Else, forward it to all other listeners, which should handle it gracefully
        // Note: if a controller uses socket-io, then it _will_ fail on upgrade requests
        listeners.forEach((l) => l(req, socket, head))
      }
    })
  }

  private createLogger = () => {
    const { log } = this.config
    const logConfig = log || {}

    // Prepare the logger
    this.logger = new Logger('Server', logConfig)
  }

  private logBanner = () => {
    const { logger } = this

    logger.info(`Powered by
   _    _
  | |  | |
  | |__| | __ _ _ __ _ __ ___   ___  _ __  _   _
  |  __  |/ _\` | '__| '_ \` _ \\ / _ \\| '_ \\| | | |
  | |  | | (_| | |  | | | | | | (_) | | | | |_| |
  |_|  |_|\\__,_|_|  |_| |_| |_|\\___/|_| |_|\\__, |
                                            __/ |
                                           |___/`)
  }
}
