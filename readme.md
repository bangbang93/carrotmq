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
var mq = carrotmq('amqp://localhost', schema);

mq.queue('fooQueue', function (message){
    let data = message.content.toString();
    console.log(data);
    this.ack();
})
```