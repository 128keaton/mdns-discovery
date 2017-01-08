"use strict";

var debug = require('debug')('mdns-discovery'),
    dgram = require("dgram"),
    packet = require('dns-packet');

var defaultOptions = {
    //name: 'm_d_n_s',
    nsme: '',
    port: 5353,
    ip: "224.0.0.251",
    reuseAddr: true,
    interfaces: [],
    type: 'udp4',
    q: {
        name: '',
        type: 'PTR',
        class: 0x8001
    },
    timeout: 4,
    broadcast: true,
    multicast: true,
    multicastTTL: 64,
    ttl: 64
    //returnOnFirstFound: false,
	//find: 'string'
};


function MulticastDNS(opts) {
    if (this instanceof MulticastDNS === false) {
        return new MulticastDNS(opts);
    }
    this.setOptions(opts);
    this.clients = [];
    this.found = [];
}


function checkOptions (opts, def) {
    //opts = opts || {};
    def = def || defaultOptions;
    for (var prop in def) {
        if (def.hasOwnProperty(prop)) {
            if (def[prop] instanceof Array) {
                if (!opts[prop]) opts[prop] = [].concat(def[prop]);
            } else if (typeof def[prop] === 'object') {
                if (typeof opts[prop] !== 'object') {
                    opts[prop] = {};
                }
                checkOptions(opts[prop], def[prop]);
            } else {
                if (opts[prop] === undefined) opts[prop] = def[prop];
            }
        }
    }
    //return opts;
}


MulticastDNS.prototype.setOptions = function (opts) {
    opts = opts || {};
    opts.q = opts.q || {};
    opts.q.name = opts.q.name || opts.name;
    var to = opts.timeout;
    checkOptions(opts);
    if (!opts.find && !to) opts.timeout = 0;
    this.options = opts;
}


MulticastDNS.prototype.getInterfaces = function () {
    if (this.options.interfaces && this.options.interfaces.length) return;
    var self = this;
    var interfaces = require('os').networkInterfaces();
    for (var devName in interfaces) {
        var iface = interfaces[devName];
        for (var i = 0; i < iface.length; i++) {
            var alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                self.options.interfaces.push(alias.address);
                debug("found interface: %s", alias.address);
            }
        }
    }
};
MulticastDNS.prototype.browse = MulticastDNS.prototype.run;


MulticastDNS.prototype.getPayload = function () {
    var message = packet.encode({
        questions: [this.options.q]
        // questions:[{
        //     name: this.options.q.name,
        //     type: this.options.q.type, //'PTR',
        //     class: this.options.q.class, //0x8001,
        //     //ttl: 3600
        // }]
    });
    return message;
};


MulticastDNS.prototype.onClose = function () {
};

MulticastDNS.prototype.onError = function (err) {
};


MulticastDNS.prototype.prepare = function (interfaceIp) {
    
    var client = dgram.createSocket({ type: this.options.type, reuseAddr: this.options.reuseAddr });
    
    client.on("message", function(message, rinfo) {
        this.onMessage(message, rinfo);
    }.bind(this));
    client.on("listening", function() {
        debug("listening on ",client.address());
        
        client.setBroadcast(this.options.broadcast !== false);
    
        if (this.options.multicast !== false) {
            if (this.options.addMembership !== false) {
                client.addMembership(this.options.ip, interfaceIp);
            }
            if (this.options.multicastTTL) client.setMulticastTTL(this.options.multicastTTL);
            client.setMulticastLoopback(this.options.multicastLoopback !== false);
        }
        if (this.options.ttl) client.setTTL(this.options.ttl);
        if (this.options.q.name) {
            var payload = this.getPayload();
            client.send(payload, 0, payload.length, this.options.port, this.options.ip, function (err, bytes) {
            });
        }
    }.bind(this));
    client.on("close", this.onClose.bind(this));
    client.on("error", this.onError.bind(this));
    
    client.bind(this.options.port, interfaceIp);
    this.clients.push(client);
};


MulticastDNS.prototype.close = function () {
    if (this.timer) {
        clearTimeout(this.timer);
        delete this.timer;
    }
    this.clients.forEach(function(client, i) {
        if (client) client.close();
        this.clients[i] = undefined;
    }.bind(this));
};


MulticastDNS.prototype.run = function (timeout, readyCallback) {
    if (typeof timeout === 'function') {
        readyCallback = timeout;
        timeout = undefined; 
    }
    if (timeout === undefined) timeout = this.options.timeout;
    this.getInterfaces();
    this.options.interfaces.forEach(function(interfaceIp) {
        this.prepare(interfaceIp);
    }.bind(this));
    if (readyCallback) this.readyCallback = readyCallback.bind(this);
    if (timeout) this.timer = setTimeout(function() {
        this.close();
        if (debug.enabled) {
            this.found.foreEach(function(info) {
               debug("found: %s - %s", info.ip, info.name);
            });
        }
        this.readyCallback && this.readyCallback(this.found);
    }.bind(this), timeout * 1000);
    return this;
};


MulticastDNS.prototype.setFilter = function (propName, arr) {
    if (typeof propName === 'function') {
        this.validFilter = propName.bind(this);
        return this;
    }
    this.validFilter = function(a) {
        var bo = arr.find(function(v) {
            return v[propName] === a[propName]
        });
        return !bo;
    };
    return this;
};


MulticastDNS.prototype.onPacket = function (packets, rinfo) {
    //this.options.find = 'amzn.dmgr:';
    if (!this.options.find || !packets.answers) return;
    
    packets.answers.forEach(function(a) {
        if (a.name.indexOf(this.options.find) === 0) {
            if (this.validFilter && !this.validFilter({ ip: rinfo.address })) return;
            var found = this.found.find(function(v) {
                return v.ip === rinfo.address;
            });
            if (found) return;
            
            this.found.push({
                ip: rinfo.address,
                //name: a.name
                name: packets.answers[0].name ? packets.answers[0].name : a.name
            });
            if (this.options.returnOnFirstFound) {
                this.close();
                this.readyCallback(this.found);
            }
        }
    }.bind(this));
    return this;
};


MulticastDNS.prototype.on = function (name, fn) {
    switch(name) {
        case 'packet': this.__proto__.onPacket = fn; break;
        case 'message': this.__proto__.onMessage = fn; break;
        case 'filter': this.validFilter = fn; break;
    }
    return this;
}


MulticastDNS.prototype.onIP = function (ip, fn) {
    var args = arguments;
    if (args.length < 2) return;
    fn = args[args.length-1];
    if (typeof fn !== 'function') return;
    if (!this.onIPs) this.onIPs = [];
    fn = fn.bind(this);
    for (var i=0; i<args.length-1; i++) {
        this.onIPs.push({
            ip: args[i],
            fn: fn
        });
    }
    return this;
}


MulticastDNS.prototype.onMessage = function (message, rinfo) {
    
    var packets;
    try {
        packets = packet.decode(message);
    } catch(e) {
        return;
    }
    this.onPacket(packets, rinfo);
    
    if (this.onIPs) {
        var found = this.onIPs.find(function(entry) {
            return (entry.ip === rinfo.address);
        });
        if (found) found.fn(packets, rinfo);
    }
    
    if (debug.enabled && packets.answers) packets.answers.forEach(function(packet, i) {
        //debug('packet[%d]=%s type=%s class=%d, ttl=%d', i, packet.name, packet.type, packet.class, packet.ttl);
        debug(`${rinfo.address} - packet[${i}]=${packet.name}, type=${packet.type}, class=${packet.class}, ttl=${packet.ttl}}`);
    });
    return this;
};


module.exports = MulticastDNS;
