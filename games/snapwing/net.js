/* Snapwing network layer.
   Phones and the big screen talk directly over WebRTC data channels (PeerJS).
   The public PeerJS signalling server only introduces the two sides; after that
   input flows peer-to-peer, so on the same Wi-Fi latency is a few milliseconds.
   No server of our own is needed. Swap this file for a relay later if required. */
window.SnapNet = (() => {
  const PREFIX = 'snapwing-';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L ambiguity
  const CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
  ];
  let libPromise = null;

  function loadLib() {
    if (window.Peer) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const attempt = i => {
        if (i >= CDN.length) { libPromise = null; return reject(new Error('Could not load the connection library. Check the internet connection.')); }
        const s = document.createElement('script');
        s.src = CDN[i];
        s.onload = () => resolve();
        s.onerror = () => attempt(i + 1);
        document.head.appendChild(s);
      };
      attempt(0);
    });
    return libPromise;
  }

  function makeCode(n = 4) { let c = ''; for (let i = 0; i < n; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }

  /* The big screen. Resolves with { code, send(conn,msg), broadcast(msg), close() }. */
  async function host(handlers, attempts = 0) {
    await loadLib();
    return new Promise((resolve, reject) => {
      const code = makeCode();
      const peer = new Peer(PREFIX + code, { debug: 1 });
      const conns = new Map();
      const api = {
        code, peer, conns,
        send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) {} },
        broadcast(msg) { for (const c of conns.values()) api.send(c, msg); },
        close() { try { peer.destroy(); } catch (e) {} },
      };
      peer.on('open', () => resolve(api));
      peer.on('connection', conn => {
        conn.on('open', () => { conns.set(conn.peer, conn); handlers.onJoin && handlers.onJoin(conn); });
        conn.on('data', msg => handlers.onMessage && handlers.onMessage(conn, msg));
        const bye = () => { if (conns.delete(conn.peer)) handlers.onLeave && handlers.onLeave(conn); };
        conn.on('close', bye);
        conn.on('error', bye);
      });
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && attempts < 5) { peer.destroy(); resolve(host(handlers, attempts + 1)); }
        else if (!peer.open) reject(err);
        else handlers.onError && handlers.onError(err);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
    });
  }

  /* A phone. Resolves with { send(msg), close() } once the data channel is open. */
  async function join(code, handlers) {
    await loadLib();
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      let conn = null, settled = false;
      const fail = err => { if (settled) return; settled = true; try { peer.destroy(); } catch (e) {} reject(err); };
      const timeout = setTimeout(() => fail(new Error('No screen answered with that code. Check the code and that the screen is on the Party page.')), 15000);
      peer.on('open', () => {
        conn = peer.connect(PREFIX + normCode(code), { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (settled) return;
          settled = true; clearTimeout(timeout);
          resolve({ peer, conn, send(msg) { try { if (conn.open) conn.send(msg); } catch (e) {} }, close() { try { peer.destroy(); } catch (e) {} } });
          handlers.onOpen && handlers.onOpen();
        });
        conn.on('data', msg => handlers.onMessage && handlers.onMessage(msg));
        conn.on('close', () => { if (settled) handlers.onClose && handlers.onClose(); });
        conn.on('error', e => { if (!settled) fail(e); else handlers.onClose && handlers.onClose(); });
      });
      peer.on('error', err => {
        if (!settled) fail(err.type === 'peer-unavailable' ? new Error('No screen found with that code.') : err);
        else if (err.type !== 'peer-unavailable') handlers.onError && handlers.onError(err);
      });
      peer.on('disconnected', () => { if (settled) { try { peer.reconnect(); } catch (e) {} } });
    });
  }

  return { host, join, makeCode, normCode, loadLib };
})();
