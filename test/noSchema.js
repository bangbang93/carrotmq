/**
 * Created by bangbang93 on 16-3-30.
 */
'use strict';
var carrotmq = require('./../index');
var Assert = require('assert');
var co = require('co');

let uri = 'amqp://cofactories:cofactories@10.1.2.1';

var app;

before(function (done) {
  app = new carrotmq(uri);
  app.on('ready', ()=>done());
});

let date = new Date();

describe('no schema queue', function () {
  it('queue', function (done) {
    this.timeout(5000);
    app.queue('fooQueue', function (data) {
      this.ack();
      Assert.equal(Date.parse(data.date), date.valueOf());
      done();
    });

    app.sendToQueue('fooQueue', {date});
  });

});