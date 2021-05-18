/**
 * Created by bangbang93 on 16-3-2.
 */
'use strict';
import CarrotMQ from '../src'
import 'should'

const {RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST, RABBITMQ_VHOST = ''} = process.env;

const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}/${RABBITMQ_VHOST}`;

const app = new CarrotMQ(uri);

app.on('error', function (err) {
  console.error(err);
  process.exit(-1);
});

before('setup with schema', async function (){
  await app.connect()
});

after(function () {
  return app.close();
});

describe('carrotmq', function () {
  this.timeout(5000);
  it('publish and subscribe', async function () {
    await new Promise(async (resolve) => {
      const ch = await app.createChannel()
      await ch.assertExchange('exchange0', 'topic')
      await app.queue('fooExchangeQueue', function () {
        this.ack();
        resolve()
      })
      await ch.bindQueue('fooExchangeQueue', 'exchange0', 'foo.bar.key')
      await app.publish('exchange0', 'foo.bar.key', {time: new Date})
      await ch.close()
    })
    app.channels.size.should.eql(3)
  });
  it('rpc', function (done) {
    app.queue('rpcQueue', async function (data) {
      console.log(data);
      await this.ack();
      await this.reply(data);
      await this.cancel();
    });
    let time = new Date();
    app.rpc('rpcQueue', {time})
      .then(function (reply) {
        reply.ack();
        const data = reply.data;
        if (new Date(data.time).valueOf() === time.valueOf()){
          done();
        } else {
          done(new Error('wrong time'));
        }
      })
  });
  it('rpc error', async function () {
    await app.queue('rpcQueue', function () {
      this.reply({err: 'error message'});
      this.ack();
    });
    let time = new Date();
    const reply = await app.rpc('rpcQueue', {time})
    console.log(reply.data)
    reply.data.err.should.eql('error message')
    reply.ack()
  });
});
