const {EventEmitter} = require('events')
const bencode = require('bencode')
const BitField = require('bitfield')
const debug = require('debug')('ut_hodlong')
const sha1 = require('simple-sha1')
const EOS = require('eosjs')

const BITFIELD_GROW = 1E3
const PIECE_LENGTH = 1 << 14 // 16 KiB

module.exports = stats => {
  class utHodlong extends EventEmitter {
    constructor (wire, eosEndpoint, eosAccount, privateKey, chain) {
      super()

      this._wire = wire

      if (privateKey == null) return this.emit('error', new Error('No private key passed to constructor'))
      else this._privateKey = privateKey
      if (eosEndpoint == null) return this.emit('error', new Error('No eos endpoint passed to constructor'))
      else this._eosEndpoint = eosEndpoint

      if (chain != null) this._chain = chain
      else {
        chain = {
          main: 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906', // main network
          jungle: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca', // jungle testnet
          sys: 'cf057bbfb72640471fd910bcb67639c22df9f92470936cddc1ade0e2f2e7dc4f' // local developer
        }
      }

      this._superpeer = false
      try { if (process.env.ENV_VARIABLE['HODLONG_SUPERPEER'] !== 'TRUE') this._superpeer = true }
      catch (err) {}

      this._connectedId = {}
      this._pendingStats = {}
      this.stats = {}
      this._processedStats = {}
      this._fetching = false
      this._statsComplete = false
      this._statSize = null
      this._incomingPeerId = null
      this._bitfield = new BitField(0, { grow: BITFIELD_GROW })
      // how many reject messages to tolerate before quitting
      this._remainingRejects = null
      if (Buffer.isBuffer(stats)) {
        this.setStats(stats)
      }
      this.peerId = null
    }

    onHandshake (infoHash, peerId, extensions) {
      this._connectedId[peerId] = true
      this._incomingPeerId = peerId
    }

    onExtendedHandshake (handshake) {
      if (!handshake.m || !handshake.m.ut_hodlong) {
        return this.emit('warning', new Error('Peer does not support ut_hodlong'))
      }
      if (!handshake.stats) {
        return this.emit('warning', new Error('Peer does not have any statistics'))
      }
      if (this._incomingPeerId === null) {
        return this.emit('warning', new Error('Peer does not have incoming id'))
      }
      this.setStats(handshake.m.ut_hodlong.stats)
    }

    onMessage (buf) {
      let dict
      let trailer
      try {
        const str = buf.toString()
        const trailerIndex = str.indexOf('ee') + 2
        dict = bencode.decode(str.substring(0, trailerIndex))
        trailer = buf.slice(trailerIndex)
      } catch (err) {
        // drop invalid messages
        return
      }

      switch (dict.msg_type) {
        case 0:
          // ut_hodlong request (from peer)
          // example: { 'msg_type': 0, 'piece': 0 }
          this._onRequest(dict.piece)
          break
        case 1:
          // ut_hodlong data (in response to our request)
          // example: { 'msg_type': 1, 'piece': 0, 'total_size': 3425 }
          this._onData(dict.piece, trailer, dict.total_size)
          break
        case 2:
          // ut_hodlong reject (peer doesn't have piece we requested)
          // { 'msg_type': 2, 'piece': 0 }
          this._onReject(dict.piece)
          break
      }
    }

    /**
     * Ask the peer to send size.
     * @public
     */
    fetch () {
      if (this._statsComplete) {
        return
      }
      this._fetching = true
      if (this._statsSize) {
        this._requestPieces()
      }
    }

    /**
     * Stop asking the peer to send stats.
     * @public
     */
    cancel () {
      this._fetching = false
    }

    setStats (stats) {
      if (this._statsComplete) return true
      debug('set stats')

      // if full torrent dictionary was passed in, pull out just `info` key
      try {
        const info = bencode.decode(stats).info
        if (info) {
          stats = bencode.encode(info)
        }
      } catch (err) {}

      this.cancel()

      this._pendingStats = stats
      this._statsComplete = true
      this._statSize = Object.keys(this.stats).length
      this._wire.extendedHandshake.stats_size = this._statsSize

      this.emit('stats', bencode.encode({
        info: bencode.decode(this.size)
      }))

      return true
    }

    _send (dict, trailer) {
      let buf = bencode.encode(dict)
      if (Buffer.isBuffer(trailer)) {
        buf = Buffer.concat([buf, trailer])
      }
      this._wire.extended('ut_hodlong', buf)
    }

    _request (piece) {
      this._send({ msg_type: 0, piece })
    }

    _data (piece, buf, totalSize) {
      const msg = {msg_type: 1, piece}
      if (typeof totalSize === 'number') {
        msg.total_size = totalSize
      }
      this._send(msg, buf)
    }

    _reject (piece) {
      this._send({msg_type: 2, piece})
    }

    _onRequest (piece) {
      if (!this._statComplete) {
        this._reject(piece)
        return
      }
      const start = piece * PIECE_LENGTH
      let end = start + PIECE_LENGTH
      if (end > this._statsSize) {
        end = this._statsSize
      }
      const buf = this.size.slice(start, end)
      this._data(piece, buf, this._statsSize)
    }

    _onData (piece, buf, totalSize) {
      if (buf.length > PIECE_LENGTH) {
        return
      }
      const datasize = piece * PIECE_LENGTH
      buf.copy(this._pendingStats, datasize)
      if (this._pendingStats[this.peerId] != null) {
        this._pendingStats[this.peerId] += datasize
      }
      else { this._pendingStats[this.peerId] = datasize }
      this._bitfield.set(piece)
      this._checkDone()
    }

    _checkDone () {
      let done = true
      for (let piece = 0; piece < this._numPieces; piece++) {
        if (!this._bitfield.get(piece)) {
          done = false
          break
        }
      }
      if (!done) return

      // attempt to set statistics -- may fail sha1 check
      const success = this.setStats(this.stats)
      this._eosPush()
      if (!success) {
        this._failedStats()
      }
    }

    _requestPieces () {
      this.stats = Buffer.alloc(this._statSize)
      for (let piece = 0; piece < this._numPieces; piece++) {
        this._request(piece)
      }
    }

    _failedStats () {
      // reset bitfield & try again
      this._bitfield = new BitField(0, { grow: BITFIELD_GROW })
      this._remainingRejects -= this._numPieces
      if (this._remainingRejects > 0) {
        this._requestPieces()
      } else {
        this.emit('warning', new Error('Peer sent invalid statistics'))
      }
    }
    _eosPush (amount) {
      if (new Date() - this.last_eos_push < 3000) { return }
      else {
        let eos = EOS({
          keyProvider: this._privateKey,
          httpEndpoint: this._eosEndpoint,
          chain: this._chain.sys
        })
        eos.transaction('hodlong', stats => {
          stats.addstats(this._eosAccount, this._infoId)
        })
      }
    }
  }
  // Name of the bittorrent-protocol extension
  utHodlong.prototype.name = 'ut_hodlong'

  return utHodlong
}
