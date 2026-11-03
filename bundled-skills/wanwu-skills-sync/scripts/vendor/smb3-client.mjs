// smb3-client 0.2.0 (MIT). See smb3-client.LICENSE.txt. Generated from its published dist/index.js using esbuild --bundle --minify-syntax --platform=node --format=esm --target=node20.

// Wanwu integration patches: idle socket timeout, bounded stream read-ahead short-read detection and directory continuation, and negotiated dialect/credit checks.

// dist/client.js
import { Writable as Writable2, PassThrough } from "node:stream";

// dist/transport/socket.js
import { connect } from "node:net";
import { EventEmitter } from "node:events";

// dist/transport/framer.js
function frame(payload) {
  if (payload.length > 16777215)
    throw new RangeError(`frame: payload ${payload.length} exceeds 24-bit limit`);
  let hdr = Buffer.alloc(4);
  return hdr[0] = 0, hdr[1] = payload.length >>> 16 & 255, hdr[2] = payload.length >>> 8 & 255, hdr[3] = payload.length & 255, Buffer.concat([hdr, payload]);
}
var FrameReader = class {
  buf = Buffer.alloc(0);
  feed(chunk) {
    this.buf = this.buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buf, chunk]);
  }
  next() {
    if (this.buf.length < 4)
      return null;
    let len = this.buf[1] << 16 | this.buf[2] << 8 | this.buf[3];
    if (this.buf.length < 4 + len)
      return null;
    let payload = Buffer.from(this.buf.subarray(4, 4 + len));
    return this.buf = Buffer.from(this.buf.subarray(4 + len)), payload;
  }
};

