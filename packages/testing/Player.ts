import {
    Service, ID, Address,
    Sender, Caller, Interval,
    WSController,
    OnConnection,
    OnDisconnect,
    Message, MessageBody
} from "@tenderair/kite.core"

@Service("player")
export class Player {
    constructor(
        @Address() private address: number,
        @ID() private id: number,
        @Sender() private sender: Function,
        @Caller() private caller: Function
    ) {

        // console.log(`player(${id}) in ${address >> 24}`)
    }

    onStart() {
        console.log("this is on start")
    }

    ping(@Address() address: number, a: number, b: number, c: number) {
        console.log("!!recv ping", a, b, c)
    }

    add(a: number, b: number) {
        console.log("get add", a, b, "in", this.id)
        return a + b
    }

    @Interval("show_debug", 2000)
    async print() {

        console.log("this is timer")

        // this.sender("player", 2).ping(1, 2, 3)

        let pid = 1 + Math.round(Math.random())

        console.log(`player(${this.id}) remote call player(${pid}) start`)

        const promise = this.caller("player", pid).add(1, 2)

        console.log(`player(${this.id}) remote call player(${pid}) done:${await promise}`)
    }
}

/**
 * 参考：http://www.midwayjs.org/docs/extensions/socketio
 * Socket 中间件
Socket 中的中间件的写法和 Web 中间件 相似，但是加载的时机略有不同。

由于 Socket 有连接和接收消息两个阶段，所以中间件以此分为几类。

全局 Connection 中间件，会对所有 namespace 下的 connection 生效
全局 Message 中间件，会对所有 namespace 下的 message 生效
Controller 中间件，会对单个 namespace 下的 connection 和 message 生效
Connection 中间件，会对单个 namespace 下的 connection 生消息
Message 中间件，会对单个 namespace 下的 message 生效
 */

@WSController("gate", 80)
export class Gateway {

    @OnConnection()
    onConnected(session: any) {
        console.log("on connected")
    }

    @OnDisconnect()
    onDisconnect() {
        console.log("on disconnect")
    }

    // @WithAck()
    @Message("login")
    login(@MessageBody() data: object) {
        console.log("recv login", data)

        return {
            event: "login",
            data: {
                ok: true
            }
        }
    }

    @Message("ping", true)
    ping(@MessageBody() data: object) {
        console.log("recv ping", data)

        return "hello"
    }
}
