import {
  IProperty, IPropertyArray, IPropertyRaw, IPropertySchema, IPropertyUndiscriminated, PropertyType,
} from '@harmonyjs/types-persistence'

import PropertyFactory from 'utils/property/factory'
import Types from 'utils/types'
import { extractModelName } from './utils'

type Operator = {
  name: string
  type: 'inherit' | PropertyType
  array?: boolean
}

const genericOperators : Operator[] = [
  { name: 'eq', type: 'inherit' },
  { name: 'neq', type: 'inherit' },
  { name: 'exists', type: 'boolean' },
  { name: 'in', type: 'inherit', array: true },
  { name: 'nin', type: 'inherit', array: true },
]

const numberOperators : Operator[] = [
  { name: 'gte', type: 'inherit' },
  { name: 'lte', type: 'inherit' },
  { name: 'gt', type: 'inherit' },
  { name: 'lt', type: 'inherit' },
]

const stringOperators : Operator[] = [
  { name: 'regex', type: 'string' },
]

const numberTypes = ['number', 'float', 'date', 'id', 'reference', 'reversed-reference']
const stringTypes = ['string']
const complexTypes = ['array', 'schema']

const memoizedOperators : {[key: string]: string} = {}
const operatorTypes : {[key: string]: IPropertySchema} = {}

function buildArrayIdentifier(property : IProperty) : string {
  if (!complexTypes.includes(property.type)) {
    return property.type
  }

  if (property.type === 'array') {
    return `[${buildArrayIdentifier(property)}]`
  }

  // eslint-disable-next-line no-use-before-define
  return `{${buildSchemaIdentifier((property as IPropertySchema).of)}}`
}

function buildSchemaIdentifier(schema : {[key: string]: IProperty}): string {
  return Object.keys(schema)
    .sort()
    .map((k) => {
      if (!complexTypes.includes(schema[k].type)) {
        return `${k}--${schema[k].type}`
      }

      if (schema[k].type === 'array') {
        return `${k}--[${buildArrayIdentifier((schema[k] as IPropertyArray).of)}]`
      }

      return `${k}--{${buildSchemaIdentifier((schema[k] as IPropertySchema).of)}}`
    })
    .join(',')
}

function createOperator({ operator, type, of } : { operator: Operator, type: PropertyType, of?: any }) {
  const ops = PropertyFactory({
    type: operator.type === 'inherit' ? type : operator.type,
    of,
    name: '',
  })

  return operator.array ? Types.Array.of(ops) : ops
}

function makeOperator(operator : Operator, operators : {[key:string]: IProperty}, property : IProperty) {
  // eslint-disable-next-line no-param-reassign
  operators[operator.name] = createOperator({
    operator,
    type: property.type,
    of: (property as IPropertyUndiscriminated).of,
  });

  (operators[operator.name] as IPropertyUndiscriminated).for((property as IPropertyUndiscriminated).isFor)
}

function createOperatorField({
  property,
} : {
  property: IProperty
}) : IPropertyRaw {
  const operators : {[key:string]: IProperty} = {}

  if (property.type === 'array') {
    const identifier = `[${buildArrayIdentifier(property.of)}]`

    if (!memoizedOperators[identifier]) {
      memoizedOperators[identifier] = `HarmonyJsOperatorInternal${Object.keys(memoizedOperators).length}`
      operatorTypes[memoizedOperators[identifier]] = Types.Schema.of({
        exists: Types.Boolean,
        some: createOperatorField({ property: property.of }),
        all: createOperatorField({ property: property.of }),
      })
    }

    return Types.Raw.of(`${memoizedOperators[identifier]}Input`)
  }

  if (property.type === 'schema') {
    const identifier = `{${buildSchemaIdentifier(property.of)}}`

    if (!memoizedOperators[identifier]) {
      memoizedOperators[identifier] = `HarmonyJsOperatorInternal${Object.keys(memoizedOperators).length}`
      operatorTypes[memoizedOperators[identifier]] = Types.Schema.of({
        // eslint-disable-next-line no-use-before-define
        match: createOperatorType({ schema: property as IPropertySchema }),
      })
    }

    return Types.Raw.of(`${memoizedOperators[identifier]}Input`)
  }

  const identifier = extractModelName(property.type, true)

  if (!memoizedOperators[identifier]) {
    memoizedOperators[identifier] = `HarmonyJsOperator${identifier}`

    genericOperators.forEach((operator) => makeOperator(operator, operators, property))

    if (numberTypes.includes(property.type)) {
      numberOperators.forEach((operator) => makeOperator(operator, operators, property))
    }

    if (stringTypes.includes(property.type)) {
      stringOperators.forEach((operator) => makeOperator(operator, operators, property))
    }

    operatorTypes[memoizedOperators[identifier]] = Types.Schema.of(operators)
  }

  return Types.Raw.of(`${memoizedOperators[identifier]}Input`)
}

export function createOperatorType({ schema } : { schema: IPropertySchema }) {
  const match : {[key: string]: IProperty} = {}
  Object.keys(schema.of)
    .forEach((key) => {
      match[key] = createOperatorField({ property: schema.of[key] })
    })
  return Types.Schema.of(match)
}

export function getOperatorTypes() {
  return operatorTypes
}
