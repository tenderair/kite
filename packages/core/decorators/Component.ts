import { get_or_add_class_meta } from "../utils/get-or-add-class-meta";

type Element = [string, {
    props: object,
    on: object,
    ref: string
}]
type Template = () => Element[]

export interface ComponentOptions {
    name?: string;
    template?: Template;
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