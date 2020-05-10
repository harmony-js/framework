import { RouteOptions, RouteShorthandOptions } from 'fastify'

import { Controller } from '@harmonyjs/types-server'

type HttpMethod = 'get'|'post'|'put'|'delete'|'options'|'patch'|'head'

type ControllerRESTRoute = RouteOptions['handler'] | {
  options: RouteShorthandOptions,
  handler: RouteOptions['handler']
}

type ControllerRESTConfig = {
  path: string,
  routes: {
    [method in HttpMethod]?: {
      [route: string]: ControllerRESTRoute,
    }
  }
}

/*
 * The SPA Controller exposes a single-page app on a given path,
 * statically built using Webpack, or served by Webpack-Dev-Server in development
 */
const ControllerREST : Controller<ControllerRESTConfig> = function ControllerREST(config) {
  return ({
    name: 'ControllerREST',
    async initialize({ logger, server }) {
      const {
        path,
        routes,
      } = config

      const prefix = path.endsWith('/') ? path.slice(0, -1) : path

      server.register((instance) => {
        (['get', 'post', 'put', 'delete', 'options', 'patch', 'head'] as HttpMethod[])
          .forEach((method) => {
            if (routes[method]) {
              Object.keys(routes[method]!)
                .forEach((route) => {
                  const routePath = route.startsWith('/') ? route : `/${route}`
                  logger.info(`Registering handler for ${method}:${prefix}${routePath}`)
                  if ('options' in routes[method]![route]) {
                    instance[method](
                      routePath,
                      routes[method]!.options as RouteShorthandOptions,
                      routes[method]!.handler as RouteOptions['handler'],
                    )
                  } else {
                    instance[method](
                      routePath,
                      routes[method]![route] as RouteOptions['handler'],
                    )
                  }
                })
            }
          })
      }, { prefix })
    },
  })
}

export default ControllerREST
