import { AppOptions } from "../types/AppOptions";
import { BaseApplication } from "./BaseApplication";
import { Worker, SHARE_ENV, MessageChannel } from 'worker_threads';
import { cpus } from 'os';
import { Target } from "../types/Remote";
import { hash } from "../utils/hash";
import { Message } from "../types/Message";

export class MasterApplication extends BaseApplication {

    workers: Array<Worker | undefined> = [];

    constructor(options: AppOptions) {
        super(options);
    }

    startWorkers() {
        const count = this.config.threads || cpus().length
        for (let i = 0; i < count; ++i) {
            const worker = new Worker(process.argv[1], {
                workerData: {
                    index: i,
                },
                env: SHARE_ENV,
            })

            this.workers.push(worker)

            worker.on('error', (event) => {
                console.log(`kite:on_error(threads[${i}])`, event)
            })

            worker.on('exit', () => {
                console.log(`kite:on_exit(threads[${i}])`)

                this.workers[i] = undefined

                for (const worker of this.workers) {
                    if (worker) {
                        worker.postMessage({ type: "check" })
                        return
                    }
                }

                console.log("kite:exit@all workers exit")
                setImmediate(process.exit, 0)
            })
        }

        for (let i = 0; i < this.workers.length; i++) {
            const first = this.workers[i] as Worker

            for (let j = i + 1; j < this.workers.length; j++) {
                const second = this.workers[j] as Worker

                const channel = new MessageChannel()

                first.postMessage({
                    type: "connect",
                    index: j, port: channel.port1
                }, [channel.port1])

                second.postMessage({
                    type: "connect",
                    index: i, port: channel.port2
                }, [channel.port2])
            }
        }

        for (const worker of this.workers) {
            if (!worker) {
                continue
            }
            worker.on('message', (message) => {
                return this.dispatch(worker, message)
            })
            worker.postMessage({ type: "start" })
        }
    }

    /**
     * service 随机分配
     */
    async bootServices() {

        interface Node {
            name: string,
            service: { name: string, id?: number | string, options?: object },
            class: Function,
            children: Node[]
        }

        let root: Node[] = []
        let names: { [key: string]: { children: Node[] } } = {}

        for (const service of this.config.services) {
            const descriptor = this.name_classes.get(service.name);
            if (descriptor == null) {
                throw new Error(`no such service:${service.name}`);
            }

            let node = { name: service.name as string, service, class: descriptor, children: [] }

            names[node.name] = node

            if (service.depend_on == null) {
                root.push(node)
            }
            else {
                names[service.depend_on].children.push(node)
            }
        }

        for (const one of root) {

            const target = { name: one.service.name, id: one.service.id }

            if (one.children.length > 0) {
                await this.createSync(target, one.service.options)
            }
            else {
                await this.create(target, one.service.options)
            }

            for (const child of one.children) {
                await this.createSync({ name: child.service.name, id: child.service.id }, child.service.options)
            }
        }

    }

    async bootControllers() {
        for (const controller of this.config.controllers || []) {
            const descriptor = this.name_classes.get(controller.name);
            if (descriptor == null) {
                throw new Error(`no such controller:${controller.name}`);
            }
            await this.createController({ name: controller.name, id: controller.id }, controller.options, controller.driver)
        }
    }

    async create(target: Target, options?: any): Promise<number> {

        let worker = this.choose(target) as Worker

        return this.call(worker, {
            type: "create",
            target,
            options,
        })
    }

    async createSync(target: Target, options?: any): Promise<number> {
        let worker = this.choose(target) as Worker
        return this.call(worker, {
            type: "createSync",
            target,
            options,
        })
    }

    async createControllerSync(target: Target, options?: any, driver?: any): Promise<number> {
        let worker = this.choose(target) as Worker
        return this.call(worker, {
            type: "createControllerSync",
            target,
            options,
            driver
        })
    }

    async createController(target: Target, options?: any, driver?: any): Promise<number> {
        let worker = this.choose(target) as Worker

        console.log("master:createController")

        return this.call(worker, {
            type: "createController",
            target,
            options,
            driver
        })
    }

    dispatch(from: Worker, message: Message) {
        // console.log(`master:dispatch`, type, session ? session : '', body)

        try {
            switch (message.type) {
                case "resp":
                    this.onResp(from, message)
                    break
            }
        }
        catch (err) {
            console.error(err)
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

    call(worker: Worker, message: any): Promise<number> {

        let session = message.session = ++this.session

        worker.postMessage(message)

        return new Promise((resolve, reject) => {
            this.rpcs[session] = {
                resolve,
                reject
            }
        })
    }
    onResp(from: Worker, message: Message) {

        const { session } = message
        const result: any = message.result
        const error: Error | undefined = message.error

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
}
