import assert from 'node:assert/strict';
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';

// Electron V1 fuse indices and sentinel are published by electron/fuses.
// This layout is checked against the pinned, SHA-256-verified Windows runtime.
const file = process.argv[2];
const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const bytes = readFileSync(file);
const marker = bytes.indexOf(sentinel);
assert.ok(marker >= 0 && bytes.indexOf(sentinel, marker + sentinel.length) === -1);
const start = marker + sentinel.length;
assert.equal(bytes[start], 1);
assert.equal(bytes[start + 1], 9);
const offset = start + 2;
const wire = bytes.subarray(offset, offset + 9);
assert.equal(wire.toString('ascii'), '101100011', 'Unexpected upstream Electron fuse defaults');
for (const bit of [0, 2, 3, 7]) wire[bit] = 0x30; // RunAsNode, NODE_OPTIONS, Node inspect, file: privileges.
const handle = openSync(file, 'r+');
try { assert.equal(writeSync(handle, wire, 0, wire.length, offset), wire.length); }
finally { closeSync(handle); }
assert.equal(readFileSync(file).subarray(offset, offset + wire.length).toString('ascii'), '000000001');