// dist/transport/socket.js
var TcpTransport = class _TcpTransport extends EventEmitter {
  socket;
  reader = new FrameReader();
  closed = !1;
  constructor(socket) {
    super();
    socket.setTimeout(30000, () => socket.destroy(new Error("SMB connection timed out")));
    this.socket = socket, socket.on("data", (chunk) => {
      this.reader.feed(chunk);
      let m;
      for (; (m = this.reader.next()) !== null; )
        this.emit("message", m);
    }), socket.on("error", (err) => this.emit("error", err)), socket.on("close", () => {
      this.closed || (this.closed = !0, this.emit("close"));
    });
  }
  static connect(host, port = 445, opts = {}) {
    return new Promise((resolve, reject) => {
      let sock = connect({ host, port }), onError = (err) => {
        cleanup(), reject(err);
      }, onConnect = () => {
        cleanup(), resolve(new _TcpTransport(sock));
      }, timer = null, cleanup = () => {
        timer && clearTimeout(timer), sock.off("error", onError), sock.off("connect", onConnect);
      };
      sock.once("error", onError), sock.once("connect", onConnect), opts.timeoutMs && opts.timeoutMs > 0 && (timer = setTimeout(() => {
        sock.destroy(new Error(`connect timeout after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs));
    });
  }
  send(frame2) {
    if (this.closed)
      throw new Error("TcpTransport: closed");
    this.socket.write(frame2);
  }
  close() {
    this.closed || (this.closed = !0, this.socket.end());
  }
};

// dist/connection/connection.js
import { randomBytes } from "node:crypto";
import { EventEmitter as EventEmitter2 } from "node:events";

// dist/wire/buffer.js
var Reader = class _Reader {
  buf;
  offset = 0;
  constructor(buf) {
    this.buf = buf;
  }
  remaining() {
    return this.buf.length - this.offset;
  }
  need(n) {
    if (this.remaining() < n)
      throw new RangeError(`Reader: need ${n} bytes, have ${this.remaining()}`);
  }
  u8() {
    this.need(1);
    let v = this.buf.readUInt8(this.offset);
    return this.offset += 1, v;
  }
  u16() {
    this.need(2);
    let v = this.buf.readUInt16LE(this.offset);
    return this.offset += 2, v;
  }
  u32() {
    this.need(4);
    let v = this.buf.readUInt32LE(this.offset);
    return this.offset += 4, v;
  }
  u64() {
    this.need(8);
    let v = this.buf.readBigUInt64LE(this.offset);
    return this.offset += 8, v;
  }
  bytes(n) {
    this.need(n);
    let v = Buffer.from(this.buf.subarray(this.offset, this.offset + n));
    return this.offset += n, v;
  }
  utf16(byteLength) {
    this.need(byteLength);
    let v = this.buf.subarray(this.offset, this.offset + byteLength).toString("utf16le");
    return this.offset += byteLength, v;
  }
  sub(offset, length) {
    if (offset < 0 || length < 0 || offset + length > this.buf.length)
      throw new RangeError("Reader.sub: out of range");
    return new _Reader(Buffer.from(this.buf.subarray(offset, offset + length)));
  }
  view() {
    return this.buf;
  }
}, Writer = class {
  chunks = [];
  len = 0;
  get offset() {
    return this.len;
  }
  push(b) {
    this.chunks.push(b), this.len += b.length;
  }
  u8(v) {
    let b = Buffer.alloc(1);
    b.writeUInt8(v & 255, 0), this.push(b);
  }
  u16(v) {
    let b = Buffer.alloc(2);
    b.writeUInt16LE(v & 65535, 0), this.push(b);
  }
  u32(v) {
    let b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0), this.push(b);
  }
  u64(v) {
    let b = Buffer.alloc(8);
    b.writeBigUInt64LE(v, 0), this.push(b);
  }
  bytes(b) {
    this.push(Buffer.from(b));
  }
  utf16(s) {
    this.push(Buffer.from(s, "utf16le"));
  }
  pad(n) {
    n > 0 && this.push(Buffer.alloc(n));
  }
  padTo(boundary) {
    let rem = this.len % boundary;
    rem !== 0 && this.pad(boundary - rem);
  }
  buffer() {
    return Buffer.concat(this.chunks, this.len);
  }
};

// dist/wire/commands.js
var SmbCommand = {
  NEGOTIATE: 0,
  SESSION_SETUP: 1,
  LOGOFF: 2,
  TREE_CONNECT: 3,
  TREE_DISCONNECT: 4,
  CREATE: 5,
  CLOSE: 6,
  FLUSH: 7,
  READ: 8,
  WRITE: 9,
  LOCK: 10,
  IOCTL: 11,
  CANCEL: 12,
  ECHO: 13,
  QUERY_DIRECTORY: 14,
  CHANGE_NOTIFY: 15,
  QUERY_INFO: 16,
  SET_INFO: 17,
  OPLOCK_BREAK: 18
}, Dialect = {
  SMB_2_0_2: 514,
  SMB_2_1_0: 528,
  SMB_3_0_0: 768,
  SMB_3_0_2: 770,
  SMB_3_1_1: 785
}, HeaderFlag = {
  SERVER_TO_REDIR: 1,
  ASYNC_COMMAND: 2,
  RELATED_OPERATIONS: 4,
  SIGNED: 8,
  PRIORITY_MASK: 112,
  DFS_OPERATIONS: 268435456,
  REPLAY_OPERATION: 536870912
}, NegotiateContextType = {
  PREAUTH_INTEGRITY_CAPABILITIES: 1,
  ENCRYPTION_CAPABILITIES: 2,
  COMPRESSION_CAPABILITIES: 3,
  NETNAME_NEGOTIATE_CONTEXT_ID: 5,
  TRANSPORT_CAPABILITIES: 6,
  RDMA_TRANSFORM_CAPABILITIES: 7,
  SIGNING_CAPABILITIES: 8
}, SecurityMode = {
  SIGNING_ENABLED: 1,
  SIGNING_REQUIRED: 2
}, Capability = {
  DFS: 1,
  LEASING: 2,
  LARGE_MTU: 4,
  MULTI_CHANNEL: 8,
  PERSISTENT_HANDLES: 16,
  DIRECTORY_LEASING: 32,
  ENCRYPTION: 64
}, Cipher = {
  AES_128_CCM: 1,
  AES_128_GCM: 2,
  AES_256_CCM: 3,
  AES_256_GCM: 4
}, ShareFlag = {
  ENCRYPT_DATA: 32768
}, NTStatus = {
  STATUS_SUCCESS: 0,
  STATUS_PENDING: 259,
  STATUS_NOTIFY_CLEANUP: 267,
  STATUS_NOTIFY_ENUM_DIR: 268,
  STATUS_MORE_PROCESSING_REQUIRED: 3221225494,
  STATUS_NO_MORE_FILES: 2147483654,
  STATUS_END_OF_FILE: 3221225489,
  STATUS_INVALID_PARAMETER: 3221225485,
  STATUS_ACCESS_DENIED: 3221225506,
  STATUS_OBJECT_NAME_NOT_FOUND: 3221225524,
  STATUS_OBJECT_NAME_COLLISION: 3221225525,
  STATUS_OBJECT_PATH_NOT_FOUND: 3221225530,
  STATUS_NO_SUCH_FILE: 3221225487,
  STATUS_SHARING_VIOLATION: 3221225539,
  STATUS_FILE_LOCK_CONFLICT: 3221225556,
  STATUS_NOT_A_DIRECTORY: 3221225731,
  STATUS_FILE_IS_A_DIRECTORY: 3221225658,
  STATUS_DIRECTORY_NOT_EMPTY: 3221225729,
  STATUS_DISK_FULL: 3221225599,
  STATUS_NETWORK_NAME_DELETED: 3221225673,
  STATUS_BAD_NETWORK_NAME: 3221225676,
  STATUS_PRIVILEGE_NOT_HELD: 3221225569,
  STATUS_LOGON_FAILURE: 3221225581,
  STATUS_PASSWORD_EXPIRED: 3221225585,
  STATUS_ACCOUNT_DISABLED: 3221225586,
  STATUS_ACCOUNT_RESTRICTION: 3221225582,
  STATUS_USER_SESSION_DELETED: 3221225987,
  STATUS_NETWORK_SESSION_EXPIRED: 3221226332,
  STATUS_CANCELLED: 3221225760,
  STATUS_INVALID_HANDLE: 3221225480,
  STATUS_DELETE_PENDING: 3221225558
};
function isSuccess(status) {
  return status === NTStatus.STATUS_PENDING ? !1 : status >>> 30 === 0;
}
function isPending(status) {
  return status === NTStatus.STATUS_PENDING;
}
var _statusReverse = Object.fromEntries(Object.entries(NTStatus).map(([k, v]) => [v, k]));
function statusName(status) {
  return _statusReverse[status] ?? `0x${status.toString(16).toUpperCase().padStart(8, "0")}`;
}

// dist/wire/smb2-header.js
var PROTOCOL_ID = Buffer.from([254, 83, 77, 66]), SMB2_HEADER_SIZE = 64;
function encodeHeader(h) {
  let w = new Writer();
  if (w.bytes(PROTOCOL_ID), w.u16(SMB2_HEADER_SIZE), w.u16(h.creditCharge), w.u32(h.status >>> 0), w.u16(h.command), w.u16(h.creditRequestResponse), w.u32(h.flags >>> 0), w.u32(h.nextCommand ?? 0), w.u64(h.messageId), h.flags & HeaderFlag.ASYNC_COMMAND) {
    if (h.asyncId === void 0)
      throw new Error("encodeHeader: asyncId required when ASYNC flag set");
    w.u64(h.asyncId);
  } else
    w.u32(0), w.u32(h.treeId ?? 0);
  if (w.u64(h.sessionId), h.signature) {
    if (h.signature.length !== 16)
      throw new Error("signature must be 16 bytes");
    w.bytes(h.signature);
  } else
    w.pad(16);
  return w.buffer();
}
function decodeHeader(buf) {
  if (buf.length < SMB2_HEADER_SIZE)
    throw new RangeError(`SMB2 header too short: ${buf.length}`);
  if (!buf.subarray(0, 4).equals(PROTOCOL_ID))
    throw new Error("decodeHeader: bad protocol id");
  let r = new Reader(buf);
  r.bytes(4);
  let structureSize = r.u16();
  if (structureSize !== SMB2_HEADER_SIZE)
    throw new Error(`decodeHeader: unexpected StructureSize ${structureSize}`);
  let creditCharge = r.u16(), status = r.u32(), command = r.u16(), creditRequestResponse = r.u16(), flags = r.u32(), nextCommand = r.u32(), messageId = r.u64(), isAsync = (flags & HeaderFlag.ASYNC_COMMAND) !== 0, treeId, asyncId;
  isAsync ? asyncId = r.u64() : (r.u32(), treeId = r.u32());
  let sessionId = r.u64(), signature = r.bytes(16), base = {
    command,
    creditCharge,
    creditRequestResponse,
    flags,
    messageId,
    sessionId,
    status,
    nextCommand,
    signature
  };
  return { header: isAsync ? { ...base, asyncId } : { ...base, treeId }, bodyOffset: SMB2_HEADER_SIZE, isAsync };
}

// dist/wire/structs/negotiate.js
var STRUCT_SIZE_REQ = 36;
function encodeNegotiateRequest(req) {
  if (req.clientGuid.length !== 16)
    throw new Error("clientGuid must be 16 bytes");
  let has311 = req.dialects.includes(Dialect.SMB_3_1_1);
  if (has311 && (!req.preauthSalt || req.preauthSalt.length !== 32))
    throw new Error("preauthSalt (32 bytes) required when SMB 3.1.1 is advertised");
  let w = new Writer();
  if (w.u16(STRUCT_SIZE_REQ), w.u16(req.dialects.length), w.u16(req.securityMode), w.u16(0), w.u32(req.capabilities), w.bytes(req.clientGuid), has311) {
    let ciphers = req.ciphers ?? [], ctxCount = 1 + (ciphers.length > 0 ? 1 : 0), ctxOffsetPatchAt = w.offset;
    w.u32(0), w.u16(ctxCount), w.u16(0);
    for (let d of req.dialects)
      w.u16(d);
    w.padTo(8);
    let ctxOffsetFromHeader = 64 + w.offset, buf = w.buffer();
    buf.writeUInt32LE(ctxOffsetFromHeader, ctxOffsetPatchAt);
    let ctx = new Writer();
    if (ctx.u16(NegotiateContextType.PREAUTH_INTEGRITY_CAPABILITIES), ctx.u16(38), ctx.u32(0), ctx.u16(1), ctx.u16(32), ctx.u16(1), ctx.bytes(req.preauthSalt), ciphers.length > 0) {
      ctx.padTo(8), ctx.u16(NegotiateContextType.ENCRYPTION_CAPABILITIES);
      let encDataLen = 2 + 2 * ciphers.length;
      ctx.u16(encDataLen), ctx.u32(0), ctx.u16(ciphers.length);
      for (let c of ciphers)
        ctx.u16(c);
    }
    return ctx.padTo(8), Buffer.concat([buf, ctx.buffer()]);
  }
  w.u64(0n);
  for (let d of req.dialects)
    w.u16(d);
  return w.buffer();
}
var STRUCT_SIZE_RESP = 65;
function decodeNegotiateResponse(body, bodyAt = 64) {
  let r = new Reader(body), structureSize = r.u16();
  if (structureSize !== STRUCT_SIZE_RESP)
    throw new Error(`NEGOTIATE response StructureSize ${structureSize} != 65`);
  let securityMode = r.u16(), dialect = r.u16(), negotiateContextCount = r.u16(), serverGuid = r.bytes(16), capabilities = r.u32(), maxTransactSize = r.u32(), maxReadSize = r.u32(), maxWriteSize = r.u32(), systemTime = r.u64(), serverStartTime = r.u64(), securityBufferOffset = r.u16(), securityBufferLength = r.u16(), negotiateContextOffsetField = r.u32(), securityBuffer = Buffer.alloc(0);
  if (securityBufferLength > 0) {
    let start = securityBufferOffset - bodyAt;
    securityBuffer = Buffer.from(body.subarray(start, start + securityBufferLength));
  }
  let out = {
    dialect,
    securityMode,
    serverGuid,
    capabilities,
    maxTransactSize,
    maxReadSize,
    maxWriteSize,
    systemTime,
    serverStartTime,
    securityBuffer
  };
  if (dialect === Dialect.SMB_3_1_1 && negotiateContextCount > 0) {
    let cursor = negotiateContextOffsetField - bodyAt;
    out.cipherIds = [];
    for (let i = 0; i < negotiateContextCount; i++) {
      let ctxR = new Reader(body);
      ctxR.offset = cursor;
      let ctxType = ctxR.u16(), dataLen = ctxR.u16();
      ctxR.u32();
      let dataStart = ctxR.offset;
      if (ctxType === NegotiateContextType.PREAUTH_INTEGRITY_CAPABILITIES) {
        let hashAlgCount = ctxR.u16(), saltLen = ctxR.u16();
        hashAlgCount >= 1 && (out.preauthHashAlg = ctxR.u16());
        for (let j = 1; j < hashAlgCount; j++)
          ctxR.u16();
        out.preauthSalt = ctxR.bytes(saltLen);
      } else if (ctxType === NegotiateContextType.ENCRYPTION_CAPABILITIES) {
        let cipherCount = ctxR.u16();
        for (let j = 0; j < cipherCount; j++)
          out.cipherIds.push(ctxR.u16());
      }
      cursor = dataStart + dataLen + 7 & -8;
    }
  }
  return out;
}

// dist/wire/structs/cancel.js
function encodeCancelRequest() {
  return Buffer.from([4, 0, 0, 0]);
}

// dist/connection/credits.js
var CreditWindow = class {
  credits;
  waiters = [];
  constructor(credits) {
    this.credits = credits;
  }
  available() {
    return this.credits;
  }
  take(n) {
    return n <= 0 ? Promise.resolve() : this.credits >= n ? (this.credits -= n, Promise.resolve()) : new Promise((resolve, reject) => {
      this.waiters.push({ n, resolve, reject });
    });
  }
  release(n) {
    if (!(n <= 0))
      for (this.credits += n; this.waiters.length > 0 && this.credits >= this.waiters[0].n; ) {
        let w = this.waiters.shift();
        this.credits -= w.n, w.resolve();
      }
  }
};

// dist/connection/preauth.js
import { createHash } from "node:crypto";
var PreauthHash = class {
  value = Buffer.alloc(64);
  update(data) {
    this.value = createHash("sha512").update(Buffer.concat([this.value, data])).digest();
  }
  digest() {
    return Buffer.from(this.value);
  }
};

// dist/connection/encryption.js
import { createCipheriv, createDecipheriv } from "node:crypto";

// dist/errors.js
var STATUS_TO_CODE = {
  [NTStatus.STATUS_OBJECT_NAME_NOT_FOUND]: "ENOENT",
  [NTStatus.STATUS_OBJECT_PATH_NOT_FOUND]: "ENOENT",
  [NTStatus.STATUS_NO_SUCH_FILE]: "ENOENT",
  [NTStatus.STATUS_OBJECT_NAME_COLLISION]: "EEXIST",
  [NTStatus.STATUS_ACCESS_DENIED]: "EACCES",
  [NTStatus.STATUS_PRIVILEGE_NOT_HELD]: "EACCES",
  [NTStatus.STATUS_SHARING_VIOLATION]: "EBUSY",
  [NTStatus.STATUS_FILE_LOCK_CONFLICT]: "EBUSY",
  [NTStatus.STATUS_DELETE_PENDING]: "EBUSY",
  [NTStatus.STATUS_NOT_A_DIRECTORY]: "ENOTDIR",
  [NTStatus.STATUS_FILE_IS_A_DIRECTORY]: "EISDIR",
  [NTStatus.STATUS_DIRECTORY_NOT_EMPTY]: "ENOTEMPTY",
  [NTStatus.STATUS_DISK_FULL]: "ENOSPC",
  [NTStatus.STATUS_NETWORK_NAME_DELETED]: "ENXIO",
  [NTStatus.STATUS_BAD_NETWORK_NAME]: "ENXIO",
  [NTStatus.STATUS_INVALID_PARAMETER]: "EINVAL",
  [NTStatus.STATUS_CANCELLED]: "ECANCELED"
};
function statusToCode(status) {
  return STATUS_TO_CODE[status];
}
var SmbError = class extends Error {
  status;
  statusName;
  code;
  constructor(opts) {
    super(opts.message, opts.cause === void 0 ? void 0 : { cause: opts.cause }), this.name = "SmbError", this.status = opts.status, this.statusName = statusName(opts.status), this.code = statusToCode(opts.status);
  }
}, SmbAuthError = class extends SmbError {
  constructor(opts) {
    super(opts), this.name = "SmbAuthError";
  }
}, SmbProtocolError = class extends SmbError {
  constructor(opts) {
    super(opts), this.name = "SmbProtocolError";
  }
};

// dist/connection/encryption.js
var TRANSFORM_PROTOCOL_ID = Buffer.from([253, 83, 77, 66]), TRANSFORM_HEADER_SIZE = 52, AUTH_TAG_LEN = 16, ENCRYPTED_FLAG = 1;
function isTransformHeader(buf) {
  return buf.length < 4 ? !1 : buf[0] === 253 && buf[1] === 83 && buf[2] === 77 && buf[3] === 66;
}
function isCcm(cipherId) {
  return cipherId === Cipher.AES_128_CCM || cipherId === Cipher.AES_256_CCM;
}
function nonceLength(cipherId) {
  return isCcm(cipherId) ? 11 : 12;
}
function counterNonce(counter, cipherId) {
  let nlen = nonceLength(cipherId), nonce = Buffer.alloc(nlen);
  return nonce.writeBigUInt64LE(counter, 0), nonce;
}
function aeadEncrypt(cipherId, key, nonce, aad, plaintext) {
  if (cipherId === Cipher.AES_128_CCM || cipherId === Cipher.AES_256_CCM) {
    let alg = cipherId === Cipher.AES_128_CCM ? "aes-128-ccm" : "aes-256-ccm", c = createCipheriv(alg, key, nonce, { authTagLength: AUTH_TAG_LEN });
    return c.setAAD(aad, { plaintextLength: plaintext.length }), { ciphertext: Buffer.concat([c.update(plaintext), c.final()]), tag: c.getAuthTag() };
  }
  if (cipherId === Cipher.AES_128_GCM || cipherId === Cipher.AES_256_GCM) {
    let alg = cipherId === Cipher.AES_128_GCM ? "aes-128-gcm" : "aes-256-gcm", c = createCipheriv(alg, key, nonce, { authTagLength: AUTH_TAG_LEN });
    return c.setAAD(aad), { ciphertext: Buffer.concat([c.update(plaintext), c.final()]), tag: c.getAuthTag() };
  }
  throw new SmbProtocolError({ status: 0, message: `unsupported cipher 0x${cipherId.toString(16)}` });
}
function aeadDecrypt(cipherId, key, nonce, aad, ciphertext, tag) {
  if (cipherId === Cipher.AES_128_CCM || cipherId === Cipher.AES_256_CCM) {
    let alg = cipherId === Cipher.AES_128_CCM ? "aes-128-ccm" : "aes-256-ccm", d = createDecipheriv(alg, key, nonce, { authTagLength: AUTH_TAG_LEN });
    return d.setAuthTag(tag), d.setAAD(aad, { plaintextLength: ciphertext.length }), Buffer.concat([d.update(ciphertext), d.final()]);
  }
  if (cipherId === Cipher.AES_128_GCM || cipherId === Cipher.AES_256_GCM) {
    let alg = cipherId === Cipher.AES_128_GCM ? "aes-128-gcm" : "aes-256-gcm", d = createDecipheriv(alg, key, nonce, { authTagLength: AUTH_TAG_LEN });
    return d.setAuthTag(tag), d.setAAD(aad), Buffer.concat([d.update(ciphertext), d.final()]);
  }
  throw new SmbProtocolError({ status: 0, message: `unsupported cipher 0x${cipherId.toString(16)}` });
}
function encryptMessage(plaintext, keys, sessionId, counter) {
  let nonce = counterNonce(counter, keys.cipherId), header = Buffer.alloc(TRANSFORM_HEADER_SIZE);
  TRANSFORM_PROTOCOL_ID.copy(header, 0), nonce.copy(header, 20), header.writeUInt32LE(plaintext.length, 36), header.writeUInt16LE(ENCRYPTED_FLAG, 42), header.writeBigUInt64LE(sessionId, 44);
  let aad = header.subarray(20, 52), { ciphertext, tag } = aeadEncrypt(keys.cipherId, keys.encryption, nonce, aad, plaintext);
  return tag.copy(header, 4), Buffer.concat([header, ciphertext]);
}
function decryptMessage(frame2, keys, expectedSessionId) {
  if (frame2.length < TRANSFORM_HEADER_SIZE)
    throw new SmbProtocolError({ status: 0, message: "TRANSFORM frame too short" });
  if (!isTransformHeader(frame2))
    throw new SmbProtocolError({ status: 0, message: "TRANSFORM bad ProtocolId" });
  let tag = frame2.subarray(4, 20), originalSize = frame2.readUInt32LE(36), flags = frame2.readUInt16LE(42);
  if (flags !== ENCRYPTED_FLAG)
    throw new SmbProtocolError({ status: 0, message: `TRANSFORM Flags=0x${flags.toString(16)}, expected 0x0001` });
  if (frame2.readBigUInt64LE(44) !== expectedSessionId)
    throw new SmbProtocolError({ status: 0, message: "TRANSFORM SessionId mismatch" });
  let ciphertext = frame2.subarray(TRANSFORM_HEADER_SIZE);
  if (ciphertext.length !== originalSize)
    throw new SmbProtocolError({
      status: 0,
      message: `TRANSFORM length mismatch: ciphertext=${ciphertext.length} OriginalMessageSize=${originalSize}`
    });
  let aad = frame2.subarray(20, 52), nonce = frame2.subarray(20, 20 + nonceLength(keys.cipherId));
  try {
    return aeadDecrypt(keys.cipherId, keys.decryption, nonce, aad, ciphertext, tag);
  } catch (err) {
    throw err instanceof SmbProtocolError ? err : new SmbProtocolError({
      status: 0,
      message: `TRANSFORM auth failure: ${err.message}`,
      cause: err
    });
  }
}

// dist/connection/connection.js
var Connection = class extends EventEmitter2 {
  transport;
  nextMessageId = 0n;
  pendingByMessageId = /* @__PURE__ */ new Map();
  pendingByAsyncId = /* @__PURE__ */ new Map();
  /** Tracks the asyncId assigned by the server for pending async requests, keyed by messageId string. */
  asyncIdByMessageId = /* @__PURE__ */ new Map();
  credits = new CreditWindow(1);
  preauth = new PreauthHash();
  negotiated = null;
  closed = !1;
  verifier = null;
  signCancel = null;
  encryptor = null;
  encryptionRequired = !1;
  signingRequired = !1;
  constructor(transport) {
    super(), this.transport = transport, transport.on("message", (msg) => this.onMessage(msg)), transport.on("close", () => this.onClose()), transport.on("error", (err) => this.onError(err));
  }
  get state() {
    return this.negotiated;
  }
  async open(opts = {}) {
    let dialects = opts.dialects ?? [
      Dialect.SMB_2_1_0,
      Dialect.SMB_3_0_0,
      Dialect.SMB_3_0_2,
      Dialect.SMB_3_1_1
    ], clientGuid = opts.clientGuid ?? randomBytes(16), preauthSalt = randomBytes(32), reqBody = encodeNegotiateRequest({
      dialects,
      clientGuid,
      capabilities: opts.capabilities ?? Capability.LARGE_MTU,
      securityMode: opts.securityMode ?? SecurityMode.SIGNING_ENABLED,
      preauthSalt,
      ...opts.ciphers !== void 0 ? { ciphers: opts.ciphers } : {}
    }), result = await this.send(SmbCommand.NEGOTIATE, reqBody, { creditCharge: 0 });
    if (!isSuccess(result.header.status))
      throw new SmbProtocolError({
        status: result.header.status,
        message: `NEGOTIATE failed: ${statusName(result.header.status)}`
      });
    let resp = decodeNegotiateResponse(result.body, SMB2_HEADER_SIZE);
    if (!dialects.includes(resp.dialect)) throw new SmbProtocolError({ status: 0, message: "Server selected an unsupported SMB dialect" });
    let negotiated = {
      dialect: resp.dialect,
      serverGuid: resp.serverGuid,
      capabilities: resp.capabilities,
      securityMode: resp.securityMode,
      maxReadSize: resp.maxReadSize,
      maxWriteSize: resp.maxWriteSize,
      maxTransactSize: resp.maxTransactSize,
      securityBuffer: resp.securityBuffer,
      ...resp.preauthHashAlg !== void 0 ? { preauthHashAlg: resp.preauthHashAlg } : {},
      ...resp.preauthSalt !== void 0 ? { preauthSalt: resp.preauthSalt } : {},
      ...resp.cipherIds !== void 0 ? { cipherIds: resp.cipherIds } : {}
    };
    return this.negotiated = negotiated, this.negotiated;
  }
  async send(command, body, opts = {}) {
    if (this.closed)
      throw new SmbProtocolError({ status: 0, message: "connection closed" });
    let charge = opts.creditCharge ?? 1;
    await this.credits.take(Math.max(charge, 1));
    let messageId = this.nextMessageId++, flags = opts.flags ?? 0, wantEncrypt = opts.encrypt === !0 && this.encryptor !== null, header = encodeHeader({
      command,
      creditCharge: charge,
      creditRequestResponse: 1,
      flags,
      messageId,
      sessionId: opts.sessionId ?? 0n,
      treeId: opts.treeId ?? 0,
      status: 0
    }), frameBuf = Buffer.concat([header, body]);
    if (opts.signing && !wantEncrypt) {
      let signedFlags = flags | HeaderFlag.SIGNED;
      header = encodeHeader({
        command,
        creditCharge: charge,
        creditRequestResponse: 1,
        flags: signedFlags,
        messageId,
        sessionId: opts.sessionId ?? 0n,
        treeId: opts.treeId ?? 0,
        status: 0
      }), frameBuf = Buffer.concat([header, body]), opts.signing.sign(frameBuf).copy(frameBuf, 48);
    }
    (command === SmbCommand.NEGOTIATE || command === SmbCommand.SESSION_SETUP) && this.preauth.update(frameBuf);
    let promise = new Promise((resolve, reject) => {
      this.pendingByMessageId.set(messageId.toString(), {
        resolve,
        reject,
        expectsAsync: command === SmbCommand.CHANGE_NOTIFY,
        encrypted: wantEncrypt
      });
    }), wire = wantEncrypt ? this.encryptor.encrypt(frameBuf) : frameBuf;
    return this.transport.send(frame(wire)), promise;
  }
  preauthDigest() {
    return this.preauth.digest();
  }
  setVerifier(fn) {
    this.verifier = fn;
  }
  setCancelSigner(fn) {
    this.signCancel = fn;
  }
  setEncryptor(e) {
    this.encryptor = e;
  }
  /** When true, plaintext responses (other than SESSION_SETUP) cause a fatal protocol error. */
  setEncryptionRequired(v) {
    this.encryptionRequired = v;
  }
  /** When true, post-handshake plaintext-unsigned responses cause a fatal protocol error. */
  setSigningRequired(v) {
    this.signingRequired = v;
  }
  onMessage(raw) {
    let msg = raw, wasEncrypted = !1;
    if (isTransformHeader(raw)) {
      if (this.encryptor === null) {
        this.fail(new SmbProtocolError({ status: 0, message: "received encrypted frame but no encryptor installed" }));
        return;
      }
      try {
        msg = this.encryptor.decrypt(raw), wasEncrypted = !0;
      } catch (err) {
        let message = err instanceof Error ? err.message : String(err);
        this.fail(new SmbProtocolError({ status: 0, message: `decrypt failed: ${message}` }));
        return;
      }
    }
    let parsed;
    try {
      parsed = decodeHeader(msg);
    } catch (err) {
      this.fail(new SmbProtocolError({ status: 0, message: `bad SMB2 header: ${err.message}` }));
      return;
    }
    let { header } = parsed, body = Buffer.from(msg.subarray(SMB2_HEADER_SIZE));
    if (!wasEncrypted && this.encryptionRequired && header.command !== SmbCommand.SESSION_SETUP) {
      this.fail(new SmbProtocolError({
        status: 0,
        message: "plaintext response received but session requires encryption"
      }));
      return;
    }
    if (!wasEncrypted && this.signingRequired && header.command !== SmbCommand.NEGOTIATE && header.command !== SmbCommand.SESSION_SETUP && (header.flags & HeaderFlag.SIGNED) === 0) {
      this.fail(new SmbProtocolError({
        status: 0,
        message: "unsigned response received but signing is required"
      }));
      return;
    }
    if (!wasEncrypted && (header.flags & HeaderFlag.SIGNED) !== 0 && this.verifier !== null) {
      let working = Buffer.from(msg);
      working.fill(0, 48, 64);
      let sig = header.signature ?? Buffer.alloc(16);
      if (!this.verifier(working, sig)) {
        this.fail(new SmbProtocolError({ status: 0, message: "signature verify failed" }));
        return;
      }
    }
    this.credits.release(header.creditRequestResponse), header.command === SmbCommand.NEGOTIATE ? this.preauth.update(msg) : header.command === SmbCommand.SESSION_SETUP && header.status === NTStatus.STATUS_MORE_PROCESSING_REQUIRED && this.preauth.update(msg);
    let messageKey = header.messageId.toString(), pending = this.pendingByMessageId.get(messageKey);
    if (!pending) {
      if (header.asyncId !== void 0) {
        let asyncKey = header.asyncId.toString(), a = this.pendingByAsyncId.get(asyncKey);
        if (a) {
          this.pendingByAsyncId.delete(asyncKey), this.asyncIdByMessageId.delete(messageKey), a.resolve({ header, body });
          return;
        }
      }
      return;
    }
    if (isPending(header.status) && header.asyncId !== void 0) {
      this.pendingByAsyncId.set(header.asyncId.toString(), pending), this.asyncIdByMessageId.set(messageKey, header.asyncId), this.pendingByMessageId.delete(messageKey);
      return;
    }
    this.pendingByMessageId.delete(messageKey), pending.resolve({ header, body });
  }
  onClose() {
    this.closed = !0, this.fail(new SmbProtocolError({ status: 0, message: "connection closed" })), this.emit("close");
  }
  onError(err) {
    this.fail(new SmbProtocolError({ status: 0, message: err.message, cause: err }));
  }
  fail(err) {
    this.closed = true;
    this.transport.close();
    for (const waiter of this.credits.waiters.splice(0)) waiter.reject(err);
    for (let p of this.pendingByMessageId.values())
      p.reject(err);
    for (let p of this.pendingByAsyncId.values())
      p.reject(err);
    this.pendingByMessageId.clear(), this.pendingByAsyncId.clear(), this.asyncIdByMessageId.clear();
  }
  cancel(opts) {
    if (this.closed)
      return;
    let asyncId = opts.asyncId ?? this.asyncIdByMessageId.get(opts.messageId.toString()), encryptCancel = (this.pendingByMessageId.get(opts.messageId.toString()) ?? (asyncId !== void 0 ? this.pendingByAsyncId.get(asyncId.toString()) : void 0))?.encrypted === !0 && this.encryptor !== null, flags = asyncId !== void 0 ? HeaderFlag.ASYNC_COMMAND : 0;
    !encryptCancel && this.signCancel !== null && (flags = flags | HeaderFlag.SIGNED);
    let header = encodeHeader({
      command: SmbCommand.CANCEL,
      creditCharge: 1,
      creditRequestResponse: 0,
      flags,
      messageId: opts.messageId,
      sessionId: opts.sessionId ?? 0n,
      ...asyncId !== void 0 ? { asyncId } : { treeId: opts.treeId ?? 0 },
      status: 0
    }), body = encodeCancelRequest(), frameBuf = Buffer.concat([header, body]);
    !encryptCancel && this.signCancel !== null && this.signCancel(frameBuf).copy(frameBuf, 48);
    let wire = encryptCancel ? this.encryptor.encrypt(frameBuf) : frameBuf;
    this.transport.send(frame(wire));
  }
  close() {
    this.closed || (this.closed = !0, this.transport.close());
  }
};

// dist/session/ntlm.js
import { randomBytes as randomBytes2 } from "node:crypto";

// dist/session/keys.js
import { createHmac } from "node:crypto";
function md4(buf) {
  let F = (x, y, z) => x & y | ~x & z, G = (x, y, z) => x & y | x & z | y & z, H = (x, y, z) => x ^ y ^ z, ROL = (x, n) => (x << n | x >>> 32 - n) >>> 0, lenBits = BigInt(buf.length) * 8n, padLen = (56 - (buf.length + 1) % 64 + 64) % 64, total = buf.length + 1 + padLen + 8, m = Buffer.alloc(total);
  buf.copy(m, 0), m[buf.length] = 128, m.writeBigUInt64LE(lenBits, total - 8);
  let a = 1732584193, b = 4023233417, c = 2562383102, d = 271733878;
  for (let i = 0; i < total; i += 64) {
    let X = [];
    for (let j = 0; j < 16; j++)
      X.push(m.readUInt32LE(i + j * 4));
    let aa = a, bb = b, cc = c, dd = d, r1 = [3, 7, 11, 19];
    for (let j = 0; j < 16; j++) {
      let k = j, s = r1[j % 4];
      a = ROL(a + F(b, c, d) + X[k] >>> 0, s), [a, b, c, d] = [d, a, b, c];
    }
    let r2 = [3, 5, 9, 13], o2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
    for (let j = 0; j < 16; j++) {
      let k = o2[j], s = r2[j % 4];
      a = ROL(a + G(b, c, d) + X[k] + 1518500249 >>> 0, s), [a, b, c, d] = [d, a, b, c];
    }
    let r3 = [3, 9, 11, 15], o3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let j = 0; j < 16; j++) {
      let k = o3[j], s = r3[j % 4];
      a = ROL(a + H(b, c, d) + X[k] + 1859775393 >>> 0, s), [a, b, c, d] = [d, a, b, c];
    }
    a = a + aa >>> 0, b = b + bb >>> 0, c = c + cc >>> 0, d = d + dd >>> 0;
  }
  let out = Buffer.alloc(16);
  return out.writeUInt32LE(a, 0), out.writeUInt32LE(b, 4), out.writeUInt32LE(c, 8), out.writeUInt32LE(d, 12), out;
}
function hmacMd5(key, data) {
  return createHmac("md5", key).update(data).digest();
}
function ntowfV2(password, username, domain) {
  let ntPasswordHash = md4(Buffer.from(password, "utf16le")), id = Buffer.from(username.toUpperCase() + domain, "utf16le");
  return hmacMd5(ntPasswordHash, id);
}
function kdfSp800108CounterHmacSha256(ki, label, context, outBytes) {
  let lBits = outBytes * 8, out = [], produced = 0, counter = 1;
  for (; produced < outBytes; ) {
    let c = Buffer.alloc(4);
    c.writeUInt32BE(counter, 0);
    let sep = Buffer.from([0]), lEnc = Buffer.alloc(4);
    lEnc.writeUInt32BE(lBits, 0);
    let block = createHmac("sha256", ki).update(c).update(label).update(sep).update(context).update(lEnc).digest();
    out.push(block), produced += block.length, counter++;
  }
  return Buffer.concat(out, outBytes);
}

// dist/session/ntlm.js
var NTLMSSP_FLAGS = {
  NEGOTIATE_UNICODE: 1,
  NEGOTIATE_OEM: 2,
  REQUEST_TARGET: 4,
  NEGOTIATE_SIGN: 16,
  NEGOTIATE_SEAL: 32,
  NEGOTIATE_NTLM: 512,
  NEGOTIATE_DOMAIN_SUPPLIED: 4096,
  NEGOTIATE_WORKSTATION_SUPPLIED: 8192,
  NEGOTIATE_ALWAYS_SIGN: 32768,
  NEGOTIATE_EXTENDED_SESSIONSECURITY: 524288,
  NEGOTIATE_TARGET_INFO: 8388608,
  NEGOTIATE_VERSION: 33554432,
  NEGOTIATE_128: 536870912,
  NEGOTIATE_KEY_EXCH: 1073741824,
  NEGOTIATE_56: 2147483648
}, SIGNATURE = Buffer.from("NTLMSSP\0");
function encodeNegotiateMessage() {
  let w = new Writer();
  w.bytes(SIGNATURE), w.u32(1);
  let flags = NTLMSSP_FLAGS.NEGOTIATE_UNICODE | NTLMSSP_FLAGS.NEGOTIATE_OEM | NTLMSSP_FLAGS.REQUEST_TARGET | NTLMSSP_FLAGS.NEGOTIATE_SIGN | NTLMSSP_FLAGS.NEGOTIATE_NTLM | NTLMSSP_FLAGS.NEGOTIATE_ALWAYS_SIGN | NTLMSSP_FLAGS.NEGOTIATE_EXTENDED_SESSIONSECURITY | NTLMSSP_FLAGS.NEGOTIATE_TARGET_INFO | NTLMSSP_FLAGS.NEGOTIATE_VERSION | NTLMSSP_FLAGS.NEGOTIATE_128 | NTLMSSP_FLAGS.NEGOTIATE_KEY_EXCH | NTLMSSP_FLAGS.NEGOTIATE_56;
  return w.u32(flags >>> 0), w.u16(0), w.u16(0), w.u32(0), w.u16(0), w.u16(0), w.u32(0), w.bytes(Buffer.alloc(8)), w.buffer();
}
function decodeChallengeMessage(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE))
    throw new Error("NTLMSSP: bad signature");
  if (buf.readUInt32LE(8) !== 2)
    throw new Error("NTLMSSP: not CHALLENGE");
  let tnLen = buf.readUInt16LE(12), tnOffset = buf.readUInt32LE(16), flags = buf.readUInt32LE(20), serverChallenge = Buffer.from(buf.subarray(24, 32)), tiLen = buf.readUInt16LE(40), tiOffset = buf.readUInt32LE(44), targetName = tnLen > 0 ? Buffer.from(buf.subarray(tnOffset, tnOffset + tnLen)).toString("utf16le") : "", targetInfo = tiLen > 0 ? Buffer.from(buf.subarray(tiOffset, tiOffset + tiLen)) : Buffer.alloc(0);
  return { flags, serverChallenge, targetName, targetInfo };
}
function nowFiletime() {
  let epochDiffSec = 11644473600n, ms = BigInt(Date.now());
  return (ms / 1000n + epochDiffSec) * 10000000n + ms % 1000n * 10000n;
}
function computeNtlmV2(inp) {
  let responseKeyNT = ntowfV2(inp.password, inp.username, inp.domain), time = inp.time ?? nowFiletime(), tempW = new Writer();
  tempW.u8(1), tempW.u8(1), tempW.bytes(Buffer.alloc(6)), tempW.u64(time), tempW.bytes(inp.clientChallenge), tempW.u32(0), tempW.bytes(inp.targetInfo), tempW.u32(0);
  let temp = tempW.buffer(), ntProofInput = Buffer.concat([inp.serverChallenge, temp]), ntProofStr = hmacMd5(responseKeyNT, ntProofInput), ntChallengeResponse = Buffer.concat([ntProofStr, temp]), lm = hmacMd5(responseKeyNT, Buffer.concat([inp.serverChallenge, inp.clientChallenge])), lmChallengeResponse = Buffer.concat([lm, inp.clientChallenge]), sessionBaseKey = hmacMd5(responseKeyNT, ntProofStr);
  return { ntChallengeResponse, lmChallengeResponse, sessionBaseKey };
}
function encodeAuthenticateMessage(inp) {
  let domainBytes = Buffer.from(inp.domain, "utf16le"), userBytes = Buffer.from(inp.username, "utf16le"), wsBytes = Buffer.from(inp.workstation ?? "", "utf16le"), off = 88, lmOff = off;
  off += inp.lmChallengeResponse.length;
  let ntOff = off;
  off += inp.ntChallengeResponse.length;
  let domainOff = off;
  off += domainBytes.length;
  let userOff = off;
  off += userBytes.length;
  let wsOff = off;
  off += wsBytes.length;
  let sessKeyOff = off;
  off += inp.encryptedRandomSessionKey.length;
  let total = off, w = new Writer();
  w.bytes(SIGNATURE), w.u32(3), w.u16(inp.lmChallengeResponse.length), w.u16(inp.lmChallengeResponse.length), w.u32(lmOff), w.u16(inp.ntChallengeResponse.length), w.u16(inp.ntChallengeResponse.length), w.u32(ntOff), w.u16(domainBytes.length), w.u16(domainBytes.length), w.u32(domainOff), w.u16(userBytes.length), w.u16(userBytes.length), w.u32(userOff), w.u16(wsBytes.length), w.u16(wsBytes.length), w.u32(wsOff), w.u16(inp.encryptedRandomSessionKey.length), w.u16(inp.encryptedRandomSessionKey.length), w.u32(sessKeyOff), w.u32(inp.flags >>> 0), w.bytes(Buffer.alloc(8));
  let micPos = w.offset;
  w.bytes(Buffer.alloc(16)), w.bytes(inp.lmChallengeResponse), w.bytes(inp.ntChallengeResponse), w.bytes(domainBytes), w.bytes(userBytes), w.bytes(wsBytes), w.bytes(inp.encryptedRandomSessionKey);
  let buf = w.buffer();
  if (buf.length !== total)
    throw new Error(`AUTH msg length mismatch: ${buf.length} vs ${total}`);
  if (inp.mic) {
    let concat = Buffer.concat([inp.mic.negotiateMessage, inp.mic.challengeMessage, buf]);
    hmacMd5(inp.mic.exportedSessionKey, concat).copy(buf, micPos, 0, 16);
  }
  return buf;
}
function generateClientChallenge() {
  return randomBytes2(8);
}
function generateExportedSessionKey() {
  return randomBytes2(16);
}
function rc4(key, data) {
  let S = new Uint8Array(256);
  for (let i2 = 0; i2 < 256; i2++)
    S[i2] = i2;
  let j = 0;
  for (let i2 = 0; i2 < 256; i2++)
    j = j + S[i2] + key[i2 % key.length] & 255, [S[i2], S[j]] = [S[j], S[i2]];
  let out = Buffer.alloc(data.length), i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = i + 1 & 255, j = j + S[i] & 255, [S[i], S[j]] = [S[j], S[i]];
    let t = S[i] + S[j] & 255;
    out[k] = data[k] ^ S[t];
  }
  return out;
}

// dist/session/spnego.js
var NTLMSSP_OID = Buffer.from("2b06010401823702020a", "hex"), SPNEGO_OID = Buffer.from("2b0601050502", "hex");
function derLen(n) {
  if (n < 128)
    return Buffer.from([n]);
  let bytes = [], v = n;
  for (; v > 0; )
    bytes.unshift(v & 255), v >>>= 8;
  return Buffer.from([128 | bytes.length, ...bytes]);
}
function tlv(tag, value) {
  return Buffer.concat([Buffer.from([tag]), derLen(value.length), value]);
}
function readLen(buf, off) {
  let first = buf[off++];
  if (first < 128)
    return { len: first, off };
  let numBytes = first & 127, len = 0;
  for (let i = 0; i < numBytes; i++)
    len = len << 8 | buf[off++];
  return { len, off };
}
function wrapInitNegToken(ntlmToken) {
  let oidTlv = tlv(6, NTLMSSP_OID), mechTypeList = tlv(48, oidTlv), mechTypes = tlv(160, mechTypeList), mechToken = tlv(162, tlv(4, ntlmToken)), negTokenInit = tlv(48, Buffer.concat([mechTypes, mechToken])), negTokenTagged = tlv(160, negTokenInit), inner = Buffer.concat([tlv(6, SPNEGO_OID), negTokenTagged]);
  return tlv(96, inner);
}
function wrapNegTokenResp(ntlmToken) {
  let responseToken = tlv(162, tlv(4, ntlmToken)), negTokenResp = tlv(48, responseToken);
  return tlv(161, negTokenResp);
}
function extractNtlmFromResp(spnego) {
  let off = 0;
  if (spnego[off] === 161) {
    if (off++, { off } = readLen(spnego, off), spnego[off++] !== 48)
      throw new Error("SPNEGO: expected SEQUENCE");
    for ({ off } = readLen(spnego, off); off < spnego.length; ) {
      let tag = spnego[off++], { len, off: o } = readLen(spnego, off);
      if (off = o, tag === 162) {
        if (spnego[off++] !== 4)
          throw new Error("SPNEGO: expected OCTET STRING");
        let { len: l, off: o2 } = readLen(spnego, off);
        return Buffer.from(spnego.subarray(o2, o2 + l));
      }
      off += len;
    }
  }
  throw new Error("SPNEGO: no responseToken found");
}

// dist/wire/structs/sessionSetup.js
var REQ_STRUCT_SIZE = 25;
function encodeSessionSetupRequest(req) {
  let w = new Writer(), blobOffset = 64 + REQ_STRUCT_SIZE - 1;
  return w.u16(REQ_STRUCT_SIZE), w.u8(req.flags ?? 0), w.u8(req.securityMode), w.u32(req.capabilities), w.u32(req.channel ?? 0), w.u16(blobOffset), w.u16(req.blob.length), w.u64(req.previousSessionId ?? 0n), w.bytes(req.blob), w.buffer();
}
var RESP_STRUCT_SIZE = 9;
function decodeSessionSetupResponse(body, bodyAt = 64) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== RESP_STRUCT_SIZE)
    throw new Error(`SESSION_SETUP resp StructureSize ${ss} != 9`);
  let sessionFlags = r.u16(), offset = r.u16(), length = r.u16(), start = offset - bodyAt, securityBuffer = length > 0 ? Buffer.from(body.subarray(start, start + length)) : Buffer.alloc(0);
  return { sessionFlags, securityBuffer };
}

// dist/connection/signing.js
import { createCipheriv as createCipheriv2, createHmac as createHmac2, timingSafeEqual } from "node:crypto";
function hmacSha256(key, data) {
  return createHmac2("sha256", key).update(data).digest();
}
function aesEcbEncryptBlock(key, block) {
  let c = createCipheriv2("aes-128-ecb", key, null);
  return c.setAutoPadding(!1), Buffer.concat([c.update(block), c.final()]);
}
function leftShift(b) {
  let out = Buffer.alloc(b.length), carry = 0;
  for (let i = b.length - 1; i >= 0; i--) {
    let v = b[i];
    out[i] = v << 1 & 255 | carry, carry = (v & 128) !== 0 ? 1 : 0;
  }
  return out;
}
function deriveSubkeys(key) {
  let Rb = Buffer.alloc(16);
  Rb[15] = 135;
  let L = aesEcbEncryptBlock(key, Buffer.alloc(16)), k1 = leftShift(L);
  if (L[0] & 128)
    for (let i = 0; i < 16; i++)
      k1[i] = k1[i] ^ Rb[i];
  let k2 = leftShift(k1);
  if (k1[0] & 128)
    for (let i = 0; i < 16; i++)
      k2[i] = k2[i] ^ Rb[i];
  return { k1, k2 };
}
function aesCmac(key, msg) {
  if (key.length !== 16)
    throw new Error("AES-CMAC: 16-byte key required");
  let { k1, k2 } = deriveSubkeys(key), blocks = Math.ceil(msg.length / 16), lastFull = blocks > 0 && msg.length % 16 === 0, nBlocks = Math.max(blocks, 1), lastBlock;
  if (lastFull) {
    lastBlock = Buffer.from(msg.subarray((nBlocks - 1) * 16, nBlocks * 16));
    for (let i = 0; i < 16; i++)
      lastBlock[i] = lastBlock[i] ^ k1[i];
  } else {
    let start = (nBlocks - 1) * 16, tail = msg.subarray(start);
    lastBlock = Buffer.alloc(16), tail.copy(lastBlock, 0), lastBlock[tail.length] = 128;
    for (let i = 0; i < 16; i++)
      lastBlock[i] = lastBlock[i] ^ k2[i];
  }
  let X = Buffer.alloc(16);
  for (let i = 0; i < nBlocks - 1; i++) {
    let block = msg.subarray(i * 16, i * 16 + 16), Y2 = Buffer.alloc(16);
    for (let j = 0; j < 16; j++)
      Y2[j] = X[j] ^ block[j];
    X = aesEcbEncryptBlock(key, Y2);
  }
  let Y = Buffer.alloc(16);
  for (let j = 0; j < 16; j++)
    Y[j] = X[j] ^ lastBlock[j];
  return aesEcbEncryptBlock(key, Y);
}
function sign(msg, key, dialect) {
  return dialect === Dialect.SMB_2_0_2 || dialect === Dialect.SMB_2_1_0 ? hmacSha256(key, msg).subarray(0, 16) : aesCmac(key, msg);
}
function verify(msg, sig, key, dialect) {
  let expected = sign(msg, key, dialect);
  return sig.length !== expected.length ? !1 : timingSafeEqual(sig, expected);
}

// dist/session/session.js
function pickCipher(offered, preferred) {
  for (let c of preferred)
    if (offered.includes(c))
      return c;
}
function cipherKeyLength(cipherId) {
  return cipherId === Cipher.AES_256_CCM || cipherId === Cipher.AES_256_GCM ? 32 : 16;
}
var Session = class {
  conn;
  creds;
  sessionId = 0n;
  signingKey = null;
  encryptionKeys = null;
  /** True when global encryption mode is "required" — every non-NEGOTIATE/SESSION_SETUP request encrypts. */
  globalEncrypt = !1;
  closed = !1;
  mode;
  signingMode;
  preferredCiphers;
  constructor(conn, creds, opts = {}) {
    this.conn = conn, this.creds = creds, this.mode = opts.encryption ?? "if-offered", this.signingMode = opts.signing ?? "if-offered", this.preferredCiphers = opts.ciphers ?? [
      Cipher.AES_128_GCM,
      Cipher.AES_128_CCM,
      Cipher.AES_256_GCM,
      Cipher.AES_256_CCM
    ];
  }
  async setup() {
    let negotiated = this.conn.state;
    if (!negotiated)
      throw new Error("Session.setup: connection not negotiated");
    let dialect = negotiated.dialect;
    if (this.signingMode === "disabled" && (negotiated.securityMode & SecurityMode.SIGNING_REQUIRED) !== 0)
      throw new SmbAuthError({
        status: 0,
        message: "server requires signing, but client has signing disabled"
      });
    let ntlmNeg = encodeNegotiateMessage(), blob1 = wrapInitNegToken(ntlmNeg), req1 = encodeSessionSetupRequest({
      securityMode: SecurityMode.SIGNING_ENABLED,
      capabilities: 0,
      blob: blob1
    }), resp1 = await this.conn.send(SmbCommand.SESSION_SETUP, req1, { creditCharge: 1 });
    if (resp1.header.status !== NTStatus.STATUS_MORE_PROCESSING_REQUIRED)
      throw new SmbAuthError({
        status: resp1.header.status,
        message: `SESSION_SETUP NEG expected MORE_PROCESSING_REQUIRED, got ${resp1.header.status.toString(16)}`
      });
    this.sessionId = resp1.header.sessionId;
    let sessSetup1 = decodeSessionSetupResponse(resp1.body, 64), ntlmChalBlob = extractNtlmFromResp(sessSetup1.securityBuffer);
    if (ntlmChalBlob.length === 0)
      throw new SmbAuthError({ status: 0, message: "no NTLM CHALLENGE in server response" });
    let challenge = decodeChallengeMessage(ntlmChalBlob), clientChallenge = generateClientChallenge(), ntlmV2 = computeNtlmV2({
      password: this.creds.password,
      username: this.creds.username,
      domain: this.creds.domain ?? "",
      serverChallenge: challenge.serverChallenge,
      clientChallenge,
      targetInfo: challenge.targetInfo
    }), exportedSessionKey = generateExportedSessionKey(), encryptedRandomSessionKey = rc4(ntlmV2.sessionBaseKey, exportedSessionKey), flags = NTLMSSP_FLAGS.NEGOTIATE_UNICODE | NTLMSSP_FLAGS.NEGOTIATE_SIGN | NTLMSSP_FLAGS.NEGOTIATE_NTLM | NTLMSSP_FLAGS.NEGOTIATE_ALWAYS_SIGN | NTLMSSP_FLAGS.NEGOTIATE_EXTENDED_SESSIONSECURITY | NTLMSSP_FLAGS.NEGOTIATE_TARGET_INFO | NTLMSSP_FLAGS.NEGOTIATE_VERSION | NTLMSSP_FLAGS.NEGOTIATE_128 | NTLMSSP_FLAGS.NEGOTIATE_KEY_EXCH | NTLMSSP_FLAGS.NEGOTIATE_56, auth = encodeAuthenticateMessage({
      domain: this.creds.domain ?? "",
      username: this.creds.username,
      ntChallengeResponse: ntlmV2.ntChallengeResponse,
      lmChallengeResponse: ntlmV2.lmChallengeResponse,
      encryptedRandomSessionKey,
      flags,
      mic: {
        exportedSessionKey,
        negotiateMessage: ntlmNeg,
        challengeMessage: ntlmChalBlob
      }
    }), blob2 = wrapNegTokenResp(auth), req2 = encodeSessionSetupRequest({
      securityMode: SecurityMode.SIGNING_ENABLED,
      capabilities: 0,
      blob: blob2
    }), resp2 = await this.conn.send(SmbCommand.SESSION_SETUP, req2, {
      creditCharge: 1,
      sessionId: this.sessionId
    });
    if (!isSuccess(resp2.header.status))
      throw new SmbAuthError({ status: resp2.header.status, message: "SESSION_SETUP AUTH failed" });
    if (dialect === Dialect.SMB_2_1_0 || dialect === Dialect.SMB_2_0_2)
      this.signingKey = exportedSessionKey;
    else if (dialect === Dialect.SMB_3_0_0 || dialect === Dialect.SMB_3_0_2)
      this.signingKey = kdfSp800108CounterHmacSha256(exportedSessionKey, Buffer.from("SMB2AESCMAC\0", "ascii"), Buffer.from("SmbSign\0", "ascii"), 16);
    else if (dialect === Dialect.SMB_3_1_1) {
      let preauth = this.conn.preauthDigest();
      this.signingKey = kdfSp800108CounterHmacSha256(exportedSessionKey, Buffer.from("SMBSigningKey\0", "ascii"), preauth, 16);
    } else
      throw new SmbAuthError({ status: 0, message: `unsupported dialect ${dialect.toString(16)}` });
    let signingKey = this.signingKey;
    if (this.conn.setVerifier((frame2, sig) => verify(frame2, sig, signingKey, dialect)), this.applyCancelSigner(), this.applySigningMode(), this.mode !== "disabled" && this.dialectSupportsEncryption(dialect)) {
      let cipherId = this.selectCipher(dialect, negotiated.cipherIds);
      if (cipherId !== void 0) {
        let keys = this.deriveEncryptionKeys(dialect, exportedSessionKey, cipherId);
        this.encryptionKeys = keys;
        let sessionId = this.sessionId, counter = 1n, enc = {
          encrypt: (plaintext) => {
            let c = counter++;
            return encryptMessage(plaintext, keys, sessionId, c);
          },
          decrypt: (frame2) => decryptMessage(frame2, keys, sessionId)
        };
        this.conn.setEncryptor(enc), this.globalEncrypt = this.mode === "required" || this.mode === "if-offered", this.conn.setEncryptionRequired(this.globalEncrypt);
      } else if (this.mode === "required")
        throw new SmbAuthError({
          status: 0,
          message: "encryption required but server did not offer a supported cipher"
        });
    } else if (this.mode === "required")
      throw new SmbAuthError({
        status: 0,
        message: `encryption required but dialect 0x${dialect.toString(16)} does not support it`
      });
  }
  dialectSupportsEncryption(dialect) {
    return dialect === Dialect.SMB_3_0_0 || dialect === Dialect.SMB_3_0_2 || dialect === Dialect.SMB_3_1_1;
  }
  selectCipher(dialect, offeredByServer) {
    if (dialect === Dialect.SMB_3_0_0 || dialect === Dialect.SMB_3_0_2) {
      let conn = this.conn.state;
      return conn !== null && (conn.capabilities & 64) !== 0 ? Cipher.AES_128_CCM : void 0;
    }
    return offeredByServer === void 0 || offeredByServer.length === 0 ? void 0 : pickCipher(offeredByServer, this.preferredCiphers);
  }
  deriveEncryptionKeys(dialect, sessionKey, cipherId) {
    let keyLen = cipherKeyLength(cipherId);
    if (dialect === Dialect.SMB_3_0_0 || dialect === Dialect.SMB_3_0_2) {
      let encryption2 = kdfSp800108CounterHmacSha256(sessionKey, Buffer.from("SMB2AESCCM\0", "ascii"), Buffer.from("ServerIn \0", "ascii"), keyLen), decryption2 = kdfSp800108CounterHmacSha256(sessionKey, Buffer.from("SMB2AESCCM\0", "ascii"), Buffer.from("ServerOut\0", "ascii"), keyLen);
      return { encryption: encryption2, decryption: decryption2, cipherId };
    }
    let preauth = this.conn.preauthDigest(), encryption = kdfSp800108CounterHmacSha256(sessionKey, Buffer.from("SMBC2SCipherKey\0", "ascii"), preauth, keyLen), decryption = kdfSp800108CounterHmacSha256(sessionKey, Buffer.from("SMBS2CCipherKey\0", "ascii"), preauth, keyLen);
    return { encryption, decryption, cipherId };
  }
  async close() {
    if (this.closed || this.sessionId === 0n)
      return;
    this.closed = !0;
    let body = Buffer.from([4, 0, 0, 0]), signing = this.makeSigning();
    await this.conn.send(SmbCommand.LOGOFF, body, {
      sessionId: this.sessionId,
      ...signing !== void 0 ? { signing } : {},
      encrypt: this.globalEncrypt
    });
  }
  makeSigning() {
    if (this.signingMode === "disabled")
      return;
    let key = this.signingKey, dialect = this.conn.state?.dialect;
    if (!(!key || !dialect))
      return {
        sign: (msg) => sign(msg, key, dialect)
      };
  }
  applySigningMode() {
    this.conn.setSigningRequired(this.signingMode === "required");
  }
  /**
   * Registers a CANCEL frame signer on the Connection unless signing is disabled.
   * Under `signing: "disabled"`, the Connection's CANCEL path stays null-safe and
   * cancellations go out unsigned — consistent with MS-SMB2 §3.2.4.24 only when
   * the session never agreed to sign in the first place.
   */
  applyCancelSigner() {
    if (this.signingMode === "disabled")
      return;
    let key = this.signingKey, dialect = this.conn.state?.dialect;
    !key || dialect === void 0 || this.conn.setCancelSigner((msg) => sign(msg, key, dialect));
  }
};

// dist/wire/structs/treeConnect.js
function encodeTreeConnectRequest(req) {
  let path = Buffer.from(req.path, "utf16le"), w = new Writer();
  return w.u16(9), w.u16(req.flags ?? 0), w.u16(72), w.u16(path.length), w.bytes(path), w.buffer();
}
function decodeTreeConnectResponse(body) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== 16)
    throw new Error(`TREE_CONNECT resp StructureSize ${ss} != 16`);
  let t = r.u8();
  r.u8();
  let shareFlags = r.u32(), capabilities = r.u32(), maximalAccess = r.u32(), shareType;
  switch (t) {
    case 1:
      shareType = "disk";
      break;
    case 2:
      shareType = "ipc";
      break;
    case 3:
      shareType = "print";
      break;
    default:
      shareType = "special";
  }
  return { shareType, shareFlags, capabilities, maximalAccess };
}

// dist/wire/structs/treeDisconnect.js
function encodeTreeDisconnectRequest() {
  return Buffer.from([4, 0, 0, 0]);
}

// dist/tree/tree.js
var Tree = class _Tree {
  conn;
  session;
  path;
  treeId;
  shareType;
  shareFlags;
  maximalAccess;
  encryptData;
  constructor(conn, session, path, treeId, shareType, shareFlags, maximalAccess, encryptData) {
    this.conn = conn, this.session = session, this.path = path, this.treeId = treeId, this.shareType = shareType, this.shareFlags = shareFlags, this.maximalAccess = maximalAccess, this.encryptData = encryptData;
  }
  /** True if any request on this tree must be encrypted (per-share flag or session-wide). */
  get encryptRequired() {
    return this.encryptData || this.session.globalEncrypt;
  }
  static async connect(conn, session, sharePath) {
    let body = encodeTreeConnectRequest({ path: sharePath }), signing = session.makeSigning(), resp = await conn.send(SmbCommand.TREE_CONNECT, body, {
      sessionId: session.sessionId,
      ...signing !== void 0 ? { signing } : {},
      encrypt: session.globalEncrypt,
      creditCharge: 1
    });
    if (!isSuccess(resp.header.status))
      throw new SmbError({ status: resp.header.status, message: `TREE_CONNECT failed: ${statusName(resp.header.status)}` });
    let tcr = decodeTreeConnectResponse(resp.body);
    if (resp.header.treeId === void 0)
      throw new Error("TREE_CONNECT: server did not return TreeId");
    let encryptData = (tcr.shareFlags & ShareFlag.ENCRYPT_DATA) !== 0;
    if (encryptData && session.encryptionKeys === null)
      throw new SmbError({
        status: 0,
        message: `server requires encryption on share ${sharePath} but the session has no encryption keys`
      });
    return new _Tree(conn, session, sharePath, resp.header.treeId, tcr.shareType, tcr.shareFlags, tcr.maximalAccess, encryptData);
  }
  async disconnect() {
    let body = encodeTreeDisconnectRequest(), signing = this.session.makeSigning();
    await this.conn.send(SmbCommand.TREE_DISCONNECT, body, {
      sessionId: this.session.sessionId,
      treeId: this.treeId,
      ...signing !== void 0 ? { signing } : {},
      encrypt: this.encryptRequired,
      creditCharge: 1
    });
  }
};

// dist/wire/structs/create.js
var FileAccess = {
  FILE_READ_DATA: 1,
  FILE_WRITE_DATA: 2,
  FILE_APPEND_DATA: 4,
  FILE_READ_EA: 8,
  FILE_WRITE_EA: 16,
  FILE_EXECUTE: 32,
  FILE_DELETE_CHILD: 64,
  FILE_READ_ATTRIBUTES: 128,
  FILE_WRITE_ATTRIBUTES: 256,
  DELETE: 65536,
  READ_CONTROL: 131072,
  GENERIC_READ: 2147483648,
  GENERIC_WRITE: 1073741824,
  GENERIC_EXECUTE: 536870912,
  GENERIC_ALL: 268435456
}, ShareAccess = {
  READ: 1,
  WRITE: 2,
  DELETE: 4
}, CreateDisposition = {
  SUPERSEDE: 0,
  OPEN: 1,
  CREATE: 2,
  OPEN_IF: 3,
  OVERWRITE: 4,
  OVERWRITE_IF: 5
}, CreateOptions = {
  DIRECTORY_FILE: 1,
  WRITE_THROUGH: 2,
  SEQUENTIAL_ONLY: 4,
  NON_DIRECTORY_FILE: 64,
  DELETE_ON_CLOSE: 4096
}, FileAttribute = {
  READONLY: 1,
  HIDDEN: 2,
  SYSTEM: 4,
  DIRECTORY: 16,
  ARCHIVE: 32,
  NORMAL: 128,
  TEMPORARY: 256
};
function encodeCreateRequest(req) {
  let name = req.filename.replace(/^[\\/]+/, "").replace(/\//g, "\\"), nameBuf = Buffer.from(name, "utf16le"), w = new Writer();
  return w.u16(57), w.u8(0), w.u8(0), w.u32(2), w.u64(0n), w.u64(0n), w.u32(req.desiredAccess >>> 0), w.u32(req.fileAttributes >>> 0), w.u32(req.shareAccess >>> 0), w.u32(req.createDisposition >>> 0), w.u32(req.createOptions >>> 0), w.u16(120), w.u16(nameBuf.length), w.u32(0), w.u32(0), nameBuf.length === 0 ? w.u8(0) : w.bytes(nameBuf), w.buffer();
}
function decodeCreateResponse(body) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== 89)
    throw new Error(`CREATE resp StructureSize ${ss} != 89`);
  let oplockLevel = r.u8();
  r.u8();
  let createAction = r.u32(), creationTime = r.u64(), lastAccessTime = r.u64(), lastWriteTime = r.u64(), changeTime = r.u64(), allocationSize = r.u64(), endOfFile = r.u64(), fileAttributes = r.u32();
  r.u32();
  let fileId = r.bytes(16);
  return r.u32(), r.u32(), {
    oplockLevel,
    createAction,
    creationTime,
    lastAccessTime,
    lastWriteTime,
    changeTime,
    allocationSize,
    endOfFile,
    fileAttributes,
    fileId
  };
}

// dist/wire/structs/close.js
function encodeCloseRequest(fileId, requestPostQueryAttribs = !1) {
  if (fileId.length !== 16)
    throw new Error("CLOSE: FileId must be 16 bytes");
  let w = new Writer();
  return w.u16(24), w.u16(requestPostQueryAttribs ? 1 : 0), w.u32(0), w.bytes(fileId), w.buffer();
}
function decodeCloseResponse(body) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== 60)
    throw new Error(`CLOSE resp StructureSize ${ss} != 60`);
  return { flags: r.u16() };
}

// dist/open/open.js
var Open = class _Open {
  tree;
  fileId;
  meta;
  closed = !1;
  constructor(tree, fileId, meta) {
    this.tree = tree, this.fileId = fileId, this.meta = meta;
  }
  static async create(tree, req) {
    let body = encodeCreateRequest(req), signing = tree.session.makeSigning(), resp = await tree.conn.send(SmbCommand.CREATE, body, {
      sessionId: tree.session.sessionId,
      treeId: tree.treeId,
      ...signing !== void 0 ? { signing } : {},
      encrypt: tree.encryptRequired,
      creditCharge: 1
    });
    if (!isSuccess(resp.header.status))
      throw new SmbError({ status: resp.header.status, message: `CREATE failed: ${statusName(resp.header.status)}` });
    let meta = decodeCreateResponse(resp.body);
    return new _Open(tree, meta.fileId, meta);
  }
  async close() {
    if (this.closed)
      return;
    this.closed = !0;
    let body = encodeCloseRequest(this.fileId), signing = this.tree.session.makeSigning(), resp = await this.tree.conn.send(SmbCommand.CLOSE, body, {
      sessionId: this.tree.session.sessionId,
      treeId: this.tree.treeId,
      ...signing !== void 0 ? { signing } : {},
      encrypt: this.tree.encryptRequired,
      creditCharge: 1
    });
    if (!isSuccess(resp.header.status))
      throw new SmbError({ status: resp.header.status, message: `CLOSE failed: ${statusName(resp.header.status)}` });
    decodeCloseResponse(resp.body);
  }
  static async withOpen(tree, req, fn) {
    let open = await _Open.create(tree, req);
    try {
      return await fn(open);
    } finally {
      try {
        await open.close();
      } catch {
      }
    }
  }
};

// dist/wire/structs/read.js
function encodeReadRequest(req) {
  if (req.fileId.length !== 16)
    throw new Error("READ: FileId must be 16 bytes");
  let w = new Writer();
  return w.u16(49), w.u8(0), w.u8(0), w.u32(req.length >>> 0), w.u64(req.offset), w.bytes(req.fileId), w.u32(req.minimumCount ?? 0), w.u32(req.channel ?? 0), w.u32(0), w.u16(0), w.u16(0), w.u8(0), w.buffer();
}
function decodeReadResponse(body, bodyAt = 64) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== 17)
    throw new Error(`READ resp StructureSize ${ss} != 17`);
  let dataOffset = r.u8();
  r.u8();
  let dataLength = r.u32();
  r.u32(), r.u32();
  let start = dataOffset - bodyAt;
  return Buffer.from(body.subarray(start, start + dataLength));
}

// dist/open/read.js
var DEFAULT_CHUNK = 65536;
async function readAll(open, length) {
  let max = open.tree.conn.state?.maxReadSize ?? DEFAULT_CHUNK, chunkSize = Math.min(max, DEFAULT_CHUNK), out = [], offset = 0n, remaining = length;
  for (; remaining > 0n; ) {
    let want = Number(remaining > BigInt(chunkSize) ? BigInt(chunkSize) : remaining), chunk = await readAt(open, offset, want);
    if (chunk.length === 0)
      break;
    out.push(chunk), offset += BigInt(chunk.length), remaining -= BigInt(chunk.length);
  }
  return Buffer.concat(out);
}
async function readAt(open, offset, length) {
  let safeLength = Math.min(length, DEFAULT_CHUNK), charge = 1, body = encodeReadRequest({ fileId: open.fileId, offset, length: safeLength }), signing = open.tree.session.makeSigning(), resp = await open.tree.conn.send(SmbCommand.READ, body, {
    sessionId: open.tree.session.sessionId,
    treeId: open.tree.treeId,
    ...signing !== void 0 ? { signing } : {},
    encrypt: open.tree.encryptRequired,
    creditCharge: charge
  });
  if (resp.header.status === NTStatus.STATUS_END_OF_FILE)
    return Buffer.alloc(0);
  if (!isSuccess(resp.header.status))
    throw new SmbError({ status: resp.header.status, message: `READ failed: ${statusName(resp.header.status)}` });
  let first = decodeReadResponse(resp.body, 64);
  if (first.length === 0 || safeLength >= length)
    return first;
  let rest = await readAt(open, offset + BigInt(first.length), length - first.length);
  return rest.length === 0 ? first : Buffer.concat([first, rest]);
}

// dist/wire/structs/write.js
function encodeWriteRequest(req) {
  if (req.fileId.length !== 16)
    throw new Error("WRITE: FileId must be 16 bytes");
  let w = new Writer();
  return w.u16(49), w.u16(112), w.u32(req.data.length), w.u64(req.offset), w.bytes(req.fileId), w.u32(req.channel ?? 0), w.u32(0), w.u16(0), w.u16(0), w.u32(req.flags ?? 0), w.bytes(req.data.length === 0 ? Buffer.from([0]) : req.data), w.buffer();
}
function decodeWriteResponse(body) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== 17)
    throw new Error(`WRITE resp StructureSize ${ss} != 17`);
  return r.u16(), r.u32();
}

// dist/open/write.js
async function writeAll(open, offset, data) {
  let max = open.tree.conn.state?.maxWriteSize ?? 65536, chunkSize = Math.min(max, 65536), written = 0;
  for (; written < data.length; ) {
    let chunk = data.subarray(written, written + Math.min(chunkSize, data.length - written)), charge = Math.max(1, Math.ceil(chunk.length / 65536)), body = encodeWriteRequest({
      fileId: open.fileId,
      offset: offset + BigInt(written),
      data: Buffer.from(chunk)
    }), signing = open.tree.session.makeSigning(), resp = await open.tree.conn.send(SmbCommand.WRITE, body, {
      sessionId: open.tree.session.sessionId,
      treeId: open.tree.treeId,
      ...signing !== void 0 ? { signing } : {},
      encrypt: open.tree.encryptRequired,
      creditCharge: charge
    });
    if (!isSuccess(resp.header.status))
      throw new SmbError({ status: resp.header.status, message: `WRITE failed: ${statusName(resp.header.status)}` });
    let count = decodeWriteResponse(resp.body);
    if (count <= 0)
      throw new Error("WRITE returned zero count");
    written += count;
  }
}

// dist/paths.js
function splitSharePath(p) {
  if (!p || p.length === 0)
    throw new SmbError({ status: NTStatus.STATUS_INVALID_PARAMETER, message: "empty path" });
  if (p.startsWith("\\\\") || /^[A-Za-z]:/.test(p))
    throw new SmbError({ status: NTStatus.STATUS_INVALID_PARAMETER, message: `bad path: ${p}` });
  let parts = p.split("/").filter((x) => x.length > 0);
  if (parts.some((x) => x === ".."))
    throw new SmbError({ status: NTStatus.STATUS_INVALID_PARAMETER, message: "path contains .." });
  if (parts.length === 0)
    throw new SmbError({ status: NTStatus.STATUS_INVALID_PARAMETER, message: "empty share" });
  return { share: parts[0], rest: parts.slice(1).join("/") };
}
function toSmbPath(rest) {
  return rest.replace(/^[\\/]+/, "").replace(/\//g, "\\");
}
function smbTimeToDate(filetime) {
  if (filetime === 0n)
    return /* @__PURE__ */ new Date(0);
  let ms = Number(filetime / 10000n - 11644473600n * 1000n);
  return new Date(ms);
}

// dist/open/query.js
function metaToStat(meta) {
  let a = meta.fileAttributes, isDir = (a & FileAttribute.DIRECTORY) !== 0, eof = meta.endOfFile;
  if (eof > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("file size exceeds MAX_SAFE_INTEGER; use statBig()");
  return {
    size: Number(eof),
    isFile: !isDir,
    isDirectory: isDir,
    attributes: a,
    readonly: (a & FileAttribute.READONLY) !== 0,
    hidden: (a & FileAttribute.HIDDEN) !== 0,
    system: (a & FileAttribute.SYSTEM) !== 0,
    archive: (a & FileAttribute.ARCHIVE) !== 0,
    ctime: smbTimeToDate(meta.creationTime),
    atime: smbTimeToDate(meta.lastAccessTime),
    mtime: smbTimeToDate(meta.lastWriteTime),
    changeTime: smbTimeToDate(meta.changeTime)
  };
}

// dist/wire/structs/queryDirectory.js
var QueryDirectoryFlag = {
  RESTART_SCANS: 1,
  RETURN_SINGLE_ENTRY: 2,
  INDEX_SPECIFIED: 4,
  REOPEN: 16
};
function encodeQueryDirectoryRequest(req) {
  let pat = Buffer.from(req.searchPattern, "utf16le"), w = new Writer();
  return w.u16(33), w.u8(req.fileInformationClass), w.u8(req.flags), w.u32(req.fileIndex), w.bytes(req.fileId), w.u16(96), w.u16(pat.length), w.u32(req.outputBufferLength), pat.length === 0 ? w.u8(0) : w.bytes(pat), w.buffer();
}
function decodeQueryDirectoryResponse(body, bodyAt = 64) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== 9)
    throw new Error(`QUERY_DIRECTORY resp StructureSize ${ss} != 9`);
  let offset = r.u16(), length = r.u32(), start = offset - bodyAt;
  return Buffer.from(body.subarray(start, start + length));
}
function parseFileIdBothDirectoryInformation(buf) {
  let out = [], off = 0;
  for (; off < buf.length; ) {
    let r = new Reader(buf);
    r.offset = off;
    let next = r.u32();
    r.u32();
    let creationTime = r.u64(), lastAccessTime = r.u64(), lastWriteTime = r.u64(), changeTime = r.u64(), endOfFile = r.u64();
    r.u64();
    let fileAttributes = r.u32(), fileNameLength = r.u32();
    r.u32(), r.u8(), r.u8(), r.bytes(24), r.u16(), r.bytes(8);
    let fileName = fileNameLength > 0 ? r.utf16(fileNameLength) : "";
    if (out.push({ fileName, endOfFile, fileAttributes, creationTime, lastAccessTime, lastWriteTime, changeTime }), next === 0)
      break;
    off += next;
  }
  return out;
}

// dist/wire/structs/queryInfo.js
var InfoType = {
  FILE: 1,
  FILESYSTEM: 2,
  SECURITY: 3,
  QUOTA: 4
}, FileInformationClass = {
  FileBasicInformation: 4,
  FileStandardInformation: 5,
  FileInternalInformation: 6,
  FileEaInformation: 7,
  FileAccessInformation: 8,
  FileAllInformation: 18,
  FileAlignmentInformation: 17,
  FilePositionInformation: 14,
  FileModeInformation: 16,
  FileNameInformation: 9,
  FileEndOfFileInformation: 20,
  FileRenameInformation: 10,
  FileDispositionInformation: 13,
  FileIdBothDirectoryInformation: 37,
  FileIdFullDirectoryInformation: 38
};

// dist/open/readdir.js
async function readdirAll(open, pattern = "*") {
  let items = [], first = !0;
  for (; ; ) {
    let body = encodeQueryDirectoryRequest({
      fileInformationClass: FileInformationClass.FileIdBothDirectoryInformation,
      flags: first ? QueryDirectoryFlag.RESTART_SCANS : 0,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: pattern,
      outputBufferLength: 65536
    });
    first = !1;
    let signing = open.tree.session.makeSigning(), resp = await open.tree.conn.send(SmbCommand.QUERY_DIRECTORY, body, {
      sessionId: open.tree.session.sessionId,
      treeId: open.tree.treeId,
      ...signing !== void 0 ? { signing } : {},
      encrypt: open.tree.encryptRequired,
      creditCharge: 1
    });
    if (resp.header.status === NTStatus.STATUS_NO_MORE_FILES)
      break;
    if (!isSuccess(resp.header.status))
      throw new SmbError({ status: resp.header.status, message: `QUERY_DIRECTORY failed: ${statusName(resp.header.status)}` });
    let buf = decodeQueryDirectoryResponse(resp.body, 64);
    if (buf.length === 0)
      break;
    let page = parseFileIdBothDirectoryInformation(buf);
    for (let e of page)
      items.push(e);
    if (page.length === 0)
      break;
  }
  return items.filter((x) => x.fileName !== "." && x.fileName !== "..");
}

// dist/open/readStream.js
import { Readable } from "node:stream";
function createReadStream(open, opts = {}) {
  let start = opts.start ?? 0n, totalEnd = opts.end ?? open.meta.endOfFile - 1n;
  if (totalEnd < start)
    return Readable.from([], { objectMode: !1 });
  let max = open.tree.conn.state?.maxReadSize ?? 65536, chunkSize = Math.min(max, opts.highWaterMark ?? 65536), concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8)), nextOffset = start, outOffset = start, buffers = /* @__PURE__ */ new Map(), inFlight = 0, pushing = !1, closed = !1, stream = new Readable({
    highWaterMark: chunkSize,
    read() {
      pushing = !0, drain();
    }
  });
  function drain() {
    for (; pushing && buffers.has(outOffset.toString()); ) {
      let k = outOffset.toString(), buf = buffers.get(k);
      buffers.delete(k), pushing = stream.push(buf), outOffset += BigInt(buf.length);
    }
    if (outOffset > totalEnd && inFlight === 0 && buffers.size === 0 && !closed) {
      closed = !0, stream.push(null);
      return;
    }
    for (; pushing && !stream.destroyed && inFlight + buffers.size < concurrency && nextOffset <= totalEnd; ) {
      let remaining = totalEnd - nextOffset + 1n, want = remaining > BigInt(chunkSize) ? BigInt(chunkSize) : remaining, offset = nextOffset, length = Number(want);
      nextOffset += want, inFlight++, readAt(open, offset, length).then((buf) => {
        inFlight--;
        if (buf.length !== length) { stream.destroy(new Error("SMB file changed during read")); return; }
        buffers.set(offset.toString(), buf), drain();
      }, (err) => {
        stream.destroy(err);
      });
    }
  }
  return stream;
}

// dist/open/writeStream.js
import { Writable } from "node:stream";
function createWriteStream(open, opts = {}) {
  let max = open.tree.conn.state?.maxWriteSize ?? 65536, hwm = opts.highWaterMark ?? max, offset = opts.start ?? 0n, closeOnFinal = opts.closeOnFinal ?? !0;
  return new Writable({
    highWaterMark: hwm,
    write(chunk, _enc, cb) {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      writeAll(open, offset, buf).then(() => {
        offset += BigInt(buf.length), cb();
      }, (err) => cb(err));
    },
    final(cb) {
      if (!closeOnFinal)
        return cb();
      open.close().then(() => cb(), (err) => cb(err));
    },
    destroy(err, cb) {
      if (!closeOnFinal)
        return cb(err);
      open.close().then(() => cb(err), () => cb(err));
    }
  });
}

// dist/wire/structs/changeNotify.js
var CompletionFilter = {
  FILE_NAME: 1,
  DIR_NAME: 2,
  ATTRIBUTES: 4,
  SIZE: 8,
  LAST_WRITE: 16,
  LAST_ACCESS: 32,
  CREATION: 64,
  EA: 128,
  SECURITY: 256,
  STREAM_NAME: 512,
  STREAM_SIZE: 1024,
  STREAM_WRITE: 2048
}, ChangeAction = {
  ADDED: 1,
  REMOVED: 2,
  MODIFIED: 3,
  RENAMED_OLD_NAME: 4,
  RENAMED_NEW_NAME: 5
};
function encodeChangeNotifyRequest(req) {
  if (req.fileId.length !== 16)
    throw new Error("CHANGE_NOTIFY: FileId must be 16 bytes");
  let w = new Writer();
  return w.u16(32), w.u16(req.flags), w.u32(req.outputBufferLength), w.bytes(req.fileId), w.u32(req.completionFilter), w.u32(0), w.buffer();
}
function parseFileNotifyInformation(buf) {
  let out = [], off = 0;
  for (; off < buf.length; ) {
    let r = new Reader(buf);
    r.offset = off;
    let next = r.u32(), action = r.u32(), fnLen = r.u32(), fileName = r.utf16(fnLen);
    if (out.push({ action, fileName }), next === 0)
      break;
    off += next;
  }
  return out;
}
function decodeChangeNotifyResponse(body, bodyAt = 64) {
  let r = new Reader(body), ss = r.u16();
  if (ss !== 9)
    throw new Error(`CHANGE_NOTIFY resp StructureSize ${ss} != 9`);
  let offset = r.u16(), length = r.u32(), start = offset - bodyAt;
  return Buffer.from(body.subarray(start, start + length));
}

// dist/open/changeNotify.js
var DEFAULT_FILTER = CompletionFilter.FILE_NAME | CompletionFilter.DIR_NAME | CompletionFilter.ATTRIBUTES | CompletionFilter.SIZE | CompletionFilter.LAST_WRITE | CompletionFilter.CREATION, ACTION_NAME = {
  [ChangeAction.ADDED]: "added",
  [ChangeAction.REMOVED]: "removed",
  [ChangeAction.MODIFIED]: "modified",
  [ChangeAction.RENAMED_OLD_NAME]: "renamedOldName",
  [ChangeAction.RENAMED_NEW_NAME]: "renamedNewName"
};
async function* watchOpen(open, opts = {}) {
  let filter = opts.completionFilter ?? DEFAULT_FILTER, flags = opts.recursive ? 1 : 0, conn = open.tree.conn, aborted = !1, lastMessageId = null;
  if (opts.signal) {
    if (opts.signal.aborted)
      return;
    opts.signal.addEventListener("abort", () => {
      aborted = !0, lastMessageId !== null && conn.cancel({
        messageId: lastMessageId,
        sessionId: open.tree.session.sessionId,
        treeId: open.tree.treeId
      });
    }, { once: !0 });
  }
  for (; !aborted; ) {
    let body = encodeChangeNotifyRequest({
      fileId: open.fileId,
      flags,
      outputBufferLength: 65536,
      completionFilter: filter
    }), signing = open.tree.session.makeSigning(), capturedMessageId = conn.nextMessageId, resp;
    try {
      let sent = conn.send(SmbCommand.CHANGE_NOTIFY, body, {
        sessionId: open.tree.session.sessionId,
        treeId: open.tree.treeId,
        ...signing !== void 0 ? { signing } : {},
        encrypt: open.tree.encryptRequired,
        creditCharge: 1
      });
      lastMessageId = capturedMessageId, resp = await sent;
    } catch (err) {
      if (aborted)
        return;
      throw err;
    }
    if (resp.header.status === NTStatus.STATUS_CANCELLED || resp.header.status === NTStatus.STATUS_NOTIFY_CLEANUP)
      return;
    if (!isSuccess(resp.header.status))
      throw new SmbError({ status: resp.header.status, message: `CHANGE_NOTIFY failed: ${statusName(resp.header.status)}` });
    let buf = decodeChangeNotifyResponse(resp.body, 64);
    if (buf.length !== 0) {
      for (let it of parseFileNotifyInformation(buf))
        yield { action: ACTION_NAME[it.action] ?? "modified", fileName: it.fileName };
      if (aborted)
        return;
    }
  }
}

// dist/wire/structs/setInfo.js
function encodeSetInfoRequest(req) {
  let w = new Writer();
  return w.u16(33), w.u8(req.infoType), w.u8(req.fileInformationClass), w.u32(req.buffer.length), w.u16(96), w.u16(0), w.u32(req.additionalInformation ?? 0), w.bytes(req.fileId), w.bytes(req.buffer.length === 0 ? Buffer.from([0]) : req.buffer), w.buffer();
}
function encodeFileRenameInformation(inp) {
  let name = Buffer.from(inp.fileName, "utf16le"), w = new Writer();
  return w.u8(inp.replaceIfExists ? 1 : 0), w.bytes(Buffer.alloc(7)), w.u64(inp.rootDirectory ?? 0n), w.u32(name.length), w.bytes(name), w.buffer();
}

// dist/rpc/dcerpc.js
var NDR_UUID = "8a885d04-1ceb-11c9-9fe8-08002b104860", NDR_VERSION = 2;
function uuidToBytes(uuid) {
  let hex = uuid.replace(/-/g, ""), out = Buffer.alloc(16);
  return out.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0), out.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4), out.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6), Buffer.from(hex.slice(16, 20), "hex").copy(out, 8), Buffer.from(hex.slice(20, 32), "hex").copy(out, 10), out;
}
function commonHeader(packetType, callId, fragLen) {
  let w = new Writer();
  return w.u8(5), w.u8(0), w.u8(packetType), w.u8(3), w.bytes(Buffer.from([16, 0, 0, 0])), w.u16(fragLen), w.u16(0), w.u32(callId), w.buffer();
}
function encodeBindRequest(opts) {
  let max = opts.maxXmitFrag ?? 4280, w = new Writer();
  w.bytes(commonHeader(11, opts.callId, 0)), w.u16(max), w.u16(opts.maxRecvFrag ?? max), w.u32(0), w.u8(1), w.bytes(Buffer.alloc(3)), w.u16(0), w.u8(1), w.u8(0), w.bytes(uuidToBytes(opts.abstractUuid)), w.u16(opts.abstractMajor), w.u16(opts.abstractMinor), w.bytes(uuidToBytes(NDR_UUID)), w.u16(NDR_VERSION), w.u16(0);
  let buf = w.buffer();
  return buf.writeUInt16LE(buf.length, 8), buf;
}
function encodeRequest(opts) {
  let w = new Writer();
  w.bytes(commonHeader(0, opts.callId, 0)), w.u32(opts.stub.length), w.u16(opts.contextId), w.u16(opts.opnum), w.bytes(opts.stub);
  let buf = w.buffer();
  return buf.writeUInt16LE(buf.length, 8), buf;
}
function parseResponse(buf) {
  return buf.length < 24 || buf[2] !== 2 ? null : Buffer.from(buf.subarray(24));
}

// dist/rpc/srvsvc.js
var SRVSVC_UUID = "4b324fc8-1670-01d3-1278-5a47bf6ee188", SRVSVC_MAJOR = 3, SRVSVC_MINOR = 0, referentCounter = 131072;
function newReferent() {
  return referentCounter += 4, referentCounter;
}
function ndrUtf16(s) {
  let w = new Writer(), ws = s + "\0", max = ws.length;
  for (w.u32(max), w.u32(0), w.u32(max), w.utf16(ws); w.offset % 4 !== 0; )
    w.u8(0);
  return w.buffer();
}
function encodeNetrShareEnumRequest(req) {
  let w = new Writer(), ptr = newReferent();
  w.u32(ptr), w.bytes(ndrUtf16(req.serverName)), w.u32(req.infoLevel), w.u32(req.infoLevel);
  let arrPtr = newReferent();
  return w.u32(arrPtr), w.u32(0), w.u32(0), w.u32(req.preferredMaximumLength), w.u32(0), w.buffer();
}
function parseNetrShareEnumResponse(stub) {
  if (stub.length < 4)
    return { entries: [], status: 0 };
  let r = new Reader(stub);
  if (r.u32(), r.remaining() < 4)
    return { entries: [], status: 0 };
  if (r.u32(), r.remaining() < 4)
    return { entries: [], status: 0 };
  if (r.u32() === 0) {
    for (; r.remaining() > 4; )
      r.u32();
    let status2 = r.remaining() >= 4 ? r.u32() : 0;
    return { entries: [], status: status2 };
  }
  if (r.remaining() < 8)
    return { entries: [], status: 0 };
  let entriesRead = r.u32();
  if (r.u32() === 0 || entriesRead === 0)
    return { entries: [], status: 0 };
  if (r.remaining() < 4)
    return { entries: [], status: 0 };
  r.u32();
  let entries = [];
  for (let i = 0; i < entriesRead && !(r.remaining() < 12); i++) {
    let namePtr = r.u32(), type = r.u32(), commentPtr = r.u32();
    entries.push({ namePtr, type, commentPtr });
  }
  let out = [];
  for (let e of entries) {
    let name = "";
    if (e.namePtr !== 0 && r.remaining() >= 12) {
      let max = r.u32();
      r.u32();
      let actual = r.u32();
      if (r.remaining() >= actual * 2)
        for (name = r.utf16(actual * 2).replace(/\0+$/, "").trimEnd(); r.offset % 4 !== 0 && r.remaining() > 0; )
          r.u8();
    }
    let comment = "";
    if (e.commentPtr !== 0 && r.remaining() >= 12) {
      let max = r.u32();
      r.u32();
      let actual = r.u32();
      if (r.remaining() >= actual * 2)
        for (comment = r.utf16(actual * 2).replace(/\0+$/, "").trimEnd(); r.offset % 4 !== 0 && r.remaining() > 0; )
          r.u8();
    }
    out.push({ name, type: e.type, comment });
  }
  for (; r.remaining() > 4; )
    r.u32();
  let status = r.remaining() >= 4 ? r.u32() : 0;
  return { entries: out, status };
}

// dist/client.js
var Client = class {
  opts;
  conn = null;
  session = null;
  trees = /* @__PURE__ */ new Map();
  state = "idle";
  constructor(opts) {
    this.opts = opts;
  }
  async connect() {
    if (this.state !== "idle")
      throw new Error(`Client.connect: state=${this.state}`);
    let transport = await TcpTransport.connect(this.opts.host, this.opts.port ?? 445, {
      timeoutMs: this.opts.connectTimeout ?? 1e4
    });
    this.conn = new Connection(transport);
    let encryption = this.opts.encryption ?? "if-offered", signing = this.opts.signing ?? "if-offered", ciphers = encryption === "disabled" ? [] : [Cipher.AES_128_GCM, Cipher.AES_128_CCM, Cipher.AES_256_GCM, Cipher.AES_256_CCM], capabilities = ciphers.length > 0 ? Capability.LARGE_MTU | Capability.ENCRYPTION : Capability.LARGE_MTU, securityMode = signing === "required" ? SecurityMode.SIGNING_ENABLED | SecurityMode.SIGNING_REQUIRED : SecurityMode.SIGNING_ENABLED;
    await this.conn.open({ ciphers, capabilities, securityMode }), this.session = new Session(this.conn, {
      username: this.opts.username,
      password: this.opts.password,
      domain: this.opts.domain ?? ""
    }, { encryption, ciphers, signing }), await this.session.setup(), this.state = "connected";
  }
  async treeFor(share) {
    if (!this.conn || !this.session)
      throw new Error("not connected");
    let t = this.trees.get(share);
    if (t)
      return t;
    let sharePath = `\\\\${this.opts.host}\\${share}`;
    return t = await Tree.connect(this.conn, this.session, sharePath), this.trees.set(share, t), t;
  }
  async readFile(path, encoding) {
    let { share, rest } = splitSharePath(path), tree = await this.treeFor(share);
    return Open.withOpen(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.FILE_READ_DATA | FileAccess.FILE_READ_ATTRIBUTES,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OPEN,
      createOptions: CreateOptions.NON_DIRECTORY_FILE,
      fileAttributes: 0
    }, async (open) => {
      let buf = await readAll(open, open.meta.endOfFile);
      return encoding ? buf.toString(encoding) : buf;
    });
  }
  async writeFile(path, data, encoding = "utf8") {
    let buf = typeof data == "string" ? Buffer.from(data, encoding) : data, { share, rest } = splitSharePath(path), tree = await this.treeFor(share);
    await Open.withOpen(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.GENERIC_WRITE | FileAccess.FILE_READ_ATTRIBUTES,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OVERWRITE_IF,
      createOptions: CreateOptions.NON_DIRECTORY_FILE,
      fileAttributes: 0
    }, async (open) => writeAll(open, 0n, buf));
  }
  async readdir(path, opts) {
    let { share, rest } = splitSharePath(path), tree = await this.treeFor(share);
    return Open.withOpen(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.FILE_READ_DATA | FileAccess.FILE_READ_ATTRIBUTES,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OPEN,
      createOptions: 1,
      // DIRECTORY_FILE
      fileAttributes: 0
    }, async (open) => {
      let entries = await readdirAll(open);
      return opts?.withFileTypes ? entries.map((e) => {
        let isDir = (e.fileAttributes & FileAttribute.DIRECTORY) !== 0;
        return {
          name: e.fileName,
          isFile: () => !isDir,
          isDirectory: () => isDir
        };
      }) : entries.map((e) => e.fileName);
    });
  }
  async stat(path) {
    let { share, rest } = splitSharePath(path), tree = await this.treeFor(share);
    return Open.withOpen(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.FILE_READ_ATTRIBUTES,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OPEN,
      createOptions: 0,
      fileAttributes: 0
    }, async (open) => metaToStat(open.meta));
  }
  async mkdir(path) {
    let { share, rest } = splitSharePath(path), tree = await this.treeFor(share);
    await Open.withOpen(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.FILE_READ_ATTRIBUTES | FileAccess.FILE_WRITE_ATTRIBUTES,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.CREATE,
      createOptions: 1,
      // DIRECTORY_FILE
      fileAttributes: 0
    }, async () => {
    });
  }
  async rm(path) {
    let { share, rest } = splitSharePath(path), tree = await this.treeFor(share);
    await Open.withOpen(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.DELETE,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OPEN,
      createOptions: CreateOptions.NON_DIRECTORY_FILE | CreateOptions.DELETE_ON_CLOSE,
      fileAttributes: 0
    }, async () => {
    });
  }
  async rmdir(path) {
    let { share, rest } = splitSharePath(path), tree = await this.treeFor(share);
    await Open.withOpen(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.DELETE,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OPEN,
      createOptions: CreateOptions.DIRECTORY_FILE | CreateOptions.DELETE_ON_CLOSE,
      fileAttributes: 0
    }, async () => {
    });
  }
  async rename(from, to) {
    let f = splitSharePath(from), t = splitSharePath(to);
    if (f.share !== t.share)
      throw new SmbError({ status: 0, message: "rename across shares is not supported" });
    let tree = await this.treeFor(f.share);
    await Open.withOpen(tree, {
      filename: toSmbPath(f.rest),
      desiredAccess: FileAccess.DELETE | FileAccess.FILE_READ_ATTRIBUTES,
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OPEN,
      createOptions: 0,
      fileAttributes: 0
    }, async (open) => {
      let inner = encodeFileRenameInformation({
        replaceIfExists: !1,
        fileName: toSmbPath(t.rest)
      }), body = encodeSetInfoRequest({
        infoType: InfoType.FILE,
        fileInformationClass: FileInformationClass.FileRenameInformation,
        fileId: open.fileId,
        buffer: inner
      }), signing = tree.session.makeSigning(), resp = await tree.conn.send(SmbCommand.SET_INFO, body, {
        sessionId: tree.session.sessionId,
        treeId: tree.treeId,
        ...signing !== void 0 ? { signing } : {},
        encrypt: tree.encryptRequired,
        creditCharge: 1
      });
      if (!isSuccess(resp.header.status))
        throw new SmbError({
          status: resp.header.status,
          message: `SET_INFO rename failed: ${statusName(resp.header.status)}`
        });
    });
  }
  async *watch(path, opts = {}) {
    let { share, rest } = splitSharePath(path), tree = await this.treeFor(share), open = await Open.create(tree, {
      filename: toSmbPath(rest),
      desiredAccess: FileAccess.FILE_READ_DATA | FileAccess.FILE_READ_ATTRIBUTES,
      // FILE_LIST_DIRECTORY = FILE_READ_DATA
      shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
      createDisposition: CreateDisposition.OPEN,
      createOptions: 1,
      // DIRECTORY_FILE
      fileAttributes: 0
    });
    try {
      for await (let ev of watchOpen(open, opts)) {
        let fullPath = `${share}/${toSmbPath(rest).replace(/\\/g, "/")}/${ev.fileName.replace(/\\/g, "/")}`.replace(/\/+/g, "/");
        yield { action: ev.action, path: fullPath };
      }
    } finally {
      try {
        await open.close();
      } catch {
      }
    }
  }
  createReadStream(path, options = {}) {
    let out = new PassThrough();
    return this._beginReadStream(path, options, {
      onReady: (inner) => {
        inner.pipe(out), inner.on("error", (e) => out.destroy(e)), out.on("close", () => inner.destroy());
      },
      onError: (err) => {
        out.destroy(err);
      }
    }), out;
  }
  async _beginReadStream(path, options, cbs) {
    try {
      let { share, rest } = splitSharePath(path), tree = await this.treeFor(share), open = await Open.create(tree, {
        filename: toSmbPath(rest),
        desiredAccess: FileAccess.FILE_READ_DATA | FileAccess.FILE_READ_ATTRIBUTES,
        shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
        createDisposition: CreateDisposition.OPEN,
        createOptions: CreateOptions.NON_DIRECTORY_FILE,
        fileAttributes: 0
      }), inner = createReadStream(open, options);
      inner.on("end", async () => {
        try {
          await open.close();
        } catch {
        }
      }), inner.on("error", () => {
        open.close().catch(() => {
        });
      }), cbs.onReady(inner);
    } catch (err) {
      cbs.onError(err);
    }
  }
  createWriteStream(path) {
    let inner = null, connectError = null, pending = [], pendingFinal = null, proxy = new Writable2({
      write(chunk, _enc, cb) {
        if (connectError) {
          cb(connectError);
          return;
        }
        let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        inner ? inner.write(buf, (err) => cb(err ?? void 0)) : pending.push({ chunk: buf, cb });
      },
      final(cb) {
        if (connectError) {
          cb(connectError);
          return;
        }
        inner ? inner.end(() => cb()) : pendingFinal = cb;
      },
      destroy(err, cb) {
        inner && inner.destroy(err ?? void 0), cb(err);
      }
    });
    return this._beginWriteStream(path, {
      onReady: (i) => {
        inner = i;
        let chain = Promise.resolve();
        for (let { chunk, cb } of pending)
          chain = chain.then(() => new Promise((resolve) => {
            i.write(chunk, (err) => {
              cb(err ?? void 0), resolve();
            });
          }));
        pending.length = 0, chain.then(() => {
          if (pendingFinal) {
            let cb = pendingFinal;
            pendingFinal = null, i.end(() => cb());
          }
        }).catch((err) => proxy.destroy(err)), i.on("error", (e) => proxy.destroy(e));
      },
      onError: (err) => {
        connectError = err;
        for (let p of pending)
          p.cb(err);
        pending.length = 0, pendingFinal && pendingFinal(err), pendingFinal = null, proxy.destroy(err);
      }
    }), proxy;
  }
  async _beginWriteStream(path, cbs) {
    try {
      let { share, rest } = splitSharePath(path), tree = await this.treeFor(share), open = await Open.create(tree, {
        filename: toSmbPath(rest),
        desiredAccess: FileAccess.GENERIC_WRITE | FileAccess.FILE_READ_ATTRIBUTES,
        shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
        createDisposition: CreateDisposition.OVERWRITE_IF,
        createOptions: CreateOptions.NON_DIRECTORY_FILE,
        fileAttributes: 0
      });
      cbs.onReady(createWriteStream(open));
    } catch (err) {
      cbs.onError(err);
    }
  }
  async listShares() {
    if (!this.conn || !this.session)
      throw new Error("not connected");
    let ipcPath = `\\\\${this.opts.host}\\IPC$`, ipc = await Tree.connect(this.conn, this.session, ipcPath);
    try {
      return await Open.withOpen(ipc, {
        filename: "srvsvc",
        desiredAccess: FileAccess.GENERIC_READ | FileAccess.GENERIC_WRITE | FileAccess.FILE_READ_ATTRIBUTES,
        shareAccess: ShareAccess.READ | ShareAccess.WRITE | ShareAccess.DELETE,
        createDisposition: CreateDisposition.OPEN,
        createOptions: 0,
        fileAttributes: 0
      }, async (open) => {
        let bind = encodeBindRequest({ callId: 1, abstractUuid: SRVSVC_UUID, abstractMajor: SRVSVC_MAJOR, abstractMinor: SRVSVC_MINOR });
        await this._pipeTransceive(open, bind);
        let stub = encodeNetrShareEnumRequest({
          serverName: `\\\\${this.opts.host}`,
          infoLevel: 1,
          preferredMaximumLength: 4294967295
        }), req = encodeRequest({ callId: 2, opnum: 15, contextId: 0, stub }), respFrame = await this._pipeTransceive(open, req), respStub = parseResponse(respFrame);
        return respStub ? parseNetrShareEnumResponse(respStub).entries.map((e) => ({
          name: e.name,
          type: (e.type & 255) === 0 ? "disk" : (e.type & 255) === 1 ? "print" : (e.type & 255) === 3 ? "ipc" : "special",
          comment: e.comment
        })) : [];
      });
    } finally {
      await ipc.disconnect().catch(() => {
      });
    }
  }
  async _pipeTransceive(open, payload) {
    let writeBody = encodeWriteRequest({ fileId: open.fileId, offset: 0n, data: payload }), signW = open.tree.session.makeSigning(), writeResp = await open.tree.conn.send(SmbCommand.WRITE, writeBody, {
      sessionId: open.tree.session.sessionId,
      treeId: open.tree.treeId,
      ...signW !== void 0 ? { signing: signW } : {},
      encrypt: open.tree.encryptRequired,
      creditCharge: 1
    });
    if (!isSuccess(writeResp.header.status))
      throw new SmbError({
        status: writeResp.header.status,
        message: `pipe WRITE failed: ${statusName(writeResp.header.status)}`
      });
    decodeWriteResponse(writeResp.body);
    let readBody = encodeReadRequest({ fileId: open.fileId, offset: 0n, length: 65536 }), signR = open.tree.session.makeSigning(), readResp = await open.tree.conn.send(SmbCommand.READ, readBody, {
      sessionId: open.tree.session.sessionId,
      treeId: open.tree.treeId,
      ...signR !== void 0 ? { signing: signR } : {},
      encrypt: open.tree.encryptRequired,
      creditCharge: 1
    });
    if (!isSuccess(readResp.header.status))
      throw new SmbError({
        status: readResp.header.status,
        message: `pipe READ failed: ${statusName(readResp.header.status)}`
      });
    return decodeReadResponse(readResp.body);
  }
  async close() {
    if (this.state !== "closed") {
      this.state = "closed";
      for (let t of this.trees.values())
        try {
          await t.disconnect();
        } catch {
        }
      if (this.trees.clear(), this.session)
        try {
          await this.session.close();
        } catch {
        }
      this.conn?.close();
    }
  }
};

// dist/index.js
var VERSION = "0.0.0";
export {
  Client,
  SmbAuthError,
  SmbError,
  SmbProtocolError,
  VERSION
};
