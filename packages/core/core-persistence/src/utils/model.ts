import {
  ComputedField, ComputedQuery, IProperty, IPropertyID, IPropertySchema, IPropertyUndiscriminated,
  Model, PropertyMode, Resolver, Resolvers, SanitizedModel, Schema, Scopes,
} from '@harmonyjs/types-persistence'

import { ApolloError } from 'apollo-server-core'

import PropertyFactory from 'utils/property/factory'

import { createOperatorType } from 'utils/property/operators'
import { sanitizeSchema, sanitizeSchemaField } from 'utils/property/sanitation'
import { extractModelName, wrap } from 'utils/property/utils'
import { mutationResolvers, queryResolvers, ResolverDefinition } from 'utils/resolvers'

import Types from 'utils/types'

function extendField(field: ComputedQuery, modelName: string): { type?: IProperty, args?: Schema } {
  switch (field.extends) {
    case 'read': {
      return {
        type: PropertyFactory({ type: 'raw', of: modelName, name: modelName }),
        args: {
          filter: PropertyFactory({ type: 'raw', of: `${modelName}FilterInput`, name: `${modelName}Filter` }),
          skip: Types.Number,
          sort: PropertyFactory({ type: 'raw', of: `${modelName}SortInput`, name: `${modelName}Sort` }),
        },
      }
    }
    case 'readMany': {
      return {
        type: Types.Array.of(PropertyFactory({ type: 'raw', of: modelName, name: '' })),
        args: {
          filter: PropertyFactory({ type: 'raw', of: `${modelName}FilterInput`, name: `${modelName}Filter` }),
          skip: Types.Number,
          limit: Types.Number,
          sort: PropertyFactory({ type: 'raw', of: `${modelName}SortInput`, name: `${modelName}Sort` }),
        },
      }
    }
    case 'count': {
      return {
        type: Types.Number,
        args: {
          filter: PropertyFactory({ type: 'raw', of: `${modelName}FilterInput`, name: `${modelName}Filter` }),
        },
      }
    }
    case 'create': {
      return {
        type: PropertyFactory({ type: 'raw', of: modelName, name: '' }),
        args: {
          record: PropertyFactory({ type: 'raw', of: `${modelName}CreateInput`, name: `${modelName}Create` }).required,
        },
      }
    }
    case 'createMany': {
      return {
        type: Types.Array.of(PropertyFactory({ type: 'raw', of: modelName, name: '' })),
        args: {
          records: Types.Array.of(
            PropertyFactory({ type: 'raw', of: `${modelName}CreateInput`, name: `${modelName}Create` }).required,
          ).required,
        },
      }
    }
    case 'update': {
      return {
        type: PropertyFactory({ type: 'raw', of: modelName, name: '' }),
        args: {
          record: PropertyFactory({ type: 'raw', of: `${modelName}UpdateInput`, name: `${modelName}Update` }).required,
        },
      }
    }
    case 'updateMany': {
      return {
        type: Types.Array.of(PropertyFactory({ type: 'raw', of: modelName, name: '' })),
        args: {
          records: Types.Array.of(
            PropertyFactory({ type: 'raw', of: `${modelName}UpdateInput`, name: `${modelName}Update` }).required,
          ).required,
        },
      }
    }
    case 'delete': {
      return {
        type: PropertyFactory({ type: 'raw', of: modelName, name: '' }),
        args: {
          _id: Types.ID.required,
        },
      }
    }
    case 'deleteMany': {
      return {
        type: Types.Array.of(PropertyFactory({ type: 'raw', of: modelName, name: '' })),
        args: {
          _ids: Types.Array.of(Types.ID.required).required,
        },
      }
    }
    default:
      break
  }

  return {}
}

function extractMainSchema({ schema, name }: { schema: Schema, name: string }) {
  const sanitized = sanitizeSchema({ schema, name })

  Object.keys(sanitized.of)
    .forEach((key) => {
      if (sanitized.of[key].mode.length < 1) {
        sanitized.of[key].mode.push(PropertyMode.OUTPUT)
        sanitized.of[key].mode.push(PropertyMode.INPUT)
      }
    })

  return sanitized
}

