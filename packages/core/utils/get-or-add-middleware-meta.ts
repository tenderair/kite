import { MiddlewareMetadata } from "../types/Meta";

export function get_or_add_middleware_meta(target: Object): MiddlewareMetadata {
    let existed = (Reflect as any).getMetadata("middleware", target) as MiddlewareMetadata;

    if (existed) {
        return existed
    }

    existed = {
        name: undefined,
        type: undefined,
    } as MiddlewareMetadata;

    (Reflect as any).defineMetadata("middleware", existed, target);

    return existed
}