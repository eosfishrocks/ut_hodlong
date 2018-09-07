const { EventEmitter } = require('events')
const bencode = require('bencode')
const BitField = require('bitfield')
const debug = require('debug')('ut_metadata')
const sha1 = require('simple-sha1')

const MAX_METADATA_SIZE = 1E7 // 10 MB
const BITFIELD_GROW = 1E3
const PIECE_LENGTH = 1 << 14 // 16 KiB

module.exports = stats => {
  class utHodlong extends EventEmitter {
    constructor (wire) {
      super()

      this._wire = wire

      this._superpeer = false;
      try{
        if(process.env.ENV_VARIABLE["H_SUPERPEER"] !== "TRUE")  this._superpeer = true;
      }
      //Do nothing with catch; since this is running in a browser, superpeer will default to false.
      catch{}

      this._connectedId = {}
      this._fetching = false
      this._statsComplete = false
      this._statSize = null
      // how many reject messages to tolerate before quitting
      this._remainingRejects = null

      if (Buffer.isBuffer(stats)) {
        this.setStats(stats, peerid)
      }
    }

    onHandshake (infoHash, peerId, extensions) {
      this._connectedId[peerId] = true

    }

    onExtendedHandshake (handshake) {
      if (!handshake.m || !handshake.m.ut_hodlong) {
        return this.emit('warning', new Error('Peer does not support ut_hodlong'))
      }
      if (!handshake.stats) {
        return this.emit('warning', new Error('Peer does not have any statistics'))
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
          // ut_metadata request (from peer)
          // example: { 'msg_type': 0, 'piece': 0 }
          this._onRequest(dict.piece)
          break
        case 1:
          // ut_metadata data (in response to our request)
          // example: { 'msg_type': 1, 'piece': 0, 'total_size': 3425 }
          this._onData(dict.piece, trailer, dict.total_size)
          break
        case 2:
          // ut_metadata reject (peer doesn't have piece we requested)
          // { 'msg_type': 2, 'piece': 0 }
          this._onReject(dict.piece)
          break
      }
    }

    /**
     * Ask the peer to send metadata.
     * @public
     */
    fetch () {
      if (this._metadataComplete) {
        return
      }
      this._fetching = true
      if (this._metadataSize) {
        this._requestPieces()
      }
    }

    /**
     * Stop asking the peer to send metadata.
     * @public
     */
    cancel () {
      this._fetching = false
    }

    setStats (stats) {
      if (this._metadataComplete) return true
      debug('set metadata')

      // if full torrent dictionary was passed in, pull out just `info` key
      try {
        const info = bencode.decode(stats).info
        if (info) {
          stats = bencode.encode(info)
        }
      } catch (err) {}

      this.cancel()

      this.metadata = metadata
      this._metadataComplete = true
      this._metadataSize = this.metadata.length
      this._wire.extendedHandshake.metadata_size = this._metadataSize

      this.emit('metadata', bencode.encode({
        info: bencode.decode(this.metadata)
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
      const msg = { msg_type: 1, piece }
      if (typeof totalSize === 'number') {
        msg.total_size = totalSize
      }
      this._send(msg, buf)
    }

    _reject (piece) {
      this._send({ msg_type: 2, piece })
    }

    _onRequest (piece) {
      if (!this._statComplete) {
        this._reject(piece)
        return
      }
      const start = piece * PIECE_LENGTH
      let end = start + PIECE_LENGTH
      if (end > this._metadataSize) {
        end = this._metadataSize
      }
      const buf = this.metadata.slice(start, end)
      this._data(piece, buf, this._metadataSize)
    }

    _onData (piece, buf, totalSize) {
      if (buf.length > PIECE_LENGTH) {
        return
      }
      buf.copy(this.stats, piece * PIECE_LENGTH)
      this._processData(stats)
      this._checkDone()
    }

    _processData(stats){
      if(this.superpeer){
        this.stats = {...stats, ...this.stats}
      }
      else{
        for (let stat in this.stats){
          if (stat === this.stats){}
          else {
            let found = false
            for (let savedStat in this.stats.key()){
              if (stat === savedStat){
                found = true
                break
              }
              else { this.stats[stat] = stats[stat]}
            }
          }
        }
      }
      return true
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

      if (!success) {
        this._failedMetadata()
      }
    }

    _requestPieces () {
      this.stats = Buffer.alloc(this._statSize)
      for (let piece = 0; piece < this._numPieces; piece++) {
        this._request(piece)
      }
    }
    _failedMetadata () {
      // reset bitfield & try again
      this._bitfield = new BitField(0, { grow: BITFIELD_GROW })
      this._remainingRejects -= this._numPieces
      if (this._remainingRejects > 0) {
        this._requestPieces()
      } else {
        this.emit('warning', new Error('Peer sent invalid statistics'))
      }
    }
  }

  // Name of the bittorrent-protocol extension
  utHodlong.prototype.name = 'ut_hodlong'

  return utHodlong
}
