/**
 * Created by bangbang93 on 16-3-16.
 */
'use strict';
var carrotmq = require('./../index');
var rabbitmqSchema = require('rabbitmq-schema');
var Assert = require('assert');
var co = require('co');

var schema = new rabbitmqSchema({
  exchange: 'cofactories',
  type: 'topic',
  bindings: [{
    routingPattern: 'pay.market',
    destination: {
      queue: 'cofactoriesPayMarket',
      messageSchema: {
        type: 'object'
      }
    }
  }, {
    routingPattern: 'pay',
    destination: {
      queue: 'CofactoriesPay',
      messageSchema: {
        type: 'object'
      }
    }
  }, {
    routingPattern: 'pay.callback.enterprise',
    destination: {
      queue: 'CofactoriesPayEnterpriseCallback',
      messageSchema: {
        type: 'object'
      }
    }
  }]
});

let uri = 'amqp://cofactories:cofactories@10.1.2.1';

var app = new carrotmq(uri, schema);

app.on('error', function (err) {
  console.log('got error');
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
  it('queue', function (done) {
    app.queue('CofactoriesPayEnterpriseCallback', function (data) {
      this.ack();
      done();
    });
    app.publish('cofactories', 'pay.callback.enterprise', {a:1});
  })
});