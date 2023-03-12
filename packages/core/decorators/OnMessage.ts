import { get_or_add_method_meta } from "../utils/get-or-add-method-meta";

export function OnMessage(name?: string, options?: {
    ack: boolean,
    middleware?: [],
}): MethodDecorator {
    return function (target: Object, propertyKey: string | symbol) {

        let method = get_or_add_method_meta(target, propertyKey);
        let value = { name: name || propertyKey, ...options }

        let meta = { type: "OnMessage", value }

        method.tags.push(meta)
        method.results.push(meta)
    }
}