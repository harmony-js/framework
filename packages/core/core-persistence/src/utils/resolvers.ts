import {
  AliasCrudEnum, CrudEnum,
  InternalResolvers,
  ScopedInternalResolver, UnscopedInternalResolver, InternalResolver, Resolver, ReferenceResolver, Scope, Transform,
  IAdapter, IProperty, IPropertySchema,
  SanitizedModel, ScopedModelResolvers,
  Scalar, ModelResolvers, Model,
} from '@harmonyjs/types-persistence'
import { ApolloError, ValidationError } from 'apollo-server-core'
import { GraphQLResolveInfo, GraphQLScalarType } from 'graphql'
import DataLoader from 'dataloader'

import GraphQLLong from 'graphql-type-long'
import GraphQLJson from 'graphql-type-json'
import GraphQLDate from 'graphql-date'

import { extractModelName } from 'utils/property/utils'

export type ResolverDefinition = {
  type: CrudEnum,
  suffix: string,
  alias?: AliasCrudEnum[],
}

// Query
export const queryResolvers: ResolverDefinition[] = [
  {
    type: 'read',
    suffix: '',
    alias: ['get', 'find'],
  }, {
    type: 'readMany',
    suffix: 'List',
    alias: ['list'],
  }, {
    type: 'count',
    suffix: 'Count',
  },
]

// Mutations
export const mutationResolvers: ResolverDefinition[] = [
  {
    type: 'create',
    suffix: 'Create',
  }, {
    type: 'createMany',
    suffix: 'CreateMany',
  }, {
    type: 'update',
    suffix: 'Update',
    alias: ['edit'],
  }, {
    type: 'updateMany',
    suffix: 'UpdateMany',
    alias: ['editMany'],
  }, {
    type: 'delete',
    suffix: 'Delete',
  }, {
    type: 'deleteMany',
    suffix: 'DeleteMany',
  },
]

type ResolverSource = any
type ResolverArgs = {[key: string]: any}
type ResolverContext = {[key: string]: any}
type ResolverInfo = GraphQLResolveInfo

function computeFieldResolver({
  field, resolver, internalResolvers,
} : {
  field: string, resolver: Resolver, internalResolvers: Record<string, InternalResolvers>
}) {
  return (
    source: ResolverSource,
    args: ResolverArgs,
    context: ResolverContext,
    info: ResolverInfo,
  ) => {
    const wrappedResolvers : {[model: string]: ScopedModelResolvers } = {}

    const cArgs = {
      source, info,
    }

    Object.keys(internalResolvers)
      .forEach((mod) => {
        const internalResolver = internalResolvers[mod]

        Object.keys(internalResolver)
          .forEach((res) => {
            const alias = res as AliasCrudEnum

            wrappedResolvers[mod] = wrappedResolvers[mod] || {}

            const wrappedResolver = (nArgs : ResolverArgs) => internalResolver[alias]({
              args: nArgs,
              ...cArgs,
              context: context.external,
            })
            wrappedResolver.unscoped = (nArgs : ResolverArgs) => internalResolver[alias].unscoped({
              args: nArgs,
              ...cArgs,
              context: context.external,
            })

            wrappedResolvers[mod][alias] = wrappedResolver as any
          })

        wrappedResolvers[mod].reference = (idArg) => internalResolver.reference({
          ...cArgs,
          source: { _id: idArg },
          fieldName: '_id',
          foreignFieldName: '_id',
          context: context.external,
          internal: context.internal,
        }) as any
      })

    return resolver({
      source,
      args,
      context: context.external,
      info,
      resolvers: wrappedResolvers,
      field,
    })
  }
}

