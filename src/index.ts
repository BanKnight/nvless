import { stringify, v5, validate } from "uuid"
import { WebSocketServer, WebSocket, createWebSocketStream } from "ws";
import { createConnection } from "net";
import { createSocket } from "dgram";

import { read_address } from "./utils";
import { Dest, MuxSession } from "./types";
import { finished } from "stream";

const PORT = parseInt(process.env.PORT ?? "1080")
const UUID = validate(process.env.UUID ?? "") ?
    process.env.UUID : v5(process.env.UUID!, Buffer.alloc(16))

let start_index = Date.now()

const sessions = {} as Record<string, MuxSession>

const wss = new WebSocketServer({ port: PORT,host:"0.0.0.0" })

wss.on("connection", (ws: WebSocket) => {

    ws.id = start_index++
    ws.pendings = []
    ws.next = head.bind(null, ws)

    ws.on("message", (data: Buffer, isBinary) => {
        ws.pendings.push(data)
        ws.next()
    })
})

const protocol_type_to_name = {
    1: "tcp",
    2: "udp",
    3: "mux"
}

const vless_success_resp = Buffer.from([0, 0])

function head(socket: WebSocket) {

    const buffer = fetch(socket, 24)
    if (buffer == null) {
        return
    }

    let offset = 0

    const version = buffer[offset++]
    const userid = stringify(buffer.subarray(offset, offset += 16))     //1,17

    const optLength = buffer[offset++]      //17
    const optBuffer = buffer.subarray(offset, offset += optLength!)
    const cmd = buffer[offset++] //18+optLength

    //@ts-ignore
    let protocol = protocol_type_to_name[cmd!]
    if (protocol == null) {
        console.error(new Error(`unsupported type:${cmd}`))
        socket.close()
        return
    }

    if (!auth(socket, userid)) {
        //@ts-ignore
        const ip = socket._socket.remoteAddress;
        //@ts-ignore
        const port = socket._socket.remotePort
        console.error(new Error(`auth failed type:${cmd} ${ip}:${port}`))
        socket.close()
        return
    }

    if (protocol == "mux")        //mux
    {
        socket.pendings.push(buffer.subarray(offset))
        socket.next = mux.bind(null, socket)
        mux(socket)
        return
    }

    const dest = {
        host: "",
        protocol,
        port: buffer.readUInt16BE(offset) as unknown as number,
        user: userid,
        version: version!,
    }

    offset += 2

    offset = read_address(buffer, dest, offset)
    if (!dest.host) {
        console.error(new Error(`invalid  addressType`))
        socket.close()
        return
    }

    // socket.pendings = null
    socket.removeAllListeners("message")

    const head = buffer.subarray(offset)
    if (head.length > 0) {
        socket.pendings.unshift(head)
    }

    socket.send(vless_success_resp)

    switch (cmd) {
        case 0x01:      //tcp
            tcp(socket, dest)
            break
        case 0x02:      //udp
            udp(socket, dest)
            break
        default:    //mux
            console.error(new Error(`unsupported type:${cmd}`))
            socket.close()
            break
    }

}

/**
 * 如果数量足够，就取出全部
 * 否则，返回空
 * @param socket 
 * @param at_least 要满足的最小数量
 * @returns 
 */
function fetch(socket: WebSocket, at_least: number) {
    let total = 0
    for (let one of socket.pendings) {
        total += one.length
    }
    if (total < at_least) {
        return
    }

    if (socket.pendings.length == 1) {
        return socket.pendings.pop()
    }
    const buffer = Buffer.allocUnsafe(total)

    let offset = 0

    while (socket.pendings.length > 0) {
        let one = socket.pendings.shift()
        one!.copy(buffer, offset, one!.length)
        offset += one!.length
    }

    return buffer
}

function auth(_: WebSocket, uuid: string) {
    return uuid === UUID
}

function tcp(socket: WebSocket, dest: Dest) {

    if (!dest.host || !dest.port || dest.protocol != "tcp") {
        console.error("cant socket to forward", dest.host, dest.port)
        socket.close()
        return
    }

    const next = createConnection(dest)

    next.setKeepAlive(true)
    next.setNoDelay(true)

    const stream = createWebSocketStream(socket, {
        allowHalfOpen: false,   //可读端end的时候，调用可写端.end()了
        autoDestroy: true,
        emitClose: true,
        objectMode: false,
        writableObjectMode: false
    })

    stream.pipe(next).pipe(stream)

    const destroy = () => {
        if (socket.OPEN) {
            socket.close()
        }

        if (!next.destroyed) {
            next.destroy()
        }
    }
    finished(next, destroy)
    finished(stream, destroy)
}

