const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const INDEX = path.join(__dirname, 'index.html');
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function send(socket, packet) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(packet));
  }
}

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function leave(socket) {
  const room = socket.room;
  if (!room) return;

  socket.room = null;

  if (room.host === socket) {
    if (room.guest) {
      send(room.guest, { type: 'player-left', playerId: 'HOST' });
      room.guest.room = null;
    }
    rooms.delete(room.code);
  } else if (room.guest === socket) {
    room.guest = null;
    send(room.host, {
      type: 'player-left',
      playerId: socket.playerId
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nie znaleziono strony.');
  }

  fs.readFile(INDEX, (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Brak pliku index.html obok server.js.');
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(html);
  });
});

const wss = new WebSocketServer({
  server,
  maxPayload: 1024 * 1024
});

wss.on('connection', socket => {
  socket.room = null;
  socket.playerId = '';

  socket.on('message', raw => {
    let packet;

    try {
      packet = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!packet || typeof packet.type !== 'string') return;

    if (packet.type === 'create-room') {
      leave(socket);

      const code = newCode();
      const room = {
        code,
        host: socket,
        guest: null
      };

      rooms.set(code, room);
      socket.room = room;
      socket.playerId = 'HOST';

      send(socket, {
        type: 'room-created',
        code,
        playerId: 'HOST'
      });
      return;
    }

    if (packet.type === 'join-room') {
      leave(socket);

      const code = String(packet.code || '')
        .replace(/\s+/g, '')
        .toUpperCase();

      const room = rooms.get(code);

      if (!room) {
        send(socket, {
          type: 'error',
          message: 'Nie ma pokoju o takim kodzie.'
        });
        return;
      }

      if (room.guest && room.guest.readyState === WebSocket.OPEN) {
        send(socket, {
          type: 'error',
          message: 'Ten pokój jest już pełny.'
        });
        return;
      }

      room.guest = socket;
      socket.room = room;
      socket.playerId = 'PLAYER2';

      send(socket, {
        type: 'room-joined',
        code,
        playerId: socket.playerId
      });

      send(room.host, {
        type: 'player-joined',
        playerId: socket.playerId
      });
      return;
    }

    if (packet.type === 'ping') {
      send(socket, { type: 'pong', t: packet.t });
      return;
    }

    if (packet.type === 'game') {
      const room = socket.room;
      if (!room || !packet.msg || typeof packet.msg !== 'object') return;

      const recipient = socket === room.host
        ? room.guest
        : room.host;

      if (recipient) {
        send(recipient, {
          type: 'game',
          playerId: socket.playerId,
          msg: packet.msg
        });
      }
    }
  });

  socket.on('close', () => leave(socket));
  socket.on('error', () => leave(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pixel World działa na porcie ${PORT}`);
});
