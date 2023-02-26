import { Target } from "./Remote";

export interface Message {
    session?: number,
    type: string,
    source: Target,
    body: any
}