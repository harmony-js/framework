// Resolver enums
import { GraphQLResolveInfo } from 'graphql'
import {
  Schema, SchemaInputType, SchemaOperatorType, SchemaOutputType,
} from 'property'

export type CrudEnum = 'read'|'readMany'|'count'|'create'|'createMany'|'update'|'updateMany'|'delete'|'deleteMany'
export type AliasCrudEnum = CrudEnum|'get'|'find'|'list'|'edit'|'editMany'

// Helpers
export type FilterArgs<CurrentSchema extends Schema> = Partial<SchemaInputType<CurrentSchema> & {
  _and?: FilterArgs<CurrentSchema>[]
  _or?: FilterArgs<CurrentSchema>[]
  _nor?: FilterArgs<CurrentSchema>[]
  _operators?: SchemaOperatorType<CurrentSchema>
} & (
  unknown extends CurrentSchema['_id'] ? { _id?: string } : {}
)>

export type SortArgs<CurrentSchema extends Schema> = {
  [key in keyof CurrentSchema]?: CurrentSchema[key] extends Schema ? SortArgs<CurrentSchema[key]> : number
}

export type CreateRecordArgs<CurrentSchema extends Schema> = SchemaInputType<CurrentSchema> & (
  unknown extends CurrentSchema['_id'] ? { _id?: string } : {}
)
export type UpdateRecordArgs<CurrentSchema extends Schema> = Partial<SchemaInputType<CurrentSchema>> & (
  unknown extends CurrentSchema['_id'] ? { _id: string } : {}
)

type OutputType<CurrentSchema extends Schema> = SchemaOutputType<CurrentSchema> & (
  unknown extends CurrentSchema['_id'] ? { _id: string } : {}
)

export type HarmonyFilterType<CurrentSchema extends Schema> = FilterArgs<CurrentSchema>
export type HarmonySortType<CurrentSchema extends Schema> = SortArgs<CurrentSchema>
export type HarmonyCreateType<CurrentSchema extends Schema> = CreateRecordArgs<CurrentSchema>
export type HarmonyUpdateType<CurrentSchema extends Schema> = CreateRecordArgs<CurrentSchema>

export type ExtendedArgs<
  Extension extends AliasCrudEnum|'reference',
  CurrentSchema extends Schema
  > = (
  CrudEnum extends Extension ? any :
  'count' extends Extension ? { filter?: FilterArgs<CurrentSchema> } :

  'read' extends Extension ? { filter?: FilterArgs<CurrentSchema>, skip?: number, sort?: SortArgs<CurrentSchema> } :
  'get' extends Extension ? { filter?: FilterArgs<CurrentSchema>, skip?: number, sort?: SortArgs<CurrentSchema> } :
  'find' extends Extension ? { filter?: FilterArgs<CurrentSchema>, skip?: number, sort?: SortArgs<CurrentSchema> } :

  'readMany' extends Extension
    ? { filter?: FilterArgs<CurrentSchema>, skip?: number, limit?: number, sort?: SortArgs<CurrentSchema> } :
  'list' extends Extension
    ? { filter?: FilterArgs<CurrentSchema>, skip?: number, limit?: number, sort?: SortArgs<CurrentSchema> } :

  'create' extends Extension ? { record: CreateRecordArgs<CurrentSchema> } :
  'createMany' extends Extension ? { records: CreateRecordArgs<CurrentSchema>[] } :

  'update' extends Extension ? { record: UpdateRecordArgs<CurrentSchema> } :
  'updateMany' extends Extension ? { records: UpdateRecordArgs<CurrentSchema>[] } :

  'edit' extends Extension ? { record: UpdateRecordArgs<CurrentSchema> } :
  'editMany' extends Extension ? { records: UpdateRecordArgs<CurrentSchema>[] } :

  'delete' extends Extension ? { _id: string } :
  'deleteMany' extends Extension ? { _ids: string[] } :

  any
)

export type ExtendedType<
  Extension extends AliasCrudEnum|'reference',
  CurrentSchema extends Schema
  > = (
  CrudEnum extends Extension ? any :
  'count' extends Extension ? number :

  'read' extends Extension ? OutputType<CurrentSchema>|null :
  'get' extends Extension ? OutputType<CurrentSchema>|null :
  'find' extends Extension ? OutputType<CurrentSchema>|null :

  'readMany' extends Extension ? OutputType<CurrentSchema>[] :
  'list' extends Extension ? OutputType<CurrentSchema>[] :

  'create' extends Extension ? OutputType<CurrentSchema>|null :
  'createMany' extends Extension ? OutputType<CurrentSchema>[] :

  'update' extends Extension ? OutputType<CurrentSchema>|null :
  'updateMany' extends Extension ? OutputType<CurrentSchema>[] :

  'edit' extends Extension ? OutputType<CurrentSchema>|null :
  'editMany' extends Extension ? OutputType<CurrentSchema>[] :

  'delete' extends Extension ? OutputType<CurrentSchema>|null :
  'deleteMany' extends Extension ? OutputType<CurrentSchema>[] :

  any
  )


