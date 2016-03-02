# carrotmq
a much easy way to use rabbitmq

## usage
```javascript
var rabbitSchema = require('rabbit-schema');
var carrotmq = require('carrotmq');

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