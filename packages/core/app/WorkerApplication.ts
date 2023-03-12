import { MessagePort, parentPort, workerData } from 'worker_threads';
import { Server } from 'socket.io';

import { BaseApplication } from "./BaseApplication";
import { AppOptions } from "../types/AppOptions";

import { Kite } from "../types/Kite";
import { Constructable } from "../types/Constructable";
import { KiteMetadata, MethodMeta, ParameterMeta, PropertyMeta } from "../types/Meta";
import { Remote, RemoteAgent, RouteParams, Target } from "../types/Remote";
import { Message } from "../types/Message";
import { hash } from "../utils/hash";
import { ComponentOptions } from "../decorators";

type IDKites = Map<number | string, Kite>;

interface IndexMessagePort extends MessagePort {
    index: number,
}

export class WorkerApplication extends BaseApplication {

    index = workerData.index as number
    address_helper = (workerData.index << 24) + 100000

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

    async dispatch(from: MessagePort, message: Message) {

        let result = null
        let error = null

        try {
            switch (message.type) {
                case "connect":
                    result = await this.onConnect(from, message)
                    break
                case "create":
                    result = await this.onCreate(from, message)
                    break
                case "createSync":
                    result = await this.onCreateSync(from, message)
                    break
                case "createController":
                    result = await this.onCreateController(from, message)
                    break
                case "destroy":
                    this.onDestroy(from, message)
                    break
                case "action":
                    result = await this.onAction(from, message)
                    break
                case "resp":
                    this.onResp(from, message)
                    break
                case "regist":
                    this.onRegist(from, message)
                    break
                case "Listen":
                    this.onListen(from, message)
                    break
                case "Remove":
                    this.onRemove(from, message)
                    break
                case "Emit":
                    this.onEmit(from, message)
                    break
                default:
                    break
            }
        }
        catch (err) {
            error = err
        }

        if (message.session == null || message.type == "resp") {
            return
        }

        // console.log("post resp for", session)

        from.postMessage({
            type: "resp",
            session: message.session,
            result,
            error
        })
    }

    onConnect(from: MessagePort, message: Message) {

        const index = message.index as number
        const port = message.port as IndexMessagePort

        port.index = index

        this.workers[index] = port

        port.on('message', (message) => {
            return this.dispatch(port, message)
        })

        console.log(`worker(${this.index}) onConnect worker(${index})`)
    }

    onCreate(from: MessagePort, message: Message): number {

        const target = message.target as Target
        const options = message.options as any

        target.address = target.address || ++this.address_helper

        const kite = this.createRootKite(target, options, {})

        setImmediate(() => {
            this.startKite(kite)
        })

        return kite.address
    }

    async onCreateSync(from: MessagePort, message: Message): Promise<number> {

        const target = message.target as Target
        const options = message.options as any

        target.address = target.address || ++this.address_helper

        const kite = this.createRootKite(target, options, {})

        await this.startKite(kite)

        return kite.address
    }

    async onCreateController(from: MessagePort, message: Message) {

        const target = message.target as Target
        const options: any = message.options
        const driver: any = message.driver

        target.address = target.address || ++this.address_helper

        const kite = this.createController(target, options, driver, {})

        setImmediate(() => {
            this.startKite(kite)
        })

        return kite.address
    }

    async onDestroy(from: MessagePort, message: Message) {

        const target = message.target as Target
        const kite = this.find(target)
        if (kite == null) {
            return
        }

        this.kites.delete(kite.address)

        if (kite.id == null) {
            this.global_kites.delete(kite.name)
        }
        else {
            let names = this.local_kites.get(kite.name)
            if (names) {
                names.delete(kite.id)
            }
        }

        await this.stopKite(kite)

        console.log(`${kite.name}(${kite.id ?? ""}).destroy()`)
    }

