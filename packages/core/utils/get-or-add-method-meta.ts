import { MethodMeta } from "../types/Meta"
import { get_or_add_class_meta } from "./get-or-add-class-meta"

export function get_or_add_method_meta(target: Object, propertyKey: string | symbol): MethodMeta {

    target = propertyKey ? target.constructor : target

    let meta = get_or_add_class_meta(target)

    if (propertyKey == null) {
        return meta.self
    }

    let method = meta.methods[propertyKey] as MethodMeta
    if (method) {
        return method
    }
    meta.methods[propertyKey] = method = {
        name: propertyKey,
        tags: [],
        parameters: [],
        results: [],
    }
    return method
}