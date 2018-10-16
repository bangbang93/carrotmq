import * as amqplib from 'amqplib'
import {EventEmitter} from 'events'
import * as Bluebird from 'bluebird'
import {ValidationError} from './lib/ValidationError'
import {Channel, ConfirmChannel, Connection, Options, Replies} from 'amqplib'
import {ICarrotMQMessage, IConfig, IConsumer, IContext, IRPCResult, MessageType} from './types'

import rabbitmqSchema = require('rabbitmq-schema')
import * as os from 'os'

const defaultConfig: IConfig = {
  rpcTimeout: 30e3,
  callbackQueue: null,
  appId: `${os.hostname()}:${process.title}:${process.pid}`
}

/**
 * CarrotMQ
 * @extends EventEmitter
 */
export class CarrotMQ extends EventEmitter {
  public uri: string
  public schema: rabbitmqSchema | null
  public config: IConfig
  public connection: Connection
  public ready: boolean
  public isConnecting: boolean = false
  public appId: string
  public readonly channels = new Set<Channel>()

  public manualClose: boolean

  private isFirstConnection: boolean = true
  private readyPromise: Promise<void>
  private readonly rpcQueues = new Set<string>()
  private readonly rpcListener = new Map<string, Function>()

  /**
   * constructor
   * @param {string} uri amqp url
   * @param {rabbitmqSchema|null} [schema] rabbitmq-schema
   * @param {IConfig} [config] config
   */
  constructor(uri: string, schema?: rabbitmqSchema, config:IConfig = defaultConfig) {
    super()
    if (schema && !(schema instanceof rabbitmqSchema)) {
      throw new TypeError('arguments must be rabbitmqSchema')
    }
    this.uri    = uri
    this.schema = schema
    this.config = {...defaultConfig, ...config}
    this.appId = this.config.appId
  }

