const { leaves } = require('webtorrent-fixtures')
const bencode = require('bencode')
const Protocol = require('bittorrent-protocol')
const test = require('tape')
const utHodlong = require('../')

test('wire.use(utHodlong())', t => {
  const wire = new Protocol()
  wire.pipe(wire)

  wire.use(utHodlong())

  t.ok(wire.ut_hodlong)
  t.ok(wire.ut_hodlong.fetch)
  t.ok(wire.ut_hodlong.cancel)
  t.ok(wire.ut_hodlong.stats)
  t.end()
})

test('wire.use(utHodlong(stats))', t => {
  const wire = new Protocol()
  wire.pipe(wire)

  wire.use(utHodlong(leaves.torrent))

  t.ok(wire.ut_hodlong)
  t.ok(wire.ut_hodlong.fetch)
  t.ok(wire.ut_hodlong.cancel)

  t.equal(
    wire.ut_hodlong.stats.processedStats,
    bencode.decode(leaves.torrent).processedStats
  )
  t.end()
})
