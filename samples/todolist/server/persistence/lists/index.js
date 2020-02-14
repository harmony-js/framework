import schema from './schema'
import computed from './computed'

export default {
  name: 'list',
  schema,
  computed,

  elasticsearch: {
    fields: {
      name: {
        type: 'text',
        value(doc) {
          return doc.name
        },
      },
    },
  },
}
