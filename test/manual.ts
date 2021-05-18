import CarrotMQ from '../src'

const app = new CarrotMQ('amqp://guest:guest@lo-srv-0.s.chipwing.com', {
  callbackQueue: {
    queue: 'carrotmq@' + process.pid,
    options:{
      autoDelete: true,
    }
  }
})

app.queue('carrotmq.test', async (data, ctx) => {
  ctx.ack()
  if (ctx.properties.replyTo) {
    await ctx.reply('a')
  }
})
.then(async () => {
  for(let i = 0; i < 2; i++) {
    const res = await app.rpc('carrotmq.test', 'a')
    res.ack()

    console.log('ack')
    console.log(res.data)
  }
  // for(let i = 0; i < 100; i++) {
  //   await app.sendToQueue('carrotmq.test', 'a')
  // }

  console.log(app.channels.size)
})
