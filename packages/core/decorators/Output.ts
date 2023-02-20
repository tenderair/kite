import { get_or_add_property_meta } from "../utils/get-or-add-property-meta";

export function Output(name?: string): PropertyDecorator {
    return function (target: Object, propertyKey: string | symbol) {
        let property = get_or_add_property_meta(target, propertyKey);
        property.tags.push({ type: "Output", value: name || propertyKey })
    }
}
