import { AppOptions } from "../types/AppOptions";
import { BaseApplication } from "./BaseApplication";
import { MessagePort, parentPort, workerData } from 'worker_threads';
import { Kite } from "../types/Kite";
import { Constructable } from "../types/Constructable";
import { ClassMeta, MetaTag, MethodMeta, ParameterMeta } from "../types/Meta";
import { make_remote as makeRemote, Target } from "../types/Remote";
import { Message } from "../types/Message";
import { Server } from 'socket.io';
import { hash } from "../utils/hash";

type IDKites = Map<number | string, Kite>;

interface IndexMessagePort extends MessagePort {
    index: number,
}

export class WorkerApplication extends BaseApplication {

    index = workerData.index as number
    id_helper = workerData.index << 24

    workers: { [key: number]: IndexMessagePort } = {};
    //按名字划分
    local_kites = new Map<string, IDKites>();
    global_kites = new Map<string, number>();       //全局唯一名字的

    constructor(options: AppOptions) {
        super(options);
    }

    startWorkers() {
        parentPort?.on('message', (message) => {
            return this.dispatch(parentPort as MessagePort, message)
        })

        const channel = new MessageChannel()
        const recv = channel.port2 as IndexMessagePort

        recv.index = this.index

        this.workers[this.index] = recv        //拿来发送给port1

        //拿来接收处理的
        channel.port1.on('message', (message) => {
            return this.dispatch(recv, message)
        })
    }

    async dispatch(from: MessagePort,
        { session, type, source, body }: Message) {

        // console.log(`worker[${this.index}]:dispatch`, type, session ? session : '', body)

        let result = null
        let error = null

        try {
            switch (type) {
                case "connect":
                    result = await this.onConnect(from, body)
                    break
                case "create":
                    result = await this.onCreate(from, body)
                    break
                case "createSync":
                    result = await this.onCreateSync(from, body)
                    break
                case "createController":
                    result = await this.onCreateController(from, body)
                    break
                case "do":
                    result = await this.onDo(from, source, body)
                    break
                case "resp":
                    this.onResp(from, session as number, body)
                    break
                case "regist":
                    this.onRegist(from, body)
                    break
                default:
                    break
            }
        }
        catch (err) {
            error = err
        }

        if (session == null || type == "resp") {
            return
        }

        // console.log("post resp for", session)

        from.postMessage({
            type: "resp",
            session,
            body: {
                result,
                error
            }
        })
    }

    onConnect(from: MessagePort, { index, port }: { index: number, port: MessagePort }) {

        let index_port = port as IndexMessagePort

        index_port.index = index

        this.workers[index] = index_port

        index_port.on('message', (message) => {
            return this.dispatch(index_port, message)
        })

        console.log(`worker(${this.index}) onConnect worker(${index})`)
    }

    onCreate(from: MessagePort, { target, options }: { target: Target, options: any }): number {

        const kite = this.createKite(target, options)

        this.createKiteValue(kite)
        this.startKite(kite)

        return kite.address
    }

    async onCreateSync(from: MessagePort, { target, options }: { target: Target, options: any }): Promise<number> {

        const kite = this.createKite(target, options)

        this.createKiteValue(kite)
        this.startKite(kite)

        return new Promise((resolve, reject) => {
            kite.once("started", () => {
                kite.off("error", reject)
                resolve(kite.address)
            })
            kite.once("error", reject)
        })
    }

    async onCreateController(from: MessagePort, { target, options, driver }: { target: Target, options: any, driver: any }) {

        const kite = this.createController(target, options, driver)

        this.createKiteValue(kite)
        this.startKite(kite)

        return kite.address
    }

    /**
     * 两个kite之间rpc调用
     * @param from 
     * @param source 
     * @param param2 
     * @returns 
     */
    async onDo(from: MessagePort, source: number, { target, method, args }: { target: Target, method: string, args: any[] }) {

        let kite = this.find(target)

        if (kite == null) {
            throw new Error(`no such ${target.name}(${target.id ? target.id : ''})`)
        }

        let meta = kite.meta as ClassMeta
        let instance = kite.value

        let result = null

        let method_meta = meta?.methods[method]
        if (method_meta) {
            result = await this.resolveMethod(kite, method_meta, args)
            this.resolveResult(kite, method_meta, result)
        }
        else {
            result = await instance[method](...args)
        }

        // console.log("got result for", method, result)

        return result
    }

