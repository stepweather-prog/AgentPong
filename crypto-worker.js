// crypto-worker.js
function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex) {
    return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))).buffer;
}

async function generateKeyPair() {
    const kp = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
    );
    const pubKey = await crypto.subtle.exportKey('raw', kp.publicKey);
    const privKey = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
    return {
        publicKey: bufferToHex(pubKey),
        privateKey: bufferToHex(privKey)
    };
}

async function deriveSecret(privateKeyHex, publicKeyHex) {
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        hexToBuffer(privateKeyHex),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveBits']
    );
    const publicKey = await crypto.subtle.importKey(
        'raw',
        hexToBuffer(publicKeyHex),
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: publicKey },
        privateKey,
        256
    );
    return bufferToHex(bits);
}

async function SHA(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(hash);
}

async function HKDF(secret, salt, info) {
    const secretKey = await crypto.subtle.importKey(
        'raw',
        hexToBuffer(secret),
        { name: 'HKDF' },
        false,
        ['deriveBits']
    );
    const infoBuffer = new TextEncoder().encode(info);
    const saltBuffer = salt ? hexToBuffer(salt) : new Uint8Array(32);
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBuffer, info: infoBuffer },
        secretKey,
        256
    );
    return bufferToHex(bits);
}

async function encryptAES(plaintext, keyHex) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
        'raw',
        hexToBuffer(keyHex),
        { name: 'AES-GCM' },
        false,
        ['encrypt']
    );
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.byteLength);
    return bufferToHex(combined.buffer);
}

async function decryptAES(encryptedHex, keyHex) {
    const combined = new Uint8Array(hexToBuffer(encryptedHex));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await crypto.subtle.importKey(
        'raw',
        hexToBuffer(keyHex),
        { name: 'AES-GCM' },
        false,
        ['decrypt']
    );
    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );
        return new TextDecoder().decode(decrypted);
    } catch(e) {
        return null;
    }
}

async function sign(hexData, hexPrivateKey) {
    const key = await crypto.subtle.importKey(
        'pkcs8',
        hexToBuffer(hexPrivateKey),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        hexToBuffer(hexData)
    );
    return bufferToHex(sig);
}

async function verify(hexData, hexSignature, hexPublicKey) {
    try {
        const key = await crypto.subtle.importKey(
            'raw',
            hexToBuffer(hexPublicKey),
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );
        return await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key,
            hexToBuffer(hexSignature),
            hexToBuffer(hexData)
        );
    } catch (e) {
        return false; // v6.4: пустая/битая подпись — «не прошла», а не исключение (вход атакуем)
    }
}

async function computeHMAC(data, keyHex) {
    const key = await crypto.subtle.importKey(
        'raw',
        hexToBuffer(keyHex),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(data)
    );
    return bufferToHex(signature);
}

async function verifyHMAC(data, sigHex, keyHex) {
    const key = await crypto.subtle.importKey(
        'raw',
        hexToBuffer(keyHex),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );
    return await crypto.subtle.verify(
        'HMAC',
        key,
        hexToBuffer(sigHex),
        new TextEncoder().encode(data)
    );
}

// ===== X3DH (Extended Triple Diffie-Hellman) =====

async function x3dhSend(myIdentityPriv, myEphemeralPriv, theirIdentityPub, theirSignedPreKeyPub) {
    const dh1 = await deriveSecret(myIdentityPriv, theirSignedPreKeyPub);
    const dh2 = await deriveSecret(myEphemeralPriv, theirIdentityPub);
    const dh3 = await deriveSecret(myEphemeralPriv, theirSignedPreKeyPub);
    const combined = dh1 + dh2 + dh3;
    return await HKDF(combined, null, 'osprp-x3dh-root');
}

async function x3dhReceive(myIdentityPriv, mySignedPreKeyPriv, theirIdentityPub, theirEphemeralPub) {
    const dh1 = await deriveSecret(mySignedPreKeyPriv, theirIdentityPub);
    const dh2 = await deriveSecret(myIdentityPriv, theirEphemeralPub);
    const dh3 = await deriveSecret(mySignedPreKeyPriv, theirEphemeralPub);
    const combined = dh1 + dh2 + dh3;
    return await HKDF(combined, null, 'osprp-x3dh-root');
}

