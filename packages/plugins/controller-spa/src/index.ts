import Inert from '@hapi/inert'
import H2O2 from '@hapi/h2o2'
import Vision from '@hapi/vision'

import HapiReactViews from 'hapi-react-views'
import httpProxy from 'http-proxy'

import { Controller, ControllerSPAConfiguration } from '@harmonyjs/types-server'


/*
 * The SPA Controller exposes a single-page app on a given path,
 * statically built using Webpack, or served by Webpack-Dev-Server in development
 */
export default class ControllerSPA extends Controller {
  name = 'ControllerSPA'

  plugins = [Inert, H2O2, Vision]

  config : ControllerSPAConfiguration

  constructor(config) { // eslint-disable-line
    super(config)
  }

  async initialize({ server, logger }) {
    const {
      path,
      forceStatic,
      hmr,

      statics,
      views,
    } = this.config

    // The SPA Controller is made of two parts: a static serving system for resources,
    // and a view system for rendering the initial page(s)

    // In development, we can use options.forceStatic to run in production-like mode
    const production = process.env.NODE_ENV === 'production' || forceStatic

    logger.info(`Initializing SPA Controller on path ${path} (Environment: ${
      process.env.NODE_ENV || 'development'
    }, Mode: ${
      production ? 'static' : 'webpack'
    })`)

    if (views) {
      /* Configure view engine to use React */
      server.views({
        engines: { jsx: HapiReactViews, js: HapiReactViews, ...views.engines },
        path: views.dir,
        defaultExtension: 'js',
      })

      /* Register view routes */
      if (views.paths) {
        Object.keys(views.paths).forEach((p) => {
          const view = views.paths[p]

          const viewPath = path + (path.endsWith('/') ? '' : '/') + (p.startsWith('/') ? p.slice(1) : p)

          server.route({
            method: 'GET',
            path: viewPath,
            handler: { view },
          })

          logger.info(`Registered view '${view}' on path ${viewPath}`)
        })
      } else if (logger) {
        logger.warn('View Engine initialized with no views')
      }
    }

    let staticPath = path
      + ((path.endsWith('/')) ? '' : '/')
      + (statics.path.startsWith('/') ? statics.path.slice(1) : statics.path)

    if (staticPath.endsWith('/')) {
      staticPath = staticPath.slice(0, -1)
    }


    if (production) {
      /* Route for serving static files */
      server.route({
        method: 'GET',
        path: `${staticPath}/{param*}`,
        handler: {
          directory: {
            path: statics.dir,
          },
        },
      })

      logger.info(`Serving static files from ${statics.dir} on path ${staticPath}/`)
    } else {
      /* Webpack Proxy */
      server.route({
        method: 'GET',
        path: `${staticPath}/{webpackPath*}`,
        handler: {
          proxy: {
            host: hmr.endpoint,
            port: hmr.port,
            passThrough: true,
          },
        },
      })


      // We also need to proxy sockjs-node, since Webpack development uses the standard sockjs path
      // This means that any other sockjs used for Harmony need to be on a different path
      server.route({
        method: ['POST', 'GET'],
        path: '/sockjs-node/{path*}',
        handler: {
          proxy: {
            host: hmr.endpoint,
            port: hmr.port,
            passThrough: true,
          },
        },
      })

      // Finally, we proxy the upgrade request if they start by /socket.io
      const wsProxy = httpProxy.createProxyServer({ target: `http://${hmr.endpoint}:${hmr.port}` })
      wsProxy.on('error', (error) => logger.error(error))

      server.listener.on('upgrade', (req, socket, head) => {
        if (req.url.startsWith('/sockjs-node')) wsProxy.ws(req, socket, head)
      })

      logger.info(`Webpack proxy established to address ${hmr.endpoint}:${hmr.port}`)
    }

    logger.info(`SPA site served on ${path}`)
  }
}
