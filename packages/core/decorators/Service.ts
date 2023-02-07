import { get_or_add_class_meta } from "../utils/get-or-add-class-meta";

export function Service(name?: string): ClassDecorator {
    return function (target: Function) {
        const existed = get_or_add_class_meta(target);

        existed.name = name
        existed.type = "Service"
    }
}