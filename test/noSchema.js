/**
 * Created by bangbang93 on 16-3-30.
 */
'use strict';
const carrotmq = require('./../index');
const Assert   = require('assert');

const {RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST} = process.env;

const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}/${RABBITMQ_HOST}`;

let app;

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