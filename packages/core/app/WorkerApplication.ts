import { MessagePort, parentPort, workerData } from 'worker_threads';
import { Server } from 'socket.io';

import { BaseApplication } from "./BaseApplication";
import { AppOptions } from "../types/AppOptions";

import { Kite } from "../types/Kite";
import { Constructable } from "../types/Constructable";
import { KiteMetadata, MethodMeta, ParameterMeta, PropertyMeta } from "../types/Meta";
import { makeRemote, Target } from "../types/Remote";
import { Message } from "../types/Message";
import { hash } from "../utils/hash";
import { ComponentOptions } from "../decorators";

type IDKites = Map<number | string, Kite>;

interface IndexMessagePort extends MessagePort {
    index: number,
}

export class WorkerApplication extends BaseApplication {

    index = workerData.index as number
    address_helper = workerData.index << 24

    workers: Record<number, IndexMessagePort> = {};     //[index] = IndexMessagePort
    local_kites = new Map<string, IDKites>();           //[name] = IDKites
    global_kites = new Map<string, number>();           //[name] = address

    constructor(options: AppOptions) {
        super(options);

        for (const descriptor of options.components) {
            const meta = (Reflect as any).getMetadata("class", descriptor) as KiteMetadata;
            this.name_classes.set((meta.name ?? descriptor.name).toLowerCase(), descriptor);
        }
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
                case "destroy":
                    this.onDestroy(from, body)
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

        const kite = this.createRootKite(target, options, {
            ...target,
            address: ++this.address_helper,
        })

        setImmediate(() => {
            this.startKite(kite)
        })

        return kite.address
    }

    async onCreateSync(from: MessagePort, { target, options }: { target: Target, options: any }): Promise<number> {

        const kite = this.createRootKite(target, options, {
            ...target,
            address: ++this.address_helper,
        })

        await this.startKite(kite)

        return kite.address
    }

    async onCreateController(from: MessagePort, { target, options, driver }: { target: Target, options: any, driver: any }) {

        const kite = this.createController(target, options, driver)

        setImmediate(() => {
            this.startKite(kite)
        })

        return kite.address
    }

    async onDestroy(from: MessagePort, { target }: { target: Target }) {

        const kite = this.find(target)
        if (kite == null) {
            return
        }

        this.kites.delete(kite.address)

        if (kite.id == null) {
            this.global_kites.delete(kite.name)
        }
        else {
            let names = this.local_kites.get(target.name as string)
            if (names) {
                names.delete(kite.id)
            }
        }

        await this.stopKite(kite)
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

        const current = this.findMethod(kite, method)
        if (current == null) {
            throw new Error(`no such method ${target.name}(${target.id ? target.id : ''}).${method}()`)
        }

        let meta = current.meta
        let instance = current.value

        let result = null

        let method_meta = meta.methods[method]
        if (method_meta) {
            result = await this.resolveMethod(current, method_meta, args)
            this.resolveResult(current, method_meta, result)
        }
        else {
            result = await instance[method](...args)
        }

        return result
    }

