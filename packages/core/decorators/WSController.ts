import { get_or_add_class_meta } from "../utils/get-or-add-class-meta";

export function WSController(name: string, port: number): ClassDecorator {
    return function (target: Function) {
        const existed = get_or_add_class_meta(target);

        existed.name = name
        existed.type = "WSController"
        existed.value = port
    }
}