// Internal Resolvers
export type ScopedInternalResolver = (arg: {
  source?: any
  args: {[key: string]: any}
  context: {[key: string]: any}
  info: GraphQLResolveInfo
}) => Promise<{[key: string]: any}|null>
export type UnscopedInternalResolver = (arg: {
  source?: any
  args: {[key: string]: any},
  context?: {[key: string]: any}
}) => Promise<{[key: string]: any}|null>
export type InternalResolver = ScopedInternalResolver & { unscoped: UnscopedInternalResolver }

export type ReferenceResolver = (params: {
  source: any
  context?: {[key: string]: any}
  internal: {[key: string]: any}
  info?: GraphQLResolveInfo

  fieldName: string,
  foreignFieldName: string
}) => Promise<{[key: string]: any}|null>

export type InternalResolvers =
  Record<AliasCrudEnum, InternalResolver> &
  Record<'reference'|'references', ReferenceResolver>


// Model Resolvers
export type ModelResolver<
  Args extends {[key: string]: any} = {[key: string]: any},
  Return extends any = any
> = ((args: Args) => Promise<Return>)
export type ScopedModelResolver<
  Args extends {[key: string]: any} = {[key: string]: any},
  Return extends any = any
> = ModelResolver<Args, Return> & { unscoped: ModelResolver<Args, Return> }

export type ScopedModelResolvers<CurrentSchema extends Schema = any> = {
  [key in AliasCrudEnum|'reference']: 'reference' extends key
    ? ((args: string | { toString(): string }) => Promise<OutputType<CurrentSchema>|null>)
    : ScopedModelResolver<
      ExtendedArgs<key, CurrentSchema>,
      ExtendedType<key, CurrentSchema>
    >
}
export type ModelResolvers<CurrentSchema extends Schema = any> = {
  [key in AliasCrudEnum]: ModelResolver<
    ExtendedArgs<key, CurrentSchema>,
    ExtendedType<key, CurrentSchema>
  >
}


// Resolvers
export type Resolver<
  Source extends any = any,
  Args extends {[key: string]: any}|undefined = {[key: string]: any},
  Return extends any = any,
  Context extends any = any,
  Schemas extends { [key: string]: Schema } = any,
  > = (params: {
  source: Source
  args: Args
  context: Context
  info: GraphQLResolveInfo

  resolvers: {[schema in keyof Schemas]: ScopedModelResolvers<Schemas[schema]>}
  field: string
}) => Promise<Return>

export type Resolvers<
  Context extends any = any,
  Schemas extends { [key: string]: Schema } = any,
> = {
  [field: string]: Resolver<any, any, any, Context, Schemas>
}


// Scopes
export type Scope<
  Context extends any = any,
  Schemas extends { [key: string]: Schema }|undefined = any,
  Source extends any = any,
  Args extends {[key: string]: any}|undefined = {[key: string]: any},
  FullResolvers extends boolean = true,
  > = (params: {
  source: Source
  args: Args
  context: Context
  info: GraphQLResolveInfo

  field: string
} & (false extends FullResolvers ? {
  resolvers: {[schema in keyof Schemas]: ModelResolvers<NonNullable<Schemas>[schema]>}
} : {
  resolvers: {[schema in keyof Schemas]: ScopedModelResolvers<NonNullable<Schemas>[schema]>}
})) => Promise<(Args|undefined|void)>

export type Scopes<
  Context = any,
  Schemas extends { [key: string]: Schema }|undefined = any,
  CurrentSchema extends Schema = any,
  > = {
  [R in CrudEnum]?: Scope<
    Context, Schemas, CurrentSchema, ExtendedArgs<R, CurrentSchema>, false
  >
}


// Transforms
export type Transform<
  Context extends any = any,
  Schemas extends { [key: string]: Schema }|undefined = any,
  Source extends any = any,
  Args extends {[key: string]: any}|undefined = {[key: string]: any},
  Return extends any = any,
  FullResolvers extends boolean = true,
  > = (params: {
  source: Source
  args: Args
  context: Context
  info: GraphQLResolveInfo

  field: string
  value: Return|null
  error: Error|null
} & (false extends FullResolvers ? {
  resolvers: {[schema in keyof Schemas]: ModelResolvers<NonNullable<Schemas>[schema]>}
} : {
  resolvers: {[schema in keyof Schemas]: ScopedModelResolvers<NonNullable<Schemas>[schema]>}
})) => Promise<(Return|undefined|void)>

export type Transforms<
  Context = any,
  Schemas extends { [key: string]: Schema }|undefined = any,
  CurrentSchema extends Schema = any,
  > = {
  [R in CrudEnum]?: Transform<
    Context, Schemas, CurrentSchema, ExtendedArgs<R, CurrentSchema>, ExtendedType<R, CurrentSchema>, false
  >
}
