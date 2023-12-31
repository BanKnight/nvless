import { stringify, v5, validate } from "uuid"
import { WebSocket, createWebSocketStream, WebSocketServer } from "ws";
import { createConnection } from "net";
import { RemoteInfo, createSocket } from "dgram";

import { readAddress, readMetaAddress, writeMetaAddress } from "./utils";
import { Dest, MuxSession, NameProtocols } from "./types";
import { finished } from "stream";

const PORT = parseInt(process.env.PORT ?? "3000")
const UUID = validate(process.env.UUID ?? "") ?
    process.env.UUID : v5(process.env.UUID ?? "inputyouruuid", Buffer.alloc(16))

const WSPATH = process.env.WSPATH ?? ""

let idHelper = 1

const sessions = {} as Record<string, MuxSession>

const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0", path: WSPATH })

let connecting = 0
let lastConnecting = 0

wss.on("connection", (socket: WebSocket) => {

    connecting++

    socket.id = idHelper++
    socket.pendings = []
    socket.next = head.bind(null, socket)
    socket.setMaxListeners(100)

    //@ts-ignore
    // console.log("New connection from", socket.id, socket._socket.remoteAddress, socket._socket.remotePort)

    socket.on("message", (data: Buffer, isBinary) => {
        socket.pendings.push(data)
        socket.next()
    })

    socket.on("error", () => {
        socket.close()
    })

    socket.once("close", () => {
        connecting--
        // console.log("close", socket.id)
    })

    socket.once("close", () => {
        const prefix = socket.id.toString()

        for (const id in sessions) {
            let session = sessions[id]
            if (!id.startsWith(prefix)) {
                continue
            }
            delete sessions[id]
            session?.close?.()
        }
    })
})

setInterval(() => {
    if (connecting != lastConnecting) {
        console.log("Connections alive:", connecting)
    }
    lastConnecting = connecting
}, 5000)

wss.on('error', (e: any) => {

    if (e.code == 'EADDRINUSE') {
        console.error(e)
        //Retry
        return
    }

    // if (proxy.server.force) {
    //     return
    // }
});

wss.on("listening", () => {
    console.log(`listening on ${PORT},uuid:${UUID},path:${WSPATH}`)
    console.log(`vless://${UUID}@127.0.0.1:${PORT}?host=localhost&path=${WSPATH}&type=ws&encryption=none&fp=random&sni=localhost#nvless`)
    console.log("注意修改ip 域名 ")
})


// 仅在发送的时候才用到的buffer
const BUFFER_META_RESERVE = Buffer.allocUnsafe(64)
const BUFFER_LEN_RESERVE = Buffer.allocUnsafe(2)

const BUFFER_SUCCESS_RESP = Buffer.from([0, 0])

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
    let protocol = NameProtocols[cmd!]
    if (protocol == null) {
        console.error("unsupported type:", cmd)
        socket.close()
        return
    }

    if (!auth(socket, userid)) {
        //@ts-ignore
        const ip = socket._socket.remoteAddress;
        //@ts-ignore
        const port = socket._socket.remotePort
        console.error("auth failed type:", cmd, ip, port)
        socket.close()
        return
    }

    if (protocol == "mux") {       //mux
        const head = buffer.subarray(offset)
        socket.pendings.push(head)
        socket.next = mux.bind(null, socket)
        socket.send(BUFFER_SUCCESS_RESP)
        mux(socket)
        return
    }

    //@ts-ignore
    const dest: Dest = {
        protocol,
        port: buffer.readUint16BE(offset),
    }

    offset += 2
    offset = readAddress(buffer, dest, offset)

    if (!dest.host || dest.host.length == 0 || !dest.port) {
        console.error("invalid  addressType:", dest.host, dest.port)
        socket.close()
        return
    }

    socket.removeAllListeners("message")

    socket.send(BUFFER_SUCCESS_RESP)

    const head = buffer.subarray(offset)

    switch (dest.protocol) {
        case "tcp":      //tcp
            tcp(socket, dest, head)
            break
        case "udp":      //udp
            udp(socket, dest, head)
            break
        default:    //unknown
            console.error("unsupported dest.protocol type", cmd)
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
function fetch(socket: { pendings: Array<Buffer> }, at_least: number) {
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
        const one = socket.pendings.shift()
        offset += one!.copy(buffer, offset, one!.length)
    }

    return buffer
}

