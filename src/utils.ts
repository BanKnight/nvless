import { Dest, Protocols, NameProtocols } from "./types"

export const isIPv4 = (address: string) => /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(address)
export const isIPv6 = (address: string) => /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(address)
export const isDomain = (address: string) => /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9])*$/.test(address)

export function readMetaAddress(meta: Buffer, offset: number = 4) {

    //@ts-ignore
    const dest: Dest = {}

    dest.protocol = NameProtocols[meta.readUint8(offset++)]
    dest.port = meta.readUInt16BE(offset)

    offset += 2

    readAddress(meta, dest, offset)

    return dest
}

export function readAddress(meta: Buffer, dest: Dest, offset: number) {

    const addressType = meta.readUint8(offset++)

    switch (addressType) {
        case 0x01:      //ipv4
            dest.family = "ipv4"
            dest.host = `${meta[offset++]}.${meta[offset++]}.${meta[offset++]}.${meta[offset++]}`
            break
        case 0x02:      //domain
            {
                const size = meta[offset++]
                dest.family = "domain"
                dest.host = meta.subarray(offset, offset += size!).toString()
            }
            break
        case 0x03:      //ipv6
            {
                const array = []

                for (let i = 0; i < 8; i++, offset += 2) {
                    array.push(meta.readUint16BE(offset).toString(16));
                }
                dest.family = "ipv6"
                dest.host = array.join(":")
            }
            break
    }

    return offset
}

export function writeMetaAddress(meta: Buffer, dest: Dest, offset: number) {

    offset = meta.writeUint8(Protocols[dest.protocol!], offset)
    offset = meta.writeUInt16BE(dest.port, offset)

    return writeAddress(meta, dest, offset)
}

export function writeAddress(meta: Buffer, dest: Dest, offset: number) {

    switch (dest.family) {
        case "ipv4":
            offset = meta.writeUInt8(0x01, offset)
            dest.host.split(".").forEach(e => offset = meta.writeUInt8(parseInt(e), offset))
            break
        case "domain":
            {
                const sub = Buffer.from(dest.host)

                offset = meta.writeUInt8(0x02, offset)
                offset = meta.writeUInt8(sub.byteLength, offset)

                offset += sub.copy(meta, offset)
            }
            break
        case "ipv6":
            {
                const array = dest.host.split(":")

                offset = meta.writeUInt8(0x03, offset)

                for (let i = 0; i < array.length; i++) {
                    offset = meta.writeUInt16BE(parseInt(array[i]!, 16), offset)
                }
            }
            break
    }

    return offset
}
