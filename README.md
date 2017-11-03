# carrotmq

a much easy way to use rabbitmq

[中文文档](https://blog.bangbang93.com/2016/03/29/carrotmq%e4%b8%ad%e6%96%87%e6%96%87%e6%a1%a3.moe)

[![Build Status](https://travis-ci.org/bangbang93/carrotmq.svg?branch=master)](https://travis-ci.org/bangbang93/carrotmq)
[![Version npm](https://img.shields.io/npm/v/carrotmq.svg?style=flat-square)](https://www.npmjs.com/package/carrotmq)
[![NPM Downloads](https://img.shields.io/npm/dm/carrotmq.svg?style=flat-square)](https://www.npmjs.com/package/carrotmq)
[![Dependencies](https://img.shields.io/david/bangbang93/carrotmq.svg?style=flat-square)](https://david-dm.org/bangbang93/carrotmq)
[![NPM](https://nodei.co/npm/carrotmq.png?downloads=true&downloadRank=true)](https://nodei.co/npm/carrotmq/)
[![Greenkeeper badge](https://badges.greenkeeper.io/bangbang93/carrotmq.svg)](https://greenkeeper.io/)

## APIDOC

[API.md](API.md)

## usage
```javascript
const {CarrotMQ} = require('carrotmq');
//var rabbitmqSchema = require('rabbitmq-schema');
const rabbitmqSchema = CarrotMQ.schema;

//see https://www.npmjs.com/package/rabbitmq-schema
const schema = new rabbitmqSchema({
    exchange: 'exchange0',
    type: 'topic',
    bindings: [{
      routingPattern: 'foo.bar.#',
      destination: {
        queue: 'fooQueue',
        messageSchema: {}
      }
    }]
});
const mq = new CarrotMQ('amqp://localhost', schema);

const publisher = new CarrotMQ('amqp://localhost'); //also can use without schema

mq.queue('fooQueue', function (data){
    console.log(data);
    this.ack();
    //this.nack();
    //this.reject();
    //this.cancel(); cancel this consumer;
    this.reply({date: new Date}); //reply to message.properties.relyTo
    this.carrotmq //carrotmq instrance
    this.channel  //current channel
    return Promise.reject(); // or throw new Error('some thing happened') will execute `this.reject()` if this message hadn't been ack
});

mq.sendToQueue('queue', {msg: 'message'});
mq.publish('exchange', 'foo.bar.key', {msg: 'hello world!'});
```

## Message Validation
`messageSchema` defines as json-schema on queue. Message will be validate when they comes.
If failed while validation, a `validateError:${queue}` event will emit.
If no listener attached on this event, this fail will be silent ignore and message will be acked.
```js
const schema = new rabbitmqSchema({
    exchange: 'exchange0',
    type: 'topic',
    bindings: [{
      routingPattern: 'foo.bar.#',
      destination: {
        queue: 'fooQueue',
        messageSchema: {
         title: 'push-target',
         type: 'object',
         properties: {
           userIds: {
             type: 'array',
           },
           message: {
             type: 'object',
             properties: {
               text: {
                 type: 'string',
               },
               title: {
                 type: 'string',
               }
             },
             required: ['text', 'title'],
           },
         },
         required: ['userIds', 'message'],
       }
      }
    }]
});
const mq = new CarrotMQ('amqp://localhost', schema);
mq.queue('fooQueue', function(data) {
  console.log(data);
});
mq.on('validationError:fooQueue', function(err) {
  const ValidateError = require(ValidationError);
  err instanceof ValidateError === true;
  console.error(err);
  err.channel.ack(err.content);
  err.channel; //queue channel
  err.content; //raw content (Buffer)
})
```

## RPC
```javascript
mq.rpc('queue', {data: new Date})
.then((reply)=>{
  reply.ack();
  console.log(reply.data); //some reply result
});
```

## RPC Over Exchange
```javascript

//{
//    routingPattern: 'rpc.#',
//   destination: {
//      queue: 'rpcQueue',
//      messageSchema: {}
//    }
//  }

app.queue('rpcQueue', function (data) {
  this.reply(data);
  this.ack();
}, true);   /* true here for mark this queue is a rpc queue,
carrotmq will wrap real content with json {replyTo: 'queue', content: {buffer}}
for replyTo properties,because of rabbitMQ will ignore
message sent to exchange with vanilla replyTo ,
if server side doesn't using carrotmq ,just handle {replyTo: 'queue', content: {buffer}}*/

let time = new Date();
app.rpcExchange('exchange0', 'rpc.rpc', {time})
.then(function (reply){
  reply.ack();
  console.log(reply.data)//{time: time}
})
```

## events
### ready
emit after connection established
```javascript
mq.on('ready', function(){});
```

### error
emit when something happened
```javascript
mq.on('error', function (err){});
```

### message
emit when message come
```javascript
mq.on('message', function (data){
  data.channel; //channel object
  data.queue   //queue name
  data.message  //message object
})
```

### close
emit when connection close
```js
mq.on('close', () => setTimeout(mq.connect(), 1000));
```

## upgrade
### V4 to V5

Because of rewritten in TypeScript, some export has changed
before:
```javascript
const CarrotMQ = require('carrotmq')
```
after:
```javascript
const {CarrotMQ} = require('carrotmq')
```
### V2 to V3
#### breaking change
  - mq.rpc() and mq.rpcExchange() method remove the 4th consumer argument.And using Promise
  
  used to
  ```js
    mq.rpc('someQueue', {data}, function(data) {
      const that = this;
      // or some data async logic
      doSomeThingAsync(data)
      .then(() => that.ack())
      .catch(() => that.nack());
      return data;
    }).then((data) => console.log(data));
```
now can replaced by
```js
    let reply = await mq.rpc('someQueue', {data});
    try {
      await doSomeThingAsync(reply.data);
      reply.ack();
    } catch (e) {
      reply.nack();
    }
```
