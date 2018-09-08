const Protocol = require('bittorrent-protocol')
const net = require('net')
const { leaves } = require('webtorrent-fixtures')
const utHodlong = require('../')

net.createServer(socket => {
  let wire = new Protocol()
  socket.pipe(wire).pipe(socket)
  wire.use(utHodlong(leaves.torrent))
  wire.ut_hodlong.fetch()
  // handle handshake
  wire.on('stats', (infoHash, peerId) => {
    console.log(`received stats from $(peerId)`)
  })
}).listen(6881)
