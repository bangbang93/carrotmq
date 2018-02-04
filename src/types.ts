import CarrotMQ from './index'
import {Channel, Options} from 'amqplib'
import {Replies} from 'amqplib/properties'

export interface IConfig {
  rpcTimeout?: number
  callbackQueue?: {
    queue: string,
    options?: Options.AssertQueue
  },
}

export interface IRPCResult {
  data: any,
  ack()
}

export interface IContext {
  message: any,
  fields: any,
  properties: any,
  replyTo: string,
  content: Buffer | object,
  carrotmq: CarrotMQ,
  channel: Channel,
  _isAcked: boolean,
  reply(msg: any, options?: Options.Publish): Promise<void>,
  ack(allUpTo?: boolean): void,
  nack(allUpTo?: boolean, requeue?: boolean): void,
  reject(requeue?: boolean): void,
  cancel(): Promise<Replies.Empty>
}

export interface IConsumer {
  (this: IContext, data: any, ctx: IContext): any
}

export type MessageType = any|string|Buffer
