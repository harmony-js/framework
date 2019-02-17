import Inert from 'inert'
import Vision from 'vision'
import HapiReactViews from 'hapi-react-views'
import { WebConfig } from '@foundationjs/typedefs/server'

// Import React and React DOM so that Mixt knows to bundle them
import 'react'
import 'react-dom'

export default async function (
  server: any,
  {
    views,
    static: staticConfig,
    routes,
    logger,
  }: WebConfig,
) {
  await Promise.all([
    server.register(Inert),
    server.register(Vision),
  ])

  if (views) {
    /* Configure view engine to use React */
    server.views({
      engines: { jsx: HapiReactViews, js: HapiReactViews, ...views.engines },
      path: views.dir,
      defaultExtension: 'js',
    })

    /* Register view routes */
    if (views.paths) {
      Object.entries(views.paths).forEach(([path, view]) => {
        server.route({
          method: 'GET',
          path,
          handler: { view },
        })
      })
    } else if (logger) {
      logger.warn('View Engine initialized with no views')
    }
  }

  /* Route for serving static files */
  if (staticConfig && staticConfig.enabled) {
    server.route({
      method: 'GET',
      path: `${staticConfig.path}/{param*}`,
      handler: {
        directory: {
          path: staticConfig.dir,
        },
      },
    })
  }

  /* Custom routes */
  if (routes) {
    routes.forEach(route => server.route(route))
  }
}