    onResp(from: MessagePort, session: number, { result, error }: { result?: any, error?: Error }) {

        let rpc = this.rpcs[session]
        if (rpc == null) {
            return
        }

        delete this.rpcs[session]

        if (result) {
            rpc.resolve(result)
        }
        else if (error) {
            rpc.reject(error)
        }
    }

    onRegist(from: MessagePort, { name, address }: { name: string, address: number }) {
        this.global_kites.set(name, address)
    }

    async resolveMethod(kite: Kite, method_meta: MethodMeta, args: any[] = [], context?: any) {

        const parameters = [];

        for (const one of method_meta.parameters) {
            let value = this.resolveParameter(kite, one, context)
            parameters.push(value)
        }

        const result = await kite.value[method_meta.name](...parameters, ...args)

        return result
    }

    resolveParameters(kite: Kite, method_meta: MethodMeta, context?: any) {

        const parameters = [];

        for (const one of method_meta.parameters) {
            let value = this.resolveParameter(kite, one, context)
            parameters.push(value)
        }

        return parameters
    }

    resolveParameter(kite: Kite, parameter: ParameterMeta, context?: any) {
        switch (parameter.type) {
            case "Address":
                return kite.address
            case "ID":
                return kite.id
            case "Options":
                {
                    let key = parameter.value as string
                    if (key) {
                        return kite.options[key]
                    }
                    else {
                        return kite.options
                    }
                }
            case "Sender":
                return makeRemote((target: Target, method: string, args: any[]) => {
                    const message = {
                        type: "do",
                        source: kite.address,
                        body: {
                            target,
                            method,
                            args,
                        }
                    }
                    const port = this.choose(target)
                    port.postMessage(message)
                })
            case "Caller":
                return makeRemote((target: Target, method: string, args: any[]) => {
                    const session = ++this.session
                    const port = this.choose(target)

                    const message = {
                        type: "do",
                        session,
                        source: kite.address,
                        body: {
                            target,
                            method,
                            args,
                        }
                    }

                    return new Promise((resolve, reject) => {

                        port.postMessage(message)

                        this.rpcs[session] = { resolve, reject }
                    })
                })
            case "Server":
                return kite.server
            case "Socket":
                return context?.socket
            case "MessageBody":
                {
                    let args = context?.args        //socket.io can emit with many parameters
                    if (args == null || args.length == 0) {
                        return
                    }

                    const body = args[parameter.index || 0]

                    let key = parameter.value as string
                    if (key) {
                        return body[key]
                    }
                    else {
                        return body
                    }
                }

        }
    }

    resolveResult(kite: Kite, method_meta: MethodMeta, result?: any, context?: any) {
        for (const tag of method_meta.results) {
            switch (tag.type) {
                case "Message":
                    {
                        let option = tag.value as any
                        if (option.ack) {
                            let args = context?.args        //socket.io can emit with many parameters
                            if (args == null || args.length == 0) {
                                return
                            }

                            const callback = args[args.length - 1]

                            if (typeof callback == "function") {
                                callback(result)
                            }
                            return
                        }

                        if (result?.event) {
                            context?.socket.emit(result.event, result.data)
                        }
                    }
                    break
            }
        }
    }

    createKite(target: Target, options?: any): Kite {

        const kite = new Kite()

        kite.name = target.name as string
        kite.id = target.id
        kite.address = ++this.id_helper
        kite.options = options
        kite.descriptor = this.name_descriptors.get(kite.name) as Constructable<unknown>

        console.log(`create ${kite.address}=${kite.name}(${kite.id ? kite.id : ''})`)

        if (kite.descriptor == null) {
            return kite
        }

        kite.meta = (Reflect as any).getMetadata("class", kite.descriptor) as ClassMeta;

        if (target.id == null)       //global
        {
            this.global_kites.set(target.name as string, kite.address)

            this.broad({
                type: "regist",
                body: {
                    name: target.name,
                    address: kite.address,
                }
            })
        }
        else {
            let names = this.local_kites.get(target.name as string)
            if (names == null) {
                names = new Map<number | string, Kite>()
                this.local_kites.set(target.name as string, names)
            }

            names.set(target.id, kite)
        }

        this.kites.set(kite.address, kite)

        return kite
    }

