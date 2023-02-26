import { EventEmitter } from "events";
import { readFileSync } from 'fs';
import { AppOptions } from "../types/AppOptions";
import { Kite } from "../types/Kite";
import { parse } from 'yaml';
import { KiteMetadata, RouterMeta } from "../types/Meta";
import { RouterOptions } from "../decorators/Router";

export class BaseApplication extends EventEmitter {

    protected name_classes = new Map<string, Function>();
    protected extra_routers = new Map<string, RouterMeta>()             //extra routers
    protected kites: Map<Number, Kite> = new Map<Number, Kite>();       //[address] = kite
    protected config: any;
    protected session = 0
    protected rpcs: Record<number, { resolve: Function, reject: Function }> = {}

    constructor(protected options: AppOptions) {
        super();

        for (const descriptor of options.services) {
            const meta = (Reflect as any).getMetadata("class", descriptor) as KiteMetadata;
            this.name_classes.set(meta.name as string, descriptor);

            for (const name in meta.routers) {
                const router = meta.routers[name]
                this.extra_routers.set(name, router)
            }

        }

        for (const descriptor of options.controllers) {
            const meta = (Reflect as any).getMetadata("class", descriptor) as KiteMetadata;
            this.name_classes.set(meta.name as string, descriptor);

            for (const name in meta.routers) {
                const router = meta.routers[name]
                this.extra_routers.set(name, router)
            }
        }
    }

    async start() {

        try {
            this.loadConfig();
            this.startWorkers();

            await this.bootServices();
            await this.bootControllers();
        }
        catch (e) {
            console.error(e)
            process.exit(1)
        }
    }

    loadConfig() {
        const content = readFileSync("kite.yml", "utf-8");
        this.config = parse(content);
    }

    startWorkers() { }

    async bootServices() { }
    async bootControllers() { }
}
