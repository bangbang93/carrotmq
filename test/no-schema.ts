/**
 * Created by bangbang93 on 16-3-30.
 */

'use strict';
import CarrotMQ from '../lib/index'
import * as should from 'should'

const {RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST} = process.env;

const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}/`;

let app;

before('setup without schema', function (done) {
  this.timeout(5000)
  app = new CarrotMQ(uri, null, {
    callbackQueue: {
      queue: 'carrotmq.test.callback'
    }
  });
  app.on('ready', done);
});

after(function () {
  app.close();
})

let date = new Date();

describe('no schema queue', function () {
  this.timeout(5000);

  it('queue', function (done) {
    app.queue('fooQueue', function (data) {
      try {
        console.log(data)
        this.ack();
        Date.parse(data.date).should.equal(date.valueOf());
        done();
      } catch (e) {
        done(e)
      }
    });

    app.sendToQueue('fooQueue', {date});
  });
  it('rpc', async function () {
    app.queue('carrotmq.test.callback', (data, ctx) => {
      ctx.ack()
      return ctx.reply(data)
    })
    const result = await app.rpc('carrotmq.test.callback', {data: 'aaa'})
    await result.ack()
    result.data['data'].should.eql('aaa')
  })
});
