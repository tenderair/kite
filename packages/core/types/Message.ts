export interface Message {
    session?: number,
    type: string,
    source: number,
    body: any
}