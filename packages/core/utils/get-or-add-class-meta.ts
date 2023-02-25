import { KiteMetadata, MethodMeta } from "../types/Meta";

export function get_or_add_class_meta(target: Object): KiteMetadata {
    let existed = (Reflect as any).getMetadata("class", target) as KiteMetadata;

    if (existed) {
        return existed
    }

    existed = {
        name: undefined,
        type: undefined,
        methods: {},
        properties: {},
        tags: [],
        construction: {
            name: "constructor",
            parameters: [],
            tags: [],
            results: [],
        },
        routers: {}
    } as KiteMetadata;

    (Reflect as any).defineMetadata("class", existed, target);

    return existed
}