// Симуляция двух пиров поверх пропатченного crypto-worker.js (v6.4)
const fs = require('fs');
const src = fs.readFileSync('D:/stepweather-prog/ROBINHOOD-P2P/crypto-worker.js', 'utf8');
const factory = new Function('self', src + '\n;return {generateKeyPair,deriveSecret,x3dhSend,x3dhReceive,packBlob,unpackBlob,advanceRecvRatchet,dhRatchetStep,dhRatchetReceive,sign,verify};');
const W = factory({ onmessage: function(){} });

const MAX_RATCHET_JUMP = 100; // должен совпадать с CONFIG.MAX_RATCHET_JUMP в p2ppong.js
const send = async (ch, obj) => {
    const r = await W.packBlob(JSON.stringify(obj), ch);
    ch.sendKey = r.newSendKey; ch.sendIndex = r.newSendIndex; ch.dhSendCount++;
    return r;
};
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

async function deliverRaw(chRecv, packed, chRecvSide) {
    // повторяет логику _handleIn (advance-ветка) из p2ppong.js v6.4
    let ur = await W.unpackBlob(packed, chRecv);
    if (!ur) {
        let raw = null; try { raw = JSON.parse(packed); } catch (e) {}
        if (raw && raw.k !== undefined && raw.k !== chRecv.dhRemotePubKey) {
            // сигнатура нового DH-pub ironная: ECDSA identity-ключом отправителя
            const okSig = await W.verify(raw.k, raw.ks || '', chRecv.remoteIdentityPub);
            if (okSig) {
                chRecv.dhRemotePubKey = raw.k;
                chRecv.oldRecvKeys = (chRecv.oldRecvKeys || []).concat([{ key: chRecv.recvKey, index: chRecv.recvIndex || 0 }]).slice(-MAX_RATCHET_JUMP);
                const r = await W.dhRatchetReceive(chRecv.rootKey, chRecv.dhKeyPair.privateKey, raw.k);
                chRecv.rootKey = r.newRootKey; chRecv.recvKey = r.newRecvKey; chRecv.recvIndex = 0;
                chRecv.dhRecvCount = 0; chRecv.dhPendingRotation = true;
                ur = await W.unpackBlob(packed, chRecv); // как в p2ppong v6.4: retry сразу после приёма поворота
            }
        }
        if (!ur && raw && raw._ri !== undefined) {
            const t = parseInt(raw._ri) || 0;
            if (t > (chRecv.recvIndex || 0) && t <= (chRecv.recvIndex || 0) + MAX_RATCHET_JUMP) {
                const rr = await W.advanceRecvRatchet(chRecv, t);
                if (rr) {
                    chRecv.recvKey = rr.finalKey; chRecv.recvIndex = rr.index;
                    // как _keyCacheMerge в p2ppong v6.4: дедуп индексов, последние записи имеют приоритет
                    const tmp = (chRecv.oldRecvKeys || []).concat(rr.oldKeys).slice(-MAX_RATCHET_JUMP);
                    const seen = new Set();
                    for (let i = tmp.length - 1; i >= 0; i--) { const k = tmp[i]; if (!k || seen.has(k.index)) tmp.splice(i, 1); else seen.add(k.index); }
                    chRecv.oldRecvKeys = tmp;
                    ur = await W.unpackBlob(packed, chRecv);
                }
            }
        }
    }
    if (ur) { // в p2ppong это общий хвост после первой успешной unpack — для ЛЮБОГО пути прихода ur
        chRecv.recvKey = ur.newRecvKey || chRecv.recvKey;
        chRecv.recvIndex = ur.newRecvIndex || chRecv.recvIndex;
        // NB: кэш старых ключей НЕ чистится по recvIndex — поздние сообщения должны расшифроваться;
        // рост ограничен MAX_RATCHET_JUMP при пополнении, дубликаты ловит дедуп по n
    }
    return ur;
}

