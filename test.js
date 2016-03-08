/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
var carrotmq = require('./');
var rabbitmqSchema = require('rabbitmq-schema');
var Assert = require('assert');

var schema = new rabbitmqSchema({
  exchange: 'exchange0',
  type: 'topic',
  bindings: [{
    routingPattern: 'foo.bar.#',
    destination: {
      queue: 'fooQueue',
      messageSchema: {}
    }
  }, {
    routingPattern: 'rpc.#',
    destination: {
      queue: 'rpcQueue',
      messageSchema: {}
    }
  }]
});

let uri = 'amqp://cofactories:cofactories@10.1.2.1';

var app = new carrotmq(uri, schema);

app.on('error', function (err) {
  throw err;
});

before(function (done){
  this.timeout(5000);
  app.on('ready', function () {
    done();
  });
  app.on('error', function (err) {
    done(err);
  })
});

describe('carrotmq', function () {
  it('publish and subscribe', function (done) {
    app.queue('fooQueue', function (message) {
      this.ack();
      done();
    });
    app.publish('exchange0', 'foo.bar.key', {time: new Date});
  });
  it('should reject wrong schema', function (done) {
    let app = new carrotmq(uri, {});
    app.on('error', function (err) {
      if (err instanceof TypeError){
        done();
      } else {
        done(err);
      }
    })
  });
  it('can init by function call', function (done) {
    let app = carrotmq(uri, schema);
    app.on('ready', done);
    app.on('error', done);
  });
  it('rpc', function (done) {
    app.queue('rpcQueue', function (data) {
      this.reply(data);
      this.ack();
    }, true);
    let time = new Date();
    app.rpc('exchange0', 'rpc.rpc', {time}).then((data)=>{
      if (new Date(data.time).valueOf() == time.valueOf()){
        done();
      } else {
        done(new Error('wrong time',  data.time, time));
      }
    })
  })
});