import { Service, ID, Address, Sender, Interval, Caller } from "@tenderkite/core"

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

    ping(a: number, b: number, c: number) {
        console.log("!!recv ping", a, b, c)
    }

    add(a: number, b: number) {
        console.log("get add", a, b, "in", this.id)
        return a + b
    }

    @Interval("show_debug", 0, 1000)
    async print() {

        console.log("this is timer")

        this.sender("player", 2).ping(1, 2, 3)

        const promise = this.caller("player", 1 + Math.round(Math.random())).add(1, 2)

        console.log("1+2=", await promise)
    }
}
export class Gateway {
    constructor() { }

    onConnected(session: any) { }

    login() {

        return { ok: true }
    }

}
