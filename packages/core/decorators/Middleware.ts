import { get_or_add_middleware_meta } from "../utils/get-or-add-middleware-meta";

export interface IMiddleware {
    use: (context: any, next: () => any) => any,
}

export function Middleware(name: string): ClassDecorator {
    return function (target: IMiddleware | Function) {
        const existed = get_or_add_middleware_meta(target);

        existed.name = name
        existed.type = "Middleware"
    }
}