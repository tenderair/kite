import { get_or_add_method_meta } from "../utils/get-or-add-method-meta";

export function Message(name?: string, ack = false): MethodDecorator {
    return function (target: Object, propertyKey: string | symbol) {
        let method = get_or_add_method_meta(target, propertyKey);
        let value = { name: name || propertyKey, ack }
        method.tags.push({ type: "Message", value })
        method.results.push({ type: "Message", value })
    }
}