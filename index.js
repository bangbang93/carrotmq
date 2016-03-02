/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
var amqplib = require('amqplib');
var rabbitmqSchema = require('rabbitmq-schema');
var co = require('co');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var carrotmq = function (uri, schema){
  if (!schema instanceof  rabbitmqSchema){
    throw new TypeError('arguments must be rabbitmqSchema');
  }
  if (!this instanceof carrotmq){
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
    that.emit('ready');
  }).catch((err)=>{this.emit('error', err)});
};

util.inherits(carrotmq, EventEmitter);

module.exports = carrotmq;

carrotmq.prototype.queue = function (queue, consumer) {
  return this.connection.createChannel()
    .then((channel)=>{
      channel.assertQueue(queue);
      channel.consume(queue, (message)=>{
        var that = {};
        that.carrotmq = this;
        that.channel = channel;
        that.reply = function (message, options) {
          options = Object.assign(message.properties, options);
          this.sendToQueue.call(message.properties.replyTo, message, options)
        };
        that.ack = function () {
          channel.ack(message);
        };
        that.nack = function () {
          channel.nack(message);
        };
        that.reject = function () {
          channel.reject(message);
        };
        consumer.call(that, message);
      })
    })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.sendToQueue = function (queue, message, options) {
  message = makeContent(message);
  return this.connection.createChannel()
    .then((channel)=>{
      channel.assertQueue(queue);
      channel.sendToQueue(queue, message, options);
    })
    .catch((err)=>this.emit('error', err));
};

carrotmq.prototype.publish = function (exchange, routingKey, content, options) {
  content = makeContent(content);
  return this.connection.createChannel()
    .then((channel)=>{
      channel.publish(exchange, routingKey, content, options);
    })
    .catch((err)=>this.emit('error', err));
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