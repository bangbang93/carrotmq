/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
const amqplib        = require('amqplib');
const rabbitmqSchema = require('rabbitmq-schema');
const EventEmitter   = require('events').EventEmitter;
const ValidationError  = require('./lib/ValidationError');
const Promise = require('bluebird');

const noop = () => {
};

class carrotmq extends EventEmitter {
  constructor(uri, schema) {
    console.log(schema instanceof rabbitmqSchema);
    if (schema && !(schema instanceof rabbitmqSchema)) {
      throw new TypeError('arguments must be rabbitmqSchema');
    }
    super();
    this.uri    = uri;
    this.schema = schema;
    this.connect().catch((err) => {
      this.emit(err);
    });
  }

  async connect(){
    const that = this;
    let connection  = await amqplib.connect(that.uri);
    that.connection = connection;
    let channel     = await connection.createChannel();
    if (!this.schema) {
      that.ready = true;
      that.emit('ready');
      that.on('message', noop);
      that.on('ready', noop);
      return;
    }
    let exchanges = this.schema.getExchanges();
    for(const exchange of exchanges) {
      await channel.assertExchange(exchange.exchange, exchange.type, exchange.options);
      let bindings = exchange.getDirectBindings();
      for(const binding of bindings) {
        let dest = binding.destination;
        let src  = binding.source;
        if (dest.queue) {
          await channel.assertQueue(dest.queue, dest.options);
          await channel.bindQueue(dest.queue, src.exchange, binding.routingPattern);
        }
        if (dest.exchange) {
          await channel.assertExchange(dest.exchange, dest.type, dest.options);
          await channel.bindExchange(dest.exchange, src.exchange, binding.routingPattern);
        }
      }
    }
    that.ready = true;
    that.emit('ready');
    that.on('message', noop);
    that.on('ready', noop);
  }

  async queue(queue, consumer, rpcQueue, opts) {
    let that = this;
    if (!that.ready){
      return new Promise(function (resolve) {
        that.on('ready', ()=>that.queue(queue, consumer, rpcQueue, opts).then(resolve))
      })
    }
    if (!opts && typeof rpcQueue === 'object'){
      opts = rpcQueue;
      rpcQueue = false;
    }
    const channel = await this.connection.createChannel();
    if ((!queue.startsWith('amq.') && this.schema && !this.schema.getQueueByName(queue))
      || !this.schema) {
      channel.assertQueue(queue, opts);
    }
    return channel.consume(queue, (message)=>{
      this.emit('message', {
        queue,
        message,
        channel
      });
      const ctx = {
        message,
        fields    : message.fields,
        properties: message.properties
      };
      if (rpcQueue) {
        let content = JSON.parse(message.content.toString());
        ctx.replyTo = content.replyTo;
        ctx.content = new Buffer(content.content.data);
        ctx.content = JSON.parse(ctx.content.toString());
      } else {
        ctx.content = JSON.parse(message.content.toString());
      }

      ctx.carrotmq = this;
      ctx.channel = channel;
      ctx._isAcked = false;
      ctx.reply = function (msg, options) {
        let replyTo = ctx.replyTo || message.properties.replyTo;
        if (!replyTo){
          throw new Error('empty reply queue');
        }
        options = Object.assign(message.properties, options);
        that.sendToQueue(replyTo, msg, options)
      };
      ctx.ack = function () {
        ctx._isAcked = true;
        return channel.ack(message);
      };
      ctx.nack = function () {
        ctx._isAcked = true;
        return channel.nack(message);
      };
      ctx.reject = function () {
        ctx._isAcked = true;
        return channel.reject(message);
      };
      ctx.cancel = function () {
        ctx._isAcked = true;
        return channel.cancel(message.fields.consumerTag);
        //channel.close();
      };

      if (this.schema && this.schema.getQueueByName(queue)) {
        try {
          this.schema.validateMessage(queue, ctx.content);
        } catch (e) {
          const err = new ValidationError(message, channel, queue, e);
          if (this.listenerCount(`validationError:${queue}`) !== 0){
            return this.emit(`validationError:${queue}`, err);
          }
          if (rpcQueue || message.properties.replyTo){
            ctx.reply({err});
          }
          return ctx.ack();
        }
      }

      try {
        let result = consumer.call(ctx, ctx.content);
        if (result && typeof result === 'object' && typeof result.catch === 'function'){
          result.catch((err)=>{
            if (!ctx._isAcked) {
              ctx.reject();
            }
            ctx._isAcked = true;
            that.emit('error', err);
          });
        }
      } catch (e) {
        if (!ctx._isAcked) {
          ctx.reject();
        }
        ctx._isAcked = true;
        that.emit('error', e);
      }
    })
  }

