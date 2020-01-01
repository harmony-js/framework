/* global localStorage */

import ApolloBoost, {
  ApolloClient, FetchPolicy, HttpLink, InMemoryCache, ApolloClientOptions,
} from 'apollo-boost'
import Graphql from 'graphql-tag'
import { jsonToGraphQLQuery as JSQ, EnumType } from 'json-to-graphql-query'
import IO from 'socket.io-client'
import {
  MutationType,
  QueryArgs, QueryConfiguration, QueryDefinition, QueryType,
  QuerySelect, QueryArgsMap, QueryCallback, QueryField,
} from '@harmonyjs/types-query'

const transformJSQ = (q: QueryDefinition) => {
  const query = {}

  Object.keys(q)
    .map((key) => ([key, q[key]]))
    .forEach(([name, content]: [string, QueryField | boolean]) => {
      if (typeof content === 'boolean') {
        query[name] = true
      } else {
        query[name] = {
          ...((content.select) || {}),
        }

        if (content.args) {
          query[name].__args = content.args
        }
      }
    })

  return JSQ(query)
}


class Query {
  io = null

  client: ApolloClient<any>

  fetchPolicy = 'network-only'

  currentClient = 0

  scheduledForStop : {[key: string]: any} = {}

  onGoingQueries : {[key: string]: number} = {}

  configure = (params: QueryConfiguration = {}, reactNative = false) => {
    const {
      token, fetchPolicy = 'network-only', endpoint, path,
    } = params

    this.fetchPolicy = fetchPolicy

    const config: {
      headers?: {
        [key: string]: string
      },
      uri?: string,
      link?: HttpLink,
      cache?: InMemoryCache
    } = {}

    if (token) {
      config.headers = {
        authorization: `Bearer ${token}`,
      }
    }

    const host = (endpoint && endpoint.host) || ''
    const port = (endpoint && endpoint.port)


    const graphql = (path && path.graphql) || '/graphql'
    const socket = (path && path.socket) || '/harmonyjs-socket'

    const graphqlPath = (graphql.startsWith('/') ? '' : '/') + graphql
    const socketPath = (socket.startsWith('/') ? '' : '/') + socket

    const portPath = (port ? `:${port}` : '')
    const hostPath = (host.endsWith('/') ? host.slice(0, -1) : host)

    config.uri = hostPath + portPath + graphqlPath
    const socketUri = hostPath + portPath


    if (reactNative) {
      config.link = new HttpLink({
        uri: config.uri,
        headers: config.headers,
      })
      config.cache = new InMemoryCache()
      delete config.uri
      delete config.headers

      this.io = IO(socketUri, {
        path: socketPath,
        transports: ['websocket'],
        jsonp: false,
      })
    } else {
      this.io = IO(socketUri, {
        path: socketPath,
      })
    }

    if (this.client) {
      if (this.onGoingQueries[this.currentClient]) {
        this.scheduledForStop[this.currentClient] = this.client
      } else {
        this.client.stop()
      }
    }

    if (reactNative) {
      this.client = new ApolloClient(config as ApolloClientOptions<null>)
    } else {
      this.client = new ApolloBoost(config)
    }
    this.currentClient += 1
    this.onGoingQueries[this.currentClient] = 0
    this.scheduledForStop[this.currentClient] = false
  }

  query = (q: QueryDefinition) => {
    const runningClient = this.currentClient
    this.onGoingQueries[runningClient] += 1

    return this.client.query({
      query: Graphql(`{ ${transformJSQ(q)} }`),
      fetchPolicy: <FetchPolicy> this.fetchPolicy,
    })
      .then(({ data }) => {
        this.onGoingQueries[runningClient] -= 1
        this.purge(runningClient)

        return data
      })
  }

  mutate = (q: QueryDefinition) => {
    const runningClient = this.currentClient
    this.onGoingQueries[runningClient] += 1

    return this.client.mutate({
      mutation: Graphql(`mutation { ${transformJSQ(q)} }`),
    })
      .then(({ data }) => {
        this.onGoingQueries[runningClient] -= 1
        this.purge(runningClient)

        return data
      })
  }

  purge = (client) => {
    if (this.scheduledForStop[client] && !this.onGoingQueries[client]) {
      this.scheduledForStop[client].stop()
      this.scheduledForStop[client] = false
    }
  }

  mutation = this.mutate

  subscribe = (event, callback) => {
    if (this.io) {
      this.io.on(event, callback)
    }
  }

  unsubscribe = (event, callback) => {
    if (this.io) {
      this.io.off(event, callback)
    }
  }
}

const client = new Query()

export default client

/**
 * Get the correct format for event names
 * @param {string} name - Name of the collection
 * @returns {string} - Formatted name
 */
function eventName(name: string) {
  return `${name.replace(/[A-Z]/g, (m) => m.toLowerCase())}`
}


/**
 * Builders
 */