    createKiteValue(kite: Kite) {

        const meta = kite.meta as ClassMeta
        const descriptor = kite.descriptor as Constructable<unknown>

        const params = this.resolveParameters(kite, meta.self)

        kite.value = new descriptor(...params)
    }

    createController(target: Target, options?: any, driver?: any): Kite {

        const kite = this.createKite(target, options)

        const meta = kite.meta as ClassMeta

        if (meta?.value == null) {
            throw new Error("no transport in " + target.name)
        }

        const port = driver?.port || meta?.value || 8080
        const server = kite.server = new Server() as Server

        this.createKiteValue(kite)

        let onConnected: MethodMeta
        let onDisconnect: MethodMeta
        let messages: any[] = []

        for (const name in meta.methods) {
            const method = meta.methods[name]
            for (let tag of method.tags) {
                switch (tag.type) {
                    case "OnConnection":
                        onConnected = method
                        break
                    case "OnDisconnect":
                        onDisconnect = method
                        break
                    case "Message":
                        messages.push({ name: tag.value.name as string, method })
                        break
                    default:
                        break
                }
            }
        }
        server.on("connection", async (socket) => {
            if (onConnected) {
                await this.resolveMethod(kite, onConnected, [], { socket })
            }
            for (const one of messages) {
                socket.on(one.name, async (...args: any[]) => {
                    const context = { socket, args }
                    const result = await this.resolveMethod(kite, one.method, [], context)
                    this.resolveResult(kite, one.method, result, context)
                })
            }
            socket.on("disconnect", async (...args: any[]) => {
                if (onDisconnect) {
                    await this.resolveMethod(kite, onDisconnect, args, { socket })
                }
            })
        })

        server.listen(port, {
            path: `/${target.name}`
        })

        console.log("controller listen @" + port)

        return kite
    }

    startKite(kite: Kite) {

        let meta = kite.meta as ClassMeta
        let instance = kite.value

        let timers: any = {}

        for (let name in meta.methods) {
            let method = meta.methods[name]

            let index = method.tags.findIndex((tag) => tag.type == "Interval")
            if (index == -1) {
                continue
            }

            let tag = method.tags[index]

            timers[tag.value?.name as string] = {
                ...tag.value,
                method: name,
                meta: method,
            }
        }

        kite.timers = timers

        setImmediate(async () => {

            if (instance.onStart) {
                await instance.onStart()
            }

            for (let name in timers) {
                let timer = timers[name]

                let onTimer = this.resolveMethod.bind(this, kite, timer.meta)

                if (timer.repeat == null) {
                    timer.id = setTimeout(onTimer, timer.delay)
                }
                else {
                    timer.id = setInterval(onTimer, timer.repeat)
                }
            }

            kite.emit("started")
        })

        kite.on("error", () => {
            for (let name in timers) {
                let timer = timers[name]

                if (timer.repeat == null) {
                    clearTimeout(timer.id)
                }
                else {
                    clearInterval(timer.id)
                }
            }

            kite.timers = timers = {}
        })
    }

    choose(target: Target) {
        let index = 0
        if (typeof target.id == "number") {
            index = target.id % this.config.threads
        }
        else if (typeof target.id == "string") {
            index = hash(target.id) % this.config.threads
        }
        else if (target.name) {
            let address = this.global_kites.get(target.name)
            if (address == null) {
                throw new Error("can't find global target:" + target.name)
            }

            index = address % this.config.threads
        }
        else if (target.address) {
            index = target.address % this.config.threads
        }

        return this.workers[index]
    }

    /**
     * 找出本地的Kite实例
     * @param target 
     * @returns 
     */
    find(target: Target): Kite | undefined {
        let kite
        if (target.address) {
            kite = this.kites.get(target.address)
        }
        else if (target.name && target.id) {
            let kites = this.local_kites.get(target.name as string)
            if (kites) {
                kite = kites.get(target.id)
            }
        }
        else if (target.name) {
            let address = this.global_kites.get(target.name)
            kite = this.kites.get(address as number)
        }

        return kite
    }

    broad(message: any, include_self = false) {
        for (let index in this.workers) {
            let worker = this.workers[index]

            if (!include_self && worker.index == this.index) {
                continue
            }

            worker.postMessage(message)
        }
    }

}