/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict'
import * as amqplib from 'amqplib'
import rabbitmqSchema = require('rabbitmq-schema')
import {EventEmitter} from 'events'
import * as Bluebird from 'bluebird'
import {ValidationError} from './lib/ValidationError'
import {Channel, Connection, Options} from 'amqplib'

const noop = () => {}

export interface IConfig {
  rpcTimeout?: number
}

interface IContent {
  message: any,
  fields: object,
  properties: object,
  replyTo: string,
  content: Buffer | object,
  carrotmq: CarrotMQ,
  channel: Channel,
  _isAcked: boolean,
  reply(msg: any, options?: Options.Publish),
  ack(allUpTo?: boolean),
  nack(allUpTo?: boolean, requeue?: boolean),
  reject(requeue?: boolean),
  cancel()
}

const defaultConfig: IConfig = {
  rpcTimeout: 30e3,
}

/**
 * CarrotMQ
 * @extends EventEmitter
 */
export class CarrotMQ extends EventEmitter {
  public uri: string
  public schema: rabbitmqSchema
  public config: IConfig
  public connection: Connection
  public ready: boolean

  private _manualClose: boolean
  /**
   * constructor
   * @param {string} uri amqp url
   * @param {rabbitmqSchema|null} [schema] rabbitmq-schema
   * @param {object} config config
   */
  constructor(uri, schema, config:IConfig = {}) {
    if (schema && !(schema instanceof rabbitmqSchema)) {
      throw new TypeError('arguments must be rabbitmqSchema')
    }
    super()
    this.uri    = uri
    this.schema = schema
    this.config = Object.assign(defaultConfig, config) as IConfig
    this.connect().catch((err) => {
      this.emit(err)
    })
    this.on('message', noop)
    this.on('ready', noop)
  }

  /**
   * connect to rabbitmq, auto call when construct,or can be called manually when need reconnect
   * @returns {Bluebird.<void>}
   */
  async connect(){
    let connection  = await amqplib.connect(this.uri)
    this.connection = connection
    connection.on('close', onclose.bind(this))
    connection.on('error', this.emit.bind(this, 'error'))
    let channel     = await connection.createChannel()
    if (!this.schema) {
      this.ready = true
      this.emit('ready')
      return
    }
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
    this.ready = true
    this._manualClose = false
    this.emit('ready')
  }

