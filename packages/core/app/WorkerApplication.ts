import { AppOptions } from "../types/AppOptions";
import { BaseApplication } from "./BaseApplication";
import { MessagePort, parentPort, workerData } from 'worker_threads';
import { Service } from "../types/Service";
import { Constructable } from "../types/Constructable";
import { ClassMeta, MetaTag, MethodMeta } from "../types/Meta";
import { make_remote as makeRemote, Target } from "../types/Remote";
import { Message } from "../types/Message";

type IdServices = Map<number | string, Service>;

interface IndexMessagePort extends MessagePort {
    index: number,
}

export class WorkerApplication extends BaseApplication {

    index = workerData.index as number
    id_helper = workerData.index << 24

    workers: { [key: number]: IndexMessagePort | MessagePort } = {};
    //按名字划分
    local_services = new Map<string, IdServices>();
    global_services = new Map<string, number>();       //全局唯一名字的

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
                    result = await this.onConnect(from as MessagePort, body)
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
    }

    onCreate(from: MessagePort, { target, options }: { target: Target, options: any }): number {

        const service = this.create(target, options)

        this.startService(service)

        return service.address
    }

    async onCreateSync(from: MessagePort, { target, options }: { target: Target, options: any }): Promise<number> {

        const service = this.create(target, options)

        this.startService(service)

        return new Promise((resolve, reject) => {
            service.once("started", () => {
                service.off("error", reject)
                resolve(service.address)
            })
            service.once("error", reject)
        })
    }

    async onCreateController(from: MessagePort, { target, options, driver }: { target: Target, options: any, driver: any }) {

        const service = this.createController(target, options)

        this.startService(service)

        return service.address
    }

    async onDo(from: MessagePort, source: number, { target, method, args }: { target: Target, method: string, args: any[] }) {
        let service = null
        if (target.id == null) {
            let address = this.global_services.get(target.name)
            service = this.address_services.get(address as number)
        }
        else {
            let services = this.local_services.get(target.name as string)
            if (services == null) {
                throw new Error("no such service:" + target.name)
            }

            service = services.get(target.id)
        }

        if (service == null) {
            throw new Error(`no such ${target.name}(${target.id ? target.id : ''})`)
        }

        let meta = service.meta as ClassMeta
        let instance = service.value
        let parameters = null

        let method_meta = meta?.methods[method]
        if (method_meta) {
            parameters = this.resolveParameters(service, meta, method_meta)
            parameters = [...parameters, ...args]
        }
        else {
            parameters = args
        }

        const result = await instance[method](...parameters)

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
            console.log("recv error resp")
            rpc.reject(error)
        }
    }

    resolveParameters(service: Service, meta: ClassMeta, method_meta: MethodMeta, context?: any) {

        const parameters = [];

        for (const one of method_meta.parameters) {
            let value = this.resolveParameter(service, meta, one, context)
            parameters.push(value)
        }

        return parameters
    }

    resolveParameter(service: Service, meta: ClassMeta, parameter: MetaTag, context?: any) {
        switch (parameter.type) {
            case "Address":
                return service.address
            case "ID":
                return service.id
            case "Options":
                let key = parameter.value as string
                if (key) {
                    return service.options[key]
                }
                else {
                    return service.options
                }
            case "Sender":
                return makeRemote((target: Target, method: string, args: any[]) => {
                    // const message = {
                    //     type: "do",
                    //     source: service.address,
                    //     body: {
                    //         target,
                    //         method,
                    //         args,
                    //     }
                    // }

                    // const port = this.choose(target)
                    // port.postMessage(message)
                })
            case "Caller":
                return makeRemote((target: Target, method: string, args: any[]) => {
                    const session = ++this.session
                    const port = this.choose(target)

                    const message = {
                        type: "do",
                        session,
                        source: service.address,
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
        }
    }

    create(target: Target, options?: any): Service {
        const service = new Service()

        service.name = target.name
        service.id = target.id
        service.address = ++this.id_helper
        service.options = options
        service.descriptor = this.name_descriptors.get(service.name) as Constructable<unknown>

        console.log(`create ${service.address}=${service.name}(${service.id ? service.id : ''})`)

        if (service.descriptor == null) {
            return service
        }

        service.meta = (Reflect as any).getMetadata("class", service.descriptor) as ClassMeta;

        if (target.id == null)       //global
        {
            this.global_services.set(target.name, service.address)

            this.broad({
                type: "regist",
                body: {
                    name: target.name,
                    address: service.address,
                }
            })
        }
        else {
            let names = this.local_services.get(target.name)
            if (names == null) {
                names = new Map<number | string, Service>()
                this.local_services.set(target.name, names)
            }

            names.set(target.id, service)
        }

        const params = this.resolveParameters(service, service.meta, service.meta.self)

        service.value = new service.descriptor(...params)

        this.address_services.set(service.address, service)

        return service
    }

    createController(target: Target, options?: any, driver?: any): Service {
        return this.create(target, options)
    }

    startService(service: Service) {

        let meta = service.meta as ClassMeta
        let instance = service.value

        let timers: any = {}

        for (let name in meta.methods) {
            let method = meta.methods[name]

            let index = method.tags.findIndex((tag) => tag.type == "Interval")
            if (index == null) {
                continue
            }

            let tag = method.tags[index]

            timers[tag.value?.name as string] = {
                ...tag.value,
                method: name,
                meta: method,
            }
        }

        service.timers = timers

        setImmediate(async () => {

            if (instance.onStart) {
                await instance.onStart()
            }

            for (let name in timers) {
                let timer = timers[name]

                let onTimer = () => {
                    let params = this.resolveParameters(service, service.meta as ClassMeta, timer.meta)

                    instance[timer.method](...params)
                }

                if (timer.repeat == null) {
                    timer.id = setTimeout(onTimer, timer.delay)
                }
                else {
                    timer.id = setInterval(onTimer, timer.repeat)
                }
            }

            service.emit("started")
        })

        service.on("error", () => {
            for (let name in timers) {
                let timer = timers[name]

                if (timer.repeat == null) {
                    clearTimeout(timer.id)
                }
                else {
                    clearInterval(timer.id)
                }
            }

            service.timers = timers = {}
        })
    }

    choose(target: Target) {
        let index = 0
        if (typeof target.id == "number") {
            index = target.id % this.config.threads
        }
        else if (typeof target.id == "string") {
            let crc = 0     //todo:use crc value
            index = crc % this.config.threads
        }
        else if (target.name) {
            let address = this.global_services.get(target.name)

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

    broad(message: any) {
        for (let index in this.workers) {
            let worker = this.workers[index] as IndexMessagePort

            if (worker.index == this.index) {
                continue
            }

            worker.postMessage(message)
        }
    }

}