function udp(socket: WebSocket, dest: Dest) {

    if (!dest.host || !dest.port || dest.protocol != "udp") {
        console.error("cant socket to forward udp", dest.host, dest.port)
        socket.close()
        return
    }

    const next = createSocket("udp4")

    next.connect(dest.port, dest.host)

    next.on("message", (data) => {
        socket.send(data)
    })

    next.on("error", () => {
        next.close()
        socket.close()
    })

    next.on("close", () => {
        socket.close()
    })

    socket.on("message", (data: Buffer) => {
        next.send(data)
    })

    socket.on("error", () => {
        socket.close()
    })

    socket.on("close", () => {
        next.close()
    })
}
function mux(socket: WebSocket) {

    const buffer = fetch(socket, 2 + 2 + 1 + 1)
    if (buffer == null) {
        return
    }
    const meta_length = buffer.readUInt16BE()

    if (meta_length < 4) {
        socket.close()
        return
    }

    if (2 + meta_length > buffer.length) {      //没有收全
        socket.pendings.push(buffer)
        return
    }

    const meta = buffer.subarray(2, 2 + meta_length)
    const type = meta[2]

    const has_extra = meta[3] == 1

    const extra_length_start = 2 + meta_length
    const extra_length = has_extra ? buffer.readUInt16BE(extra_length_start) : 0

    if (has_extra && extra_length_start + 2 + extra_length > buffer.length) {
        socket.pendings.push(buffer)
        return
    }

    let extra: Buffer | undefined
    let left: Buffer | undefined

    if (has_extra) {
        const extra_start = extra_length_start + 2
        extra = buffer.subarray(extra_start, extra_start + extra_length)
        left = buffer.subarray(extra_start + extra_length)
    }
    else {
        left = buffer.subarray(2 + meta_length)
    }

    console.log("😈 recv mux cmd", socket.id, type)

    switch (type) {
        case 1:     //new
            mux_new(socket, meta, extra)
            break
        case 2:
            mux_keep(socket, meta, extra)
            break
        case 3:
            mux_end(socket, meta, extra)
            break
        case 4:
            mux_keepalive(socket, meta, extra)
            break
        default:
            socket.close()
            break
    }

    if (left && left.length > 0) {
        console.log("😈 recv mux left > 0", socket.id, type)
        socket.pendings.push(left)
        mux(socket)
    }
}

function mux_new(socket: WebSocket, meta: Buffer, extra?: Buffer) {

    //@ts-ignore
    const session: MuxSession = sessions[session.id] = {
        id: meta.readUInt16BE(),
        dest: {
            //@ts-ignore
            protocol: protocol_type_to_name[meta[4]!],
            port: meta.readUInt16BE(5),
            host: "",       //Todo
        }
    }

    socket.on("error", () => {
        socket.close()
    })

    socket.on("close", () => {
        delete sessions[session.id]
        session.close()
    })

    read_address(meta, session, 7)

    if (!session.dest.host) {
        socket.close()
        console.error(new Error(`invalid addressType`))
        return
    }

    switch (session.dest.protocol) {
        case "tcp":
            {
                const next = createConnection(session.dest)

                next.setKeepAlive(true)
                next.setNoDelay(true)

                if (extra && extra.length > 0) {
                    socket.send(extra)
                }

                next.on("message", (buffer: Buffer) => {
                    sendClientKeep(socket, meta, buffer)
                })
                next.on("end", () => {
                    if (socket.OPEN) {
                        send_end_resp(socket, meta)
                    }
                    next.destroy()
                })

                next.on("error", () => {
                    next.destroy()
                })

                next.on("close", () => {
                    const deleted = delete sessions[session.id]

                    if (deleted && socket.OPEN) {
                        send_end_resp(socket, meta)
                    }
                })

                session.send = (data: Buffer) => {
                    if (next.writable) {
                        next.write(data)
                    }
                }
                session.close = () => {
                    if (next.writable) {
                        next.destroy()
                    }
                }
            }
            break
        case "udp":
            {
                const next = createSocket("udp4")

                next.connect(session.dest.port, session.dest.host)

                next.on("message", (data) => {
                    sendClientKeep(socket,meta,data)
                })

                next.on("error", () => {
                    next.close()
                    socket.close()
                })
                
                next.on("close", () => {
                    const deleted = delete sessions[session.id]

                    if (deleted && socket.OPEN) {
                        send_end_resp(socket, meta)
                    }                
                })

                session.send = (data: Buffer) => {
                    next.send(data)
                }

                session.close = () => {
                    next.disconnect()
                }
            }
    }
}

function mux_keep(socket: WebSocket, meta: Buffer, extra?: Buffer) {

    const id = meta.readUInt16BE().toString()
    const session = sessions[id]

    if (!session) {
        send_end_resp(socket, meta)
        return
    }
    if (!extra || extra.length == 0) {
        return
    }

    session.send(extra)
}

function mux_end(socket: WebSocket, meta: Buffer, extra?: Buffer) {

    const id = meta.readUInt16BE().toString()

    const session = sessions[id]
    if (session == null) {
        return
    }

    delete sessions[id]

    console.log("mux end", socket.id, id, session.dest.host)

    if (extra) {
        session.send(extra)
    }
    session.close()
}

function mux_keepalive(socket: WebSocket, meta: Buffer, extra?: Buffer) { }

function sendClientKeep(socket: WebSocket, originMeta: Buffer, extra: Buffer) {

    const meta = originMeta.subarray(0, 4)

    meta[2] = 2
    meta[3] = 1

    const resp = Buffer.alloc(2 + meta.length + 2)

    resp.writeUint16BE(meta.length)
    meta.copy(resp, 2)

    resp.writeUint16BE(extra.length, meta.length + 2)

    socket.send(resp)
    socket.send(extra)
}

function send_end_resp(socket: WebSocket, originMeta: Buffer) {

    console.log("😢 send mux end", socket.id, socket.id)

    const meta = originMeta.subarray(0, 4)

    meta[2] = 3     //type
    meta[3] = 0     //has_opt

    const resp = Buffer.allocUnsafe(2)
    resp.writeUint16BE(meta.length)

    socket.send(resp)
    socket.send(meta)
}


