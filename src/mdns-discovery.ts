import {NetworkInterfaceInfo, networkInterfaces} from 'os';
import {debug} from "debug";
import {decode, encode, Question} from "dns-packet";
import {createSocket, SocketType} from "dgram";

export declare interface MulticastDNSOptions {
    name: string;
    port: number;
    ip: string;
    reuseAddress: boolean;
    interfaces: string[];
    type: SocketType;
    question: Question;
    timeout: number;
    broadcast: boolean;
    multicast: boolean;
    multicastTTL: number;
    ttl: number;
    noQuestions: boolean;
    details: boolean;
    returnOnFirstFound: boolean;
    find?: string;
}

const DEFAULT_OPTIONS: MulticastDNSOptions = {
    broadcast: true,
    details: true,
    interfaces: [],
    ip: "224.0.0.251",
    multicast: true,
    multicastTTL: 64,
    noQuestions: true,
    question: {name: "", type: "PTR"},
    reuseAddress: true,
    timeout: 4,
    ttl: 64,
    type: "udp4",
    name: '',
    port: 5353,
    returnOnFirstFound: false
}

export class MulticastDNS {
    private readonly _clients: any[];
    private readonly _found: any[];
    private _onIPs: any;
    private _options: MulticastDNSOptions = DEFAULT_OPTIONS;
    private _timer: any;
    private _validFilter?: (a: any) => boolean;
    private _onEntry?: (a: any) => void;
    private _readyCallback?: (found: any[]) => void;

    public get found(): any[] {
        return this._found;
    }

    public get clients(): any[] {
        return this._clients;
    }

    public get options(): MulticastDNSOptions {
        return this._options;
    }

    constructor(options?: Partial<MulticastDNSOptions>) {
        this.setOptions(options);
        this._clients = [];
        this._found = [];
    }


