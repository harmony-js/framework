---
title: HarmonyJS Server
sidebar_label: "@harmonyjs/server"
---

`@harmonyjs/server` handles the creation and runtime of a Node webserver. Under the hood, it uses Fastify, but there is no
need to know Fastify in order to start using HarmonyJS.

_**Note:** [Fastify](https://www.fastify.io/docs/latest/Getting-Started/) knowledge is necessary to write your own [Controller Plugins](/plugins/controllers)_


## Default export

`@harmonyjs/server` default export is the `Server() : ServerInstance` factory.

This factory allows us to create a [`ServerInstance`](#serverinstance) object, which can be configured to expose our application's webserver.

<b style={{display: "block", marginBottom: "-1.5rem" }}>Sample usage</b>

```typescript
import Server from '@harmonyjs/server'

async function run() {
    // Create a new Server instance
    const server = Server()

    console.log('Launching the server...')

    // Start our server
    try {
        await server.initialize({
            endpoint: {
                host: '0.0.0.0',
                port: 80,
            },
        })

        console.log('Server launched!')
    }
    catch (err) {
        console.log('An error occurred while launching the server')
        console.error(err)
    }
}

run()
```

## Other exports

### `HttpErrors`

`@harmonyjs/server` only exports one other object: the `HttpErrors` helper.

This helpers allows throwing HTTP-compliant errors from inside custom routes or resolvers. All standard HTTP error codes
are supported, with the following syntax:

```typescript
import { HttpErrors } from '@harmonyjs/server'

// Example throwing an Unauthorized error:
throw HttpErrors.Unauthorized('Some custom message')

// Example throwing a NotImplemented error:
throw HttpErrors.NotImplemented('Some custom message')
```

All thrown `HttpErrors` are gracefully caught by the underlying server, and the correct status code is return for the
current request, along with the given custom message.

## Exported types

Here is the list of all types exported by the `@harmonyjs/server` package, related to the server instance itself.

`@harmonyjs/server` also export types related to [Controllers](/plugins/controllers), but those are described in the Controllers documentation.

### `ServerConfig`

The `ServerConfig` object allows us to configure the server before running it. Here are the available options:
```typescript
type ServerConfig = {
  endpoint: {
    host: string
    port: number
  }
  socket: {
    path: string
  }
  cluster?: {
    redis: {
      key?: string
      host?: string
      port?: number
    }
  }
  controllers: IController[]
  log: LoggerConfig
}
```
> Jump to:
[`IController`](/plugins/controllers#icontroller),
[`LoggerConfig`](/docs/api/logger#loggerconfig)

#### `ServerConfig::endpoint`

The endpoint field allows to choose the host and port to run the server on. Omitting this field will launch
a server on `localhost:3000` by default.

This field takes two subfields, `endpoint.host` and `endpoint.port`

To expose the server to the outside world, for instance when running inside Docker, `endpoint.host` should be set
to `'0.0.0.0'`

#### `ServerConfig::socket`

Field configuring the Socket.IO instance. The only available parameter is the `path` on which Socket.IO will connect. Defaults to `'/harmonyjs-socket'`

#### `ServerConfig::cluster`

The cluster configuration define how the app should handle replication, such as in a Kubernetes environment.

The main point configured is the replication of Socket.IO connections used by the framework. The `cluster` configuration entry
allows to configure the adapter to use for replication. As of now, only a Redis adapter has been implemented, so the only
available field is `cluster.redis`

##### `ServerConfig::cluster::redis`

Configure the Redis adapter used for handling replication.

Under the hood, HarmonyJS uses Socket.IO for client->server communication. The Redis adapter allows to insure that messages
are spread to all clients, whichever the emitting server, and vice-versa.

It takes three optional parameters:

- `key`: the identifier of the Redis sync cache. Defaults to `'harmony'`. <br/>
Use this key if you intend to run multiple HarmonyJS applications on the same cluster or using the same Redis server.
- `host`: the hostname on which to access the Redis server. Defaults to `'localhost'`.
- `port`: the port on which the Redis server is running. Defaults to `6379`.

#### `ServerConfig::controllers`

The controllers array contains a list of Controllers. Controllers are HarmonyJS plugins allowing to describe how to handle
specific routes, such as serving a static directory, routing to an SPA or exposing a GraphQL endpoint.

To find more information about Controllers, refer to [their documentation](/plugins/controllers).

#### `ServerConfig::log`

Configuration of the way the server instance logs its actions. Refer to the [Log util documentation](/docs/api/logger#loggerconfig)

<br />

---

### `ServerInstance`

The `ServerInstance` type represents the object returned when instantiating an `@harmonyjs/server`. It mostly exposes
lifecycle functions, as well as underlying elements such as the Fastify server for advanced customization.

After creating a new `ServerInstance`, only the `initialize` field is available. Accessing any other field will throw.
Other fields become available _after_ calling `ServerInstance::initialize`.

```typescript
type ServerInstance = {
  readonly configuration: ServerConfig
  readonly logger: ILogger

  readonly server: FastifyInstance
  readonly socket: SocketIO.Server

  initialize(configuration: Partial<ServerConfig>): Promise<void>
  close(): Promise<void>
}
```
> Jump to:
[`ServerConfig`](#serverconfig),
[`ILogger`](/docs/api/logger#ilogger),
[`FastifyInstance`](https://www.fastify.io/docs/latest/Server/#server-methods),
[`SocketIO.Server`](https://socket.io/docs/server-api/)

#### `ServerInstance::configuration`

Expose the currently applied configuration, which is the result of a merge between the configuration passed during initialization,
and the default configuration.

#### `ServerInstance::logger`

Expose the underlying logger, in order to be able to add custom logs using the Server namespace.

#### `ServerInstance::server`

Expose the underlying Fastify instance, if needed for advanced customization.

#### `ServerInstance::socket`

Expose the underlying Socket.IO instance, if needed for advanced customization.

#### `ServerInstance::initialize`

Function accepting a ServerConfig object and launching the server instance with the given configuration.

The function actually takes a Partial representation of a ServerConfig object, meaning that each field is optional.
Non-provided mandatory fields will be filled with sensible default values.

Returns a Promise resolving once everything has finished booting.

#### `ServerInstance::close`

Function for cleanly closing all the components of the server instance.

Returns a Promise resolving once everything has finished closing.
