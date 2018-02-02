/**
 * Created by bangbang93 on 16-3-30.
 */
'use strict';
const carrotmq = require('../lib/index').CarrotMQ;
require('should');

const {RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST} = process.env;

const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}/`;

let app;

before(function (done) {
  app = new carrotmq(uri, null, {
    callbackQueue: {
      queue: 'carrotmq.test.callback'
    }
  });
  app.on('ready', async ()=>done);
});

after(function () {
  app.close();
})

let date = new Date();

describe('no schema queue', function () {
  it('queue', function (done) {
    this.timeout(5000);
    app.queue('fooQueue', function (data) {
      this.ack();
      console.log(data);
      Date.parse(data.date).should.equal(date.valueOf());
      done();
    });

    app.sendToQueue('fooQueue', {date});
  });
  it('rpc', async function () {
    app.queue('carrotmq.test.callback', (data, ctx) => {
      return ctx.reply(data)
    })
    const result = await app.rpc('carrotmq.test.callback', {data: 'aaa'})
    result.data['data'].should.eql('aaa')
  })
});