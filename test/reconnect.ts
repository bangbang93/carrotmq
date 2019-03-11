import CarrotMQ from '../src'

const {RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST, RABBITMQ_VHOST = ''} = process.env;

const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}/${RABBITMQ_VHOST}`;

const app = new CarrotMQ(uri, null, {
  reconnect: {
    times: 10,
    timeout: 1000,
  }
})

describe('reconnect', function () {
  it('reconnect', async function () {
    let reconnect = false
    app.on('reconnect', () => {
      reconnect = true
    })
    await app.connect()
    await app.connection.close()
    let resolve, reject
    const p = new Promise((r, rj) => {resolve = r; reject = rj})
    app.once('ready', () => {
      if (!reconnect) {
        reject('not reconnect')
      } else {
        resolve()
      }
    })
    return p
  })
})
