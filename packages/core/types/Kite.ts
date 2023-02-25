import EventEmitter = require("events")
import { Constructable } from "./Constructable"
import { KiteMetadata } from "./Meta"

export class Kite extends EventEmitter {

    root!: Kite;
    parent?: Kite;

    address: number = 0;
    name: string = "";
    id?: number | string;
    options?: any;

    descriptor!: Constructable<unknown>;
    meta!: KiteMetadata;

    value!: any;
    children: Kite[] = [];

    timers: Record<string, any> = {};

    [key: string]: any;

    constructor() {
        super()
    }
}