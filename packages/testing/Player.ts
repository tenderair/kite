import {
    Service, ID, Address,
    Interval,
    WSController,
    OnConnection,
    OnDisconnect,
    Message, MessageBody, Component,
    WebSocketServer,
    Router,
    WebSocket,
    RemoteRouter,
    Remote,
    RouteParams,
} from "@tenderair/kite.core"

import { Server, Socket } from "socket.io";

@Component({ name: "chat" })
export class Chat {

    @ID() id!: number;

    ping(a: number, b: number, c: number) {
        console.log("!!recv ping", a, b, c)
    }

    add(a: number, b: number) {
        console.log("get add", a, b, "in")
        return a + b
    }
}

let template = `
    <chat ref="chat" :name='this.name'></chat>
`

@Component({
    template: [
        ["chat", { ref: "chat" }]
    ]
})
@Service("player")
export class Player {

    @Address() address!: number;
    @ID() id!: number;

    @RemoteRouter() remote!: Remote;

    // @Reference("chat")
    chat!: Chat;

    onStart() {
        console.log("this is on start", this.address, this.id)
    }

    @Interval("show_debug", 2000)
    async print() {

        console.log("this is timer")

        // this.sender("player", 2).ping(1, 2, 3)

        let pid = 1 + Math.round(Math.random())

        console.log(`player(${this.id}) remote call player(${pid}) start`)

        const result = await this.remote("player", pid).call("add", 1, 2)

        console.log(`player(${this.id}) remote call player(${pid}) done:${result}`)

        this.remote("player", pid).destroy()

        //this.remote("client",pid).send("add",1,2,3)
        //this.remote("client",pid).call("add",1,2,3)

        //this.sender("client",pid).send()
        //this.sender("socket_client",socketid).send()
    }
}

interface DataSocket extends Socket {
    data: {
        pid: number
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
@WSController("gate", 80, {
    middleware: [],
})
@Router({
    name: "client",
    route(name) {
        return { name: "gate" }
    },
    action(remote: RouteParams, method: string, args: any[]) {

        let [pid] = remote

        return {
            method: "send_client",
            args: [pid, method, ...args]
        }
    }
})
export class Gateway {

    clients = new Map<number, Socket>()

    @WebSocketServer()
    server!: Server;

    @OnConnection({
        middleware: [],
    })
    onConnected(@WebSocket() socket: DataSocket) {
        socket.data = { pid: 0 }
        console.log("on connected", socket.id)
    }

    @OnDisconnect()
    onDisconnect(@WebSocket() socket: DataSocket) {

        this.clients.delete(socket.data.pid)

        console.log("on disconnect")
    }

    @Message("login")
    login(@WebSocket() socket: DataSocket, @MessageBody() data: any) {

        let pid = data.pid

        if (pid == null) {

            socket.disconnect(true)

            return {
                event: 'login',
                data: { ok: false }
            }
        }

        socket.data.pid = pid

        this.clients.set(pid, socket)

        return {
            event: "login",
            data: {
                ok: true
            }
        }
    }

    @Message("ping", true)
    ping(@WebSocket() socket: Socket, @MessageBody() data: object) {
        console.log("recv ping", data)
        return "hello"
    }

    send_client(pid: number, method: string, ...args: any[]) {
        let client = this.clients.get(pid)
        if (client == null) {
            return
        }
        client.emit(method, ...args)
    }

    send_socket(pid: number,
        method: string,
        ...args: any[]) {


    }
}

