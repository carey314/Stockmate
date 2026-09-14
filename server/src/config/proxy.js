// Verified production topology: nginx on this host -> 127.0.0.1:3100.
// nginx appends $remote_addr; Express walks XFF from right to left, stopping at
// the first non-loopback address. A client-controlled prefix is never trusted.
function configureProxy(app) { app.set('trust proxy', 'loopback'); }
module.exports={configureProxy};