function extractComputedSchema({
  fields, name,
} : {
  fields?: {[key: string]: ComputedField}, name: string
}) {
  const schema: Schema = {}

  if (!fields) {
    return PropertyFactory({ type: 'schema', name, of: {} })
  }

  Object.keys(fields)
    .forEach((key) => {
      schema[key] = fields[key].type
    })

  const sanitized = sanitizeSchema({ schema, name })

  Object.keys(sanitized.of)
    .forEach((key) => {
      if (fields[key] && fields[key].args) {
        sanitized.of[key].withArgs(sanitizeSchema({ schema: fields[key].args!, name: 'args' }))
      }

      if (fields[key] && fields[key].mode) {
        sanitized.of[key].withMode(wrap(fields[key].mode))
      }

      if (sanitized.of[key].mode.length < 1) {
        sanitized.of[key].mode.push(PropertyMode.OUTPUT)
      }
    })

  return sanitized
}

function extractRootSchema({
  fields, name, baseName, base, external, strict, scopes,
} : {
  fields: {[key: string]: ComputedQuery},
  name: string,
  baseName: string,
  base: ResolverDefinition[],
  external: boolean,
  strict: boolean,
  scopes: Scopes
}) {
  const schema : Schema = {}

  // Fill schema with default queries
  base.forEach((res) => {
    if (!external && (!strict || scopes[res.type])) {
      const { type, args } = extendField(
        { extends: res.type, resolve: null as any },
        extractModelName(name),
      )

      schema[extractModelName(name, false) + res.suffix] = sanitizeSchemaField({
        schema: type!,
        name: '',
      })
        .withArgs(args!)
    }
  })

  // Fill schema with provided queries
  Object.keys(fields).forEach((queryName) => {
    const field : ComputedQuery = fields[queryName]

    const { type, args } = field.extends ? extendField(field, extractModelName(name)) : field

    const property = sanitizeSchemaField({
      schema: field.type || type || {},
      name: queryName,
    })

    if (args || field.args) {
      property.withArgs(field.args || args || {})
    }

    property.withMode([PropertyMode.OUTPUT])

    schema[queryName] = property
  })

  return extractMainSchema({ schema, name: baseName })
}

