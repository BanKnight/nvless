import {  WebSocket } from "ws";
import {  Socket as TcpSocket } from "net";
import { Socket as UdpSocket } from "dgram";

declare module 'ws' {
    interface WebSocket {
        id: number;
        pendings:Array<Buffer>;
        next:Function;
    }
}

export interface Dest
{
    port: number;
    host: string;
    protocol: "tcp" | "udp" | "unknown";
}

export type MuxSession = {
    id:number;
    dest:Dest;
    send:(...args:any[])=>void;
    close:()=>void;
}

