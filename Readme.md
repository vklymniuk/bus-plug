# ManageTeam Message Bus Plug

Module for messaging

Installation
------------
// nexus configuration
Create `.npmrc` file near the `package.json` file with `registry=http://0.0.0.0:4873/` content. Then install with:

```bash
npm install --save vklymniuk-bus-plug
```

Usage
-----
```javascript
import { setup, publish, subscribe, terminate, isConnected } from "vklymniuk-bus-plug";

await setup("amqp://rabbitmq:rabbitmq@message-bus", { // Prefer to move this config to src/config
    exchanges: ["messages-exchange"],
    queues: ["service-line.service-name.microservice-name.queue-name"],
    bindings: [{
        exchange: "messages-exchange",
        target: "service-line.service-name.microservice-name.queue-name",
        keys: [`service-line.service-name.microservice-name.routing-key`]
    }]
});

await publish("messages-exchange", "service-line.service-name.microservice-name.routing-key", {
    test: true
});

// Queue name can be omitted: in this case, dt-bus-plug assumes that the only one queue was given to `setup`.
subscribe("service-line.service-name.microservice-name.queue-name", async function (object) {
    console.log(object);
});

// Uses node-graceful-shutdown package to gracefully terminate message bus connection on application exit
import { onShutdown } from "node-graceful-shutdown";
onShutdown("message-bus", terminate);

console.log(isConnected()); // true/false regarding to whether connected to the message bus. Can be used for health checks.
```

License
-------

[MIT](LICENSE) (c) [Volodymyr Klymniuk](Volodymyr.Klymniuk@gmail.com)