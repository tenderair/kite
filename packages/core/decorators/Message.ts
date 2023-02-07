import { get_or_add_method_meta } from "../utils/get-or-add-method-meta";

export function Message(name?: string): MethodDecorator {
    return function (target: Object, propertyKey: string | symbol) {
        let method = get_or_add_method_meta(target.constructor, propertyKey);

        method.tags.push({ type: "Message", value: name })
    }
}