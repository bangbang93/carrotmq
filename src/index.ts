/**
 * Created by bangbang93 on 16-3-2.
 */


'use strict'
import * as amqplib from 'amqplib'
import {EventEmitter} from 'events'
import * as Bluebird from 'bluebird'
import {ValidationError} from './lib/ValidationError'
import {Channel, Connection, Options, Replies} from 'amqplib'
import {ICarrotMQMessage, IConfig, IConsumer, IContext, IRPCResult, MessageType} from './types'

import rabbitmqSchema = require('rabbitmq-schema')
import * as os from 'os'

const defaultConfig: IConfig = {
  rpcTimeout: 30e3,
  callbackQueue: null,
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
  public appId: string

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
    this.appId = `${os.hostname()}:${process.title}:${process.pid}`
    this.connect().catch((err) => {
      this.emit('error', err)
    })
  }

  /**
   * connect to rabbitmq, auto call when construct,or can be called manually when need reconnect
   * @returns {Bluebird.<void>}
   */
  async connect(): Promise<Connection>{
    let connection  = await amqplib.connect(this.uri)
    this.connection = connection
    connection.on('close', onclose.bind(this))
    connection.on('error', this.emit.bind(this, ['error']))
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
    this.ready = true
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
   * @param {boolean} [rpcQueue=false] is queue for rpc
   * @param {object} [opts] see amqplib#assetQueue
   */
  async queue(queue: string, consumer:IConsumer, rpcQueue:boolean = false, opts:object = null) {
    let that = this
    if (!that.ready){
      await new Bluebird(function (resolve) {
        that.on('ready', resolve)
      })
    }
    if (!opts && typeof rpcQueue === 'object'){
      opts = rpcQueue
      rpcQueue = false
    }
    const channel = await this.createChannel()
    if (!queue.startsWith('amq.')
      && (!this.schema || (this.schema && !this.schema.getQueueByName(queue)))
      && queue !== this.config.callbackQueue.queue) {
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
        reply (msg, options?) {
          let replyTo = ctx.replyTo || message.properties.replyTo
          if (!replyTo){
            throw new Error('empty reply queue')
          }
          options = Object.assign(message.properties, options, {appId: that.appId})
          return that.sendToQueue(replyTo, msg, options)
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
      if (rpcQueue) {
        const content = decodeContent({
          content: message.content,
          contentType: message.properties.contentType
        })
        ctx.replyTo = content.replyTo
        ctx.content = content.content
      } else {
        ctx.content = decodeContent({
          content: message.content,
          contentType: message.properties.contentType
        })
      }

      if (this.schema && this.schema.getQueueByName(queue)) {
        try {
          this.schema.validateMessage(queue, ctx.content)
        } catch (e) {
          const err = new ValidationError(message, channel, queue, e)
          if (this.listenerCount(`validationError:${queue}`) !== 0){
            return this.emit(`validationError:${queue}`, err)
          }
          if (rpcQueue || message.properties.replyTo){
            ctx.reply({err})
          }
          return ctx.ack()
        }
      }

      try {
        let result = consumer.call(ctx, ctx.content, ctx)
        if (result && typeof result === 'object' && typeof result.catch === 'function'){
          result.catch((err)=>{
            if (!ctx._isAcked) {
              ctx.reject()
            }
            ctx._isAcked = true
            that.emit('error', err)
          })
        }
      } catch (e) {
        if (!ctx._isAcked) {
          ctx.reject()
        }
        ctx._isAcked = true
        that.emit('error', e)
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
    let that = this
    if (!that.ready){
      await new Bluebird(function (resolve) {
        that.on('ready', resolve)
      })
    }
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
    const channel = await this.createChannel()
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
    const channel = await this.createChannel()
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
  async rpcExchange(exchange: string, routingKey: string, message: MessageType, options: Options.Publish = {}):Promise<IRPCResult> {
    let that = this
    await this.awaitReady()
    if (this.schema && this.schema.getExchangeByName(exchange)) {
      this.schema.validateMessage(exchange, routingKey, message)
    }
    let channel = await that.connection.createChannel()
    let replyQueue = await channel.assertQueue('', {
      autoDelete: true,
      durable: false,
    })
    const {content, contentType} = makeContent({
      content: message,
      replyTo: replyQueue.queue,
    })
    options.contentType = contentType
    options.appId = this.appId
    await channel.publish(exchange, routingKey, content, options)
    let ctx:IRPCResult
    return new Bluebird<IRPCResult>(function (resolve, reject) {
      return that.queue(replyQueue.queue, function (data) {
        this.cancel()
        const _ack = this.ack
        ctx = {
          _ack: false,
          data,
          properties: ctx.properties,
          fields: ctx.fields,
          ack () {
            if (this._acked) return
            this._acked = true
            return _ack.call(this)
          }
        }
        return resolve(ctx)
      })
    })
      .timeout(this.config.rpcTimeout, 'rpc timeout')
      .catch(Bluebird.TimeoutError, async (e) => {
        await channel.deleteQueue(replyQueue.queue)
        throw e
      })
      .finally(() => {
        ctx && ctx.ack()
        return channel.close()
      })
  }

  /**
   * rpc call,reply using temp queue
   * @param {string} queue - queue name
   * @param {object|string|buffer} message
   * @param {string} [callbackQueue] 回调队列名
   * @returns {Bluebird.<{data, ack}>}
   */
  async rpc(queue: string, message: MessageType, callbackQueue?: string):Promise<IRPCResult> {
    let that = this
    await this.awaitReady()
    if (this.schema && this.schema.getQueueByName(queue)) {
      this.schema.validateMessage(queue, message)
    }
    const {content, contentType} = makeContent(message)
    let channel    = await that.connection.createChannel()
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
    await channel.sendToQueue(queue, content, {
      replyTo: callbackQueue,
      correlationId,
      contentType,
      appId: this.appId,
    })
    let rpcResult:IRPCResult
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
    return new Bluebird<IRPCResult>(async (resolve) => {
      const defer = Bluebird.defer<{data, ctx: IContext}>()
      this.rpcListener.set(correlationId, defer.resolve.bind(defer))
      const {data, ctx} = await defer.promise
      rpcResult = {
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
      resolve(rpcResult)
    })
      .timeout(this.config.rpcTimeout, 'rpc timeout')
      .catch(Bluebird.TimeoutError, (err) => {
        let e = new Error('rpc timeout')
        e['cause'] = err
        e['queue'] = queue
        e['data'] = message
        throw e
    })
      .finally(async () => {
        if (rpcResult) {
          await rpcResult.ack()
        }
        await channel.close()
      })
  }

  /**
   * get raw amqplib channel
   * @returns {Bluebird.<Channel>}
   */
  async createChannel(): Promise<Channel> {
    await this.awaitReady()
    const ch = await this.connection.createChannel()
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
        content: new Buffer(content, 'utf8'),
        contentType: 'text/plain'
      }
    case typeof content === 'undefined':
      return {
        content: new Buffer('undefined'),
        contentType: 'undefined'
      }
    case typeof content === 'boolean':
    case typeof content === 'number':
    case typeof content === 'object':
      return {
        content: new Buffer(JSON.stringify(content), 'utf8'),
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
