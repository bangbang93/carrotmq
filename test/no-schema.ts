/**
 * Created by bangbang93 on 16-3-30.
 */


'use strict';
import CarrotMQ from '../src/index'
import * as should from 'should'
import * as Bluebird from 'bluebird'

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
      ctx.cancel()
      return ctx.reply(data)
    })
    const arr = []
    for(let i = 0; i < 10; i++ ){
      arr[i] = rpc()
    }
    await Promise.all(arr)

    async function rpc() {
      const data = Math.random()
      await Bluebird.delay(data * 100)
      const result = await app.rpc('carrotmq.test.callback', {data: data})
      await result.ack()
      result.data['data'].should.eql(data)
    }
  })

  it('parallel rpc', async function () {
    app.queue('carrotmq.test.callback', (data, ctx) => {
      ctx.ack()
      ctx.reply(data)
    })
    await Bluebird.map(new Array(100).fill(0), async (e, i) => {
      const res = await app.rpc('carrotmq.test.callback', i)
      res.data.should.eql(i)
      process.stdout.write(res.data + ',')
      await res.ack()
    })
    process.stdout.write('\n')
  })
});
