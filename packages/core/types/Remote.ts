export interface Target {
    name?: string,
    id?: string | number,
    address?: number
}

export type RemoteTarget = any[]
export type RemoteSender = (target: RemoteTarget, method: string, args: any[]) => any

interface RemoteDescriptor {
    target: RemoteTarget,
    send: RemoteSender,
}

/**
 * remote.player(10).ping().send()
 * @param service 
 * @returns 
 */
export function makeRemote(send: RemoteSender) {

    const caches: any = {}

    return function (...args: any[]) {

        let current = caches

        for (let i = 0; i < args.length - 1; ++i) {
            let key = args[i]
            let child = current[key]

            if (child == null) {
                current[key] = child = {}
            }

            current = child
        }

        let last = args[args.length - 1]
        let existed = current[last]
        if (existed) {
            return existed
        }

        const remote: RemoteDescriptor = {
            target: args,
            send,
        }

        existed = current[last] = new Proxy(remote, {
            get(target, p, receiver) {
                return make_method(target, p as string)
            }
        })

        return existed
    }
}

export function make_method(remote: RemoteDescriptor, method: string) {
    return function (...args: any[]) {
        return remote.send(remote.target, method, args)
    }
}