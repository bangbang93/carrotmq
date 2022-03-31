# carrotmq

a much easy way to use rabbitmq

[中文文档](https://blog.bangbang93.com/2016/03/29/carrotmq%e4%b8%ad%e6%96%87%e6%96%87%e6%a1%a3.moe)

[![Build Status](https://travis-ci.org/bangbang93/carrotmq.svg?branch=master)](https://travis-ci.org/bangbang93/carrotmq)
[![Version npm](https://img.shields.io/npm/v/carrotmq.svg?style=flat-square)](https://www.npmjs.com/package/carrotmq)
[![NPM Downloads](https://img.shields.io/npm/dm/carrotmq.svg?style=flat-square)](https://www.npmjs.com/package/carrotmq)
[![Dependencies](https://img.shields.io/david/bangbang93/carrotmq.svg?style=flat-square)](https://david-dm.org/bangbang93/carrotmq)
[![NPM](https://nodei.co/npm/carrotmq.png?downloads=true&downloadRank=true)](https://nodei.co/npm/carrotmq/)


## APIDOC

[documentation](https://bangbang93.github.io/carrotmq)

## usage
```javascript
const {CarrotMQ} = require('carrotmq');

const mq = new CarrotMQ('amqp://localhost');

const publisher = new CarrotMQ('amqp://localhost'); //also can use without schema

mq.queue('fooQueue', async (data, ctx) => {
    console.log(data);
    ctx.ack();
    //ctx.nack();
    //ctx.reject();
    //ctx.cancel(); cancel this consumer;
    ctx.reply({date: new Date}); //reply to message.properties.relyTo
    ctx.carrotmq //carrotmq instrance
    ctx.channel  //current channel
    return Promise.reject(); // or throw new Error('some thing happened') will execute `this.reject()` if this message hadn't been ack
});

mq.sendToQueue('queue', {msg: 'message'});
mq.publish('exchange', 'foo.bar.key', {msg: 'hello world!'});
```

## RPC
```javascript
mq.rpc('queue', {data: new Date})
.then((reply)=>{
  reply.ack();
  console.log(reply.data); //some reply result
});
```
If you prefer to use named queue rather than temp queue, you can set in config like 
```javascript
const mq = new CarrotMQ('amqp://localhost', {
  callbackQueue: {
    queue: 'carrotmq.rpc.callback'
  }
})
```
Or 
```javascript 
mq.rpc('carrotmq.rpc', {data: 'foo'}, 'carrotmq.rpc.callback') 
```

## RPC Over Exchange
```javascript

app.queue('rpcQueue', async (data, ctx) => {
  await ctx.reply(data);
  await ctx.ack();
});

let time = new Date();
app.rpcExchange('exchange0', 'rpc.rpc', {time})
.then(function (reply){
  reply.ack();
  console.log(reply.data)//{time: time}
}) // if target exchange is an topic or fanout exchange, only the first reply will be accepted.
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
