import Persistence, { Types } from '@harmonyjs/persistence'
import Server from '@harmonyjs/server'

import AccessorMongoose from '@harmonyjs/accessor-mongoose'

const PreferenceModel = {
  name: 'preference',
  schema: {
    theme: Types.String,
    user: Types.Reference.of('user'),
  },
}

const UserModel = {
  name: 'user',
  schema: {},
  computed: {
    fields: {
      preference: {
        type: Types.Reference.of('preference'),
        needs: ['_id'],
        async resolve({ source, resolvers }) {
          return resolvers.Preference.read({ user: source._id })
        },
      },
    },
  },
  external: true,
}

const persistence = new Persistence()

persistence.init({
  models: [PreferenceModel, UserModel],
  accessors: {
    mongo: new AccessorMongoose({
      host: 'mongodb://mongo:27017/',
      database: 'federated',
    }),
  },
})

const server = new Server()

server.init({
  endpoint: {
    host: 'localhost',
    port: '4002',
  },
  controllers: [
    new persistence.controllers.ControllerGraphQL({
      path: '/',
    }),
  ],
})
