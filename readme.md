# carrotmq
a much easy way to use rabbitmq

## usage
```javascript
var carrotmq = require('carrotmq');
//var rabbitSchema = require('rabbit-schema');
var rabbitSchema = carrotmq.schema;

//see https://www.npmjs.com/package/rabbitmq-schema
var schema = new rabbitSchema({
    exchange: 'exchange0',
    type: 'topic',
    bindings: [{
      routingPattern: 'foo.bar.#',
      destination: {
        queue: 'fooQueue',
        messageSchema: {}
      }
    }]
})
var mq = new carrotmq('amqp://localhost', schema);

mq.queue('fooQueue', function (message){
    let data = message.content.toString();
    console.log(data);
    this.ack();
    //this.nack();
    //this.reject();
    this.reply({date: new Date}); //reply to message.properties.relyTo
    this.carrotmq //carrotmq instrance
});

mq.sendToQueue('queue', {msg: 'message'});
mq.publish('exchange', 'foo.bar.key', {msg: 'hello world!'});
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
}, true);   /* true here for mark this queue was rpc queue,
carrotmq will warp real content with json {replyTo: 'queue', content: {buffer}}
for replyTo properties,because of rabbitMQ will ignore
message sent to exchange with vanilla replyTo ,
if server side doesn't using carrotmq ,just handle {replyTo: 'queue', content: {buffer}}*/

let time = new Date();
app.rpc('exchange0', 'rpc.rpc', {time}).then((data)=>{
  //data: {time: time}
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