    /**
     * 两个kite之间rpc调用
     * @param from 
     * @param source 
     * @param param2 
     * @returns 
     */
    async onAction(from: MessagePort, message: Message) {

        const source = message.source
        const target = message.target as Target
        const method = message.method as string
        const route = message.route as any[]
        const args = message.args as any[]

        let kite = this.find(target)
        if (kite == null) {
            throw new Error(`no such kite(${JSON.stringify(target)}) to invoke ${method}(...)`)
        }

        let { method: action_method, args: action_args } = this.route_action(kite, route, method, args)

        const current = this.findMethod(kite, action_method)
        if (current == null) {
            throw new Error(`no such kite(${JSON.stringify(target)}).${method}()`)
        }

        let meta = current.meta
        let instance = current.value

        let result = null

        let method_meta = meta.methods[action_method]
        if (method_meta) {
            result = await this.resolveMethod(current, method_meta, action_args, { source })
            this.resolveResult(current, method_meta, result)
        }
        else {
            result = await instance[action_method](...action_args)
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

    onResp(from: MessagePort, message: Message) {

        const session = message.session as number
        const result = message.result as any
        const error = message.error as Error

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

    onRegist(from: MessagePort, message: Message) {

        const target = message.target as Target

        this.global_kites.set(target.name as string, target.address as number)
    }

    onListen(from: MessagePort, message: Message) {

        const source = message.source
        const target = message.target as Target
        const event = message.event as string
        const method = message.method as string

        const kite = this.find(target)
        const address = source.address

        if (kite == null) {
            throw new Error(`no such kite(${JSON.stringify(target)}) to listen ${event}(...)`)
        }

        let events = kite._listeners[event]
        if (events == null) {
            events = kite._listeners[event] = []
        }

        events.push({ address: address as number, method })
    }

    onRemove(from: MessagePort, message: Message) {

        const source = message.source
        const target = message.target as Target

        const event = message.event as string
        const method = message.method as string

        const kite = this.find(target)
        const address = source.address

        if (kite == null) {
            throw new Error(`no such kite(${JSON.stringify(target)}) to remove ${event}(...)`)
        }

        let events = kite._listeners[event]
        if (events == null) {
            return
        }

        let index = events.findIndex((element) => {
            return element.method == method && element.address == address
        })

        events.splice(index, 1)
    }

    onEmit(from: MessagePort, message: Message) {

        const source: Target = message.source
        const target = message.target as Target
        const event = message.event as string
        const args = message.args as any[]

        const kite = this.find(target)

        if (kite == null) {
            throw new Error(`no such kite(${JSON.stringify(target)}) to listen ${event}(...)`)
        }

        let events = kite._listeners[event]
        if (events == null) {
            return
        }

        for (const element of events) {
            const source_target = { address: element.address }
            const port = this.choose(source_target)

            port.postMessage({
                type: "action",
                source,
                target,
                method: element.method,
                args,
            })
        }
    }

    async resolveProperties(kite: Kite, context: any) {

        const meta = kite.meta
        const value = kite.value

        for (const name in meta.properties) {
            const property = meta.properties[name]
            value[name] = this.resolveProperty(kite, property, context)
        }
    }

    resolveProperty(kite: Kite, meta: PropertyMeta, context: any) {
        for (const tag of meta.tags) {
            const tag_value = tag.value
            switch (tag.type) {
                case "Address":
                    return kite.root.address
                case "ID":
                    return kite.root.id
                case "Options":
                    {
                        if (tag_value) {
                            return kite.options[tag_value]
                        }
                        else {
                            return kite.options
                        }
                    }
                case "RemoteRouter":
                    return this.make_remote(kite)
                case "Server":
                    return context.server
                case "Input":
                    return kite.options[tag_value]
                case "Reference":
                    return kite.root.refs[tag_value]
            }
        }

    }

    async resolveMethod(kite: Kite, method_meta: MethodMeta, args: any[] = [], context: any = {}) {

        this.resolveMiddlewares(kite, method_meta, context)

        const parameters = [];

        for (const one of method_meta.parameters) {
            let value = this.resolveParameter(kite, one, context)
            parameters.push(value)
        }

        const result = await kite.value[method_meta.name](...parameters, ...args)

        return result
    }

    resolveMiddlewares(kite: Kite, method_meta: MethodMeta, context: any) {

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
            case "WebSocket":
                return context.socket
            case "MessageBody":
                {
                    let args = context?.args        //socket.io can emit with many parameters
                    if (args == null || args.length == 0) {
                        return
                    }

                    return args[parameter.value ?? 0]
                }
            case "Source":
                return context.source

        }
    }

    resolveResult(kite: Kite, method_meta: MethodMeta, result?: any, context?: any) {
        for (const tag of method_meta.results) {
            switch (tag.type) {
                case "OnMessage":
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

        const kite = this.createKite(target, options, undefined, context)

        console.log(`worker[${this.index}] create ${kite.address}=${kite.name}(${kite.id ? kite.id : ''})`)

        if (target.id == null)       //global
        {
            this.global_kites.set(target.name as string, kite.address)

            this.broad({
                type: "regist",
                target,
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
    createKite(target: Target, options: any, parent: Kite | undefined, context: any): Kite {

        const kite = new Kite()

        kite.root = parent ? parent.root : kite
        kite.parent = parent
        kite.name = target.name as string
        kite.id = target.id
        kite.address = target.address as number
        kite.options = options
        kite.server = context.server
        kite.descriptor = this.name_classes.get(kite.name) as Constructable<unknown>

        if (kite.descriptor == null) {
            throw new Error(`no such kite:${kite.name}`)
        }

        kite.meta = (Reflect as any).getMetadata("class", kite.descriptor) as KiteMetadata;

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
        //1 被children依赖,此时要先于 children 处理
        //2 同时，属性需要关联到children，此时要后于children
        this.resolveProperties(kite, context)
    }

    createKiteChildren(kite: Kite, context: any) {

        const meta = kite.meta
        const component_tag = meta.tags.find((tag) => tag.type == "Component")

        if (component_tag == null) {
            return
        }

        const options = component_tag.value as ComponentOptions
        const elements = options?.template

        if (elements == null) {
            return
        }

        for (const element of elements) {
            const name = element[0]
            const attrs = element[1]

            const props: Record<string, any> = {}

            for (let name in attrs) {
                let val = attrs[name]
                if (name.startsWith(":")) {
                    val = eval.call(kite, val)
                    name = name.substring(1)
                }

                props[name] = val
            }

            const child = this.createKite({ name }, props, kite, context)

            if (props.ref) {
                kite.root.refs[props.ref] = child.value
            }

            kite.children.push(child)
        }
    }

    createController(target: Target, options: any, driver: any, context: any): Kite {

        const server = context.server = new Server(driver)

        const kite = this.createRootKite(target, options, context)

        const meta = kite.meta as KiteMetadata

        if (meta?.value == null) {
            throw new Error("no transport in " + target.name)
        }

        const port = driver?.port || meta.value || 8080

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
                    case "OnMessage":
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
        if (instance.onStop) {
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
            index = (target.address >> 24) % this.config.threads
        }

        return this.workers[index]
    }

    route(target: RouteParams): Target {

        let first = target[0]

        if (typeof first == "number") {         //address
            return this.address_route(first)
        }

        if (typeof first == "string") {
            return this.name_route(first, target.slice(1))
        }

        throw new Error(`can't find route info for:[${target.join(",")}]`)
    }

    address_route(address: number): Target {
        return { address }
    }

    name_route(name: string, args: any[]): Target {

        let router = this.extra_routers.get(name)

        let target
        if (router) {
            target = router.route(name, ...args)
        }
        else {
            target = { name, id: args[0] }
        }

        return target
    }

    route_action(kite: Kite, route: RouteParams, method: string, args: any[]) {
        let meta = kite.meta
        let route_name = route[0] ?? ""

        let router = meta.routers[route_name]
        let action = router?.action

        if (action) {
            return action.call(kite.value, route, method, args)
        }

        return {
            method, args
        }
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

    make_remote(kite: Kite): Remote {
        const source = { name: kite.root.name, address: kite.root.address, id: kite.root.id }
        const caches: any = {}

        const that = this
        const router = (...route: RouteParams) => {
            let current = caches

            if (route.length == 0) {
                route = [kite.root.address]
            }

            for (let i = 0; i < route.length - 1; ++i) {
                let key = route[i]
                let child = current[key]

                if (child == null) {
                    current[key] = child = {}
                }

                current = child
            }

            let last = route[route.length - 1]
            let existed = current[last]
            if (existed) {
                return existed
            }

            const target = that.route(route)
            const port = that.choose(target)

            const remote: RemoteAgent = current[last] = {
                target: target,
                on(event: string, method: string) {
                    port.postMessage({
                        type: "listen",
                        source,
                        route,
                        target,
                        event,
                        method,
                    })
                },
                off(event: string, method: string) {
                    port.postMessage({
                        type: "remove",
                        source,
                        route,
                        target,
                        event,
                        method,
                    })
                },
                create(options?: any) {
                    const session = ++that.session

                    port.postMessage({
                        type: "create",
                        session,
                        source,
                        route,
                        target,
                        options,

                    })

                    return new Promise<number>((resolve, reject) => {
                        that.rpcs[session] = { resolve, reject }
                    })
                },
                destroy() {
                    port.postMessage({
                        type: "destroy",
                        source,
                        target,
                    })
                },
                send(method: string, ...args: any[]) {
                    port.postMessage({
                        type: "action",
                        source,
                        route,
                        target,
                        method,
                        args,
                    })
                },
                call(method: string, ...args: any[]) {
                    const session = ++that.session

                    port.postMessage({
                        type: "action",
                        session,
                        source,
                        route,
                        target,
                        method,
                        args,
                    })

                    return new Promise((resolve, reject) => {
                        that.rpcs[session] = { resolve, reject }
                    })
                },
                emit(event: string, ...args: any[]) {
                    port.postMessage({
                        type: "emit",
                        source,
                        route,
                        target,
                        event,
                        args,
                    })
                }
            }

            return remote
        }

        router.self = router()

        return router
    }

}