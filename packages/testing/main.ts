import { createApp } from "@tenderair/kite.core"
import { Player, Gateway } from "./Player"

// const easyMonitor = require('easy-monitor')

// easyMonitor("test")

process.on('uncaughtException', (err, origin) => {
    console.error(err)
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
    // 应用程序特定的日志记录，在此处抛出错误或其他逻辑
});

let app = createApp({
    services: [Player],
    controllers: [Gateway],
})

app.start().catch((event) => {
    console.log("catch error", event)
})


