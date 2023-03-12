import { Target } from "./Remote";

export interface Message {
    session: number,
    type: string,
    source: Target,
    target?: Target,
    route?: any[],
    [key: string]: any,
}