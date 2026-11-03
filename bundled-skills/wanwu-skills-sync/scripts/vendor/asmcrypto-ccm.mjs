// asmcrypto.js 2.3.2, AES-CCM (MIT). See asmcrypto.LICENSE.txt.

// dist_es8/aes/aes.asm.js
var AES_asm = (function() {
  "use strict";
  var ginit_done = false;
  var gexp3, glog3;
  function ginit() {
    gexp3 = [], glog3 = [];
    var a = 1, c, d;
    for (c = 0; c < 255; c++) {
      gexp3[c] = a;
      d = a & 128, a <<= 1, a &= 255;
      if (d === 128) a ^= 27;
      a ^= gexp3[c];
      glog3[gexp3[c]] = c;
    }
    gexp3[255] = gexp3[0];
    glog3[0] = 0;
    ginit_done = true;
  }
  function gmul(a, b) {
    var c = gexp3[(glog3[a] + glog3[b]) % 255];
    if (a === 0 || b === 0) c = 0;
    return c;
  }
  function ginv(a) {
    var i = gexp3[255 - glog3[a]];
    if (a === 0) i = 0;
    return i;
  }
  var aes_init_done = false;
  var aes_sbox;
  var aes_sinv;
  var aes_enc;
  var aes_dec;
  function aes_init() {
    if (!ginit_done) ginit();
    function _s(a) {
      var c, s2, x;
      s2 = x = ginv(a);
      for (c = 0; c < 4; c++) {
        s2 = (s2 << 1 | s2 >>> 7) & 255;
        x ^= s2;
      }
      x ^= 99;
      return x;
    }
    aes_sbox = [], aes_sinv = [], aes_enc = [[], [], [], []], aes_dec = [[], [], [], []];
    for (var i = 0; i < 256; i++) {
      var s = _s(i);
      aes_sbox[i] = s;
      aes_sinv[s] = i;
      aes_enc[0][i] = gmul(2, s) << 24 | s << 16 | s << 8 | gmul(3, s);
      aes_dec[0][s] = gmul(14, i) << 24 | gmul(9, i) << 16 | gmul(13, i) << 8 | gmul(11, i);
      for (var t = 1; t < 4; t++) {
        aes_enc[t][i] = aes_enc[t - 1][i] >>> 8 | aes_enc[t - 1][i] << 24;
        aes_dec[t][s] = aes_dec[t - 1][s] >>> 8 | aes_dec[t - 1][s] << 24;
      }
    }
    aes_init_done = true;
  }
  var wrapper = function(foreign, buffer) {
    if (!aes_init_done) aes_init();
    var heap = new Uint32Array(buffer);
    heap.set(aes_sbox, 2048 >> 2);
    heap.set(aes_sinv, 3072 >> 2);
    for (var i = 0; i < 4; i++) {
      heap.set(aes_enc[i], 4096 + 1024 * i >> 2);
      heap.set(aes_dec[i], 8192 + 1024 * i >> 2);
    }
    function set_key(ks, k0, k1, k2, k3, k4, k5, k6, k7) {
      var ekeys = heap.subarray(0, 60), dkeys = heap.subarray(256, 256 + 60);
      ekeys.set([k0, k1, k2, k3, k4, k5, k6, k7]);
      for (var i2 = ks, rcon = 1; i2 < 4 * ks + 28; i2++) {
        var k = ekeys[i2 - 1];
        if (i2 % ks === 0 || ks === 8 && i2 % ks === 4) {
          k = aes_sbox[k >>> 24] << 24 ^ aes_sbox[k >>> 16 & 255] << 16 ^ aes_sbox[k >>> 8 & 255] << 8 ^ aes_sbox[k & 255];
        }
        if (i2 % ks === 0) {
          k = k << 8 ^ k >>> 24 ^ rcon << 24;
          rcon = rcon << 1 ^ (rcon & 128 ? 27 : 0);
        }
        ekeys[i2] = ekeys[i2 - ks] ^ k;
      }
      for (var j = 0; j < i2; j += 4) {
        for (var jj = 0; jj < 4; jj++) {
          var k = ekeys[i2 - (4 + j) + (4 - jj) % 4];
          if (j < 4 || j >= i2 - 4) {
            dkeys[j + jj] = k;
          } else {
            dkeys[j + jj] = aes_dec[0][aes_sbox[k >>> 24]] ^ aes_dec[1][aes_sbox[k >>> 16 & 255]] ^ aes_dec[2][aes_sbox[k >>> 8 & 255]] ^ aes_dec[3][aes_sbox[k & 255]];
          }
        }
      }
      asm.set_rounds(ks + 5);
    }
    var stdlib = { Uint8Array, Uint32Array };
    var asm = (function(stdlib2, foreign2, buffer2) {
      ;
      var S0 = 0, S1 = 0, S2 = 0, S3 = 0, I0 = 0, I1 = 0, I2 = 0, I3 = 0, N0 = 0, N1 = 0, N2 = 0, N3 = 0, M0 = 0, M1 = 0, M2 = 0, M3 = 0, H0 = 0, H1 = 0, H2 = 0, H3 = 0, R = 0;
      var HEAP = new stdlib2.Uint32Array(buffer2), DATA = new stdlib2.Uint8Array(buffer2);
      function _core(k, s, t, r, x0, x1, x2, x3) {
        k = k | 0;
        s = s | 0;
        t = t | 0;
        r = r | 0;
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        var t1 = 0, t2 = 0, t3 = 0, y0 = 0, y1 = 0, y2 = 0, y3 = 0, i2 = 0;
        t1 = t | 1024, t2 = t | 2048, t3 = t | 3072;
        x0 = x0 ^ HEAP[(k | 0) >> 2], x1 = x1 ^ HEAP[(k | 4) >> 2], x2 = x2 ^ HEAP[(k | 8) >> 2], x3 = x3 ^ HEAP[(k | 12) >> 2];
        for (i2 = 16; (i2 | 0) <= r << 4; i2 = i2 + 16 | 0) {
          y0 = HEAP[(t | x0 >> 22 & 1020) >> 2] ^ HEAP[(t1 | x1 >> 14 & 1020) >> 2] ^ HEAP[(t2 | x2 >> 6 & 1020) >> 2] ^ HEAP[(t3 | x3 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 0) >> 2], y1 = HEAP[(t | x1 >> 22 & 1020) >> 2] ^ HEAP[(t1 | x2 >> 14 & 1020) >> 2] ^ HEAP[(t2 | x3 >> 6 & 1020) >> 2] ^ HEAP[(t3 | x0 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 4) >> 2], y2 = HEAP[(t | x2 >> 22 & 1020) >> 2] ^ HEAP[(t1 | x3 >> 14 & 1020) >> 2] ^ HEAP[(t2 | x0 >> 6 & 1020) >> 2] ^ HEAP[(t3 | x1 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 8) >> 2], y3 = HEAP[(t | x3 >> 22 & 1020) >> 2] ^ HEAP[(t1 | x0 >> 14 & 1020) >> 2] ^ HEAP[(t2 | x1 >> 6 & 1020) >> 2] ^ HEAP[(t3 | x2 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 12) >> 2];
          x0 = y0, x1 = y1, x2 = y2, x3 = y3;
        }
        S0 = HEAP[(s | x0 >> 22 & 1020) >> 2] << 24 ^ HEAP[(s | x1 >> 14 & 1020) >> 2] << 16 ^ HEAP[(s | x2 >> 6 & 1020) >> 2] << 8 ^ HEAP[(s | x3 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 0) >> 2], S1 = HEAP[(s | x1 >> 22 & 1020) >> 2] << 24 ^ HEAP[(s | x2 >> 14 & 1020) >> 2] << 16 ^ HEAP[(s | x3 >> 6 & 1020) >> 2] << 8 ^ HEAP[(s | x0 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 4) >> 2], S2 = HEAP[(s | x2 >> 22 & 1020) >> 2] << 24 ^ HEAP[(s | x3 >> 14 & 1020) >> 2] << 16 ^ HEAP[(s | x0 >> 6 & 1020) >> 2] << 8 ^ HEAP[(s | x1 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 8) >> 2], S3 = HEAP[(s | x3 >> 22 & 1020) >> 2] << 24 ^ HEAP[(s | x0 >> 14 & 1020) >> 2] << 16 ^ HEAP[(s | x1 >> 6 & 1020) >> 2] << 8 ^ HEAP[(s | x2 << 2 & 1020) >> 2] ^ HEAP[(k | i2 | 12) >> 2];
      }
      function _ecb_enc(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        _core(
          0,
          2048,
          4096,
          R,
          x0,
          x1,
          x2,
          x3
        );
      }
      function _ecb_dec(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        var t = 0;
        _core(
          1024,
          3072,
          8192,
          R,
          x0,
          x3,
          x2,
          x1
        );
        t = S1, S1 = S3, S3 = t;
      }
      function _cbc_enc(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        _core(
          0,
          2048,
          4096,
          R,
          I0 ^ x0,
          I1 ^ x1,
          I2 ^ x2,
          I3 ^ x3
        );
        I0 = S0, I1 = S1, I2 = S2, I3 = S3;
      }
      function _cbc_dec(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        var t = 0;
        _core(
          1024,
          3072,
          8192,
          R,
          x0,
          x3,
          x2,
          x1
        );
        t = S1, S1 = S3, S3 = t;
        S0 = S0 ^ I0, S1 = S1 ^ I1, S2 = S2 ^ I2, S3 = S3 ^ I3;
        I0 = x0, I1 = x1, I2 = x2, I3 = x3;
      }
      function _cfb_enc(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        _core(
          0,
          2048,
          4096,
          R,
          I0,
          I1,
          I2,
          I3
        );
        I0 = S0 = S0 ^ x0, I1 = S1 = S1 ^ x1, I2 = S2 = S2 ^ x2, I3 = S3 = S3 ^ x3;
      }
      function _cfb_dec(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        _core(
          0,
          2048,
          4096,
          R,
          I0,
          I1,
          I2,
          I3
        );
        S0 = S0 ^ x0, S1 = S1 ^ x1, S2 = S2 ^ x2, S3 = S3 ^ x3;
        I0 = x0, I1 = x1, I2 = x2, I3 = x3;
      }
      function _ofb(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        _core(
          0,
          2048,
          4096,
          R,
          I0,
          I1,
          I2,
          I3
        );
        I0 = S0, I1 = S1, I2 = S2, I3 = S3;
        S0 = S0 ^ x0, S1 = S1 ^ x1, S2 = S2 ^ x2, S3 = S3 ^ x3;
      }
      function _ctr(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        _core(
          0,
          2048,
          4096,
          R,
          N0,
          N1,
          N2,
          N3
        );
        N3 = ~M3 & N3 | M3 & N3 + 1;
        N2 = ~M2 & N2 | M2 & N2 + ((N3 | 0) == 0);
        N1 = ~M1 & N1 | M1 & N1 + ((N2 | 0) == 0);
        N0 = ~M0 & N0 | M0 & N0 + ((N1 | 0) == 0);
        S0 = S0 ^ x0;
        S1 = S1 ^ x1;
        S2 = S2 ^ x2;
        S3 = S3 ^ x3;
      }
      function _gcm_mac(x0, x1, x2, x3) {
        x0 = x0 | 0;
        x1 = x1 | 0;
        x2 = x2 | 0;
        x3 = x3 | 0;
        var y0 = 0, y1 = 0, y2 = 0, y3 = 0, z0 = 0, z1 = 0, z2 = 0, z3 = 0, i2 = 0, c = 0;
        x0 = x0 ^ I0, x1 = x1 ^ I1, x2 = x2 ^ I2, x3 = x3 ^ I3;
        y0 = H0 | 0, y1 = H1 | 0, y2 = H2 | 0, y3 = H3 | 0;
        for (; (i2 | 0) < 128; i2 = i2 + 1 | 0) {
          if (y0 >>> 31) {
            z0 = z0 ^ x0, z1 = z1 ^ x1, z2 = z2 ^ x2, z3 = z3 ^ x3;
          }
          y0 = y0 << 1 | y1 >>> 31, y1 = y1 << 1 | y2 >>> 31, y2 = y2 << 1 | y3 >>> 31, y3 = y3 << 1;
          c = x3 & 1;
          x3 = x3 >>> 1 | x2 << 31, x2 = x2 >>> 1 | x1 << 31, x1 = x1 >>> 1 | x0 << 31, x0 = x0 >>> 1;
          if (c) x0 = x0 ^ 3774873600;
        }
        I0 = z0, I1 = z1, I2 = z2, I3 = z3;
      }
      function set_rounds(r) {
        r = r | 0;
        R = r;
      }
      function set_state(s0, s1, s2, s3) {
        s0 = s0 | 0;
        s1 = s1 | 0;
        s2 = s2 | 0;
        s3 = s3 | 0;
        S0 = s0, S1 = s1, S2 = s2, S3 = s3;
      }
      function set_iv(i0, i1, i2, i3) {
        i0 = i0 | 0;
        i1 = i1 | 0;
        i2 = i2 | 0;
        i3 = i3 | 0;
        I0 = i0, I1 = i1, I2 = i2, I3 = i3;
      }
      function set_nonce(n0, n1, n2, n3) {
        n0 = n0 | 0;
        n1 = n1 | 0;
        n2 = n2 | 0;
        n3 = n3 | 0;
        N0 = n0, N1 = n1, N2 = n2, N3 = n3;
      }
      function set_mask(m0, m1, m2, m3) {
        m0 = m0 | 0;
        m1 = m1 | 0;
        m2 = m2 | 0;
        m3 = m3 | 0;
        M0 = m0, M1 = m1, M2 = m2, M3 = m3;
      }
      function set_counter(c0, c1, c2, c3) {
        c0 = c0 | 0;
        c1 = c1 | 0;
        c2 = c2 | 0;
        c3 = c3 | 0;
        N3 = ~M3 & N3 | M3 & c3, N2 = ~M2 & N2 | M2 & c2, N1 = ~M1 & N1 | M1 & c1, N0 = ~M0 & N0 | M0 & c0;
      }
      function get_state(pos) {
        pos = pos | 0;
        if (pos & 15) return -1;
        DATA[pos | 0] = S0 >>> 24, DATA[pos | 1] = S0 >>> 16 & 255, DATA[pos | 2] = S0 >>> 8 & 255, DATA[pos | 3] = S0 & 255, DATA[pos | 4] = S1 >>> 24, DATA[pos | 5] = S1 >>> 16 & 255, DATA[pos | 6] = S1 >>> 8 & 255, DATA[pos | 7] = S1 & 255, DATA[pos | 8] = S2 >>> 24, DATA[pos | 9] = S2 >>> 16 & 255, DATA[pos | 10] = S2 >>> 8 & 255, DATA[pos | 11] = S2 & 255, DATA[pos | 12] = S3 >>> 24, DATA[pos | 13] = S3 >>> 16 & 255, DATA[pos | 14] = S3 >>> 8 & 255, DATA[pos | 15] = S3 & 255;
        return 16;
      }
      function get_iv(pos) {
        pos = pos | 0;
        if (pos & 15) return -1;
        DATA[pos | 0] = I0 >>> 24, DATA[pos | 1] = I0 >>> 16 & 255, DATA[pos | 2] = I0 >>> 8 & 255, DATA[pos | 3] = I0 & 255, DATA[pos | 4] = I1 >>> 24, DATA[pos | 5] = I1 >>> 16 & 255, DATA[pos | 6] = I1 >>> 8 & 255, DATA[pos | 7] = I1 & 255, DATA[pos | 8] = I2 >>> 24, DATA[pos | 9] = I2 >>> 16 & 255, DATA[pos | 10] = I2 >>> 8 & 255, DATA[pos | 11] = I2 & 255, DATA[pos | 12] = I3 >>> 24, DATA[pos | 13] = I3 >>> 16 & 255, DATA[pos | 14] = I3 >>> 8 & 255, DATA[pos | 15] = I3 & 255;
        return 16;
      }
      function gcm_init() {
        _ecb_enc(0, 0, 0, 0);
        H0 = S0, H1 = S1, H2 = S2, H3 = S3;
      }
      function cipher(mode, pos, len) {
        mode = mode | 0;
        pos = pos | 0;
        len = len | 0;
        var ret = 0;
        if (pos & 15) return -1;
        while ((len | 0) >= 16) {
          _cipher_modes[mode & 7](
            DATA[pos | 0] << 24 | DATA[pos | 1] << 16 | DATA[pos | 2] << 8 | DATA[pos | 3],
            DATA[pos | 4] << 24 | DATA[pos | 5] << 16 | DATA[pos | 6] << 8 | DATA[pos | 7],
            DATA[pos | 8] << 24 | DATA[pos | 9] << 16 | DATA[pos | 10] << 8 | DATA[pos | 11],
            DATA[pos | 12] << 24 | DATA[pos | 13] << 16 | DATA[pos | 14] << 8 | DATA[pos | 15]
          );
          DATA[pos | 0] = S0 >>> 24, DATA[pos | 1] = S0 >>> 16 & 255, DATA[pos | 2] = S0 >>> 8 & 255, DATA[pos | 3] = S0 & 255, DATA[pos | 4] = S1 >>> 24, DATA[pos | 5] = S1 >>> 16 & 255, DATA[pos | 6] = S1 >>> 8 & 255, DATA[pos | 7] = S1 & 255, DATA[pos | 8] = S2 >>> 24, DATA[pos | 9] = S2 >>> 16 & 255, DATA[pos | 10] = S2 >>> 8 & 255, DATA[pos | 11] = S2 & 255, DATA[pos | 12] = S3 >>> 24, DATA[pos | 13] = S3 >>> 16 & 255, DATA[pos | 14] = S3 >>> 8 & 255, DATA[pos | 15] = S3 & 255;
          ret = ret + 16 | 0, pos = pos + 16 | 0, len = len - 16 | 0;
        }
        return ret | 0;
      }
      function mac(mode, pos, len) {
        mode = mode | 0;
        pos = pos | 0;
        len = len | 0;
        var ret = 0;
        if (pos & 15) return -1;
        while ((len | 0) >= 16) {
          _mac_modes[mode & 1](
            DATA[pos | 0] << 24 | DATA[pos | 1] << 16 | DATA[pos | 2] << 8 | DATA[pos | 3],
            DATA[pos | 4] << 24 | DATA[pos | 5] << 16 | DATA[pos | 6] << 8 | DATA[pos | 7],
            DATA[pos | 8] << 24 | DATA[pos | 9] << 16 | DATA[pos | 10] << 8 | DATA[pos | 11],
            DATA[pos | 12] << 24 | DATA[pos | 13] << 16 | DATA[pos | 14] << 8 | DATA[pos | 15]
          );
          ret = ret + 16 | 0, pos = pos + 16 | 0, len = len - 16 | 0;
        }
        return ret | 0;
      }
      var _cipher_modes = [_ecb_enc, _ecb_dec, _cbc_enc, _cbc_dec, _cfb_enc, _cfb_dec, _ofb, _ctr];
      var _mac_modes = [_cbc_enc, _gcm_mac];
      return {
        set_rounds,
        set_state,
        set_iv,
        set_nonce,
        set_mask,
        set_counter,
        get_state,
        get_iv,
        gcm_init,
        cipher,
        mac
      };
    })(stdlib, foreign, buffer);
    asm.set_key = set_key;
    return asm;
  };
  wrapper.ENC = {
    ECB: 0,
    CBC: 2,
    CFB: 4,
    OFB: 6,
    CTR: 7
  }, /**
   * AES deciphering mode constants
   * @enum {number}
   * @const
   */
  wrapper.DEC = {
    ECB: 1,
    CBC: 3,
    CFB: 5,
    OFB: 6,
    CTR: 7
  }, /**
   * AES MAC mode constants
   * @enum {number}
   * @const
   */
  wrapper.MAC = {
    CBC: 0,
    GCM: 1
  };
  wrapper.HEAP_DATA = 16384;
  return wrapper;
})();

