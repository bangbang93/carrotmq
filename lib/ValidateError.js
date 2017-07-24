/**
 * Created by bangbang93 on 2017/7/24.
 */
'use strict';
class ValidateError extends Error {
  constructor(content, channel, queue, validateError){
    super(validateError.message);
    this.content = content;
    this.channel = channel;
  }
}

module.exports = ValidateError;