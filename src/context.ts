import {Channel, Message, MessageFields, MessageProperties, Options} from 'amqplib'
import {EventEmitter} from 'events'
import CarrotMQ from './index'

export class Context extends EventEmitter {
  public replyTo: string
  public fields: MessageFields
  public properties: MessageProperties

  public isAcked: boolean

  constructor(
    public message: Message,
    public carrotmq: CarrotMQ,
    public content: unknown,
    public channel: Channel,
  ) {
    super()
    this.replyTo = message.properties.replyTo
    this.fields = message.fields
    this.properties = message.properties
  }

  get _isAcked(): boolean {
    return this.isAcked
  }

  public async reply(msg: unknown, options?: Options.Publish): Promise<void> {
    const replyTo = this.replyTo
    if (!replyTo) throw new Error('empty reply queue')
    options = {...this.message.properties, ...options, appId: this.carrotmq.appId}
    return this.carrotmq.sendToQueue(replyTo, msg, options)
  }

  public ack(allUpTo?: boolean): void {
    this.checkAck()
    return this.channel.ack(this.message, allUpTo)
  }

  public nack(allUpTo?: boolean, requeue?: boolean): void {
    this.checkAck()
    return this.channel.nack(this.message, allUpTo, requeue)
  }

  public reject(requeue?: boolean): void {
    this.checkAck()
    return this.channel.reject(this.message, requeue)
  }

  public async cancel(): Promise<void> {
    if (!this.isAcked) throw new Error('cannot cancel before ack')
    await this.channel.cancel(this.message.fields['consumerTag'])
    await this.channel.close()
    this.emit('cancel')
  }

  private checkAck(): void {
    if (this.isAcked) throw new Error('already acked')
    this.isAcked = true
  }
}
