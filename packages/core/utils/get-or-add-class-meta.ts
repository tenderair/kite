import { ClassMeta, MethodMeta } from "../types/Meta";

export function get_or_add_class_meta(target: Object): ClassMeta {
    let existed = (Reflect as any).getMetadata("class", target) as ClassMeta;

    if (existed) {
        return existed
    }

    existed = {
        name: undefined,
        type: undefined,
        methods: {},
        properties: {},
        tags: [],
        self: { parameters: [], tags: [] }
    } as ClassMeta;

    (Reflect as any).defineMetadata("class", existed, target);

    return existed
}