  /**
   * attach a consumer on the queue
   * @param {string} queue queue name
   * @param {function} consumer consumer function
   * @param {boolean} [rpcQueue=false] is queue for rpc
   * @param {object} [opts] see amqplib#assetQueue
   * @returns {Bluebird.<{ticket, queue, consumerTag, noLocal, noAck, exclusive, nowait, arguments}>}
   */
  async queue(queue, consumer, rpcQueue = false, opts = null) {
    let that = this
    if (!that.ready){
      return new Bluebird(function (resolve) {
        that.on('ready', ()=>that.queue(queue, consumer, rpcQueue, opts).then(resolve))
      })
    }
    if (!opts && typeof rpcQueue === 'object'){
      opts = rpcQueue
      rpcQueue = false
    }
    const channel = await this.connection.createChannel()
    if ((!queue.startsWith('amq.') && this.schema && !this.schema.getQueueByName(queue))
      || !this.schema) {
      channel.assertQueue(queue, opts)
    }
    return channel.consume(queue, (message)=>{
      this.emit('message', {
        queue,
        message,
        channel,
      })
      const ctx: IContent = {
        replyTo: null,
        content: null,
        message,
        fields    : message.fields,
        properties: message.properties,
        carrotmq: this,
        channel,
        _isAcked: false,
        reply (msg, options) {
          let replyTo = ctx.replyTo || message.properties.replyTo
          if (!replyTo){
            throw new Error('empty reply queue')
          }
          options = Object.assign(message.properties, options)
          return that.sendToQueue(replyTo, msg, options)
        },
        ack (allUpTo) {
          ctx._isAcked = true
          return channel.ack(message, allUpTo)
        },
        nack (allUpTo, requeue) {
          ctx._isAcked = true
          return channel.nack(message, allUpTo, requeue)
        },
        reject (requeue) {
          ctx._isAcked = true
          return channel.reject(message, requeue)
        },
        cancel () {
          ctx._isAcked = true
          return channel.cancel(message.fields.consumerTag)
          //channel.close();
        },
      }
      if (rpcQueue) {
        let content = JSON.parse(message.content.toString())
        ctx.replyTo = content.replyTo
        ctx.content = new Buffer(content.content.data)
        ctx.content = JSON.parse(ctx.content.toString())
      } else {
        ctx.content = JSON.parse(message.content.toString())
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
        let result = consumer.call(ctx, ctx.content)
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
  }

  /**
   * send message to the queue
   * @param {string} queue - queue name
   * @param {object|string|buffer} message - object=>JSON.stringify string=>Buffer.from
   * @param {object} [options] - see amqplib#assetQueue
   * @returns {Bluebird.<void>}
   */
  async sendToQueue(queue, message, options) {
    let that = this
    if (!that.ready){
      return new Bluebird(function (resolve) {
        that.on('ready', ()=>that.sendToQueue(queue, message, options).then(resolve))
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
    message = makeContent(message)
    const channel = await this.connection.createChannel()
    await channel.sendToQueue(queue, message, options)
    channel.close()
  }

  /**
   * publish into the exchange
   * @param {string} exchange - exchange name
   * @param {string} routingKey - routingKey
   * @param {object|string|buffer} content
   * @param {object} [options] - see amqplib#publish
   * @returns {Bluebird.<void>}
   */
  async publish(exchange, routingKey, content, options) {
    let that = this
    if (!that.ready){
      return new Bluebird(function (resovle) {
        that.on('ready', ()=>that.publish(exchange, routingKey, content, options).then(resovle))
      })
    }
    if (this.schema && this.schema.getExchangeByName(exchange)) {
      this.schema.validateMessage(exchange, routingKey, content)
    }
    content = makeContent(content)
    const channel = await this.connection.createChannel()
    await channel.publish(exchange, routingKey, content, options)
    channel.close()
  }

  /**
   * rpc over exchange
   * @param {string} exchange - exchange name
   * @param {string} routingKey - routing key
   * @param {object|string|buffer} content
   * @param {object} [options] - see amqplib#publish
   * @returns {Bluebird.<void>}
   */
  async rpcExchange(exchange, routingKey, content, options) {
    let that = this
    if (!that.ready){
      return new Bluebird(function (resolve) {
        that.on('ready', ()=>that.rpcExchange(exchange, routingKey, content, options).then(resolve))
      })
    }
    if (this.schema && this.schema.getExchangeByName(exchange)) {
      this.schema.validateMessage(exchange, routingKey, content)
    }
    content = makeContent(content)
    let channel = await that.connection.createChannel()
    let replyQueue = await channel.assertQueue('', {
      autoDelete: true,
      durable: false,
    })
    content = makeContent({
      content,
      replyTo: replyQueue.queue,
    })
    await channel.publish(exchange, routingKey, content, options)
    let ctx
    return new Bluebird(function (resolve, reject) {
      that.queue(replyQueue.queue, function (data) {
        ctx = this
        this.cancel()
        this.data = data
        const _ack = this.ack
        this.ack = function () {
          if (this._acked) return
          this._acked = true
          return _ack.call(this)
        }
        return resolve(this)
      })
    })
      .timeout(this.config.rpcTimeout, 'rpc timeout')
      .finally(() => {
        ctx && ctx.ack()
        channel.close()
      })
  }

  /**
   * rpc call,reply using temp queue
   * @param {string} queue - queue name
   * @param {object|string|buffer} content
   * @returns {Bluebird.<{data, ack}>}
   */
  async rpc(queue, content) {
    let that = this
    if (!that.ready){
      return new Bluebird(function (resolve) {
        that.on('ready', ()=>that.rpc(queue, content).then(resolve))
      })
    }
    if (this.schema && this.schema.getQueueByName(queue)) {
      this.schema.validateMessage(queue, content)
    }
    content = makeContent(content)
    let channel    = await that.connection.createChannel()
    let replyQueue = await channel.assertQueue('', {
      autoDelete: true,
      durable   : false,
    })
    await channel.sendToQueue(queue, content, {replyTo: replyQueue.queue})
    let ctx
    return new Bluebird(function (resolve) {
      that.queue(replyQueue.queue, function (data) {
        ctx = {}
        this.cancel()
        ctx.data = data
        const _ack = this.ack
        ctx.ack = function () {
          if (this._acked) return
          this._acked = true
          return _ack.call(this)
        }
        return resolve(ctx)
      })
    })
      .timeout(this.config.rpcTimeout, 'rpc timeout')
      .finally(() => {
        ctx && ctx.ack()
        channel.close()
      })
  }

  /**
   * get raw amqplib channel
   * @returns {Bluebird.<Channel>}
   */
  createChannel() {
    let that = this
    if (!that.ready){
      return new Bluebird(function (resolve) {
        that.on('ready', ()=>that.createChannel().then(resolve))
      })
    }
    return this.connection.createChannel()
  }

  /**
   * close connection
   */
  close() {
    if (!this.connection) return
    this._manualClose = true
    return this.connection.close()
  }

  public static schema: rabbitmqSchema = rabbitmqSchema
  public static ValidationError = ValidationError
  public static validationError = ValidationError
}

export default CarrotMQ

function makeContent(content){
  if (typeof content === 'object'){
    return new Buffer(JSON.stringify(content), 'utf8')
  } else if (typeof content === 'string') {
    return new Buffer(content, 'utf8')
  } else if (!Buffer.isBuffer(content)){
    throw new TypeError('unknown message')
  } else {
    return content
  }
}

function onclose (arg) {
  this.connection = null
  this.ready = false
  this.emit('close', arg)
}
