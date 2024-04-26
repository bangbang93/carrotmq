import {Channel, Options} from 'amqplib'
import {Context} from './context'

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
  autoMessageId?: boolean
}

export interface IRPCResult {
  data: unknown
  _ack: boolean
  properties: object
  fields: object
  ack()
}

export type IConsumer = (this: Context, data: unknown, ctx: Context) => Promise<void>

export type MessageType = unknown | boolean | number | string | Buffer

export interface ICarrotMQMessage {
  content: Buffer
  contentType: string
}

export type MakeContentFunction =
  (message: unknown, info: {queue?: string; exchange?: string; routingKey?: string}) => ICarrotMQMessage

export interface QueueOptions extends Options.AssertQueue {
  channel?: Channel
}

declare module 'amqplib' {
  interface Channel {
    reason: string
  }
}

export interface IConsumeResult {
  consumerTag: string
  channel: Channel
  queue: string
}