    public getInterfaces() {
        if (this.options.interfaces && this.options.interfaces.length) return;

        const interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()

        Object.keys(interfaces).forEach(deviceName => {
            const networkInterface = interfaces[deviceName];

            if (!!networkInterface) {
                for (let i = 0; i < networkInterface.length; i++) {
                    const alias = networkInterface[i];
                    if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                        this.options.interfaces.push(alias.address);
                        debug.log("found interface: %s", alias.address);
                    }
                }
            }
        });
    }

    public getPayload() {
        debug.log(this.options.question);
        return encode({
            questions: [this.options.question]
        });
    }

    public prepare(interfaceIP: string) {
        const client = createSocket({type: this.options.type, reuseAddr: this.options.reuseAddress});

        client.on('message', (message, info) => {
            this.onMessage(message, info);
        });


        client.on('listening', () => {
            debug.log("Listening on ", client.address());

            client.setBroadcast(this.options.broadcast);

            if (this.options.multicast && this.options.multicastTTL) {
                client.setMulticastTTL(this.options.multicastTTL);
            }

            if (this.options.ttl) {
                client.setTTL(this.options.ttl);
            }

            if (this.options.question.name) {
                const sendPayload = () => {
                    const payload = this.getPayload();
                    client.send(payload, 0, payload.length, this.options.port, this.options.ip, (err, bytes) => {
                        debug.log(err || 'Sent payload, bytes:', bytes);
                    });
                }

                if (Array.isArray(this.options.question.name)) {
                    const origName = this.options.question.name;
                    origName.forEach((name) => {
                        this.options.question.name = name;
                        sendPayload();
                    });
                    this.options.question.name = origName;
                } else {
                    sendPayload();
                }
            }
        });

        client.on("close", MulticastDNS.onClose.bind(this));
        client.on("error", MulticastDNS.onError.bind(this));

        client.bind(this.options.port, interfaceIP);
        this.clients.push(client);
    }

    public run(readyCallback?: (found: any[]) => void, ) {
        this.getInterfaces();

        this.options.interfaces.forEach((interfaceIP) => this.prepare(interfaceIP));

        this._timer = setTimeout(() => {
            this.close();
            this.found.forEach(info => debug.log("found: %s - %s", info.ip, info.name));

            if (!!readyCallback) {
                this._readyCallback = readyCallback;
                this._readyCallback(this.found);
            }
        }, (this.options.timeout * 1000));

        return this;
    }

    public close() {
        if (this._timer) {
            clearTimeout(this._timer);
            delete this._timer;
        }

        this.clients.forEach((client, i) => {
            if (client) client.close();
            this.clients[i] = undefined;
        });
    }


    public findFirstIP() {
        this.options.returnOnFirstFound = true;
        return new Promise((resolve, reject) => {
            this.run((results) => {
                if (!results || results.length === 0) {
                    reject('No response');
                } else {
                    resolve(results[0].ip);
                }
            });
        })
    }

    public on(name: string, fn: (...args: any[]) => any) {
        switch (name) {
            case 'packet':
                this.onPacket = fn;
                break;
            case 'message':
                this.onMessage = fn;
                break;
            case 'filter':
                this._validFilter = fn;
                break;
            case 'entry':
                this._onEntry = fn.bind(this);
                break;
        }
        return this;
    }

    public setFilter(propName: any, arr: any[]) {
        if (typeof propName === 'function') {
            this._validFilter = propName.bind(this);
            return this;
        }

        /// IDK, this code is bad
        this._validFilter = (a) => {
            const bo = arr.find((v) => v[propName] === a[propName]);
            return !bo;
        };
        return this;
    }

    private onMessage(message: Buffer, info: any) {
        let packets;
        try {
            packets = decode(message);
        } catch (e) {
            return;
        }

        this.onPacket(packets, info);

        if (this._onIPs) {
            const found = this._onIPs.find((entry: { ip: any; }) => (entry.ip === info.address));

            if (found) {
                found.fn(packets, info);
            }
        }

        return this;
    }

    private onPacket(packets: any, info: any) {
        if (this.options.find === undefined || !packets.answers) return;

        const addDetails = (entry: any, a: any) => {
            if (this.options.details && a.type) {
                entry[a.type] = entry[a.type] || {};
                const d = entry[a.type];

                if (a.name) {
                    if (d.name) {
                        d.names = d.names || [d.name];
                        d.names.push(a.name);
                        if (a.name.length > d.name.length) d.name = a.name;
                    } else {
                        d.name = a.name;
                    }
                }
                if (a.data) {
                    if (d.data) {
                        d.dataa = d.dataa || [d.data];
                        d.dataa.push[a.data]
                    }
                    d.data = a.data;
                }
            }
        }

        const doIt = (qa: any, type: any) => {
            if (qa) qa.forEach((a: { name: any; }) => {
                if (this.options.find === '*' || a.name.indexOf(this.options.find) === 0) {
                    if (this._validFilter && !this._validFilter({ip: info.address})) {
                        return;
                    }

                    const alreadyFound = this.found.find(function (v) {
                        return v.ip === info.address;
                    });

                    if (alreadyFound) {
                        addDetails(alreadyFound, a);
                        return;
                    }

                    const entry = {
                        ip: info.address,
                        type: type,
                        name: qa[0].name ? qa[0].name : a.name
                    };

                    addDetails(entry, a);

                    if (this._onEntry) {
                        this._onEntry(entry);
                    } else {
                        this.found.push(entry);
                    }

                    if (this.options.returnOnFirstFound) {
                        this.close();

                        if (!!this._readyCallback) {
                            this._readyCallback(this.found);
                        }
                    }
                }
            });
        }
        doIt(packets.answers, 'answer');

        if (!this.options.noQuestions && packets.questions) {
            doIt(packets.questions, 'query');
        }

        return this;
    }

    private onIP(ip: any, fn: any) {
        const args = arguments;
        if (args.length < 2) {
            return;
        }

        fn = args[args.length - 1];

        if (typeof fn !== 'function') {
            return;
        }

        if (!this._onIPs) {
            this._onIPs = [];
        }

        fn = fn.bind(this);

        for (let i = 0; i < args.length - 1; i++) {
            this._onIPs.push({
                ip: args[i],
                fn: fn
            });
        }

        return this;
    }

    private setOptions(options?: Partial<MulticastDNSOptions> | undefined) {
        const passedOptions: MulticastDNSOptions = Object.assign({}, DEFAULT_OPTIONS);

        if (!!options) {
            Object.assign(passedOptions, options);

            if (passedOptions.question.name.length === 0 && passedOptions.name.length > 0) {
                passedOptions.question.name = passedOptions.name;
            }
        }

        this._options = passedOptions;
    }

    private static onError(err: Error) {
        debug.log('Error!', err);
    }

    private static onClose() {
        debug.log('Closing connection');
    }
}