/*
 * Class QueryBuilderInternal: Create isolated instances of QueryBuilder
 */
class QueryBuilderInternal extends Promise<any> {
  config: {
    filter?: QueryArgs,
    select?: QuerySelect,
    skip?: number,
    limit?: number,
    sort?: EnumType,
  } = {
    filter: null,
    skip: null,
    limit: null,
    sort: null,
    select: null,
  }

  type: QueryType

  model: string

  constructor(type: QueryType, model?: string | null) {
    super(() => {
    })

    this.type = type
    if (model) {
      this.model = model
    }
  }

  validate = () => {
    if (!this.model) {
      throw new Error('Cannot create a query without a model')
    }

    if (!this.type) {
      throw new Error('Cannot create a query without a type of query. Use get(), list() or count()')
    }

    if (!this.config.select && this.type !== 'COUNT') {
      throw new Error('Cannot create a query without selection of fields. Use select()')
    }
  }


  /* Parameter updates */
  where = (filter: QueryArgs) => {
    this.config.filter = filter

    if (this.subscribed) {
      this.subscription()
    }

    return this
  }

  skip = (skip: number) => {
    this.config.skip = skip

    if (this.subscribed) {
      this.subscription()
    }

    return this
  }

  limit = (limit: number = null) => {
    this.config.limit = limit

    if (this.subscribed) {
      this.subscription()
    }

    return this
  }

  sort = (sort: string) => {
    this.config.sort = new EnumType(sort)

    if (this.subscribed) this.subscription()

    return this
  }

  select = (body: QuerySelect) => {
    this.config.select = body

    if (this.subscribed) this.subscription()

    return this
  }


  /* Build query */
  build = (): QueryDefinition => {
    // Check if the query is complete
    this.validate()

    const {
      select, filter, skip, sort, limit,
    } = this.config

    const sanitizedSelect = { ...select }

    // Always select _id, except if specifically set to false
    if (sanitizedSelect && !sanitizedSelect._id === false) {
      sanitizedSelect._id = true
    }

    // Create the request
    const request: QueryField = {
      COUNT: {
        args: { filter },
      },
      LIST: {
        args: {
          filter,
          skip,
          sort,
          limit,
        },
        select: sanitizedSelect,
      },
      GET: {
        args: {
          filter,
          skip,
          sort,
        },
        select: sanitizedSelect,
      },
      SEARCH: {
        args: { query: filter },
        select: sanitizedSelect,
      },
    }[this.type]

    // Get the request name
    const suffix = {
      COUNT: 'Count',
      LIST: 'List',
      GET: '',
      SEARCH: 'Search',
    }[this.type]

    const queryName = this.model + suffix

    // Return the query
    return ({
      [queryName]: request,
    })
  }

  /* Chain query */
  toPromise = () => {
    const request = this.build()

    return new Promise((resolve, reject) => client.query(request)
      .then((response) => resolve(response[Object.keys(request)[0]]))
      .catch((err) => reject(err)))
  }

  then = (callback?: QueryCallback) => this.toPromise().then(callback)

  catch = (callback?: QueryCallback) => this.toPromise().catch(callback)

  finally = (callback?: () => void) => this.toPromise().finally(callback)


  /* Subscribe query */
  subscribed = false

  lastResponse = ''

  subscriptionCallback = null

  subscriptionModels?: Array<string> = null

  subscription = async (force?: boolean) => {
    if (this.subscribed) {
      const request = this.build()
      const response = await client.query(request)
        .then((res) => res[Object.keys(request)[0]])

      const stringifiedResponse = JSON.stringify(response)
      if ((force || stringifiedResponse !== this.lastResponse) && !!this.subscriptionCallback) {
        this.subscriptionCallback(response)
      }

      this.lastResponse = stringifiedResponse
    }
  }

  subscribe = (callback?: QueryCallback, models?: Array<string>) => {
    if (callback) {
      this.subscriptionCallback = callback
    }

    if (models) {
      this.listen(...models)
    }

    // Subscribe to updated list of additional models
    if (this.subscriptionModels) {
      this
        .subscriptionModels
        .forEach((model) => {
          client.unsubscribe(`${eventName(model)}-updated`, this.subscription)
          client.subscribe(`${eventName(model)}-updated`, this.subscription)
        })
    }

    client.unsubscribe(`${eventName(this.model)}-updated`, this.subscription)
    client.subscribe(`${eventName(this.model)}-updated`, this.subscription)

    this.subscribed = true

    this.subscription(true)

    return this
  }

  listen = (...models: Array<string>) => {
    // Unsubscribe from all additional models
    if (this.subscriptionModels) {
      this.subscriptionModels.forEach((model) => {
        client.unsubscribe(`${eventName(model)}-updated`, this.subscription)
      })
    }

    this.subscriptionModels = models

    if (this.subscribed) {
      // Subscribe to updated list of additional models
      if (this.subscriptionModels) {
        this.subscriptionModels.forEach((model) => {
          client.subscribe(`${eventName(model)}-updated`, this.subscription)
        })
      }
    }

    return this
  }

