import { get_or_add_method_meta } from "../utils/get-or-add-method-meta";

export function OnConnection(options?: {
    middleware: [],
}): MethodDecorator {
    return function (target: Object, propertyKey: string | symbol) {
        let method = get_or_add_method_meta(target, propertyKey);
        method.tags.push({ type: "OnConnection", value: options })
    }
}