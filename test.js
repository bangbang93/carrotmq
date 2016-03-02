/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
var carrotmq = require('./');
var rabbitmqSchema = require('rabbitmq-schema');

var schema = new rabbitmqSchema({
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
var app = new carrotmq('amqp://cofactories:cofactories@10.1.2.1', schema);

app.on('error', function (err) {
  throw err;
});

before(function (done){
  this.timeout(5000);
  app.on('ready', function () {
    done();
  });
});

describe('carrotmq', function () {
  it('publish and subscribe', function (done) {
    app.queue('fooQueue', function (message) {
      console.log(message);
      this.ack();
      done();
    });
    app.publish('exchange0', 'foo.bar.key', {time: new Date});
  });
  it('should reject wrong schema', function (done) {
    let app = new carrotmq('amqp://cofactories:cofactories@10.1.2.1', {});
    app.on('error', function (err) {
      if (err instanceof TypeError){
        done();
      } else {
        done(err);
      }
    })
  });
  it('can init by function call', function (done) {
    let app = carrotmq('amqp://cofactories:cofactories@10.1.2.1', schema);
  })
});