// ===== Symmetric Ratchet =====

async function packBlob(jsonString, ch) {
    const messageKey = await HKDF(ch.sendKey, null, 'osprp-message-key-' + ch.sendIndex);
    const encrypted = await encryptAES(jsonString, messageKey);
    const hmac = await computeHMAC(encrypted, ch.sendKey);
    const newSendKey = await HKDF(ch.sendKey, null, 'osprp-chain-key-' + ch.sendIndex);
    const newSendIndex = ch.sendIndex + 1;

    const payload = { d: encrypted, h: hmac, _ri: ch.sendIndex, _t: Date.now() };
    const packed = JSON.stringify(payload);

    return {
        packed: packed,
        newSendKey: newSendKey,
        newSendIndex: newSendIndex
    };
}

async function unpackBlob(packedString, ch) {
    try {
        const parsed = JSON.parse(packedString);
        if (!parsed.d || !parsed.h) return null;

        const ri = parseInt(parsed._ri) || 0;

        // v6.4 fix 2: ключ ищется по индексу (in-order, либо из кэша пропущенных), а не только текущий recvKey
        let chainKey = null;
        if (ri === (ch.recvIndex || 0)) {
            chainKey = ch.recvKey;
        } else if (Array.isArray(ch.oldRecvKeys)) {
            const saved = ch.oldRecvKeys.find(function (k) { return k && k.index === ri; });
            if (saved) chainKey = saved.key;
        }
        if (!chainKey) return null;

        const hmacValid = await verifyHMAC(parsed.d, parsed.h, chainKey);
        if (!hmacValid) return null;

        const messageKey = await HKDF(chainKey, null, 'osprp-message-key-' + ri);
        const decrypted = await decryptAES(parsed.d, messageKey);
        if (!decrypted) return null;

        const result = JSON.parse(decrypted);
        result._ri = parsed._ri;
        result._t = parsed._t;

        // v6.4 fix 2: цепь двигает только in-order сообщение; out-of-order не двигает recvKey
        if (ri !== (ch.recvIndex || 0)) {
            return { data: result, newRecvKey: ch.recvKey, newRecvIndex: ch.recvIndex || 0 };
        }

        const newRecvKey = await HKDF(ch.recvKey, null, 'osprp-chain-key-' + ri);
        const newRecvIndex = ri + 1;

        // ключи обработанных индексов из кэша можно убрать
        if (Array.isArray(ch.oldRecvKeys)) {
            ch.oldRecvKeys = ch.oldRecvKeys.filter(function (k) { return k && k.index >= newRecvIndex; });
        }

        return {
            data: result,
            newRecvKey: newRecvKey,
            newRecvIndex: newRecvIndex
        };
    } catch(e) {
        return null;
    }
}

// v6.4 fix 3: кап на скачок цепи — подделка _ri в публичном ящике больше не выкручивает HKDF миллиард раз
const MAX_RATCHET_JUMP = 100;
async function advanceRecvRatchet(ch, targetRi) {
    let currentKey = ch.recvKey;
    let currentIndex = ch.recvIndex || 0;
    const oldKeys = [];

    if (typeof targetRi !== 'number' || !Number.isFinite(targetRi)) return null;
    if (targetRi < currentIndex) return null;
    if (targetRi - currentIndex > MAX_RATCHET_JUMP) return null;

    // старые цепные ключи — для сообщений, приехавших позже своих индексов (out-of-order)
    while (currentIndex < targetRi) {
        oldKeys.push({ key: currentKey, index: currentIndex });
        currentKey = await HKDF(currentKey, null, 'osprp-chain-key-' + currentIndex);
        currentIndex++;
    }

    // currentKey = цепной ключ на targetRi: им расшифровывается само сообщение targetRi
    oldKeys.push({ key: currentKey, index: currentIndex });
    currentKey = await HKDF(currentKey, null, 'osprp-chain-key-' + currentIndex);
    currentIndex++;

    return {
        finalKey: currentKey,
        index: currentIndex,
        oldKeys: oldKeys.slice(-MAX_RATCHET_JUMP)
    };
}

// ===== DH Ratchet =====

