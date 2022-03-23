import is from '@sindresorhus/is'
import {Channel, ConfirmChannel, connect, Connection, Options} from 'amqplib'
import * as Bluebird from 'bluebird'
import {EventEmitter} from 'events'
import {nanoid} from 'nanoid'
import * as os from 'os'
import VError = require('verror')
import {Context} from './context'
import {
  ICarrotMQMessage, IConfig, IConsumer, IConsumeResult, IRPCResult, MakeContentFunction, MessageType, QueueOptions,
} from './types'

const defaultConfig: IConfig = {
  rpcTimeout: 30e3,
  callbackQueue: null,
  appId: `${os.hostname()}:${process.title}:${process.pid}`,
  reconnect: {
    timeout: 3e3,
    times: 5,
  },
}

/**
 * CarrotMQ
 * @extends EventEmitter
 */
export class CarrotMQ extends EventEmitter {
  public config: IConfig
  public connection: Connection
  public ready: boolean
  public isConnecting: boolean = false
  public appId: string
  public readonly channels = new Set<Channel>()

  public decodeContent = decodeContent
  public makeContent: MakeContentFunction = makeContent

  public manualClose: boolean

  private isFirstConnection: boolean = true
  private readyPromise: Promise<void>
  private readonly rpcQueues = new Set<string>()
  private readonly rpcListener = new Map<string, (...args: unknown[]) => unknown>()
  private consumers = new Map<string, Set<IConsumer>>()
  private connectTry = 0

  /**
   * constructor
   * @param {string} uri amqp url
   * @param {IConfig} [config] config
   */
  constructor(
    public readonly uri: string | Options.Connect,
    config: IConfig = defaultConfig,
  ) {
    super()
    this.config = {...defaultConfig, ...config}
    this.appId = this.config.appId
  }

  /**
   * connect to rabbitmq, auto call when construct,or can be called manually when need reconnect
   * @returns {Bluebird.<void>}
   */
  public async connect(): Promise<Connection> {
    this.isConnecting = true
    const connection  = await connect(this.uri)
    this.connection = connection
    connection.on('close', this.onclose.bind(this))
    connection.on('error', (err) => this.emit('error', err))
    const channel = await connection.createChannel()
    if (this.config.callbackQueue) {
      await channel.assertQueue(this.config.callbackQueue.queue, this.config.callbackQueue.options)
    }
    await channel.close()
    this.ready = true
    this.isConnecting = false
    this.manualClose = false
    this.rpcQueues.clear()
    this.rpcListener.clear()
    if (!this.isFirstConnection) {
      // restore consumer
      await this.restoreConsumer()
    }
    this.emit('ready')
    this.isFirstConnection = false
    return connection
  }

  /**
   * attach a consumer on the queue
   * @param {string} queue queue name
   * @param {function} consumer consumer function
   * @param {Options.AssertQueue} [opts] see amqplib#assetQueue
   */
  public async queue(queue: string, consumer: IConsumer, opts?: QueueOptions): Promise<IConsumeResult> {
    await this.awaitReady()
    this.addQueueConsumer(queue, consumer)
    const channel = opts?.channel ?? await this.createChannel(`queue:${queue}`)
    if (!queue.startsWith('amq.') && queue !== this.config.callbackQueue?.queue) {
      await channel.assertQueue(queue, opts)
    }
    const reply = channel.consume(queue, (message) => {
      this.emit('message', {
        queue,
        message,
        channel,
      })

      const content = this.decodeContent({
        content: message.content,
        contentType: message.properties.contentType,
      })
      const ctx = new Context(message, this, content, channel)

      ctx.once('cancel', () => {
        this.removeQueueConsumer(queue, consumer)
      })

      try {
        const result = consumer.call(ctx, ctx.content, ctx)
        if (result && typeof result === 'object' && typeof result.then === 'function') {
          result.then(null, (err) => {
            if (!ctx.isAcked) {
              ctx.reject()
            }
            this.emit('error', err)
          })
        }
      } catch (e) {
        if (!ctx.isAcked) {
          ctx.reject()
        }
        this.emit('error', e)
      }
    })
    const consume = await reply
    return {consumerTag: consume.consumerTag, channel, queue}
  }

