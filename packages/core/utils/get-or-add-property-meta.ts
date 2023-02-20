import { MetaTag, PropertyMeta } from "../types/Meta"
import { get_or_add_class_meta } from "./get-or-add-class-meta"

export function get_or_add_property_meta(target: Object, propertyKey: string | symbol): PropertyMeta {

    target = propertyKey ? target.constructor : target

    let meta = get_or_add_class_meta(target)

    if (propertyKey == null) {
        throw new Error("propertyKey not specify")
    }

    let property = meta.properties[propertyKey] as PropertyMeta
    if (property) {
        return property
    }
    meta.properties[propertyKey] = property = {
        name: propertyKey,
        tags: [],
    }
    return property
}