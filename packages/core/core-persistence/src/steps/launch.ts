import ControllerApollo from '@harmonyjs/controller-apollo'
import ControllerPersistenceEvents from '@harmonyjs/controller-persistence-events'

import {
  SanitizedModel, PersistenceInstance, IAdapter, InternalResolvers, AliasCrudEnum,
  ModelResolvers, Model, PersistenceContext, Scalar,
} from '@harmonyjs/types-persistence'
import { FastifyReply, FastifyRequest } from 'fastify'

import { printSchema } from 'utils/model'
import { getOperatorTypes } from 'utils/property/operators'
import {
  makeResolvers, getResolvers,
} from 'utils/resolvers'

export async function defineSchema({ models, scalars } : { models: SanitizedModel[], scalars: string[] }) {
  const operatorTypes = getOperatorTypes()

  return `# Harmony Scalars
scalar Date
scalar JSON
scalar Number

# Custom Scalars
${scalars.map((s) => `scalar ${s}`).join('\n')}
    
# Types
${models.map((model) => printSchema({ model })).join('\n')}

# Operator Types
${Object.keys(operatorTypes).map((operatorType) => {
    operatorTypes[operatorType].name = operatorType
    return operatorTypes[operatorType].graphqlInputSchema
  }).join('\n')}
`
}

export async function defineResolvers<Models extends string|number|symbol>({
  models, adapters, defaultAdapterName, modelResolvers,
} : {
  models: SanitizedModel[]
  adapters: {[key:string]: IAdapter}
  defaultAdapterName?: string
  modelResolvers: Record<keyof Models, ModelResolvers>
}) {
  const resolvers: Record<Models, InternalResolvers> = {} as any

  const defaultAdapter = adapters ? adapters[defaultAdapterName || 'mock'] : undefined

  models.forEach((model) => {
    const name = model.schemas.main.graphqlName as Models

    resolvers[name] = makeResolvers({
      adapter: model.adapter ? adapters[model.adapter] : defaultAdapter,
      model,
      modelResolvers,
    })
  })

  return resolvers
}

export async function defineModelResolvers<Models extends {[model: string]: Model}>({
  internalResolvers, modelResolvers,
} : {
  internalResolvers: Record<string, InternalResolvers>
  modelResolvers: Record<keyof Models, ModelResolvers>
}) {
  Object.keys(internalResolvers)
    .forEach((model) => {
      const internalResolver : InternalResolvers = internalResolvers[model]
      // eslint-disable-next-line no-param-reassign
      modelResolvers[model as keyof Models] = {} as any
      Object.keys(internalResolver)
        .forEach((res) => {
          // eslint-disable-next-line no-param-reassign
          modelResolvers[model as keyof Models][res as AliasCrudEnum] = (args: { [key: string]: any }) => (
            internalResolver[res as AliasCrudEnum].unscoped({ args })
          ) as any
        })
    })
}

function resolveContext({
  request,
  reply,
  context,
} : {
  request: FastifyRequest,
  reply: FastifyReply<any>,
  context: PersistenceContext,
}) {
  const retContext : any = {}

  Object.keys(context).forEach((key) => {
    if (typeof context[key] === 'function') {
      retContext[key] = (context[key] as Function)({ request, reply })
    } else {
      retContext[key] = context[key]
    }
  })

  return retContext
}

export async function defineControllers({
  schema, instance, internalResolvers, internalContext, scalars,
} : {
  schema: string
  instance: PersistenceInstance<any>
  internalResolvers: Record<string, InternalResolvers>
  internalContext: PersistenceContext
  scalars: Record<string, Scalar>
}) {
  const mock = Object.keys(instance.configuration.adapters).length < 1
  const mocks : {[key: string]: any} = {}
  const resolvers = getResolvers({ internalResolvers, models: instance.models, scalars })

  // Add mock function for each custom scalar
  Object.keys(scalars).forEach((s) => {
    mocks[s] = scalars[s].mock || (() => '')
  })

  // Add mock function for default scalars
  mocks.Date = () => new Date()
  mocks.JSON = () => ({ hello: 'world' })
  mocks.Number = () => 42

  function ControllerGraphQL({
    path,
    enablePlayground,
    routeConfig,
    apolloConfig,
    authentication,
  } : Parameters<PersistenceInstance<any>['controllers']['ControllerGraphQL']>[0]) {
    return ({
      ...(ControllerApollo({
        path,
        enablePlayground,
        context: {
          internal: ({ request, reply }) => resolveContext({ request, reply, context: internalContext }),
          external: ({ request, reply }) => resolveContext({ request, reply, context: instance.context }),
        },
        schema,
        resolvers,
        mock,
        mocks: mock ? mocks : undefined,
        authentication,
        routeConfig,
        apolloConfig,
      })),
      name: 'ControllerGraphQL',
    })
  }

  function ControllerEvents() {
    return ({
      ...(ControllerPersistenceEvents({
        events: instance.events,
      })),
      name: 'ControllerEvents',
    })
  }

  return ({
    ControllerGraphQL,
    ControllerEvents,
  })
}