  /**
   * connect to rabbitmq, auto call when construct,or can be called manually when need reconnect
   * @returns {Bluebird.<void>}
   */
  async connect(): Promise<Connection>{
    this.isConnecting = true
    let connection  = await amqplib.connect(this.uri)
    this.connection = connection
    connection.on('close', onclose.bind(this))
    connection.on('error', (err) => this.emit('error', err))
    let channel = await connection.createChannel()
    if (this.schema) {
      let exchanges = this.schema.getExchanges()
      for(const exchange of exchanges) {
        await channel.assertExchange(exchange.exchange, exchange.type, exchange.options)
        let bindings = exchange.getDirectBindings()
        for(const binding of bindings) {
          let dest = binding.destination
          let src  = binding.source
          if (dest.queue) {
            await channel.assertQueue(dest.queue, dest.options)
            await channel.bindQueue(dest.queue, src.exchange, binding.routingPattern)
          }
          if (dest.exchange) {
            await channel.assertExchange(dest.exchange, dest.type, dest.options)
            await channel.bindExchange(dest.exchange, src.exchange, binding.routingPattern)
          }
        }
      }
    }
    if (this.config.callbackQueue) {
      await channel.assertQueue(this.config.callbackQueue.queue, this.config.callbackQueue.options)
    }
    await channel.close()
    this.ready = true
    this.isConnecting = false
    this.manualClose = false
    this.rpcQueues.clear()
    this.rpcListener.clear()
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
  async queue(queue: string, consumer: IConsumer, opts?: Options.AssertQueue) {
    await this.awaitReady()
    const channel = await this.createChannel(`queue:${queue}`)
    if (!queue.startsWith('amq.')
      && (!this.schema || (this.schema && !this.schema.getQueueByName(queue)))
      && this.config.callbackQueue && queue !== this.config.callbackQueue.queue) {
      await channel.assertQueue(queue, opts)
    }
    let consume: Replies.Consume
    const reply = channel.consume(queue, (message) => {
      this.emit('message', {
        queue,
        message,
        channel,
      })
      const ctx: IContext = {
        replyTo: null,
        content: null,
        message,
        fields    : message.fields,
        properties: message.properties,
        carrotmq: this,
        channel,
        _isAcked: false,
        reply: (msg, options?) => {
          let replyTo = ctx.replyTo || message.properties.replyTo
          if (!replyTo){
            throw new Error('empty reply queue')
          }
          options = Object.assign(message.properties, options, {appId: this.appId})
          return this.sendToQueue(replyTo, msg, options)
        },
        ack (allUpTo?) {
          if (ctx._isAcked) throw new Error('already acked')
          ctx._isAcked = true
          return channel.ack(message, allUpTo)
        },
        nack (allUpTo?, requeue?) {
          if (ctx._isAcked) throw new Error('already acked')
          ctx._isAcked = true
          return channel.nack(message, allUpTo, requeue)
        },
        reject (requeue?) {
          if (ctx._isAcked) throw new Error('already acked')
          ctx._isAcked = true
          return channel.reject(message, requeue)
        },
        async cancel () {
          if (!ctx._isAcked) throw new Error('cannot cancel before ack')
          await channel.cancel(message.fields['consumerTag'])
          await channel.close();
        },
      }
      ctx.content = decodeContent({
        content: message.content,
        contentType: message.properties.contentType
      })

      if (this.schema && this.schema.getQueueByName(queue)) {
        try {
          this.schema.validateMessage(queue, ctx.content)
        } catch (e) {
          const err = new ValidationError(message, channel, queue, e)
          if (this.listenerCount(`validationError:${queue}`) !== 0){
            return this.emit(`validationError:${queue}`, err)
          }
          if (message.properties.replyTo){
            return ctx.reply({err})
              .then(() => ctx.ack())
          } else {
            return ctx.ack()
          }
        }
      }

      try {
        let result = consumer.call(ctx, ctx.content, ctx)
        if (result && typeof result === 'object' && typeof result.then === 'function'){
          result.then(null, (err) => {
            if (!ctx._isAcked) {
              ctx.reject()
            }
            ctx._isAcked = true
            this.emit('error', err)
          })
        }
      } catch (e) {
        if (!ctx._isAcked) {
          ctx.reject()
        }
        ctx._isAcked = true
        this.emit('error', e)
      }
    })
    consume = await reply
    return {consumerTag: consume.consumerTag, channel}
  }

  /**
   * send message to the queue
   * @param {string} queue - queue name
   * @param {object|string|buffer} message - object=>JSON.stringify string=>Buffer.from
   * @param {object} [options] - see amqplib#assetQueue
   * @returns {Promise.<void>}
   */
  async sendToQueue(queue: string, message: MessageType,
                    options: Options.Publish & {skipValidate?: boolean} = {}): Promise<void> {
    await this.awaitReady()
    const skipValidate = options ? options.skipValidate : false
    if (!skipValidate && this.schema && this.schema.getQueueByName(queue)) {
      try {
        this.schema.validateMessage(queue, message)
      } catch (e) {
        throw new ValidationError(message, null, queue, e)
      }
    }
    const {content, contentType} = makeContent(message)
    options.contentType = contentType
    options.appId = this.appId
    const channel = await this.createChannel(`sendToQueue:${queue}`)
    await channel.sendToQueue(queue, content, options)
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
  async publish(exchange: string, routingKey: string, message: MessageType, options: Options.Publish = {}) {
    await this.awaitReady()
    if (this.schema && this.schema.getExchangeByName(exchange)) {
      this.schema.validateMessage(exchange, routingKey, message)
    }
    const {content, contentType} = makeContent(message)
    options.contentType = contentType
    options.appId = this.appId
    const channel = await this.createChannel(`publish:${exchange}`)
    await channel.publish(exchange, routingKey, content, options)
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
  async rpcExchange(exchange: string, routingKey: string, message: MessageType,
                    options: Options.Publish = {}): Promise<IRPCResult> {
    await this.awaitReady()

    if (this.schema && this.schema.getExchangeByName(exchange)) {
      this.schema.validateMessage(exchange, routingKey, message)
    }
    let channel = await this.connection.createChannel()
    const {content, contentType} = makeContent(message)
    const correlationId = Math.random().toString(16).substr(2)
    const callbackQueue = this.config.callbackQueue.queue
    options.contentType = contentType
    options.appId = this.appId
    options.replyTo = callbackQueue
    options.correlationId = correlationId
    if (!this.rpcQueues.has(callbackQueue)) {
      this.rpcQueues.add(callbackQueue)
      await this.queue(callbackQueue, async (data, ctx) => {
        const correlationId = ctx.properties.correlationId
        const listener = this.rpcListener.get(correlationId)
        if (!listener) return ctx.nack()
        listener({data, ctx})
        this.rpcListener.delete(correlationId)
      })
    }
    await channel.publish(exchange, routingKey, content, options)
    let rpcResult:IRPCResult

    try {
      const {data, ctx} = await new Bluebird<{data, ctx: IContext}>((resolve) => {
        this.rpcListener.set(correlationId, resolve)
      })
        .timeout(this.config.rpcTimeout, 'rpc timeout')
      const rpcResult: IRPCResult = {
        _ack: false,
        data,
        properties: ctx.properties,
        fields: ctx.fields,
        ack: async () => {
          if (rpcResult._ack) return
          rpcResult._ack = true
          await ctx.ack()
        }
      }
      return rpcResult
    } catch (err) {
      if (err instanceof Bluebird.TimeoutError) {
        err['cause'] = err
        err['exchange'] = exchange
        err['data'] = message
      }
      throw err
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
  async rpc(queue: string, message: MessageType, callbackQueue?: string):Promise<IRPCResult> {
    await this.awaitReady()
    if (this.schema && this.schema.getQueueByName(queue)) {
      this.schema.validateMessage(queue, message)
    }
    const {content, contentType} = makeContent(message)
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
    const correlationId = Math.random().toString(16).substr(2)

    if (!this.rpcQueues.has(callbackQueue)) {
      this.rpcQueues.add(callbackQueue)
      await this.queue(callbackQueue, async (data, ctx) => {
        const correlationId = ctx.properties.correlationId
        const listener = this.rpcListener.get(correlationId)
        if (!listener) return ctx.nack()
        listener({data, ctx})
        this.rpcListener.delete(correlationId)
      })
    }

    let rpcResult:IRPCResult
    await channel.sendToQueue(queue, content, {
      replyTo: callbackQueue,
      correlationId,
      contentType,
      appId: this.appId,
    })

    try {
      const {data, ctx} = await new Bluebird<{data, ctx: IContext}>((resolve) => {
        this.rpcListener.set(correlationId, resolve)
      })
        .timeout(this.config.rpcTimeout, 'rpc timeout')
      const rpcResult: IRPCResult = {
        _ack: false,
        data,
        properties: ctx.properties,
        fields: ctx.fields,
        ack: async () => {
          if (rpcResult._ack) return
          rpcResult._ack = true
          await ctx.ack()
        }
      }
      return rpcResult
    } catch (err) {
      if (err instanceof Bluebird.TimeoutError) {
        err['cause'] = err
        err['queue'] = queue
        err['data'] = message
      }
      throw err
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
  async createChannel(reason?: string): Promise<Channel> {
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

  async createConfirmChannel(): Promise<ConfirmChannel> {
    await this.awaitReady()
    const ch = await this.connection.createConfirmChannel()
    ch.on('error', this.emit.bind(this, ['error']))
    return ch
  }

  /**
   * close connection
   */
  close() {
    if (!this.connection) return
    this.manualClose = true
    return this.connection.close()
  }

  private async awaitReady() {
    if(!this.ready) {
      if (!this.isConnecting) throw new Error('no connection')
      if (!this.readyPromise) {
        this.readyPromise = new Promise((resolve) => {
          this.on('ready', resolve)
        })
      }
      await this.readyPromise
    }
  }

  public static schema: rabbitmqSchema = rabbitmqSchema
  public static ValidationError = ValidationError
  public static validationError = ValidationError
}

export default CarrotMQ

function makeContent(content: MessageType): ICarrotMQMessage{
  switch (true) {
    case Buffer.isBuffer(content):
      return {
        content,
        contentType: 'buffer'
      }
    case typeof content === 'string':
      return {
        content: Buffer.from(content, 'utf8'),
        contentType: 'text/plain'
      }
    case typeof content === 'undefined':
      return {
        content: Buffer.from('undefined'),
        contentType: 'undefined'
      }
    case typeof content === 'boolean':
    case typeof content === 'number':
    case typeof content === 'object':
      return {
        content: Buffer.from(JSON.stringify(content), 'utf8'),
        contentType: 'application/json'
      }
    default:
      throw new TypeError('unknown message')
  }
}

function decodeContent(content: ICarrotMQMessage): MessageType {
  switch (content.contentType) {
    case 'application/json':
      return JSON.parse(content.content)
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

function onclose (arg) {
  this.connection = null
  this.ready = false
  this.emit('close', arg)
}