    findMethod(parent: Kite, method: string): Kite | undefined {
        if (parent.value[method]) {
            return parent;
        }
        for (const current of parent.children) {
            let instance = current.value;

            if (instance[method]) {
                return current;
            }

            let result = this.findMethod(current, method);
            if (result) {
                return result;
            }
        }
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

    async resolveProperties(kite: Kite, context?: any) {

        const meta = kite.meta

        for (const name in meta.properties) {
            const property = meta.properties[name]
            this.resolveProperty(kite, property, context)
        }
    }

    async resolveProperty(kite: Kite, meta: PropertyMeta, context?: any) {

        const name = meta.name
        const value = kite.value

        for (const tag of meta.tags) {
            const tag_value = tag.value
            switch (tag.type) {
                case "Address":
                    value[name] = kite.root.address
                    break
                case "ID":
                    value[name] = kite.root.id
                    break
                case "Options":
                    {
                        if (tag_value) {
                            value[name] = kite.options[tag_value]
                        }
                        else {
                            value[name] = kite.options
                        }
                    }
                    break
                case "Sender":
                    value[name] = makeRemote((target: Target, method: string, args: any[]) => {
                        const message = {
                            type: "do",
                            source: kite.root.address,
                            body: {
                                target,
                                method,
                                args,
                            }
                        }
                        const port = this.choose(target)
                        port.postMessage(message)
                    })
                    break
                case "Caller":
                    value[name] = makeRemote((target: Target, method: string, args: any[]) => {
                        const session = ++this.session
                        const port = this.choose(target)

                        const message = {
                            type: "do",
                            session,
                            source: kite.root.address,
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
                    break
                case "Server":
                    value[name] = kite.root.server
                    break
                case "Input":
                    value[name] = kite.options[tag_value]
                    break
            }
        }

    }

    async resolveMethod(kite: Kite, method_meta: MethodMeta, args: any[] = [], context: any = {}) {

        const parameters = [];

        for (const one of method_meta.parameters) {
            let value = this.resolveParameter(kite, one, context)
            parameters.push(value)
        }

        const result = await kite.value[method_meta.name](...parameters, ...args)

        return result
    }

    resolveParameters(kite: Kite, method_meta: MethodMeta, context: any) {

        const parameters = [];

        for (const one of method_meta.parameters) {
            let value = this.resolveParameter(kite, one, context)
            parameters.push(value)
        }

        return parameters
    }

    resolveParameter(kite: Kite, parameter: ParameterMeta, context: any) {
        switch (parameter.type) {
            case "Socket":
                return context.socket
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

    /**
     * 创建kite
     * @param target 
     * @param options 
     * @returns 
     */
    createRootKite(target: Target, options: any, context: any): Kite {

        const kite = this.createKite(target, options, context)

        kite.root = kite

        console.log(`create ${kite.address}=${kite.name}(${kite.id ? kite.id : ''})`)

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

    /**
     * 创建kite
     * @param target 
     * @param options 
     * @returns 
     */
    createKite(target: Target, options: any, context: any): Kite {

        const kite = new Kite()

        kite.root = context.root || kite
        kite.name = target.name as string
        kite.id = target.id
        kite.address = context.address
        kite.options = options
        kite.server = context.server
        kite.descriptor = this.name_classes.get(kite.name) as Constructable<unknown>

        if (kite.descriptor == null) {
            throw new Error(`no such kite:${kite.name}`)
        }

        kite.meta = (Reflect as any).getMetadata("class", kite.descriptor) as KiteMetadata;

        context.root = kite.root

        this.createKiteValue(kite, context)
        this.createKiteChildren(kite, context)

        return kite
    }

    /**
     * 创建kite对应的对象
     * @param kite 
     */
    createKiteValue(kite: Kite, context: any) {

        const meta = kite.meta as KiteMetadata
        const descriptor = kite.descriptor as Constructable<unknown>

        const params = this.resolveParameters(kite, meta.construction, context)

        kite.value = new descriptor(...params)

        //Todo 这个位置不一定适合
        //属性有两种情况，导致双向依赖
        //1 被children依赖
        //2 同时，属性需要关联到children
        this.resolveProperties(kite, context)
    }

    createKiteChildren(kite: Kite, context: any) {

        const meta = kite.meta
        const component_tag = meta.tags.find((tag) => tag.type == "Component")

        if (component_tag == null) {
            return
        }

        const options = component_tag.value as ComponentOptions
        const elements = options?.template?.call(kite)

        if (elements == null) {
            return
        }

        for (const element of elements) {
            const name = element[0]
            const { props, on, ref } = element[1]

            const child = this.createKite({ name }, props, context)

            if (ref) {
                kite.value[ref] = child.value
            }

            kite.children.push(child)
        }
    }

    createController(target: Target, options?: any, driver?: any): Kite {

        const context = {
            ...target,
            address: ++this.address_helper,
            server: new Server(),
        }
        const kite = this.createRootKite(target, options, context)

        const meta = kite.meta as KiteMetadata

        if (meta?.value == null) {
            throw new Error("no transport in " + target.name)
        }

        const port = driver?.port || meta.value || 8080
        const server = kite.server = context.server

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

    async startKite(kite: Kite) {

        let meta = kite.meta
        let instance = kite.value
        let timers = kite.timers

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

        if (instance.onStart) {
            await instance.onStart()
            await this.startKiteChildren(kite)
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

    async startKiteChildren(kite: Kite) {
        for (const child of kite.children) {
            await this.startKite(child)
        }
    }

    async stopKite(kite: Kite) {
        let instance = kite.value
        if (instance.onStart) {
            await instance.onStop()
            await this.stopKiteChildren(kite)
        }

        let timers = kite.timers
        for (let name in timers) {
            let timer = timers[name]
            if (timer.repeat) {
                clearTimeout(timer.id)
            }
            else {
                clearInterval(timer.id)
            }
        }

        kite.emit("stopped")
    }

    async stopKiteChildren(kite: Kite) {
        for (const child of kite.children) {
            await this.stopKite(child)
        }
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
            index = hash(target.name) % this.config.threads
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