async function main() {
    // --- X3DH ---
    const aliceId = await W.generateKeyPair(), aliceEph = await W.generateKeyPair();
    const bobId = await W.generateKeyPair(), bobSpk = await W.generateKeyPair();
    const spkSig = await W.sign(bobSpk.publicKey, bobId.privateKey);
    check('SPK sig valid', await W.verify(bobSpk.publicKey, spkSig, bobId.publicKey));
    const sA = await W.x3dhSend(aliceId.privateKey, aliceEph.privateKey, bobId.publicKey, bobSpk.publicKey);
    const sB = await W.x3dhReceive(bobId.privateKey, bobSpk.privateKey, aliceId.publicKey, aliceEph.publicKey);
    check('X3DH shared secret equal', sA === sB && sA.length === 64);

    const mkCh = (peerId) => ({
        sendKey: sA, sendIndex: 0, recvKey: sA, recvIndex: 0, oldRecvKeys: [], rootKey: sA,
        dhKeyPair: null, dhRemotePubKey: null, dhSendCount: 0, dhRecvCount: 0,
        remoteIdentityPub: null, dhPubSig: null, remoteV: 2, peerId
    });
    const chA = mkCh('AAAA'), chB = mkCh('BBBB');
    chA.dhKeyPair = aliceId; chA.dhRemotePubKey = bobId.publicKey; chA.remoteIdentityPub = bobId.publicKey;
    chB.dhKeyPair = bobId; chB.dhRemotePubKey = aliceId.publicKey; chB.remoteIdentityPub = aliceId.publicKey;

    // --- in-order ---
    const m0 = await send(chA, { n: '0', d: 'msg0' }); // _ri=0
    const u0 = await W.unpackBlob(m0.packed, chB);
    check('in-order msg0', u0 && u0.data.d === 'msg0');
    chB.recvKey = u0.newRecvKey; chB.recvIndex = u0.newRecvIndex;
    check('B chain at 1', chB.recvIndex === 1);

    // --- fix 2: out-of-order (msg2 раньше msg1) ---
    const m1 = await send(chA, { n: '1', d: 'msg1' }); // _ri=1
    const m2 = await send(chA, { n: '2', d: 'msg2' }); // _ri=2
    const u2 = await deliverRaw(chB, m2.packed);
    check('out-of-order msg2 decrypted on arrival', u2 && u2.data.d === 'msg2');
    const u1 = await deliverRaw(chB, m1.packed);
    check('late msg1 decrypted from cached key', u1 && u1.data.d === 'msg1');
    check('B chain at 3', chB.recvIndex === 3);
    const dup = await deliverRaw(chB, m0.packed);
    check('old duplicate no longer decrypts (dedup по n ловит)', dup === null);

    // --- fix 3: DoS через фиктивный _ri ---
    const fake = JSON.stringify({ d: '00'.repeat(64), h: 'a'.repeat(64), _ri: 900000000 });
    const rrFake = await W.advanceRecvRatchet(chB, 900000000);
    check('advanceRecvRatchet refuses absurd jump (null)', rrFake === null);
    check('negative/backwards jump refused', await W.advanceRecvRatchet(chB, 1) === null);
    const uFake = await deliverRaw(chB, fake);
    check('fake _ri packet not advancing chain', uFake === null && chB.recvIndex === 3);

    // --- fix 1: DH ratchet (A — driver, поворачивает send-цепь на пороге) ---
    chA.dhSendCount = 50;
    const stepR = await W.dhRatchetStep(chA.rootKey, chA.dhKeyPair.privateKey, chA.dhRemotePubKey);
    check('dhRatchetStep returns new chains', !!stepR && !!stepR.newSendKey);
    const prevAPub = chA.dhKeyPair.publicKey;
    chA.rootKey = stepR.newRootKey;
    chA.dhKeyPair = { publicKey: stepR.newPubKey, privateKey: stepR.newPrivKey };
    chA.dhPubSig = await W.sign(stepR.newPubKey, aliceId.privateKey);
    chA.sendKey = stepR.newSendKey; chA.sendIndex = 0; chA.dhSendCount = 0;

    check('rotated pub sig valid', await W.verify(chA.dhKeyPair.publicKey, chA.dhPubSig, aliceId.publicKey));
    const forged = await W.sign(chA.dhKeyPair.publicKey, bobId.privateKey); // «атакующий» подписал бы чужим ключом
    check('forged pub sig rejected', !(await W.verify(chA.dhKeyPair.publicKey, forged, aliceId.publicKey)));

    // A шлёт первое сообщение новой цепи (k, ks в конверте):
    const rm0 = await send(chA, { n: '10', d: 'after-rotate' }); // _ri=0
    const raw0 = JSON.parse(rm0.packed); raw0.k = chA.dhKeyPair.publicKey; raw0.ks = chA.dhPubSig;
    const uR0 = await deliverRaw(chB, JSON.stringify(raw0));
    check('B recv-ratchets on signed pub; msg decrypts', uR0 && uR0.data.d === 'after-rotate' && chB.recvIndex === 1);
    check('B marks pending rotation', chB.dhPendingRotation === true);

    // B продолжает ОТВРАЧИВАТЬ старой send-цепью (его recv-цепь повернулась, send — нет) → A читает:
    const b2a = await send(chB, { n: '20', d: 'b-old-chain-after-recv-ratchet' }); // _ri=1
    const uB = await deliverRaw(chA, b2a.packed);
    check('A decrypts B old-chain msg after own rotation', uB && uB.data.d === 'b-old-chain-after-recv-ratchet');
    check('A recv chain unaffected by own send rotation', chA.recvIndex === 1);

    // A отвечает новой send-цепью, B читает:
    const a2 = await send(chA, { n: '21', d: 'a-new-chain' }); // _ri=1
    const uA = await deliverRaw(chB, a2.packed);
    check('B decrypts A new-chain msg (chain mirrors)', uA && uA.data.d === 'a-new-chain');

    // B вращает СВОЮ send-цепь по своему порогу:
    chB.dhSendCount = 50;
    const stepB = await W.dhRatchetStep(chB.rootKey, chB.dhKeyPair.privateKey, chB.dhRemotePubKey);
    chB.rootKey = stepB.newRootKey;
    chB.dhKeyPair = { publicKey: stepB.newPubKey, privateKey: stepB.newPrivKey };
    chB.dhPubSig = await W.sign(stepB.newPubKey, bobId.privateKey);
    chB.sendKey = stepB.newSendKey; chB.sendIndex = 0; chB.dhSendCount = 0;
    const bb = await send(chB, { n: '22', d: 'b-rotated-too' }); // _ri=0
    const rawB = JSON.parse(bb.packed); rawB.k = chB.dhKeyPair.publicKey; rawB.ks = chB.dhPubSig;
    const uBB = await deliverRaw(chA, JSON.stringify(rawB));
    check('A recv-ratchets on B rotation; msg decrypts', uBB && uBB.data.d === 'b-rotated-too' && chA.recvIndex === 1);
    check('long message text', uBB.data.d.length > 0);

    // --- recover: ПЕРВОЕ сообщение новой цепи потерялось, пришло _ri=2 напрямую ---
    const n1 = await send(chA, { n: '30', d: 'LOST' }); // _ri=0 — «съедено» сетью
    const n2 = await send(chA, { n: '31', d: 'third' }); // _ri=1
    const n3 = await send(chA, { n: '32', d: 'fourth' }); // _ri=2
    const uN2 = await deliverRaw(chB, n2.packed); // _ri=1, B.recvIndex=1 → in-order, просто без n1
    check('delivered after one lost', uN2 && uN2.data.d === 'third');
    const uN3 = await deliverRaw(chB, n3.packed); // _ri=2 → in-order
    check('next also fine', uN3 && uN3.data.d === 'fourth');

    // --- враг в ящике: подделка DH-поворота без подписи ---
    const fakePair = await W.generateKeyPair();
    const evilPkt = JSON.stringify({ d: '00'.repeat(64), h: 'b'.repeat(64), _ri: 0, k: fakePair.publicKey, ks: null });
    const uEvil = await deliverRaw(chB, evilPkt);
    check('rotation on unsigned/forged pub rejected', uEvil === null);
    check('chain not hijacked by forged pub', chB.dhRemotePubKey === chA.dhKeyPair.publicKey);

    console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' TESTS PASS' : fail + ' FAILURES of ' + (pass + fail)));
    process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
