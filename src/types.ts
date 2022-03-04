import {Channel, Options} from 'amqplib'
import {Context} from './context'
import CarrotMQ from './index'

export interface IConfig {
  appId?: string
  rpcTimeout?: number
  callbackQueue?: {
    queue: string
    options?: Options.AssertQueue
  }
  reconnect?: {
    timeout: number
    times: number
  } | false
}

export interface IRPCResult {
  data: any
  _ack: boolean
  properties: object
  fields: object
  ack()
}

/**
 * @deprecated Use class Context instead
 */
export interface IContext {
  message: any
  fields: any
  properties: any
  replyTo: string
  content: Buffer | object
  carrotmq: CarrotMQ
  channel: Channel
  _isAcked: boolean
  reply(msg: any, options?: Options.Publish): Promise<void>
  ack(allUpTo?: boolean): void
  nack(allUpTo?: boolean, requeue?: boolean): void
  reject(requeue?: boolean): void
  cancel(): Promise<void>
}

export type IConsumer = (this: Context, data: any, ctx: Context) => any

export type MessageType = any | boolean | number | string | Buffer

export interface ICarrotMQMessage {
  content: MessageType
  contentType: string
}

export type MakeContentFunction =
  (message: any, info: {queue?: string; exchange?: string; routingKey?: string}) => ICarrotMQMessage

export interface QueueOptions extends Options.AssertQueue {
  channel?: Channel
}

declare module 'amqplib' {
  interface Channel {
    reason: string
  }
}
