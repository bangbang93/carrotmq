/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
const amqplib        = require('amqplib');
const rabbitmqSchema = require('rabbitmq-schema');
const co             = require('co');
const EventEmitter   = require('events').EventEmitter;
const util           = require('util');
const Promise        = require('bluebird');

const noop = () => {
};

const carrotmq = function (uri, schema) {
  if (schema && !schema instanceof rabbitmqSchema) {
    throw new TypeError('arguments must be rabbitmqSchema');
  }
  if (!(this instanceof carrotmq)) {
    return new carrotmq(uri, schema);
  }
  EventEmitter.call(this);
  const that  = this;
  this.uri    = uri;
  this.schema = schema;
  co(function*() {
    let connection  = yield amqplib.connect(uri);
    that.connection = connection;
    let channel     = yield connection.createChannel();
    if (!schema) {
      that.ready = true;
      that.emit('ready');
      that.on('message', noop);
      that.on('ready', noop);
      return;
    }
    let exchanges = schema.getExchanges();
    yield Promise.each(exchanges, co.wrap(function*(exchange) {
      yield channel.assertExchange(exchange.exchange, exchange.type, exchange.options);
      let bindings = exchange.getDirectBindings();
      return yield Promise.each(bindings, co.wrap(function*(binding) {
        let dest = binding.destination;
        let src  = binding.source;
        if (dest.queue) {
          yield channel.assertQueue(dest.queue, dest.options);
          yield channel.bindQueue(dest.queue, src.exchange, binding.routingPattern);
        }
        if (dest.exchange) {
          yield channel.assertExchange(dest.exchange, dest.type, dest.options);
          yield channel.bindExchange(dest.exchange, src.exchange, binding.routingPattern);
        }
      }));
    }));
    that.ready = true;
    that.emit('ready');
    that.on('message', noop);
    that.on('ready', noop);
  }).catch((err) => {
    this.emit('error', err)
  });
};

util.inherits(carrotmq, EventEmitter);

carrotmq.schema = rabbitmqSchema;

module.exports = carrotmq;

carrotmq.prototype.queue = function (queue, consumer, rpcQueue, opts) {
  let that = this;
  if (!that.ready){
    return new Promise(function (resolve) {
      that.on('ready', ()=>that.queue(queue, consumer, rpcQueue, opts).then(resolve))
    })
  }
  if (!opts && typeof rpcQueue == 'object'){
    opts = rpcQueue;
    rpcQueue = false;
  }
  return this.connection.createChannel()
    .then((channel)=>{
      channel.on('error', function (err) {
        err.message = 'Channel Error: ' + err.message;
        that.emit('error', err);
      });
      if ((!queue.startsWith('amq.') && that.schema && !that.schema.getQueueByName(queue))
        || !that.schema) {
        channel.assertQueue(queue, opts);
      }
      channel.consume(queue, (message)=>{
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
        ctx.reply = function (msg, options) {
          let replyTo = ctx.replyTo || message.properties.replyTo;
          if (!replyTo){
            throw new Error('empty reply queue');
          }
          options = Object.assign(message.properties, options);
          that.sendToQueue(replyTo, msg, options)
        };
        ctx.ack = function () {
          channel.ack(message);
        };
        ctx.nack = function () {
          channel.nack(message);
        };
        ctx.reject = function () {
          channel.reject(message);
        };
        ctx.cancel = function () {
          channel.cancel(message.fields.consumerTag);
          //channel.close();
        };
        let result = consumer.call(ctx, ctx.content);
        if (result && typeof result.catch == 'function'){
          result.catch((err)=>that.emit('error', err));
        }
      })
    })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.sendToQueue = function (queue, message, options) {
  let that = this;
  if (!that.ready){
    return new Promise(function (resolve) {
      that.on('ready', ()=>that.sendToQueue(queue, message, options).then(resolve))
    })
  }
  message = makeContent(message);
  return this.connection.createChannel()
    .then((channel)=>{
      channel.sendToQueue(queue, message, options);
      channel.close();
    })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.publish = function (exchange, routingKey, content, options) {
  let that = this;
  if (!that.ready){
    return new Promise(function (resovle) {
      that.on('ready', ()=>that.publish(exchange, routingKey, content, options).then(resovle))
    })
  }
  content = makeContent(content);
  return this.connection.createChannel()
    .then((channel)=>{
      channel.publish(exchange, routingKey, content, options);
      channel.close();
    })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.rpcExchange = function (exchange, routingKey, content, options, consumer) {
  if (arguments.length == 4){
    consumer =  options;
    options = {};
  }
  if (!consumer){
    consumer = function (data) {
      this.ack();
      return data;
    }
  }
  let that = this;
  if (!that.ready){
    return new Promise(function (resolve) {
      that.on('ready', ()=>that.rpcExchange(exchange, routingKey, content, options, consumer).then(resolve));
    })
  }
  content = makeContent(content);
  return co(function*(){
    let channel = yield that.connection.createChannel();
    let queue = yield channel.assertQueue('', {
      autoDelete: true,
      durable: false
    });
    content = makeContent({
      content,
      replyTo: queue.queue
    });
    channel.publish(exchange, routingKey, content, options);
    return new Promise(function (resolve, reject) {
      that.queue(queue.queue, function(data){
        this.cancel();
        let maybePromise;
        try{
          maybePromise = consumer.call(this, data);
          if (maybePromise && typeof maybePromise.then == 'function'){
            return maybePromise;
          } else {
            return resolve(maybePromise);
          }
        } catch (e){
          if (maybePromise && typeof maybePromise.reject == 'function'){
            return maybePromise
          } else {
            return reject(e);
          }
        } finally {
          channel.close();
        }
      });
    })
  })
};

carrotmq.prototype.rpc = function (queue, content, options, consumer) {
  if (arguments.length == 3){
    consumer =  options;
    options = {};
  }
  if (!consumer){
    consumer = function (data) {
      this.ack();
      return data;
    }
  }
  let that = this;
  if (!that.ready){
    return new Promise(function (resolve) {
      that.on('ready', ()=>that.rpc(queue, content, options, consumer).then(resolve))
    })
  }
  content = makeContent(content);
  return co(function*(){
    let channel = yield that.connection.createChannel();
    let replyQueue = yield channel.assertQueue('', {
      autoDelete: true,
      durable: false
    });
    channel.sendToQueue(queue, content, {replyTo: replyQueue.queue});
    return new Promise(function (resolve, reject) {
      that.queue(replyQueue.queue, function (data) {
        this.cancel();
        let maybePromise;
        try{
          maybePromise = consumer.call(this, data);
          if (maybePromise && typeof maybePromise.then == 'function'){
            return maybePromise;
          } else {
            return resolve(maybePromise);
          }
        } catch (e){
          if (maybePromise && typeof maybePromise.reject == 'function'){
            return maybePromise
          } else {
            return reject(e);
          }
        } finally {
          channel.close();
        }
      })
    })
  })
};

carrotmq.prototype.createChannel = function () {
  let that = this;
  if (!that.ready){
    return new Promise(function (resolve) {
      that.on('ready', ()=>that.createChannel().then(resolve))
    })
  }
  return this.connection.createChannel();
};

carrotmq.prototype.close = function () {
  return this.connection.close();
};

function makeContent(content){
  if (typeof content == 'object'){
    return new Buffer(JSON.stringify(content), 'utf8');
  } else if (typeof content == 'string') {
    return new Buffer(content, 'utf8');
  } else if (!Buffer.isBuffer(content)){
    throw new TypeError('unknown message');
  } else {
    return content;
  }
}