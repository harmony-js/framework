import {
  SchemaTypes, SchemaType, SchemaDefinition, SchemaTypeOpts,
} from 'mongoose'

import {
  IProperty, IPropertyArray, IPropertySchema,
} from '@harmonyjs/types-persistence'

const MongooseTypeMap : Record<string, typeof SchemaType> = {
  boolean: SchemaTypes.Boolean,
  date: SchemaTypes.Date,
  float: SchemaTypes.Number,
  id: SchemaTypes.ObjectId,
  json: SchemaTypes.Mixed,
  number: SchemaTypes.Number,
  string: SchemaTypes.String,
}

function toMongooseType(
  prop : IProperty,
  extractAdapterType: (adapter: string) => typeof SchemaType,
) : SchemaType | SchemaDefinition {
  if (['nested', 'array'].includes(prop.type)) {
    return toMongooseSchema(prop, extractAdapterType, true) // eslint-disable-line
  }

  if (prop.type === 'reference') {
    return {
      type: extractAdapterType(prop.isFor),
      ref: prop.of as string,
      index: prop.isIndexed,
      unique: prop.isUnique,
    } as SchemaTypeOpts<typeof SchemaType>
  }

  return {
    type: MongooseTypeMap[prop.type as string] || SchemaTypes.Mixed,
    unique: prop.isUnique,
    index: prop.isIndexed,
  } as SchemaTypeOpts<typeof SchemaTypes.Mixed>
}

// eslint-disable-next-line import/prefer-default-export
export function toMongooseSchema(
  schema : IProperty,
  extractAdapterType?: (adapter: string) => typeof SchemaType,
  nested : boolean = false,
) : SchemaDefinition|SchemaDefinition[''] {
  const mongooseSchema : SchemaDefinition = {}
  const noExtractAdapterType = () => SchemaTypes.ObjectId

  if (schema.type === 'schema') {
    Object.entries((schema as IPropertySchema|IPropertyArray).of || {})
      .forEach(([key, prop] : [string, IProperty]) => {
        if (prop.type === 'schema') {
          mongooseSchema[key] = {
            type: toMongooseSchema(prop, extractAdapterType, true),
            unique: prop.isUnique,
            index: prop.isIndexed,
          }
        } else if (prop.type === 'array') {
          mongooseSchema[key] = {
            type: [toMongooseSchema(prop.of as IProperty, extractAdapterType, true)],
            unique: prop.isUnique,
            index: prop.isIndexed,
            default: undefined,
          }

          if (prop.isRequired) {
            (mongooseSchema[key] as SchemaTypeOpts<any>).default = []
          }
        } else {
          mongooseSchema[key] = toMongooseType(prop, extractAdapterType || noExtractAdapterType)
        }
      })

    if (!mongooseSchema._id && nested) {
      // @ts-ignore
      mongooseSchema._id = false
    }
  } else if (schema.type === 'array') {
    return {
      type: [toMongooseSchema(schema.of as IPropertySchema, extractAdapterType, true)] as any,
      unique: schema.isUnique,
      index: schema.isIndexed,
    }
  } else {
    return toMongooseType(schema, extractAdapterType || noExtractAdapterType) as SchemaDefinition
  }

  return mongooseSchema
}
