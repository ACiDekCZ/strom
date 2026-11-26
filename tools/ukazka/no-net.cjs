// Loaded into every node process of a demo research (NODE_OPTIONS in env.json, build-demo.ts):
// nothing of the demo goes to the network. Only this computer's own addresses (the bridge, the
// app's page) and local sockets are reached; anything else fails at once, before a name is
// looked up or a packet leaves. The invented archives (*.example.org) are never asked.
'use strict';
const net = require('node:net');

const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3}|0\.0\.0\.0)$/i;

/** The host a Socket#connect call is going to: undefined for a local socket (a path). */
function target(args) {
    let a = args[0];
    if (Array.isArray(a)) a = a[0]; // net.connect hands its normalised arguments over as one array
    if (a && typeof a === 'object') return a.path ? undefined : String(a.host ?? 'localhost');
    if (typeof a === 'string' && Number.isNaN(Number(a))) return undefined; // connect(path)
    return typeof args[1] === 'string' ? args[1] : 'localhost';
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const host = target(args);
    if (host !== undefined && !LOCAL.test(host.replace(/^\[|\]$/g, ''))) {
        const err = Object.assign(new Error(`showcase: no network from the demo (${host})`), { code: 'ECONNREFUSED' });
        process.nextTick(() => this.destroy(err));
        return this;
    }
    return connect.apply(this, args);
};