  unsubscribe = () => {
    // Subscribe to updated list of additional models
    if (this.subscriptionModels) {
      this
        .subscriptionModels
        .forEach((model) => {
          client.unsubscribe(`${eventName(model)}-updated`, this.subscription)
        })
    }

    client.unsubscribe(`${eventName(this.model)}-updated`, this.subscription)

    this.subscribed = false

    return this
  }
}

export class QueryBuilder {
  static SORT_ASC = '_ID_ASC'

  static SORT_DESC = '_ID_DESC'

  model?: string

  constructor(model: string = null) {
    this.model = model
  }

  /* Type of requests */
  get(model?: string): QueryBuilderInternal {
    return new QueryBuilderInternal('GET', model || this.model)
  }

  list(model?: string): QueryBuilderInternal {
    return new QueryBuilderInternal('LIST', model || this.model)
  }

  count(model?: string): QueryBuilderInternal {
    return new QueryBuilderInternal('COUNT', model || this.model)
  }

  search(model ?: string): QueryBuilderInternal {
    return new QueryBuilderInternal('SEARCH', model || this.model)
  }
}

export class MutationBuilderInternal extends Promise<any> {
  config: {
    record?: QueryArgs,
    select?: QuerySelect,
    _id?: string,
  } = {
    record: null,
    _id: null,
    select: null,
  }

  type: MutationType

  model: string

  constructor(type: MutationType, model?: string) {
    super(() => {
    })

    this.type = type
    if (model) {
      this.model = model
    }
  }

  validate = () => {
    if (!this.model) {
      throw new Error('Cannot create a mutation without a model')
    }
    if (!this.type) {
      throw new Error('Cannot create a mutation without a type of query. Use create(), update() or delete()')
    }

    if (
      this.type === 'UPDATE'
      && !this.config._id
      && (!this.config.record || (!(<QueryArgsMap> this.config.record)._id))
    ) {
      throw new Error('Cannot update a document without an ID. Use withId()')
    }

    if (this.type === 'DELETE' && !this.config._id) {
      throw new Error('Cannot delete a document without an ID. Use withId()')
    }

    if (this.type === 'CREATE' && !this.config.record) {
      throw new Error('Cannot create a document without content. Use withContent()')
    }
  }


  /* Parameters update */
  withId = (id: string) => {
    this.config._id = id

    return this
  }

  withContent = (record: QueryArgs) => {
    this.config.record = record

    return this
  }


  select = (body: QuerySelect) => {
    this.config.select = body

    return this
  }

  /* Build mutation */
  build = (): QueryDefinition => {
    this.validate()

    const { record, _id, select } = this.config

    const createName = Array.isArray(record) ? 'records' : 'record'

    // Create the request
    const request: QueryArgs = {
      CREATE: {
        args: { [createName]: record },
        select: select || { _id: true },
      },
      UPDATE: {
        args: {
          record: {
            ...(record as QueryArgsMap),
            _id: _id || (record ? (<QueryArgsMap>record)._id : ''),
          },
        },
        select: select || { _id: true },
      },
      DELETE: {
        args: { _id },
        select: select || { _id: true },
      },
    }[this.type]

    // Get the request name
    const suffix = {
      CREATE: Array.isArray(record) ? 'CreateMany' : 'Create',
      UPDATE: 'Update',
      DELETE: 'Delete',
    }[this.type]

    const queryName = this.model + suffix

    // Return the mutation
    return {
      [queryName]: request,
    }
  }

  /* Chain mutation */
  toPromise = () => {
    const request = this.build()

    return new Promise((resolve, reject) => client.mutation(request)
      .then((response) => resolve(response[Object.keys(request)[0]]))
      .catch((err) => reject(err)))
  }

  then = (callback?: QueryCallback) => this.toPromise().then(callback)

  catch = (callback?: QueryCallback) => this.toPromise().catch(callback)

  finally = (callback?: () => void) => this.toPromise().finally(callback)
}

export class MutationBuilder {
  model?: string

  constructor(model: string = null) {
    this.model = model
  }

  /* Type of requests */
  create = (model?: string): MutationBuilderInternal => new MutationBuilderInternal('CREATE', model || this.model)

  update = (model?: string): MutationBuilderInternal => new MutationBuilderInternal('UPDATE', model || this.model)

  delete = (model?: string): MutationBuilderInternal => new MutationBuilderInternal('DELETE', model || this.model)
}


export class Controller {
  query: QueryBuilder

  mutate: MutationBuilder

  constructor(model: string) {
    this.query = new QueryBuilder(model)
    this.mutate = new MutationBuilder(model)
  }
}

export { EnumType } from 'json-to-graphql-query'
