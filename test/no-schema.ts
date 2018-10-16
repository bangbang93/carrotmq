/**
 * Created by bangbang93 on 16-3-30.
 */


'use strict';
import CarrotMQ from '../src/index'
import * as should from 'should'
import * as Bluebird from 'bluebird'

const {RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST, RABBITMQ_VHOST = ''} = process.env;

const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}/${RABBITMQ_VHOST}`;

let app: CarrotMQ;

let date = new Date();

describe('no schema queue', function () {
  this.timeout(5000);

  beforeEach('setup without schema', async function () {
    this.timeout(5000)
    app = new CarrotMQ(uri, null, {
      callbackQueue: {
        queue: 'carrotmq.test.callback',
        options: {
          autoDelete: true,
          exclusive: true,
          durable: false,
        }
      }
    });
    await app.connect()
  });

  afterEach('disconnect mq', function () {
    return app.close()
  })

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
    const consumer = await app.queue('carrotmq.test.callback', async (data, ctx) => {
      await ctx.ack()
      await ctx.reply(data)
    })
    const arr = []
    for(let i = 0; i < 10; i++ ){
      arr[i] = rpc()
    }
    await Promise.all(arr)

    await consumer.channel.cancel(consumer.consumerTag)

    async function rpc() {
      const data = Math.random()
      await Bluebird.delay(data * 100)
      const result = await app.rpc('carrotmq.test.callback', {data: data})
      await result.ack()
      result.data['data'].should.eql(data)
    }
  })

  it('parallel rpc', async function () {
    this.timeout(30e3)
    const listener = await app.queue('carrotmq.test.callback', async (data, ctx) => {
      await ctx.ack()
      await Bluebird.delay(~~(Math.random() * 20 + 1))
      await ctx.reply(data)
    })
    await Bluebird.map(new Array(1000).fill(0), async (e, i) => {
      const res = await app.rpc('carrotmq.test.callback', i)
      res.data.should.eql(i)
      process.stdout.write(res.data + ',')
      await res.ack()
    })
    app['rpcQueues'].size.should.eql(1)
    app['rpcListener'].size.should.eql(0)
    process.stdout.write('\n')
    await listener.channel.cancel(listener.consumerTag)
  })

  it('timeout', async function () {
    this.timeout(10e3)
    app.config.rpcTimeout = 1e3
    const listener = await app.queue('carrotmq.test.rpc', async (data, ctx) => {
      await Bluebird.delay(2e3)
      // ctx.reply({time: new Date()})
    })
    app.rpc('carrotmq.test.rpc', {time: new Date()}).should.be.rejectedWith('rpc timeout')
    await Bluebird.delay(1e3)
    await listener.channel.checkQueue('carrotmq.test.callback')
  })
});
