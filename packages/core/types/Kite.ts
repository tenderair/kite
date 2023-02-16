import EventEmitter = require("events")
import { Constructable } from "./Constructable"
import { ClassMeta } from "./Meta"

export class Kite extends EventEmitter {

    address: number = 0;
    name: string = "";
    id?: number | string;
    options?: any;

    descriptor?: Constructable<unknown>;
    value?: any;
    meta?: ClassMeta;

    timers: any = {};

    [key: string]: any;

    constructor() {
        super()
    }
}