export function getResolvers({
  internalResolvers,
  scalars,
  models,
} : {
  internalResolvers: { [model: string]: InternalResolvers },
  scalars: { [model: string]: Scalar },
  models: SanitizedModel[]
}) {
  const resolvers: { [key: string]: any } = {}

  resolvers.Query = {}
  resolvers.Mutation = {}

  Object.keys(scalars).forEach((s) => {
    resolvers[s] = new GraphQLScalarType({
      name: s,
      description: scalars[s].description,
      serialize: scalars[s].serialize,
      parseValue: scalars[s].parseValue,
      parseLiteral: scalars[s].parseLiteral,
    })
  })

  Object.keys(internalResolvers)
    .forEach((model) => {
      const baseName = model[0].toLowerCase() + model.slice(1)

      const harmonyModel = models.find((m) => m.schemas.main.graphqlName === model)
      if (!harmonyModel || harmonyModel.external) {
        return
      }

      queryResolvers.forEach((res) => {
        resolvers.Query[baseName + res.suffix] = (
          source: ResolverSource,
          args: ResolverArgs,
          context: ResolverContext,
          info: ResolverInfo,
        ) => internalResolvers[model][res.type]({
          source, args, context: context.external, info,
        })
      })
      mutationResolvers.forEach((res) => {
        resolvers.Mutation[baseName + res.suffix] = (
          source: ResolverSource,
          args: ResolverArgs,
          context: ResolverContext,
          info: ResolverInfo,
        ) => internalResolvers[model][res.type]({
          source, args, context: context.external, info,
        })
      })
    })

  // Find reference fields
  function extractReference(field : IProperty) {
    if (field.type === 'reference') {
      // Handle reference
      const isArray = field.parent && field.parent.type === 'array'
      const fieldName = (isArray ? (field.parent && field.parent.name) : field.name) || ''
      const baseName = (isArray
        ? field.parent && field.parent.parent && field.parent.parent.graphqlName
        : field.parent && field.parent.graphqlName
      ) || ''
      const model = extractModelName(field.of)

      resolvers[baseName] = resolvers[baseName] || {}
      const resolver = isArray ? internalResolvers[model].references : internalResolvers[model].reference

      resolvers[baseName][fieldName] = (
        source: ResolverSource,
        args: ResolverArgs,
        context: ResolverContext,
        info: ResolverInfo,
      ) => (resolver as ReferenceResolver)({
        source,
        context: context.external,
        info,
        fieldName,
        foreignFieldName: '_id',
        internal: context.internal,
      })
    }
    if (field.type === 'reversed-reference') {
      // Handle reversed reference
      const isArray = field.parent && field.parent.type === 'array'
      const fieldName = (isArray ? (field.parent && field.parent.name) : field.name) || ''
      const baseName = (isArray
        ? field.parent && field.parent.parent && field.parent.parent.graphqlName
        : field.parent && field.parent.graphqlName
      ) || ''
      const model = extractModelName(field.of)

      if (!internalResolvers[model]) {
        throw new ValidationError(`No model found for name ${model}`)
      }

      resolvers[baseName] = resolvers[baseName] || {}
      const resolver = isArray ? internalResolvers[model].references : internalResolvers[model].reference

      resolvers[baseName][fieldName] = (
        source: ResolverSource,
        args: ResolverArgs,
        context: ResolverContext,
        info: ResolverInfo,
      ) => resolver({
        source,
        context: context.external,
        info,
        foreignFieldName: field.on,
        fieldName: '_id',
        internal: context.internal,
      })
    }
    if (field.type === 'schema') {
      // eslint-disable-next-line no-use-before-define
      extractReferences(field as IPropertySchema)
    }
    if (field.type === 'array') {
      extractReference(field.deepOf)
    }
  }

  function extractReferences(schema : IPropertySchema) {
    Object.keys(schema.of)
      .forEach((field) => {
        extractReference(schema.of[field])
      })
  }

  models.forEach((model) => {
    // Create references resolvers from main schema
    extractReferences(model.schemas.main)

    // Create references resolvers from computed schema
    extractReferences(model.schemas.computed)

    // Create resolvers from computed fields
    Object.keys(model.resolvers.computed)
      .forEach((field) => {
        const baseName = extractModelName(model.name)

        resolvers[baseName] = resolvers[baseName] || {}
        resolvers[baseName][field] = computeFieldResolver({
          resolver: model.resolvers.computed[field],
          internalResolvers,
          field,
        })
      })

    // Create queries
    Object.keys(model.resolvers.queries)
      .forEach((field) => {
        resolvers.Query[field] = computeFieldResolver({
          resolver: model.resolvers.queries[field],
          internalResolvers,
          field,
        })
      })

    // Create mutations
    Object.keys(model.resolvers.mutations)
      .forEach((field) => {
        resolvers.Mutation[field] = computeFieldResolver({
          resolver: model.resolvers.mutations[field],
          internalResolvers,
          field,
        })
      })

    // Create custom resolvers
    Object.keys(model.resolvers.custom)
      .forEach((baseName) => {
        resolvers[baseName] = resolvers[baseName] || {}
        Object.keys(model.resolvers.custom[baseName])
          .forEach((field) => {
            resolvers[baseName][field] = computeFieldResolver({
              resolver: model.resolvers.custom[baseName][field],
              internalResolvers,
              field,
            })
          })
      })

    // Create federation resolver
    if (!model.external) {
      resolvers[extractModelName(model.name)] = resolvers[extractModelName(model.name)] || {}
      resolvers[extractModelName(model.name)].__resolveReference = (
        reference: { _id: string }, context: ResolverContext, info: GraphQLResolveInfo,
      ) => (
        internalResolvers[extractModelName(model.name)].reference({
          fieldName: '_id',
          foreignFieldName: '_id',
          source: reference,
          info,
          internal: context.internal,
        })
      )
    }
  })

  resolvers.JSON = GraphQLJson
  resolvers.JSON.name = 'JSON'
  resolvers.Date = GraphQLDate
  resolvers.Date.name = 'Date'
  resolvers.Number = GraphQLLong
  resolvers.Number.name = 'Number'

  return resolvers
}