async function dhRatchetStep(rootKey, myPrivKey, theirPubKey) {
    const newKp = await generateKeyPair();
    // v6.4: DH считается НОВОЙ парой отправителя против текущей пары приёмника —
    // иначе корни у сторон никогда не сходятся (приёмник считает DH(свой старый, наш новый))
    const dhSecret = await deriveSecret(newKp.privateKey, theirPubKey);
    const newRootKey = await HKDF(rootKey, dhSecret, 'osprp-dh-root');
    const newSendKey = await HKDF(newRootKey, null, 'osprp-send-chain');
    const newRecvKey = await HKDF(newRootKey, null, 'osprp-recv-chain');

    return {
        newRootKey: newRootKey,
        newSendKey: newSendKey,
        newRecvKey: newRecvKey,
        newPubKey: newKp.publicKey,
        newPrivKey: newKp.privateKey,
        sendIndex: 0,
        recvIndex: 0
    };
}

async function dhRatchetReceive(rootKey, myPrivKey, theirNewPubKey) {
    const dhSecret = await deriveSecret(myPrivKey, theirNewPubKey);
    const newRootKey = await HKDF(rootKey, dhSecret, 'osprp-dh-root');
    // v6.4: recv-цепь принимающего обязана ЗЕРКАЛИТЬ send-цепь отправителя (тот же info),
    // иначе первый же поворот DH разойдётся и HMAC не совпадёт
    const newRecvKey = await HKDF(newRootKey, null, 'osprp-send-chain');
    const newSendKey = await HKDF(newRootKey, null, 'osprp-send-chain');

    return {
        newRootKey: newRootKey,
        newSendKey: newSendKey,
        newRecvKey: newRecvKey,
        sendIndex: 0,
        recvIndex: 0
    };
}

// ===== Обработчик сообщений =====

self.onmessage = async function(e) {
    const { id, action, payload } = e.data;

    try {
        let result;

        switch (action) {
            case 'SHA':
                result = await SHA(payload);
                break;
            case 'generateKeyPair':
                result = await generateKeyPair();
                break;
            case 'deriveSecret':
                result = await deriveSecret(payload.myPrivateKey, payload.theirPublicKey);
                break;
            case 'encryptAES':
                result = await encryptAES(payload.text, payload.secret);
                break;
            case 'decryptAES':
                result = await decryptAES(payload.enc, payload.secret);
                break;
            case 'sign':
                result = await sign(payload.data, payload.privateKey);
                break;
            case 'verify':
                result = await verify(payload.data, payload.signature, payload.publicKey);
                break;
            case 'computeHMAC':
                result = await computeHMAC(payload.data, payload.secret);
                break;
            case 'verifyHMAC':
                result = await verifyHMAC(payload.data, payload.sig, payload.secret);
                break;
            case 'x3dhSend':
                result = await x3dhSend(
                    payload.myIdentityPriv,
                    payload.myEphemeralPriv,
                    payload.theirIdentityPub,
                    payload.theirSignedPreKeyPub
                );
                break;
            case 'x3dhReceive':
                result = await x3dhReceive(
                    payload.myIdentityPriv,
                    payload.mySignedPreKeyPriv,
                    payload.theirIdentityPub,
                    payload.theirEphemeralPub
                );
                break;
            case 'packBlob':
                const packResult = await packBlob(payload.jsonString, payload.ch);
                result = {
                    packed: packResult.packed,
                    newSendKey: packResult.newSendKey,
                    newSendIndex: packResult.newSendIndex
                };
                break;
            case 'unpackBlob':
                result = await unpackBlob(payload.blob, payload.ch);
                break;
            case 'advanceRecvRatchet':
                result = await advanceRecvRatchet(payload.ch, payload.targetRi);
                break;
            case 'dhRatchetStep':
                result = await dhRatchetStep(payload.rootKey, payload.myPrivKey, payload.theirPubKey);
                break;
            case 'dhRatchetReceive':
                result = await dhRatchetReceive(payload.rootKey, payload.myPrivKey, payload.theirNewPubKey);
                break;
            default:
                throw new Error('Unknown action: ' + action);
        }

        self.postMessage({ id, result });
    } catch(e) {
        self.postMessage({ id, error: e.message });
    }
};
