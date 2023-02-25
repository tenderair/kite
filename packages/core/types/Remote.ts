export interface Target {
    name?: string,
    id?: string | number,
    address?: number
}

export type Sender = (target: Target, method: string, args: any[]) => any

interface RemoteDescriptor {
    target: Target,
    send: Sender,
}


/**
 * remote.player(10).ping().send()
 * @param service 
 * @returns 
 */
export function makeRemote(send: Sender) {

    const caches = new Map<String, any>()

    return function (name: string | number, id?: string | number) {

        let key = `${name}(${id ? id : ''})`
        let existed = caches.get(key)
        if (existed) {
            return existed
        }

        let address: number = 0
        let real_name: any = name

        if (typeof name == "number") {
            address = name
            real_name = undefined
        }


        let remote: RemoteDescriptor = {
            target: { address: address as number, name: real_name, id },
            send: send
        }

        existed = make_target(remote)

        caches.set(key, existed)

        return existed
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