function makeResolver<Models extends Record<string, Model>>({
  field,
  adapter,
  model,
  type,
  scope,
  transform,
  resolvers,
} : {
  field: string,
  adapter?: IAdapter,
  model: SanitizedModel,
  type: CrudEnum,
  scope?: Scope<any, any, any, any, false>,
  transform?: Transform<any, any, any, any, any, false>,
  resolvers: {
    [model in keyof Models]: ModelResolvers<Models[model]['schema']>;
  },
}) : ScopedInternalResolver {
  if (!adapter) {
    return async () => null
  }

  return async ({
    source, args, context, info,
  } : {
    source?: ResolverSource,
    args: ResolverArgs,
    context: ResolverContext,
    info: ResolverInfo,
  }) => {
    if (!adapter) {
      return () => null
    }

    let error
    let value
    let scopedArgs

    try {
      scopedArgs = ((scope && (await scope({
        args,
        context,
        source,
        info,
        field,
        resolvers: resolvers as any,
      }))) || args)

      value = await adapter[type]({
        args: scopedArgs as any,
        model,
      })
    } catch (err) {
      error = err
    }

    try {
      if (transform) {
        return transform({
          field,
          source,
          args: scopedArgs as any,
          context,
          info: info || {} as ResolverInfo,
          value,
          error,
          resolvers: resolvers as any,
        })
      }
    } catch (err) {
      error = err
    }

    if (error) {
      const apolloError = new ApolloError(error.message, error.name)
      apolloError.extensions.status = error.status
      apolloError.extensions.exception = {
        stacktrace: error.stack.split('\n'),
      }
      throw apolloError
    }

    return value
  }
}

function matchField(field: string|string[], key: string) {
  if (Array.isArray(field)) {
    return !!field.find((f) => String(f) === key)
  }

  return String(field) === key
}

/* eslint-disable no-param-reassign */
function initializeLoader({
  internal,
  model,
  adapter,
  field,
  type,
} : {
  internal: ResolverContext,
  model: SanitizedModel,
  adapter: IAdapter,
  field: string,
  type: 'single'|'multi',
}) {
  internal.loaders = internal.loaders || {}
  internal.loaders[model.name] = internal.loaders[model.name] || {}
  internal.loaders[model.name][type] = internal.loaders[model.name][type] || {}

  if (!internal.loaders[model.name][type][field]) {
    const customerLoader = {
      dataLoader: new DataLoader(async (keys: readonly string[]) => {
        const docs = await adapter.resolveBatch({
          model,
          fieldName: field,
          keys: keys as string[],
        })

        if (type === 'single') {
          return keys.map((k) => docs.find((doc) => doc && matchField(doc[field], String(k))))
        }

        return keys.map((k) => docs.filter((doc) => doc && matchField(doc[field], String(k))))
      }),
      async load(key: any) {
        const stringified = String(key)

        if (stringified === '[object Object]') {
          return key
        }

        return customerLoader.dataLoader.load(key)
      },
      async loadMany(keys: any[]) {
        return Promise.all(keys.map((key) => customerLoader.load(key)))
      },
    }

    internal.loaders[model.name][type][field] = customerLoader
  }

  return internal.loaders[model.name][type][field]
}
/* eslint-enable no-param-reassign */

