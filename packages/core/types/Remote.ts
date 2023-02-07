export type Target = { name: string, id?: string | number, address?: number }
export type Sender = (target: Target, method: string, args: any[]) => any

interface RemoteDescriptor {
    target: Target,
    send: Sender,
}

const target_cache = new WeakMap<Sender, any>()

/**
 * remote.player(10).ping().send()
 * @param service 
 * @returns 
 */
export function make_remote(send: Sender) {
    return function (name: string, id?: string | number) {

        let remote = {
            target: { name, id },
            send: send,
        }
        return make_target(remote)
    }
}

export function make_target(remote: RemoteDescriptor) {
    return new Proxy(remote, {
        get(target, p, receiver) {
            return make_method(remote, p as string)
        }
    })
}

export function make_method(remote: RemoteDescriptor, method: string) {
    return function (...args: any[]) {
        return remote.send(remote.target, method, args)
    }
}