function auth(_: WebSocket, uuid: string) {
    return uuid === UUID
}

function tcp(socket: WebSocket, dest: Dest, head: Buffer) {

    // console.log("connect to tcp", dest.host, dest.port)

    const next = createConnection({ host: dest.host, port: dest.port }, () => {
        console.log("tcp connected", socket.id, dest.host, dest.port)
    })

    next.setKeepAlive(true)
    next.setNoDelay(true)
    next.setTimeout(3000)

    const stream = createWebSocketStream(socket, {
        allowHalfOpen: false,   //可读端end的时候，调用可写端.end()了
        autoDestroy: true,
        emitClose: true,
        objectMode: false,
        writableObjectMode: false
    })

    if (head.length > 0) {
        // console.log("send head", socket.id, dest.host, dest.port)
        // console.log(head.toString("utf8"))
        stream.unshift(head)
    }

    stream.pipe(next).pipe(stream)

    next.on("error", (error) => {
        console.error(socket.id, dest.host, dest.port, error)
        next.destroySoon()
    })

    const destroy = () => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.close()
        }

        if (!next.destroyed) {
            next.destroy()
        }
    }
    finished(next, destroy)
    finished(stream, destroy)
}

function udp(socket: WebSocket, dest: Dest, head: Buffer) {

    const waiting = { pendings: [] } as { pendings: Buffer[] }

    if (head.length > 0) {
        waiting.pendings.push(head)
    }

    let connected = false
    const target = createSocket("udp4")

    function flushTarget() {
        const buffer = fetch(waiting, 3)
        if (buffer == null) {
            return
        }
        const length = buffer.readUint16BE(0)
        if (2 + length > buffer.length) {
            waiting.pendings.push(buffer)
            return
        }
        const end = 2 + length
        target.send(buffer.subarray(2, end), dest.port, dest.host)

        if (end < buffer.length) {
            waiting.pendings.push(buffer.subarray(end))
            flushTarget()
        }
    }

    target.connect(dest.port, dest.host, () => {
        connected = true
        console.log("udp connected", dest.host, dest.port)
        flushTarget()
    })

    target.on("message", (data) => {

        //由于长度限制，这里要考虑分页
        let offset = 0
        const lenBuffer = BUFFER_LEN_RESERVE

        //这里有问题，udp数据就应该完整弄过去的，但是uint16的长度有上限
        while (offset < data.length) {
            const len = Math.min(data.length - offset, 65535)
            lenBuffer.writeUint16BE(len)
            socket.send(lenBuffer)
            socket.send(data.subarray(offset, offset += len))
        }
    })

    target.on("error", () => {
        target.close()
    })

    target.once("close", () => {
        connected = false
        if (socket.readyState === WebSocket.OPEN) {
            socket.close()
        }
    })

    socket.on("message", (data: Buffer) => {
        waiting.pendings.push(data)
        if (connected) {
            flushTarget()
        }
    })

    socket.on("error", () => {
        socket.close()
    })

    socket.once("close", () => {
        target.close()
    })
}
function mux(socket: WebSocket) {

    const buffer = fetch(socket, 2 + 2 + 1 + 1)
    if (buffer == null) {
        return
    }

    let offset = 0
    const metaLength = buffer.readUInt16BE(offset)

    offset += 2

    if (metaLength < 4) {
        socket.close()
        return
    }

    if (offset + metaLength > buffer.length) {      //没有收全
        socket.pendings.push(buffer)
        return
    }

    const meta = buffer.subarray(offset, offset += metaLength)
    const hasExtra = meta[3] == 1

    //额外数据开始的偏移
    const extra_length = hasExtra ? buffer.readUInt16BE(offset) : 0

    offset += hasExtra ? 2 : 0

    if (hasExtra && offset + extra_length > buffer.length) { //没有收全
        socket.pendings.push(buffer)
        return
    }

    const extra = hasExtra ? buffer.subarray(offset, offset += extra_length) : undefined
    const left = offset < buffer.length ? buffer.subarray(offset) : undefined

    muxDispatch(socket, meta, extra)

    if (left && left.length > 0) {
        // console.log("😈 recv mux left > 0", socket.id, type)
        socket.pendings.push(left)
        mux(socket)
    }
}

