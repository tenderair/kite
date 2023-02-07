import { get_or_add_method_meta } from "../utils/get-or-add-method-meta";

export function Options(key?: string): ParameterDecorator {
    return function (target: Object, propertyKey: string | symbol, parameterIndex: number) {
        let method = get_or_add_method_meta(target, propertyKey);
        method.parameters[parameterIndex] = { type: "ID", value: key }
    }
}