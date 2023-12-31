const Common_AddressType =
{
    [1]: "IPv4",
    [2]: "domain",
    [3]: "IPv6"
}

const Common_AddressType_Value = {
    IPv4: 1,
    domain: 2,
    IPv6: 3
}

/**
 * addresstype: 01-->ipv4,02-->domain,03-->ipv6
 * socks5:IPV4: 0x01,domain:03,ipv6:04
 * @param buffer 
 * @param offset 
 * @param address 
 * @returns 
 */
export function read_address(buffer: Buffer, address: any, offset: number = 0) {

    const names =  Common_AddressType
    const address_type = buffer[offset++]
    //@ts-ignore
    const name = names[address_type!]

    switch (name) {
        case "IPv4":      //ipv4
            {
                address.family = "IPv4"
                address.host = `${buffer[offset++]}.${buffer[offset++]}.${buffer[offset++]}.${buffer[offset++]}`
            }
            break
        case "domain":      //domain
            {
                const size = buffer[offset++]
                address.host = buffer.subarray(offset, offset += size!).toString()
            }
            break
        case "IPv6":      //ipv6
            {
                const array = []

                for (let i = 0; i < 8; i++) {
                    array.push(buffer.readUint16BE(offset).toString(16));
                    offset += 2
                }
                address.family = "IPv6"
                address.host = array.join(":")
            }
            break
        default:
            address.host = null
            break
    }

    address.address = address.host

    return offset
}

export function write_address(buffer: Buffer, address: any, offset: number = 0) {

    const address_type_pos = offset
    const names = Common_AddressType_Value

    buffer[offset++] = 1

    switch (address.family) {
        case "IPv4":
            {
                const array = (address.address || address.host).split(".")

                for (let i = 0; i < 4; ++i) {
                    const val = parseInt(array[i])
                    buffer[offset++] = val
                }

                buffer[address_type_pos] = names["IPv4"]
            }
            break
        case "IPv6":
            {
                const array = (address.address || address.host).split(":")

                for (let i = 0; i < 8; ++i) {
                    const val = parseInt(array[i], 16)
                    buffer.writeUint16BE(val, offset)
                    offset += 2
                }

                buffer[address_type_pos] = names["IPv6"]
            }
            break
        default:        //Domain
            {
                const sub = Buffer.from((address.address || address.host))

                buffer[offset++] = sub.byteLength

                sub.copy(buffer, offset, 0, offset += sub.byteLength)

                buffer[address_type_pos] = names["domain"]
            }
            break
    }

    return offset
}