// dist_es8/other/utils.js
function is_bytes(a) {
  return a instanceof Uint8Array;
}
function _heap_init(heap, heapSize) {
  const size = heap ? heap.byteLength : heapSize || 65536;
  if (size & 4095 || size <= 0)
    throw new Error("heap size must be a positive integer and a multiple of 4096");
  heap = heap || new Uint8Array(new ArrayBuffer(size));
  return heap;
}
function _heap_write(heap, hpos, data, dpos, dlen) {
  const hlen = heap.length - hpos;
  const wlen = hlen < dlen ? hlen : dlen;
  heap.set(data.subarray(dpos, dpos + wlen), hpos);
  return wlen;
}

// dist_es8/other/errors.js
var IllegalStateError = class extends Error {
  constructor(...args) {
    super(...args);
    Object.create(Error.prototype, { name: { value: "IllegalStateError" } });
  }
};
var IllegalArgumentError = class extends Error {
  constructor(...args) {
    super(...args);
    Object.create(Error.prototype, { name: { value: "IllegalArgumentError" } });
  }
};
var SecurityError = class extends Error {
  constructor(...args) {
    super(...args);
    Object.create(Error.prototype, { name: { value: "SecurityError" } });
  }
};

// dist_es8/aes/aes.js
var AES = class {
  constructor(key, iv, padding = true, mode) {
    this.pos = 0;
    this.len = 0;
    this.mode = mode;
    this.heap = _heap_init().subarray(AES_asm.HEAP_DATA);
    this.asm = new AES_asm(null, this.heap.buffer);
    this.pos = 0;
    this.len = 0;
    const keylen = key.length;
    if (keylen !== 16 && keylen !== 24 && keylen !== 32)
      throw new IllegalArgumentError("illegal key size");
    const keyview = new DataView(key.buffer, key.byteOffset, key.byteLength);
    this.asm.set_key(keylen >> 2, keyview.getUint32(0), keyview.getUint32(4), keyview.getUint32(8), keyview.getUint32(12), keylen > 16 ? keyview.getUint32(16) : 0, keylen > 16 ? keyview.getUint32(20) : 0, keylen > 24 ? keyview.getUint32(24) : 0, keylen > 24 ? keyview.getUint32(28) : 0);
    if (iv !== void 0) {
      if (iv.length !== 16)
        throw new IllegalArgumentError("illegal iv size");
      let ivview = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
      this.asm.set_iv(ivview.getUint32(0), ivview.getUint32(4), ivview.getUint32(8), ivview.getUint32(12));
    } else {
      this.asm.set_iv(0, 0, 0, 0);
    }
    this.padding = padding;
  }
  AES_Encrypt_process(data) {
    if (!is_bytes(data))
      throw new TypeError("data isn't of expected type");
    let asm = this.asm;
    let heap = this.heap;
    let amode = AES_asm.ENC[this.mode];
    let hpos = AES_asm.HEAP_DATA;
    let pos = this.pos;
    let len = this.len;
    let dpos = 0;
    let dlen = data.length || 0;
    let rpos = 0;
    let rlen = len + dlen & -16;
    let wlen = 0;
    let result = new Uint8Array(rlen);
    while (dlen > 0) {
      wlen = _heap_write(heap, pos + len, data, dpos, dlen);
      len += wlen;
      dpos += wlen;
      dlen -= wlen;
      wlen = asm.cipher(amode, hpos + pos, len);
      if (wlen)
        result.set(heap.subarray(pos, pos + wlen), rpos);
      rpos += wlen;
      if (wlen < len) {
        pos += wlen;
        len -= wlen;
      } else {
        pos = 0;
        len = 0;
      }
    }
    this.pos = pos;
    this.len = len;
    return result;
  }
  AES_Encrypt_finish() {
    let asm = this.asm;
    let heap = this.heap;
    let amode = AES_asm.ENC[this.mode];
    let hpos = AES_asm.HEAP_DATA;
    let pos = this.pos;
    let len = this.len;
    let plen = 16 - len % 16;
    let rlen = len;
    if (this.hasOwnProperty("padding")) {
      if (this.padding) {
        for (let p = 0; p < plen; ++p) {
          heap[pos + len + p] = plen;
        }
        len += plen;
        rlen = len;
      } else if (len % 16) {
        throw new IllegalArgumentError("data length must be a multiple of the block size");
      }
    } else {
      len += plen;
    }
    const result = new Uint8Array(rlen);
    if (len)
      asm.cipher(amode, hpos + pos, len);
    if (rlen)
      result.set(heap.subarray(pos, pos + rlen));
    this.pos = 0;
    this.len = 0;
    return result;
  }
  AES_Decrypt_process(data) {
    if (!is_bytes(data))
      throw new TypeError("data isn't of expected type");
    let asm = this.asm;
    let heap = this.heap;
    let amode = AES_asm.DEC[this.mode];
    let hpos = AES_asm.HEAP_DATA;
    let pos = this.pos;
    let len = this.len;
    let dpos = 0;
    let dlen = data.length || 0;
    let rpos = 0;
    let rlen = len + dlen & -16;
    let plen = 0;
    let wlen = 0;
    if (this.padding) {
      plen = len + dlen - rlen || 16;
      rlen -= plen;
    }
    const result = new Uint8Array(rlen);
    while (dlen > 0) {
      wlen = _heap_write(heap, pos + len, data, dpos, dlen);
      len += wlen;
      dpos += wlen;
      dlen -= wlen;
      wlen = asm.cipher(amode, hpos + pos, len - (!dlen ? plen : 0));
      if (wlen)
        result.set(heap.subarray(pos, pos + wlen), rpos);
      rpos += wlen;
      if (wlen < len) {
        pos += wlen;
        len -= wlen;
      } else {
        pos = 0;
        len = 0;
      }
    }
    this.pos = pos;
    this.len = len;
    return result;
  }
  AES_Decrypt_finish() {
    let asm = this.asm;
    let heap = this.heap;
    let amode = AES_asm.DEC[this.mode];
    let hpos = AES_asm.HEAP_DATA;
    let pos = this.pos;
    let len = this.len;
    let rlen = len;
    if (len > 0) {
      if (len % 16) {
        if (this.hasOwnProperty("padding")) {
          throw new IllegalArgumentError("data length must be a multiple of the block size");
        } else {
          len += 16 - len % 16;
        }
      }
      asm.cipher(amode, hpos + pos, len);
      if (this.hasOwnProperty("padding") && this.padding) {
        let pad = heap[pos + rlen - 1];
        if (pad < 1 || pad > 16 || pad > rlen)
          throw new SecurityError("bad padding");
        let pcheck = 0;
        for (let i = pad; i > 1; i--)
          pcheck |= pad ^ heap[pos + rlen - i];
        if (pcheck)
          throw new SecurityError("bad padding");
        rlen -= pad;
      }
    }
    const result = new Uint8Array(rlen);
    if (rlen > 0) {
      result.set(heap.subarray(pos, pos + rlen));
    }
    this.pos = 0;
    this.len = 0;
    return result;
  }
};