function muxDispatch(socket: WebSocket, meta: Buffer, extra?: Buffer) {

    const uid = meta.readUInt16BE()
    const cmd = meta[2]

    if (cmd === 1) {        //创建
        muxNew(socket, uid, meta, extra)
        return
    }

    const id = `${socket.id}/${uid}`
    const session = sessions[id]

    if (!session) {
        sendClientEnd(socket, meta)
        return
    }

    switch (cmd) {
        case 2:
            muxKeep(socket, session, meta, extra)
            break
        case 3:
            muxEnd(socket, session, meta, extra)
            break
        case 4:
            muxKeepAlive(socket, session, meta, extra)
            break
        default:
            socket.close()
            break
    }
}

function muxNew(socket: WebSocket, uid: number, meta: Buffer, extra?: Buffer) {

    const dest: Dest = readMetaAddress(meta)
    const id = `${socket.id}/${uid}`

    if (!dest.host || dest.port === 0) {
        sendClientEnd(socket, meta)
        console.error("invalid mux new addressType:", dest.protocol, id, dest.host, dest.port)
        return
    }

    console.log("😈 mux new", dest.protocol, id, dest.host, dest.port)

    //@ts-ignore
    const session: MuxSession = sessions[id] = {
        id,
        uid,
        dest
    }

    switch (dest.protocol) {
        case "tcp":
            muxNewTcp(socket, session, meta)
            break
        case "udp":
            muxNewUdp(socket, session, meta)
            break
        default:
            socket.close()
            return
    }

    if (extra && extra.length > 0) {
        muxKeep(socket, session, meta, extra)
    }
}

function muxNewTcp(socket: WebSocket, session: MuxSession, meta: Buffer) {

    const target = createConnection({ host: session.dest.host, port: session.dest.port }, () => {
        console.log("mux tcp connected", session.id, session.dest.host, session.dest.port)
    })

    target.setKeepAlive(true)
    target.setNoDelay(true)
    target.setTimeout(3000)

    target.on("data", (buffer: Buffer) => {
        // console.log("-----------recv-----------")
        // console.log(buffer.toString("utf8"))

        sendClientTcpKeep(socket, meta, buffer)
    })
    target.on("end", () => {
        target.destroy()
    })

    target.on("error", () => {
        target.destroy()
    })

    target.once("close", () => {
        const deleted = delete sessions[session.id]
        if (deleted) {
            sendClientEnd(socket, meta)
        }
    })

    session.send = (data: Buffer) => {
        if (target.writable) {
            target.write(data)
        }
    }
    session.close = () => {
        if (target.writable) {
            target.destroySoon()
        }
    }
}

function muxNewUdp(socket: WebSocket, session: MuxSession, meta: Buffer) {

    let alreadyClose = false
    let last = Date.now()

    const target = createSocket("udp4")

    target.bind()
    target.on("message", (data, rinfo: RemoteInfo) => {
        last = Date.now()

        // console.log("send client mux keep udp", session.id, rinfo.address, rinfo.port)
        sendClientUdpKeep(socket, meta, rinfo, data)
    })

    target.on("error", () => {
        target.close()
    })

    const timer = setInterval(() => {
        if (Date.now() - last < 30000) {
            return
        }
        if (!alreadyClose) {
            target.close()
        }
    }, 10000)

    target.once("close", () => {
        alreadyClose = true
        clearInterval(timer)
        const deleted = delete sessions[session.id]
        if (deleted) {
            sendClientEnd(socket, meta)
        }
    })

    session.send = (msg: Buffer, port: number, host: string) => {
        last = Date.now()
        //@ts-ignore
        target.send(msg, port, host)
    }

    session.close = () => {
        if (!alreadyClose) {
            target.close()
        }
    }
}

