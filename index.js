/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
var amqplib = require('amqplib');
var rabbitmqSchema = require('rabbitmq-schema');
var co = require('co');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var Promise = require('bluebird');

var noop = ()=>{};

var carrotmq = function (uri, schema){
  if (!schema instanceof  rabbitmqSchema){
    throw new TypeError('arguments must be rabbitmqSchema');
  }
  if (!(this instanceof carrotmq)){
    return new carrotmq(uri, schema);
  }
  EventEmitter.call(this);
  var that = this;
  co(function*(){
    let connection = yield amqplib.connect(uri);
    that.connection = connection;
    let channel = yield connection.createChannel();
    let exchanges = schema.getExchanges();
    exchanges.forEach((exchange)=>{
      channel.assertExchange(exchange.exchange, exchange.type, exchange.options);
      let bindings = exchange.getDirectBindings();
      bindings.forEach((binding)=>{
        let dest = binding.destination;
        let src = binding.source;
        if (dest.queue){
          channel.assertQueue(dest.queue, dest.options);
          channel.bindQueue(dest.queue, src.exchange, binding.routingPattern);
        }
        if (dest.exchange){
          channel.assertExchange(dest.exchange, dest.type, dest.options);
          channel.bindExchange(dest.exchange, src.exchange, binding.routingPattern);
        }
      })
    });
    that.ready = true;
    that.emit('ready');
    that.on('message', noop);
    that.on('ready', noop);
  }).catch((err)=>{this.emit('error', err)});
};

util.inherits(carrotmq, EventEmitter);

carrotmq.schema = rabbitmqSchema;

module.exports = carrotmq;

carrotmq.prototype.queue = function (queue, consumer, rpcQueue) {
  let that = this;
  if (!that.ready){
    return that.on('ready', ()=>that.queue(queue, consumer))
  }
  return this.connection.createChannel()
    .then((channel)=>{
      channel.consume(queue, (message)=>{
        this.emit('message', {
          queue,
          message,
          channel
        });
        var ctx = {
          message,
          fields: message.fields,
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
          channel.close();
        };
        let result = consumer.call(ctx, ctx.content);
        if (result && typeof result.catch == 'function'){
          result.catch((err)=>that.emit(error, err));
        }
      })
    })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.sendToQueue = function (queue, message, options) {
  let that = this;
  if (!that.ready){
    return that.on('ready', ()=>that.sendToQueue(queue, message, options))
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
    return that.on('ready', ()=>that.publish(exchange, routingKey, content, options))
  }
  content = makeContent(content);
  return this.connection.createChannel()
    .then((channel)=>{
      channel.publish(exchange, routingKey, content, options);
      channel.close();
    })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.rpc = function (exchange, routingKey, content, options, consumer) {
  if (arguments.length == 4){
    consumer =  options;
    options = {};
  }
  let that = this;
  if (!that.ready){
    return that.on('ready', ()=>that.rpc(exchange, routingKey, content, options, consumer))
  }
  content = makeContent(content);
  return co(function*(){
    let channel = yield that.connection.createChannel();
    let queue = yield channel.assertQueue('', {
      autoDelete: true
    });
    that.queue(queue.queue, function(data){
      let maybePromise = consumer.call(this, data);
      this.cancel();
      if (maybePromise && typeof maybePromise.then == 'function'){
        maybePromise.then(()=>channel.close());
      } else {
        channel.close();
      }
    });
    content = makeContent({
      content,
      replyTo: queue.queue
    });
    channel.publish(exchange, routingKey, content, options);
  })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.createChannel = function () {
  let that = this;
  if (!that.ready){
    return that.on('ready', ()=>that.createChannel())
  }
  return this.connection.createChannel();
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