  /**
   * send message to the queue
   * @param {string} queue - queue name
   * @param {object|string|buffer} message - object=>JSON.stringify string=>Buffer.from
   * @param {object} [options] - see amqplib#assetQueue
   * @returns {Promise.<void>}
   */
  public async sendToQueue(queue: string, message: MessageType,
    options: Options.Publish & {skipValidate?: boolean} = {}): Promise<void> {
    await this.awaitReady()
    const {content, contentType} = this.makeContent(message, {queue})
    options.contentType = contentType
    options.appId = this.appId
    const channel = await this.createChannel(`sendToQueue:${queue}`)
    channel.sendToQueue(queue, content, options)
    await channel.close()
  }

  /**
   * publish into the exchange
   * @param {string} exchange - exchange name
   * @param {string} routingKey - routingKey
   * @param {object|string|buffer} message
   * @param {object} [options] - see amqplib#publish
   * @returns {Bluebird.<void>}
   */
  public async publish(exchange: string, routingKey: string, message: MessageType,
    options: Options.Publish = {}): Promise<void> {
    await this.awaitReady()
    const {content, contentType} = this.makeContent(message, {exchange, routingKey})
    options.contentType = contentType
    options.appId = this.appId
    const channel = await this.createChannel(`publish:${exchange}`)
    channel.publish(exchange, routingKey, content, options)
    await channel.close()
  }

  /**
   * rpc over exchange
   * @param {string} exchange - exchange name
   * @param {string} routingKey - routing key
   * @param {object|string|buffer} message
   * @param {object} [options] - see amqplib#publish
   * @returns {Bluebird.<void>}
   */
  public async rpcExchange(exchange: string, routingKey: string, message: MessageType,
    options: Options.Publish = {}): Promise<IRPCResult> {
    await this.awaitReady()

    const channel = await this.connection.createChannel()
    const {content, contentType} = this.makeContent(message, {exchange, routingKey})
    const correlationId = nanoid()
    const callbackQueue = `${this.config.callbackQueue.queue}-exchange`
    options.contentType = contentType
    options.appId = this.appId
    options.replyTo = callbackQueue
    options.correlationId = correlationId
    if (!this.rpcQueues.has(callbackQueue)) {
      this.rpcQueues.add(callbackQueue)
      await this.queue(callbackQueue, async (data, ctx) => {
        const correlationId = ctx.properties.correlationId
        const listener = this.rpcListener.get(correlationId)
        if (!listener) {
          this.emit('error', new VError({
            info: {
              correlationId, exchange, routingKey, data, queue: callbackQueue,
            },
          }, 'no such listener'))
        } else {
          listener({data, ctx})
        }
        this.rpcListener.delete(correlationId)
      })
    }
    channel.publish(exchange, routingKey, content, options)
    let rpcResult: IRPCResult

    try {
      const {data, ctx} = await new Bluebird<{data; ctx: Context}>((resolve) => {
        this.rpcListener.set(correlationId, resolve)
      })
        .timeout(this.config.rpcTimeout, 'rpc timeout')
      rpcResult = {
        _ack: false,
        data,
        properties: ctx.properties,
        fields: ctx.fields,
        ack: async () => {
          if (rpcResult._ack) return
          rpcResult._ack = true
          ctx.ack()
        },
      }
      return rpcResult
    } catch (err) {
      if (err instanceof Bluebird.TimeoutError) {
        throw new VError({
          info: {
            exchange, routingKey, data: message,
          },
          cause: err,
        }, 'rpc timeout')
      } else {
        throw err
      }
    } finally {
      if (rpcResult) {
        await rpcResult.ack()
      }
      await channel.close()
    }
  }