  async sendToQueue(queue, message, options) {
    let that = this;
    if (!that.ready){
      return new Promise(function (resolve) {
        that.on('ready', ()=>that.sendToQueue(queue, message, options).then(resolve))
      })
    }
    const skipValidate = options ? options.skipValidate : false;
    if (!skipValidate && this.schema && this.schema.getQueueByName(queue)) {
      try {
        this.schema.validateMessage(queue, message);
      } catch (e) {
        throw new ValidationError(message, null, queue, e);
      }
    }
    message = makeContent(message);
    const channel = await this.connection.createChannel();
    await channel.sendToQueue(queue, message, options);
    channel.close();
  }

  async publish(exchange, routingKey, content, options) {
    let that = this;
    if (!that.ready){
      return new Promise(function (resovle) {
        that.on('ready', ()=>that.publish(exchange, routingKey, content, options).then(resovle))
      })
    }
    if (this.schema && this.schema.getExchangeByName(exchange)) {
      this.schema.validateMessage(exchange, routingKey, content);
    }
    content = makeContent(content);
    const channel = await this.connection.createChannel();
    await channel.publish(exchange, routingKey, content, options);
    channel.close();
  }

  async rpcExchange(exchange, routingKey, content, options) {
    let that = this;
    if (!that.ready){
      return new Promise(function (resolve) {
        that.on('ready', ()=>that.rpcExchange(exchange, routingKey, content, options).then(resolve));
      })
    }
    if (this.schema && this.schema.getExchangeByName(exchange)) {
      this.schema.validateMessage(exchange, routingKey, content);
    }
    content = makeContent(content);
    let channel = await that.connection.createChannel();
    let replyQueue = await channel.assertQueue('', {
      autoDelete: true,
      durable: false
    });
    content = makeContent({
      content,
      replyTo: replyQueue.queue
    });
    await channel.publish(exchange, routingKey, content, options);
    let ctx;
    return new Promise(function (resolve, reject) {
      that.queue(replyQueue.queue, function (data) {
        ctx = this;
        this.cancel();
        this.data = data;
        const _ack = this.ack;
        this.ack = function () {
          if (this._acked) return;
          this._acked = true;
          return _ack.call(this);
        };
        return resolve(this);
      })
    })
      .finally(() => {
        ctx && ctx.ack();
        channel.close()
      });
  }

  async rpc(queue, content, options) {
    let that = this;
    if (!that.ready){
      return new Promise(function (resolve) {
        that.on('ready', ()=>that.rpc(queue, content, options).then(resolve))
      })
    }
    if (this.schema && this.schema.getQueueByName(queue)) {
      this.schema.validateMessage(queue, content);
    }
    content = makeContent(content);
    let channel    = await that.connection.createChannel();
    let replyQueue = await channel.assertQueue('', {
      autoDelete: true,
      durable   : false
    });
    await channel.sendToQueue(queue, content, {replyTo: replyQueue.queue});
    let ctx;
    return new Promise(function (resolve) {
      that.queue(replyQueue.queue, function (data) {
        ctx = this;
        this.cancel();
        this.data = data;
        const _ack = this.ack;
        this.ack = function () {
          if (this._acked) return;
          this._acked = true;
          return _ack.call(this);
        };
        return resolve(this);
      })
    })
      .finally(() => {
        ctx && ctx.ack();
        channel.close()
      });
  }

  createChannel() {
    let that = this;
    if (!that.ready){
      return new Promise(function (resolve) {
        that.on('ready', ()=>that.createChannel().then(resolve))
      })
    }
    return this.connection.createChannel();
  }

  close() {
    return this.connection.close();
  }
}


carrotmq.schema = rabbitmqSchema;
carrotmq.validationError = ValidationError;

module.exports = carrotmq;

function makeContent(content){
  if (typeof content === 'object'){
    return new Buffer(JSON.stringify(content), 'utf8');
  } else if (typeof content === 'string') {
    return new Buffer(content, 'utf8');
  } else if (!Buffer.isBuffer(content)){
    throw new TypeError('unknown message');
  } else {
    return content;
  }
}