function makeReferenceResolver({
  adapter, model, type,
} : {
  adapter?: IAdapter, model: SanitizedModel, type: 'resolveRef'|'resolveRefs', scope?: Function,
}) : ReferenceResolver {
  if (!adapter) {
    return async () => null
  }

  return async ({
    source, fieldName, foreignFieldName, internal,
  } : {
    fieldName: string,
    foreignFieldName: string,
    source?: ResolverSource,
    internal: ResolverContext,
  }) => {
    if (model.external) {
      if (foreignFieldName !== '_id') {
        throw new ValidationError('Reversed References cannot be used on an external schema!')
      }

      // In case of an external Federation model, return a Representation
      return {
        resolveRef: () => {
          const element = source && source[fieldName]
          const _id = (element && element._id) ? element._id : element

          if (!_id) {
            return null
          }

          return ({
            __typename: model.schemas.main.graphqlName,
            _id,
          })
        },
        resolveRefs: () => source
          && source[fieldName]
          && Array.isArray(source[fieldName])
          && source[fieldName].map((element: { _id: string }) => {
            const _id = (element && element._id) ? element._id : element

            if (!_id) {
              return null
            }

            return ({
              __typename: model.schemas.main.graphqlName,
              _id,
            })
          })
            .filter((r: any) => !!r),
      }[type]()
    }

    if (!adapter || !source[fieldName]) {
      return null
    }

    if (fieldName !== '_id' && type === 'resolveRef') {
      const loader = initializeLoader({
        internal,
        model,
        adapter,
        field: '_id',
        type: 'single',
      })

      return loader.load(String(source[fieldName]))
    }

    if (fieldName !== '_id' && type === 'resolveRefs') {
      const loader = initializeLoader({
        internal,
        model,
        adapter,
        field: '_id',
        type: 'single',
      })

      const result = await loader.loadMany(
        source[fieldName]
          .filter((s: string) => !!s)
          .map((s: string) => String(s))
          .filter((e : any, i: number, a: any[]) => a.indexOf(e) === i),
      )

      // Filter out null value
      return result.filter((e: any) => !!e)
    }

    if (fieldName === '_id' && type === 'resolveRef') {
      const loader = initializeLoader({
        internal,
        model,
        adapter,
        field: foreignFieldName,
        type: 'single',
      })

      return loader.load(String(source[fieldName]))
    }

    if (fieldName === '_id' && type === 'resolveRefs') {
      const loader = initializeLoader({
        internal,
        model,
        adapter,
        field: foreignFieldName,
        type: 'multi',
      })

      return loader.load(String(source[fieldName]))
    }

    return null
  }
}

export function makeResolvers<Models extends Record<string, Model>>({
  adapter, model, modelResolvers,
} : {
  adapter?: IAdapter
  model: SanitizedModel
  modelResolvers: {
    [model in keyof Models]: ModelResolvers<Models[model]['schema']>;
  }
}) {
  const resolvers :
    Record<AliasCrudEnum, InternalResolver> &
    Record<'reference'|'references', ReferenceResolver> = {} as any

  const rootResolvers = [...queryResolvers, ...mutationResolvers]

  rootResolvers.forEach((res) => {
    resolvers[res.type] = makeResolver({
      type: res.type,
      adapter,
      model,
      scope: model.scopes[res.type],
      transform: model.transforms[res.type],
      field: extractModelName(model.name) + res.suffix,
      resolvers: modelResolvers,
    }) as InternalResolver

    resolvers[res.type].unscoped = makeResolver({
      type: res.type,
      adapter,
      model,
      field: extractModelName(model.name) + res.suffix,
      resolvers: modelResolvers,
    }) as UnscopedInternalResolver

    if (res.alias) {
      res.alias.forEach((alias) => {
        resolvers[alias] = resolvers[res.type]
      })
    }
  })

  resolvers.reference = makeReferenceResolver({
    type: 'resolveRef',
    adapter,
    model,
  })

  resolvers.references = makeReferenceResolver({
    type: 'resolveRefs',
    adapter,
    model,
  })

  return resolvers
}