// dist_es8/aes/ccm.js
var _AES_CCM_adata_maxLength = 65279;
var _AES_CCM_data_maxLength = 4503599627370480;
var AES_CCM = class _AES_CCM extends AES {
  constructor(key, nonce, adata, tagSize = 16, dataLength) {
    super(key, void 0, void 0, "CCM");
    this.counter = 1;
    this.dataLength = -1;
    if (tagSize < 4 || tagSize > 16 || tagSize & 1)
      throw new IllegalArgumentError("illegal tagSize value");
    this.tagSize = tagSize;
    this.nonce = nonce;
    if (nonce.length < 8 || nonce.length > 13)
      throw new IllegalArgumentError("illegal nonce length");
    this.lengthSize = 15 - nonce.length;
    nonce = new Uint8Array(nonce.length + 1);
    nonce[0] = this.lengthSize - 1;
    nonce.set(this.nonce, 1);
    if (dataLength < 0 || dataLength > _AES_CCM_data_maxLength || dataLength > Math.pow(2, 8 * this.lengthSize) - 16)
      throw new IllegalArgumentError("illegal dataLength value");
    if (adata !== void 0) {
      if (adata.length > _AES_CCM_adata_maxLength)
        throw new IllegalArgumentError("illegal adata length");
      this.adata = adata.length ? adata : void 0;
    }
    this.dataLength = dataLength;
    this.counter = 1;
    this.AES_CCM_calculate_iv();
    this.AES_CTR_set_options(nonce, this.counter, 8 * this.lengthSize);
  }
  static encrypt(clear, key, nonce, adata, tagsize = 16) {
    return new _AES_CCM(key, nonce, adata, tagsize, clear.length).encrypt(clear);
  }
  static decrypt(cipher, key, nonce, adata, tagsize = 16) {
    return new _AES_CCM(key, nonce, adata, tagsize, cipher.length - tagsize).decrypt(cipher);
  }
  encrypt(data) {
    this.dataLength = data.length || 0;
    const result1 = this.AES_CCM_Encrypt_process(data);
    const result2 = this.AES_CCM_Encrypt_finish();
    const result = new Uint8Array(result1.length + result2.length);
    if (result1.length)
      result.set(result1);
    if (result2.length)
      result.set(result2, result1.length);
    return result;
  }
  decrypt(data) {
    this.dataLength = data.length || 0;
    const result1 = this.AES_CCM_Decrypt_process(data);
    const result2 = this.AES_CCM_Decrypt_finish();
    const result = new Uint8Array(result1.length + result2.length);
    if (result1.length)
      result.set(result1);
    if (result2.length)
      result.set(result2, result1.length);
    return result;
  }
  AES_CCM_calculate_iv() {
    const nonce = this.nonce;
    const adata = this.adata;
    const tagSize = this.tagSize;
    const lengthSize = this.lengthSize;
    const dataLength = this.dataLength;
    const data = new Uint8Array(16 + (adata ? 2 + adata.length : 0));
    data[0] = (adata ? 64 : 0) | tagSize - 2 << 2 | lengthSize - 1;
    data.set(nonce, 1);
    if (lengthSize > 6)
      data[9] = dataLength / 4294967296 >>> 16 & 15;
    if (lengthSize > 5)
      data[10] = dataLength / 4294967296 >>> 8 & 255;
    if (lengthSize > 4)
      data[11] = dataLength / 4294967296 & 255;
    if (lengthSize > 3)
      data[12] = dataLength >>> 24;
    if (lengthSize > 2)
      data[13] = dataLength >>> 16 & 255;
    data[14] = dataLength >>> 8 & 255;
    data[15] = dataLength & 255;
    if (adata) {
      data[16] = adata.length >>> 8 & 255;
      data[17] = adata.length & 255;
      data.set(adata, 18);
    }
    this._cbc_mac_process(data);
    this.asm.get_state(AES_asm.HEAP_DATA);
    const iv = new Uint8Array(this.heap.subarray(0, 16));
    const ivview = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
    this.asm.set_iv(ivview.getUint32(0), ivview.getUint32(4), ivview.getUint32(8), ivview.getUint32(12));
  }
  _cbc_mac_process(data) {
    const heap = this.heap;
    const asm = this.asm;
    let dpos = 0;
    let dlen = data.length || 0;
    let wlen = 0;
    while (dlen > 0) {
      wlen = _heap_write(heap, 0, data, dpos, dlen);
      while (wlen & 15)
        heap[wlen++] = 0;
      dpos += wlen;
      dlen -= wlen;
      asm.mac(AES_asm.MAC.CBC, AES_asm.HEAP_DATA, wlen);
    }
  }
  AES_CCM_Encrypt_process(data) {
    const asm = this.asm;
    const heap = this.heap;
    let dpos = 0;
    let dlen = data.length || 0;
    let counter = this.counter;
    let pos = this.pos;
    let len = this.len;
    const rlen = len + dlen & -16;
    let rpos = 0;
    let wlen = 0;
    if ((counter - 1 << 4) + len + dlen > _AES_CCM_data_maxLength)
      throw new RangeError("counter overflow");
    const result = new Uint8Array(rlen);
    while (dlen > 0) {
      wlen = _heap_write(heap, pos + len, data, dpos, dlen);
      len += wlen;
      dpos += wlen;
      dlen -= wlen;
      wlen = asm.mac(AES_asm.MAC.CBC, AES_asm.HEAP_DATA + pos, len);
      wlen = asm.cipher(AES_asm.ENC.CTR, AES_asm.HEAP_DATA + pos, wlen);
      if (wlen)
        result.set(heap.subarray(pos, pos + wlen), rpos);
      counter += wlen >>> 4;
      rpos += wlen;
      if (wlen < len) {
        pos += wlen;
        len -= wlen;
      } else {
        pos = 0;
        len = 0;
      }
    }
    this.counter = counter;
    this.pos = pos;
    this.len = len;
    return result;
  }
  AES_CCM_Encrypt_finish() {
    const asm = this.asm;
    const heap = this.heap;
    const tagSize = this.tagSize;
    const pos = this.pos;
    const len = this.len;
    const result = new Uint8Array(len + tagSize);
    let i = len;
    for (; i & 15; i++)
      heap[pos + i] = 0;
    asm.mac(AES_asm.MAC.CBC, AES_asm.HEAP_DATA + pos, i);
    asm.cipher(AES_asm.ENC.CTR, AES_asm.HEAP_DATA + pos, i);
    if (len)
      result.set(heap.subarray(pos, pos + len));
    asm.set_counter(0, 0, 0, 0);
    asm.get_iv(AES_asm.HEAP_DATA);
    asm.cipher(AES_asm.ENC.CTR, AES_asm.HEAP_DATA, 16);
    result.set(heap.subarray(0, tagSize), len);
    this.counter = 1;
    this.pos = 0;
    this.len = 0;
    return result;
  }
  AES_CCM_Decrypt_process(data) {
    let dpos = 0;
    let dlen = data.length || 0;
    const asm = this.asm;
    const heap = this.heap;
    let counter = this.counter;
    const tagSize = this.tagSize;
    let pos = this.pos;
    let len = this.len;
    let rpos = 0;
    const rlen = len + dlen > tagSize ? len + dlen - tagSize & -16 : 0;
    const tlen = len + dlen - rlen;
    let wlen = 0;
    if ((counter - 1 << 4) + len + dlen > _AES_CCM_data_maxLength)
      throw new RangeError("counter overflow");
    const result = new Uint8Array(rlen);
    while (dlen > tlen) {
      wlen = _heap_write(heap, pos + len, data, dpos, dlen - tlen);
      len += wlen;
      dpos += wlen;
      dlen -= wlen;
      wlen = asm.cipher(AES_asm.DEC.CTR, AES_asm.HEAP_DATA + pos, wlen);
      wlen = asm.mac(AES_asm.MAC.CBC, AES_asm.HEAP_DATA + pos, wlen);
      if (wlen)
        result.set(heap.subarray(pos, pos + wlen), rpos);
      counter += wlen >>> 4;
      rpos += wlen;
      pos = 0;
      len = 0;
    }
    if (dlen > 0) {
      len += _heap_write(heap, 0, data, dpos, dlen);
    }
    this.counter = counter;
    this.pos = pos;
    this.len = len;
    return result;
  }
  AES_CCM_Decrypt_finish() {
    const asm = this.asm;
    const heap = this.heap;
    const tagSize = this.tagSize;
    const pos = this.pos;
    const len = this.len;
    const rlen = len - tagSize;
    if (len < tagSize)
      throw new IllegalStateError("authentication tag not found");
    const result = new Uint8Array(rlen);
    const atag = new Uint8Array(heap.subarray(pos + rlen, pos + len));
    asm.cipher(AES_asm.DEC.CTR, AES_asm.HEAP_DATA + pos, rlen + 15 & -16);
    result.set(heap.subarray(pos, pos + rlen));
    let i = rlen;
    for (; i & 15; i++)
      heap[pos + i] = 0;
    asm.mac(AES_asm.MAC.CBC, AES_asm.HEAP_DATA + pos, i);
    asm.set_counter(0, 0, 0, 0);
    asm.get_iv(AES_asm.HEAP_DATA);
    asm.cipher(AES_asm.ENC.CTR, AES_asm.HEAP_DATA, 16);
    let acheck = 0;
    for (let j = 0; j < tagSize; ++j)
      acheck |= atag[j] ^ heap[j];
    if (acheck)
      throw new SecurityError("data integrity check failed");
    this.counter = 1;
    this.pos = 0;
    this.len = 0;
    return result;
  }
  AES_CTR_set_options(nonce, counter, size) {
    if (size < 8 || size > 48)
      throw new IllegalArgumentError("illegal counter size");
    const mask = Math.pow(2, size) - 1;
    this.asm.set_mask(0, 0, mask / 4294967296 | 0, mask | 0);
    const len = nonce.length;
    if (!len || len > 16)
      throw new IllegalArgumentError("illegal nonce size");
    this.nonce = nonce;
    const view = new DataView(new ArrayBuffer(16));
    new Uint8Array(view.buffer).set(nonce);
    this.asm.set_nonce(view.getUint32(0), view.getUint32(4), view.getUint32(8), view.getUint32(12));
    if (counter < 0 || counter >= Math.pow(2, size))
      throw new IllegalArgumentError("illegal counter value");
    this.counter = counter;
    this.asm.set_counter(0, 0, counter / 4294967296 | 0, counter | 0);
  }
};
export {
  AES_CCM
};
/**
 * @file {@link http://asmjs.org Asm.js} implementation of the {@link https://en.wikipedia.org/wiki/Advanced_Encryption_Standard Advanced Encryption Standard}.
 * @author Artem S Vybornov <vybornov@gmail.com>
 * @license MIT
 */