  /**
   * rpc call,reply using temp queue
   * @param {string} queue - queue name
   * @param {object|string|buffer} message
   * @param {string} [callbackQueue] 回调队列名
   * @returns {Bluebird.<{data, ack}>}
   */
  public async rpc(queue: string, message: MessageType, callbackQueue?: string): Promise<IRPCResult> {
    await this.awaitReady()
    const {content, contentType} = this.makeContent(message, {queue})
    const channel    = await this.createChannel(`rpc:${queue}`)
    if (!callbackQueue) {
      if (this.config.callbackQueue) {
        callbackQueue = this.config.callbackQueue.queue
      } else {
        callbackQueue = (await channel.assertQueue('', {
          autoDelete: true,
          durable: false,
        })).queue
      }
    }
    const correlationId = nanoid()

    if (!this.rpcQueues.has(callbackQueue)) {
      this.rpcQueues.add(callbackQueue)
      await this.queue(callbackQueue, async (data, ctx) => {
        const correlationId = ctx.properties.correlationId
        const listener = this.rpcListener.get(correlationId)
        if (!listener) {
          ctx.ack()
          this.emit('error', new VError({
            info: {
              correlationId, data, queue: callbackQueue,
            },
          }, 'no such listener'))
        } else {
          listener({data, ctx})
        }
        this.rpcListener.delete(correlationId)
      })
    }

    let rpcResult: IRPCResult
    channel.sendToQueue(queue, content, {
      replyTo: callbackQueue,
      correlationId,
      contentType,
      appId: this.appId,
    })

    try {
      const {data, ctx} = await new Bluebird<{data; ctx: Context}>((resolve) => {
        this.rpcListener.set(correlationId, resolve)
      })
        .timeout(this.config.rpcTimeout, 'rpc timeout')
      rpcResult = {
        _ack: false,
        data,
        properties: ctx.properties,
        fields: ctx.fields,
        ack: async () => {
          if (rpcResult._ack) return
          rpcResult._ack = true
          ctx.ack()
        },
      }
      return rpcResult
    } catch (err) {
      if (err instanceof Bluebird.TimeoutError) {
        throw new VError({
          info: {
            queue, data: message,
          },
          cause: err,
        }, 'rpc timeout')
      } else {
        throw err
      }
    } finally {
      if (rpcResult) {
        await rpcResult.ack()
      }
      await channel.close()
    }
  }

  /**
   * get raw amqplib channel
   * @returns {Bluebird.<Channel>}
   */
  public async createChannel(reason?: string): Promise<Channel> {
    await this.awaitReady()
    const ch = await this.connection.createChannel()
    ch.reason = reason
    ch.on('error', this.emit.bind(this, ['error']))
    this.channels.add(ch)
    ch.on('close', () => {
      this.channels.delete(ch)
    })
    return ch
  }

  public async createConfirmChannel(): Promise<ConfirmChannel> {
    await this.awaitReady()
    const ch = await this.connection.createConfirmChannel()
    ch.on('error', this.emit.bind(this, ['error']))
    return ch
  }

  /**
   * close connection
   */
  public async close(): Promise<void> {
    if (!this.connection) return
    this.manualClose = true
    this.ready = false
    return this.connection.close()
  }

  private async awaitReady(): Promise<void> {
    if (!this.ready) {
      if (!this.isConnecting) throw new Error('no connection')
      if (!this.readyPromise) {
        this.readyPromise = new Promise((resolve) => {
          this.on('ready', resolve)
        })
      }
      await this.readyPromise
    }
  }

  private addQueueConsumer(queue: string, consumer: IConsumer): void {
    let set = this.consumers.get(queue)
    if (!set) {
      set = new Set()
      this.consumers.set(queue, set)
    }
    set.add(consumer)
  }

  private removeQueueConsumer(queue: string, consumer: IConsumer): void {
    const consumers = this.consumers.get(queue)
    consumers.delete(consumer)
  }

  private async restoreConsumer(): Promise<void> {
    for (const [queue, consumers] of this.consumers) {
      for (const consumer of consumers) {
        await this.queue(queue, consumer)
      }
    }
  }

  private onclose(this: CarrotMQ, arg): void {
    this.connection = null
    this.ready = false
    if (!this.manualClose && this.config.reconnect && this.connectTry < this.config.reconnect.times) {
      this.emit('reconnect', arg)
      setTimeout(() => {
        this.connectTry++
        this.connect()
          .catch((err) => this.emit('error', err))
      }, this.config.reconnect.timeout)
    } else {
      this.emit('close', arg)
    }
  }
}

export default CarrotMQ

export {Context, IConfig}

function makeContent(content: MessageType): ICarrotMQMessage {
  if (is.buffer(content)) {
    return {
      content,
      contentType: 'buffer',
    }
  }
  if (is.string(content)) {
    return {
      content: Buffer.from(content, 'utf8'),
      contentType: 'text/plain',
    }
  }
  if (is.undefined(content)) {
    return {
      content: Buffer.from('undefined'),
      contentType: 'undefined',
    }
  }
  if (is.primitive(content) || is.object(content)) {
    return {
      content: Buffer.from(JSON.stringify(content), 'utf8'),
      contentType: 'application/json',
    }
  }
  throw new TypeError('unknown message')
}

function decodeContent(content: ICarrotMQMessage): MessageType {
  switch (content.contentType) {
    case 'application/json':
      return JSON.parse(content.content.toString())
    case 'string':
    case 'text/plain':
      return content.content.toString('utf8')
    case 'undefined':
      return undefined
    case 'buffer':
    default:
      return content.content
  }
}
