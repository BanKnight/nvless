import { WebSocket } from "ws";
import { Socket as TcpSocket } from "net";
import { Socket as UdpSocket } from "dgram";

declare module 'ws' {
    interface WebSocket {
        id: number;
        pendings: Array<Buffer>;
        next: Function;
    }
}


// export type VlessProtocol = "tcp" | "udp" | "mux" | "unknown"

export const Protocols = {
    tcp: 1,
    udp: 2,
    mux: 3,
}


export const NameProtocols = Object.entries(Protocols).reduce((acc, [key, value]) => {
    //@ts-ignore
    acc[value] = key;
    return acc;
}, {} as Record<ProtocolValue, Protocol>)

export type Protocol = keyof typeof Protocols;
export type ProtocolValue = typeof Protocols[Protocol];

export interface Dest {
    port: number;
    host: string;
    protocol: Protocol | undefined;
    family: "ipv4" | "ipv6" | "domain";
}

export type MuxSession = {
    id: string;
    uid: number;
    dest: Dest;
    send: (...args: any[]) => void;
    close: () => void;
}




