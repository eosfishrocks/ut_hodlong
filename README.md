### BitTorrent Extension to exchange statistics for the HODLONG EOS application (BEP 9)

This extension's purpose is to allow HODLONG clients to send and verify statistics from the webtorrent integration.

Works in the browser with [browserify](http://browserify.org/)! This module is used by [HODLONG](https://hodlong.com).


### usage

This package should be used with [bittorrent-protocol](https://www.npmjs.com/package/bittorrent-protocol), which supports a plugin-like system for extending the protocol with additional functionality.

Say you're already using `bittorrent-protocol`. Your code might look something like this:

### api

#### `ut_hodlong([stats])`

Initialize the extension. If you have a statistics dictionary from the hodlong webtorrent, pass the statistics to the
`ut_hodlong` constructor so it's made available to the peer.

#### `ut_metadata.fetch()`

Ask the peer to send their statistics.

#### `ut_metadata.cancel()`

Stop asking the peer to send statistics.

#### `ut_metadata.setStats(stats)`

Set the statistics from the peer. If your implementation is run on a super peer, it will collate all the statistics from the peer.
If your peer is not a super peer, it will only verify the neighboring signed statistics and the extenstion will not process outside peers.

#### `ut_metadata.on('hodlong', function (stats) {})`

Fired as statistics are being collated. Will run at a max of every minute.

```js
wire.ut_metadata.on('hodlong', metadata => {
  console.log(Buffer.isBuffer(stats)) // true
})
```

Note: the event will not fire if the peer does not support ut_metadata, if they
don't have metadata yet either, if they repeatedly send invalid data, or if they
simply don't respond.

#### `ut_metadata.on('warning', function (err) {})`

Fired if:
 - the peer does not support ut_hodlong
 - the peer doesn't have any statistics
 - the peer repeatedly sent invalid statistics.

```js
wire.ut_hodlong.on('warning', err => {
  console.log(err.message)
})
```

### license

MIT. Copyright (c)
