import {
  ApolloGateway, GatewayConfig, RemoteGraphQLDataSource, ServiceEndpointDefinition,
} from '@apollo/gateway'
import { ApolloServer, Config, ServerRegistration } from '@harmonyjs/apollo-fastify'
import { GraphQLRequest } from 'apollo-server-types'
import { RouteOptions } from 'fastify'

import { Controller } from '@harmonyjs/types-server'

type ApolloGatewayExperimental = {
  logger: {
    disableAll(arg: boolean): void
  }
  startPollingServices(): void
}

/*
 * The Apollo Controller exposes a GraphQL endpoint through an Apollo Server
 */
const ControllerApolloGateway : Controller<{
  path: string,
  enablePlayground?: boolean,
  services: ServiceEndpointDefinition[],
  authentication?: Controller & { validator: string },

  gatewayConfig?: Omit<GatewayConfig, 'serviceList'|'buildService'>
  apolloConfig?: Omit<Config, 'gateway'|'playground'|'introspection'|'context'|'subscriptions'>
  routeConfig?: Omit<RouteOptions, 'auth'>
  disableGatewayLogs?: boolean
}> = function (config) {
  return ({
    name: 'ControllerApolloGateway',
    async initialize({ server, logger }) {
      const {
        path,
        enablePlayground,

        services,
        authentication,

        gatewayConfig,
        apolloConfig,
        routeConfig,

        disableGatewayLogs,
      } = config

      logger.info('Registering GraphQL Federation endpoint...')

      const gateway = new ApolloGateway({
        ...(gatewayConfig || {}),
        serviceList: services,
        buildService({ url }) {
          return new RemoteGraphQLDataSource({
            url,
            willSendRequest({ request, context } : { request: GraphQLRequest, context: Record<string, any>}) {
              if (context.headers) {
                Object.keys(context.headers).forEach((header) => {
                  request.http!.headers.set(header, context.headers[header])
                })
              }
            },
          })
        },
      })

      if (disableGatewayLogs === true) {
        // @ts-ignore
        gateway.logger.disableAll(true)
      }

      const apolloServer = new ApolloServer({
        ...(apolloConfig || {}),
        gateway,
        playground: !!enablePlayground,
        introspection: !!enablePlayground,
        context: ({ request }) => ({
          headers: request.headers,
        }),
        subscriptions: false,
      })

      const routeOptions : ServerRegistration['routeOptions'] = { ...(routeConfig || {}) }
      if (authentication) {
        // @ts-ignore
        if (!server[authentication.validator]) {
          logger.error('The provided authentication controller was not initialized')
          logger.error(`Make sure the authentication controller ${
            authentication().name
          } is present in your controllers array and is before ${this.name}`)
          throw new Error('Missing controller')
        }

        const preValidation = []
        if (routeOptions.preValidation) {
          if (Array.isArray(routeOptions.preValidation)) {
            preValidation.push(...routeOptions.preValidation)
          } else {
            preValidation.push(routeOptions.preValidation)
          }
        }

        // @ts-ignore
        preValidation.push(server[authentication.validator].try)

        routeOptions.preValidation = preValidation
      }

      await server.register(apolloServer.createHandler({
        path,
        cors: true,
        routeOptions,
      }))

      logger.info(`GraphQL endpoint at ${path}`)
      if (enablePlayground) {
        logger.info(`GraphQL playground at ${path}`)
      }
    },
  })
}

export default ControllerApolloGateway
