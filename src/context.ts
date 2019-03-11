import {Channel, Message, MessageFields, MessageProperties, Options} from 'amqplib'
import {EventEmitter} from 'events'
import CarrotMQ from './index'
import {IContext} from './types'

export class Context extends EventEmitter implements IContext {
  public replyTo: string
  public fields: MessageFields
  public properties: MessageProperties

  public isAcked: boolean

  get _isAcked() {
    return this.isAcked
  }

  constructor(
    public message: Message,
    public carrotmq: CarrotMQ,
    public content: any,
    public channel: Channel,
  ) {
    super()
    this.replyTo = message.properties.replyTo
    this.fields = message.fields
    this.properties = message.properties
  }

  public reply(msg: any, options?: Options.Publish) {
    const replyTo = this.replyTo || this.message.properties.replyTo
    if (!replyTo) throw new Error('empty reply queue')
    options = {...this.message.properties, ...options, appId: this.carrotmq.appId}
    return this.carrotmq.sendToQueue(replyTo, msg, options)
  }

  public ack(allUpTo?: boolean) {
    this.checkAck()
    return this.channel.ack(this.message, allUpTo)
  }

  public nack(allUpTo?: boolean, requeue?: boolean) {
    this.checkAck()
    return this.channel.nack(this.message, allUpTo, requeue)
  }

  public reject(requeue?: boolean) {
    this.checkAck()
    return this.channel.reject(this.message, requeue)
  }

  public async cancel() {
    if (!this.isAcked) throw new Error('cannot cancel before ack')
    await this.channel.cancel(this.message.fields['consumerTag'])
    await this.channel.close()
    this.emit('cancel')
  }

  private checkAck() {
    if (this.isAcked) throw new Error('already acked')
    this.isAcked = true
  }
}
