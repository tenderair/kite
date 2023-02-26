import { RouterAction } from "../types/Meta";
import { Target } from "../types/Remote";
import { get_or_add_class_meta } from "../utils/get-or-add-class-meta";

export interface RouterOptions {
    name?: string,
    route: (...args: any[]) => Target;
    action?: RouterAction,
}

export function Router(options: RouterOptions): ClassDecorator {
    return function (target: Function) {
        const existed = get_or_add_class_meta(target);
        const name = options.name ?? ""

        existed.routers[name] = {
            name,
            route: options.route,
            action: options.action,
        }
    }
}