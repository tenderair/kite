import { create_app } from "@tenderkite/core"
import { Player } from "./Player"

// const easyMonitor = require('easy-monitor')

// easyMonitor("test")

process.on('uncaughtException', (err, origin) => {
    console.error(err)
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
    // 应用程序特定的日志记录，在此处抛出错误或其他逻辑
});

let app = create_app({
    services: [Player],
    controllers: [],
})

app.start().catch((event) => {
    console.log("catch error", event)
})


