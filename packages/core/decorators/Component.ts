import { get_or_add_class_meta } from "../utils/get-or-add-class-meta";

type Element = [string, Record<string, string>]
type Elements = Array<Element>

export interface ComponentOptions {
    name?: string;
    template?: Elements;
}

export function Component(options: ComponentOptions): ClassDecorator {
    return function (target: Function) {
        const existed = get_or_add_class_meta(target);

        existed.tags.push({
            type: "Component",
            value: options,
        })
    }
}