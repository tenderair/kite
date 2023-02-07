import "reflect-metadata"

import { isMainThread } from "worker_threads";
import { AppOptions } from "./types/AppOptions";
import { MasterApplication } from "./app/MasterApplication";
import { WorkerApplication } from "./app/WorkerApplication";

export function create_app(options: AppOptions): MasterApplication | WorkerApplication {
    if (isMainThread) {
        return new MasterApplication(options);
    }

    return new WorkerApplication(options);
}

export * from "./decorators"
