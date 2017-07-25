/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
const carrotmq       = require('./../index');
const rabbitmqSchema = require('rabbitmq-schema');
const Assert         = require('assert');
const co             = require('co');

const schema = new rabbitmqSchema({
  exchange: 'exchange0',
  type    : 'topic',
  bindings: [{
    routingPattern: 'foo.bar.#',
    destination   : {
      queue        : 'fooExchangeQueue',
      messageSchema: {}
    }
  }, {
    routingPattern: 'rpc.#',
    destination   : {
      queue        : 'rpcQueue',
      messageSchema: {}
    }
  }, {
    routingPattern: 'schema',
    destination: {
      queue: 'schemaQueue',
      messageSchema: {
        name: 'schema-test',
        type: 'object',
        properties: {
          time: {
            type: 'string',
          },
          arr: {
            type: 'array',
          },
        },
        required: ['time', 'arr'],
      }
    }
  }]
});

const {RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST} = process.env;

const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}/`;

const app = new carrotmq(uri, schema);

app.on('error', function (err) {
  console.error(err);
  process.exit(-1);
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

after(function () {
  app.close();
});

describe('carrotmq', function () {
  it('publish and subscribe', function (done) {
    app.queue('fooExchangeQueue', function (message) {
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
  it('rpc', function (done) {
    app.queue('rpcQueue', function (data) {
      console.log(data);
      this.reply(data);
      this.ack();
      this.cancel();
    });
    let time = new Date();
    app.rpc('rpcQueue', {time})
      .then(function (reply) {
        reply.ack();
        const data = reply.data;
        if (new Date(data.time).valueOf() === time.valueOf()){
          done();
        } else {
          done(new Error('wrong time',  data.time, time));
        }
      })
  });
  it('rpc error', function (done) {
    app.queue('rpcQueue', function (data) {
      this.reply({err: 'error message'});
      this.ack();
    });
    let time = new Date();
    app.rpc('rpcQueue', {time})
      .then((reply)=>{
        reply.ack();
        const data = reply.data;
        const err = data.err;
        Assert(err === 'error message');
        done();
    })
  });
  it('schema validate failed', function (done) {
    app.once('validateError:schemaQueue', function (err) {
      const ValidateError = require('../lib/ValidateError');
      Assert(err instanceof ValidateError);
      err.channel.ack(err.content);
      done();
    });
    app.sendToQueue('schemaQueue', {time: new Date()});
  });
  it('schema validate success', function (done) {
    const now = new Date();
    app.queue('schemaQueue', function (data) {
      Assert(new Date(data.time).valueOf() === now.valueOf());
      Assert(Array.isArray(data.arr));
      done();
    });
    app.sendToQueue('schemaQueue', {
      time: now,
      arr: [1, 2, 3],
    });
  })
});

process.on('unhandledRejection', function (err) {
  console.log(err);
});