function extractResolvers({ fields }: {
  fields: {[key: string]:ComputedQuery}|{[key: string]:ComputedField}
}): Resolvers {
  const resolvers: Resolvers = {}

  Object.keys(fields).forEach((field) => {
    if (fields[field].resolve) {
      const resolve = fields[field].resolve!
      const { scopes, transforms } = fields[field]

      if (!scopes && !transforms) {
        resolvers[field] = resolve as any
      } else {
        resolvers[field] = async (params: Parameters<Resolver>[0]) => {
          let { args } = params

          let error = null
          let value = null

          try {
            // Chain all scopes function to get the final args
            if (scopes) {
              // eslint-disable-next-line no-restricted-syntax
              for (const scope of scopes) {
                // eslint-disable-next-line no-await-in-loop
                args = (await scope({
                  ...params, args: args as any, field,
                })) || args
              }
            }

            // Run main resolver function
            value = await resolve({
              ...params, args, field,
            } as any)
          } catch (err) {
            // Throwing in a scope stops the subsequent scopes and the resolver from running
            error = err
          }

          try {
            if (transforms) {
              // eslint-disable-next-line no-restricted-syntax
              for (const transform of transforms) {
                // eslint-disable-next-line no-await-in-loop
                value = (await transform({
                  ...params, args: args as any, value, error, field,
                })) || value
              }
            }
          } catch (err) {
            // Throwing in a transform stops the subsequent transforms from running
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
    }
  })

  return resolvers
}

// eslint-disable-next-line import/prefer-default-export
export function sanitizeModel({
  model, strict, name, defaultAdapter,
}: {
  model: Model, strict: boolean, name: string, defaultAdapter: string,
}): SanitizedModel {
  const {
    adapter, schema, computed, external, scopes, transforms, ...otherProps
  } = model

  return ({
    ...otherProps,
    name,
    adapter: adapter || defaultAdapter,
    schemas: {
      main: extractMainSchema({
        schema, name,
      }),
      computed: extractComputedSchema({
        fields: computed && computed.fields, name,
      }),
      queries: extractRootSchema({
        fields: (computed && computed.queries) || {},
        name,
        baseName: 'Query',
        base: queryResolvers,
        external: !!external,
        strict,
        scopes: scopes || {} as any,
      }),
      mutations: extractRootSchema({
        fields: (computed && computed.mutations) || {},
        name,
        baseName: 'Mutation',
        base: mutationResolvers,
        external: !!external,
        strict,
        scopes: scopes || {} as any,
      }),
    },
    resolvers: {
      queries: extractResolvers({ fields: (computed && computed.queries) || {} }),
      mutations: extractResolvers({ fields: (computed && computed.mutations) || {} }),
      computed: extractResolvers({ fields: (computed && computed.fields) || {} }),
      custom: (computed && computed.custom) || {},
    },
    scopes: scopes || {},
    transforms: transforms || {},
    external: !!external,
  })
}


export function typeIdsAndReferences({ models } : { models: SanitizedModel[] }) {
  /* eslint-disable no-param-reassign */
  function typeIdsAndReferencesForProperty(model: SanitizedModel, field: IProperty) {
    // If field is an ID, set the isFor
    if (field.type === 'id' && field.isFor === '') {
      field.for(model.adapter)
    }

    // If field is an Reference, set the isFor
    if ((field.type === 'reference' || field.type === 'reversed-reference') && field.isFor === '') {
      const fieldModel = models.find((m) => m.name === field.of)

      field.for((fieldModel || model).adapter)
    }

    // If field is an Array, set isFor for Array.of
    if (field.type === 'array') {
      typeIdsAndReferencesForProperty(model, field.of)
    }

    // If field is a Schema, set isFor for Schema.of
    if (field.type === 'schema') {
      // eslint-disable-next-line no-use-before-define
      typeIdsAndReferencesForSchema(model, field.of)
    }

    // Anyway, set isFor for args
    if ((field as IPropertyUndiscriminated).__configuration.args) {
      // eslint-disable-next-line no-use-before-define
      typeIdsAndReferencesForSchema(model, (field as IPropertyUndiscriminated).__configuration.args!.of)
    }
  }
  /* eslint-enable no-param-reassign */

  function typeIdsAndReferencesForSchema(model: SanitizedModel, schema: {[key: string]: IProperty}) {
    Object.keys(schema).forEach((key: string) => typeIdsAndReferencesForProperty(model, schema[key]))
  }

  models.forEach((model) => {
    typeIdsAndReferencesForSchema(model, model.schemas.main.of)
    typeIdsAndReferencesForSchema(model, model.schemas.computed.of)
    typeIdsAndReferencesForSchema(model, model.schemas.queries.of)
    typeIdsAndReferencesForSchema(model, model.schemas.mutations.of)
  })
}

export function printSchema({ model, prefix }: { model: SanitizedModel, prefix: string }) {
  const outputSchema: Schema = {}
  const inputFilterSchema: Schema = {}
  const inputSortSchema: Schema = {}
  const inputCreateSchema: Schema = {}
  const inputUpdateSchema: Schema = {}

  // Allow sorting by nested fields
  const toInputSortSchema = (schema : IPropertySchema) => {
    const sortSchema: Schema = {}

    Object.keys(schema.of)
      .forEach((prop) => {
        if (schema.of[prop].type === 'schema') {
          sortSchema[prop] = toInputSortSchema(schema.of[prop] as IPropertySchema)
        } else {
          sortSchema[prop] = Types.Number
        }
      })

    return Types.Schema.of(sortSchema)
  }

  // Divide schema keys between input fields and output fields
  const extract = (schema: { [key: string]: IProperty }) => {
    Object.keys(schema)
      .forEach((key) => {
        const { mode } = schema[key]
        if (mode.includes(PropertyMode.OUTPUT) || mode.length < 1) {
          outputSchema[key] = schema[key].clone()
        }
        if (mode.includes(PropertyMode.INPUT) || mode.length < 1) {
          inputFilterSchema[key] = schema[key].clone()
          if (!['schema'].includes(schema[key].type)) {
            inputSortSchema[key] = Types.Number
          } else if (schema[key].type === 'schema') {
            inputSortSchema[key] = toInputSortSchema(schema[key] as IPropertySchema)
          }
          inputCreateSchema[key] = schema[key].clone()
          inputUpdateSchema[key] = schema[key].clone();

          // Mark all inputUpdate and inputFilter fields as optional
          (inputFilterSchema[key] as IPropertyUndiscriminated).__configuration.required = false;
          (inputUpdateSchema[key] as IPropertyUndiscriminated).__configuration.required = false
        }
      })
  }

  // Populate using main schema
  extract(model.schemas.main.of)
  // Populate using compute schema, computed overrides main
  extract(model.schemas.computed.of)

  // Add _id to filter, sort and create schemas
  inputFilterSchema._id = (inputFilterSchema._id as IPropertyID || Types.ID).for(model.adapter)
  inputSortSchema._id = (inputSortSchema._id as IPropertyID || Types.ID).for(model.adapter)
  inputCreateSchema._id = (inputCreateSchema._id as IPropertyID || Types.ID).for(model.adapter)

  // Add _id.required to update schema and output schema
  outputSchema._id = (outputSchema._id as IPropertyID || Types.ID).required.for(model.adapter)
  outputSchema._id = model.external ? outputSchema._id.external : outputSchema._id
  inputUpdateSchema._id = (inputUpdateSchema._id as IPropertyID || Types.ID).required.for(model.adapter)

  // Create _operators before adding _and/_or/_nor
  const ops = createOperatorType({ schema: sanitizeSchema({ schema: inputFilterSchema, name: '' }), prefix })

  // Add _and, _or, _nor to inputFilterSchema
  inputFilterSchema._and = Types.Array.of(
    PropertyFactory({ type: 'raw', of: `${extractModelName(model.name)}FilterInput`, name: '' }),
  )
  inputFilterSchema._or = Types.Array.of(
    PropertyFactory({ type: 'raw', of: `${extractModelName(model.name)}FilterInput`, name: '' }),
  )
  inputFilterSchema._nor = Types.Array.of(
    PropertyFactory({ type: 'raw', of: `${extractModelName(model.name)}FilterInput`, name: '' }),
  )

  // Add _operators to inputFilterSchema
  inputFilterSchema._operators = ops

  const inputs = model.external ? '' : `
# Filter Schema
${sanitizeSchema({ schema: inputFilterSchema, name: `${model.name}Filter` }).graphqlInputSchema}  

# Sort Schema
${sanitizeSchema({ schema: inputSortSchema, name: `${model.name}Sort` }).graphqlInputSchema}  

# Create Schema
${sanitizeSchema({ schema: inputCreateSchema, name: `${model.name}Create` }).graphqlInputSchema}  

# Update Schema
${sanitizeSchema({ schema: inputUpdateSchema, name: `${model.name}Update` }).graphqlInputSchema}`

  return `
${inputs}

# Output Schema
${
  sanitizeSchema({ schema: outputSchema, name: model.name }).graphqlSchema.replace(
    `type ${extractModelName(model.name)} {`,
    model.external
      ? `extend type ${extractModelName(model.name)} @key(fields: "_id") {`
      : `type ${extractModelName(model.name)} @key(fields: "_id") {`,
  )
}

# Queries & Mutations
${
  model.schemas.queries.graphqlSchema.replace(
    'type Query {',
    'extend type Query {',
  )
}
${
  model.schemas.mutations.graphqlSchema.replace(
    'type Mutation {',
    'extend type Mutation {',
  )
}
`.replace(/\n\n/g, '\n')
}
