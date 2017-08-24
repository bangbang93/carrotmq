<a name="carrotmq"></a>

## carrotmq ⇐ <code>EventEmitter</code>
CarrotMQ

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  

* [carrotmq](#carrotmq) ⇐ <code>EventEmitter</code>
    * [new carrotmq(uri, [schema])](#new_carrotmq_new)
    * [.connect()](#carrotmq+connect) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.queue(queue, consumer, rpcQueue, opts)](#carrotmq+queue) ⇒ <code>Promise.&lt;{ticket, queue, consumerTag, noLocal, noAck, exclusive, nowait, arguments}&gt;</code>
    * [.sendToQueue(queue, message, [options])](#carrotmq+sendToQueue) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.publish(exchange, routingKey, content, [options])](#carrotmq+publish) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.rpcExchange(exchange, routingKey, content, [options])](#carrotmq+rpcExchange) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.rpc(queue, content)](#carrotmq+rpc) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.createChannel()](#carrotmq+createChannel) ⇒ <code>Promise.&lt;Channel&gt;</code>
    * [.close()](#carrotmq+close)

<a name="new_carrotmq_new"></a>

### new carrotmq(uri, [schema])
constructor


| Param | Type | Description |
| --- | --- | --- |
| uri | <code>string</code> | amqp url |
| [schema] | <code>rabbitmqSchema</code> \| <code>null</code> | rabbitmq-schema |

<a name="carrotmq+connect"></a>

### carrotmq.connect() ⇒ <code>Promise.&lt;void&gt;</code>
connect to rabbitmq, auto call when construct,or can be called manually when need reconnect

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  
<a name="carrotmq+queue"></a>

### carrotmq.queue(queue, consumer, rpcQueue, opts) ⇒ <code>Promise.&lt;{ticket, queue, consumerTag, noLocal, noAck, exclusive, nowait, arguments}&gt;</code>
attach a consumer on the queue

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  

| Param | Type | Description |
| --- | --- | --- |
| queue | <code>string</code> | queue name |
| consumer | <code>function</code> | consumer function |
| rpcQueue | <code>boolean</code> | is queue for rpc |
| opts | <code>object</code> | see amqplib#assetQueue |

<a name="carrotmq+sendToQueue"></a>

### carrotmq.sendToQueue(queue, message, [options]) ⇒ <code>Promise.&lt;void&gt;</code>
send message to the queue

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  

| Param | Type | Description |
| --- | --- | --- |
| queue | <code>string</code> | queue name |
| message | <code>object</code> \| <code>string</code> \| <code>buffer</code> | object=>JSON.stringify string=>Buffer.from |
| [options] | <code>object</code> | see amqplib#assetQueue |

<a name="carrotmq+publish"></a>

### carrotmq.publish(exchange, routingKey, content, [options]) ⇒ <code>Promise.&lt;void&gt;</code>
publish into the exchange

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  

| Param | Type | Description |
| --- | --- | --- |
| exchange | <code>string</code> | exchange name |
| routingKey | <code>string</code> | routingKey |
| content | <code>object</code> \| <code>string</code> \| <code>buffer</code> |  |
| [options] | <code>object</code> | see amqplib#publish |

<a name="carrotmq+rpcExchange"></a>

### carrotmq.rpcExchange(exchange, routingKey, content, [options]) ⇒ <code>Promise.&lt;void&gt;</code>
rpc over exchange

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  

| Param | Type | Description |
| --- | --- | --- |
| exchange | <code>string</code> | exchange name |
| routingKey | <code>string</code> | routing key |
| content | <code>object</code> \| <code>string</code> \| <code>buffer</code> |  |
| [options] | <code>object</code> | see amqplib#publish |

<a name="carrotmq+rpc"></a>

### carrotmq.rpc(queue, content) ⇒ <code>Promise.&lt;void&gt;</code>
rpc call,reply using temp queue

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  

| Param | Type | Description |
| --- | --- | --- |
| queue | <code>string</code> | queue name |
| content | <code>object</code> \| <code>string</code> \| <code>buffer</code> |  |

<a name="carrotmq+createChannel"></a>

### carrotmq.createChannel() ⇒ <code>Promise.&lt;Channel&gt;</code>
get raw amqplib channel

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  
<a name="carrotmq+close"></a>

### carrotmq.close()
close connection

**Kind**: instance method of [<code>carrotmq</code>](#carrotmq)  