function muxKeep(socket: WebSocket, session: MuxSession, meta: Buffer, extra?: Buffer) {

    if (!extra || extra.length == 0) {
        return
    }

    if (session.dest.protocol === "tcp") {
        session.send(extra)
        return
    }

    const dest = readMetaAddress(meta)

    session.send(extra, dest.port, dest.host)
}

function muxEnd(socket: WebSocket, session: MuxSession, meta: Buffer, extra?: Buffer) {

    delete sessions[session.id]

    console.log("mux end", session.dest.protocol, session.id, session.dest.host, session.dest.port)

    if (extra) {
        session.send(extra)
    }
    session.close()
}

function muxKeepAlive(socket: WebSocket, session: MuxSession, meta: Buffer, extra?: Buffer) {

    /**
     * 保持连接 (KeepAlive)
        2 字节	1 字节	1 字节
        ID	0x04	选项 Opt
        在保持连接时:
 
        若 Opt(D) 开启，则这一帧所带的数据必须被丢弃。
        ID 可为随机值。
        #应用
     */

    const id = `${socket.id}/${meta.readUInt16BE()}`

    console.log("mux keepAlive", id)
}

function sendClientTcpKeep(socket: WebSocket, originMeta: Buffer, extra: Buffer) {

    if (socket.readyState !== WebSocket.OPEN) {
        return
    }

    const meta = originMeta.subarray(0, 4)

    //[0][1] = id
    meta[2] = 2     //cmd
    meta[3] = 1     //hasExtra 

    if (extra.length < 65535) {
        sendClientMuxData(socket, meta, extra)
        return
    }

    //由于长度限制，这里要考虑分页
    let offset = 0
    while (offset < extra.length) {
        const len = Math.min(extra.length - offset, 65535)
        sendClientMuxData(socket, meta, extra.subarray(offset, offset += len))
    }
}

function sendClientUdpKeep(socket: WebSocket, originMeta: Buffer, rinfo: RemoteInfo, extra: Buffer) {

    if (socket.readyState !== WebSocket.OPEN) {
        return
    }

    const preparedMeta = BUFFER_META_RESERVE

    //id
    preparedMeta[0] = originMeta[0]!
    preparedMeta[1] = originMeta[1]!

    preparedMeta[2] = 2     //cmd
    preparedMeta[3] = 1     //hasExtra 

    const dest: Dest = {
        port: rinfo.port,
        host: rinfo.address,
        protocol: "udp",
        //@ts-ignore
        family: rinfo.family.toLowerCase(),
    }

    const metaLength = writeMetaAddress(preparedMeta, dest, 4)
    const meta = preparedMeta.subarray(0, metaLength)

    if (extra.length < 65535) {
        sendClientMuxData(socket, meta, extra)
        return
    }

    //由于长度限制，这里要考虑分页
    let offset = 0
    while (offset < extra.length) {
        const len = Math.min(extra.length - offset, 65535)
        sendClientMuxData(socket, meta, extra.subarray(offset, offset += len))
    }
}

function sendClientMuxData(socket: WebSocket, meta: Buffer, data: Buffer) {

    //meta.length(2) + meta(meta.length) + data.length(2) + data(data.length)

    const lenBuffer = BUFFER_LEN_RESERVE

    lenBuffer.writeUint16BE(meta.length)

    socket.send(lenBuffer)
    socket.send(meta)

    lenBuffer.writeUint16BE(data.length)

    socket.send(lenBuffer)
    socket.send(data)
}

function sendClientEnd(socket: WebSocket, originMeta: Buffer) {

    if (socket.readyState !== WebSocket.OPEN) {
        return
    }

    // console.log("😢 send mux end", id)

    const meta = originMeta.subarray(0, 4)

    meta[2] = 3     //type
    meta[3] = 0     //has_opt

    const lenBuffer = BUFFER_LEN_RESERVE

    lenBuffer.writeUint16BE(meta.length)

    socket.send(lenBuffer)
    socket.send(meta)
}


