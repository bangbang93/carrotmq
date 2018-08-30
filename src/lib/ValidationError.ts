/**
 * Created by bangbang93 on 2017/7/24.
 */

'use strict';
import {Channel} from 'amqplib'
export class ValidationError extends Error {
  public content: any
  public channel: Channel
  constructor(content, channel, queue, validateError){
    super(validateError.message);
    this.content = content;
    this.channel = channel;
  }
}
