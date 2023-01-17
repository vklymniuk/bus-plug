const rabbit = require("rabbot");
const parseConnectionString = require("connection-string");
const defExchName = "messages-exchange";
const defaultExchangeConfig = {
    type: "direct",
    autoDelete: false,
    persistent: true,
};

const defaultQueueConfig = {
    autoDelete: false,
    subscribe: true,
    durable: true,
};

const connectionTimeout = 30000; // 30 seconds
let isReady = false;
let defaultQueueName;
let defaultExchangeName;
const handlers = new Map(); 

async function handleMessage (queueName, msg) {

    if (handlers.has(queueName)) {

        for (const handler of handlers.get(queueName)) { // Loop through handlers synchronously.
            await handler(msg.body);
        }

        msg.ack();
    } else {
        msg.nack();
    }
}

async function ready () {
    const start = Date.now();

    while (!isConnected()) {

        if (Date.now() - start > connectionTimeout) {
            throw new Error(`Message bus connection timeout, ${ connectionTimeout / 1000 }s`);
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

function isConnected () {
    return isReady;
}

module.exports.isConnected = isConnected;

/**
 * Publish a message to the message bus.
 * 
 * @param { String } [exchangeName] - Exchange name.
 * @param { String } routingKey - Routing key for the exchange.
 * @param {*} data - Data to send as a message.
 * 
 * @returns { String } - Routing key.
 */
module.exports.publish = async function publish (exchangeName, routingKey, data) {
    if (arguments.length === 2) {
        data = routingKey;
        routingKey = exchangeName;

        if (!defaultExchangeName) {
            throw new Error(
                "Unable to subscribe to default exchange, either:\na) pass a \"exchangeName\" parameter;\n"
                + "b) Call setup() with only one exchange before calling \"publish\".");
        }

        exchangeName = defaultExchangeName;
    }

    await ready();
    await rabbit.publish(exchangeName, {
        type: routingKey, // Also this is copied to "key"
        body: data,
    });
}

/**
 * Handles new messages in a queue in JSON format.
 * 
 * @param { String } [queue] - Queue to subscribe to. If omitted, tries to subscribe to the queue given in setup.
 * @param {Function } handler - Function-handler of queue result.
 * 
 * @returns { undefined } - Nothing.
 */
module.exports.subscribe = async function subscribe (queue, handler) {
    if (typeof queue === "function") {
        handler = queue;

        if (!defaultQueueName) {
            throw new Error(
                "Unable to subscribe to default queue, either:\na) pass a \"queue\" parameter;\n"
                + "b) Call setup() with only one queue before calling \"subscribe\".");
        }
        queue = defaultQueueName;
    }

    if (handlers.has(queue)) {
        handlers.get(queue).push(handler);
    } else {
        handlers.set(queue, [handler]);
        rabbit.handle(
            { queue: queue, autoNack: true /* Automatically handles exceptions in handler */ }, 
            async function (msg) {
                return await handleMessage(queue, msg);
            });
    }
}

module.exports.setup = async function setup (connectionString, config = {}, errorHandler = (e) => console.error(e)) {

    const connectionData = parseConnectionString(connectionString);
    config = Object.assign({}, config, {

        // Parse connection string
        connection: {
            replyQueue: false,
            name: "default",
            user: connectionData.user,
            pass: connectionData.password,
            host: connectionData.hosts[0].name,
            port: connectionData.hosts[0].name.port || 5672,
            failAfter: 3 * 24 * 60 * 60, // 3 days
            retryLimit: 999999999, // Always retry
            waitMin: 2 * 1000, // how long to delay (in ms) before initial reconnect.
            waitMax: 2 * 60 * 1000, // maximum delay (in ms) between retry attempts.
            waitIncrement: 100, // 100 ms wait increase on each attempt
            timeout: 3 * 24 * 60 * 60 * 1000, // in ms (how long to wait for a connection to be established in milliseconds)
            heartbeat: 30, // in sec (how often the client and server check to see if they can still reach each other)
            ...(config.connection || {}) // Redefine connection default config params if needed
        },

        // Simplify interface for exchanges and queues (allow just specifying exchange/queue name)
        exchanges: !config.exchanges
            ? Object.assign({}, defaultExchangeConfig, { name: defaultExchangeName = defExchName })
            : config.exchanges.map((exchange, _, arr) => {
                const params = typeof exchange === "string"
                    ? Object.assign({}, defaultExchangeConfig, { name: exchange })
                    : exchange;
                if (arr.length === 1) {
                    defaultExchangeName = params.name;
                }
                return params;
            }),

        queues: (config.queues || []).map((queue, _, arr) => {
            const params = typeof queue === "string"
                ? Object.assign({}, defaultQueueConfig, { name: queue })
                : queue;

            if (arr.length === 1) {
                defaultQueueName = params.name;
            }
            return params;
        })

    });

    rabbit.configure(config).then(() => { isReady = true; }).catch((ex) => { errorHandler(ex); });
    rabbit.on("connected", () => { isReady = true; });

    ["failed", "closed"].forEach(event => rabbit.on(event, () => { isReady = false; }));

    rabbit.on("unreachable", () => {
        isReady = false;
        errorHandler(new Error(`Message bus connection unreachable, won't try to reconnect more.`));
    });

}

module.exports.terminate = async function terminate () {
    return await rabbit.shutdown(true);
}