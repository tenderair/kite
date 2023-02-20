import { EventEmitter } from "events";
import { readFileSync } from 'fs';
import { AppOptions } from "../types/AppOptions";
import { Kite } from "../types/Kite";
import { parse } from 'yaml';
import { ClassMeta } from "../types/Meta";

export class BaseApplication extends EventEmitter {

    protected name_descriptors = new Map<string, Function>();
    protected kites: Map<Number, Kite> = new Map<Number, Kite>();
    protected config: any;
    protected session = 0
    protected rpcs: { [key: number]: any } = {}

    constructor(protected options: AppOptions) {
        super();

        for (const descriptor of options.services) {
            const meta = (Reflect as any).getMetadata("class", descriptor) as ClassMeta;
            this.name_descriptors.set(meta.name as string, descriptor);
        }

        for (const descriptor of options.controllers) {
            const meta = (Reflect as any).getMetadata("class", descriptor) as ClassMeta;
            this.name_descriptors.set(meta.name as string, descriptor);
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
