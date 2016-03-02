/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
var amqplib = require('amqplib');
var rabbitmqSchema = require('rabbitmq-schema');
var co = require('co');

var conn;

var carrotmq = function (uri, schema){
  if (!schema instanceof  rabbitmqSchema){
    throw new TypeError('arguments must be rabbitmqSchema');
  }
  return co(function*(){
    let connection = yield amqplib.connect(uri);
    conn = connection;
    let channel = yield connection.createChannel();
    let exchanges = schema.getExchanges();
    exchanges.forEach((exchange)=>{
      channel.assertExchange(exchange.exchange, exchange.type, exchange.options);
      let bindings = exchange.getDirectBindings();
      bindings.forEach((binding)=>{
        let dest = binding.destination;
        let src = binding.source;
        if (dest.queue){
          channel.bindQueue(dest.queue, src.exchange, binding.routingPattern);
        }
        if (dest.exchange){
          channel.bindExchange(dest.exchange, src.exchange, binding.routingPattern);
        }
      })
    })
  })
};

function sendToQueue(queue, message, options){
  if (typeof message == 'object'){
    message = new Buffer(JSON.stringify(message), 'utf8');
  } else if (typeof message == 'string') {
    message = new Buffer(message, 'utf8');
  } else if (!Buffer.isBuffer(message)){
    throw new TypeError('unknown message');
  }

  if (this.channel){
    var promise = Promise.resolve(this.channel);
  } else {
    promise = conn.createChannel();
  }
  promise.then((channel)=>{
    channel.sendToQueue(queue, message, options);
  })
}

carrotmq.queue = function (queue, consumer) {
  return conn.createChannel()
    .then((channel)=>{
      channel.assertQueue(queue);
      channel.consume(queue, (message)=>{
        var that = {};
        that.channel = channel;
        that.reply = function (message, options) {
          options = Object.assign(message.properties, options);
          sendToQueue.call({channel}, message.properties.replyTo, message, options)
        };
        consumer.call(that, message);
      })
    })
};