// The room size, fixed in code: every relay (Node, Worker, the room file's own
// server, /bc/) and every page enforce the same number. Nothing reads it from
// configuration, environment or a room file.
//
// Why 50: the cost that grows with the room is the key exchange, not chat.
// Every pair of members runs a hybrid ECDH + ML-KEM-768 exchange once (about
// 1.5 KB of ML-KEM per pair, sent by the lower number), so a full room holds
// 50 × 49 / 2 = 1225 pairs; later rekeys carry only small wraps (about 20
// members per 4 KB announcement). The worst moment is a newcomer that gets a
// low number and must encapsulate for all 49 others: about 25 announcement
// frames at once, which the relay limits in rules.js leave room for. Beyond
// this the right design is a tree of group keys (MLS-style), not a bigger
// number here.
export const MAX_MEMBERS = 50;

// Traffic at this size is kept down by three rules elsewhere: key wraps go only
// to the members they are for (session.js, relays), a page asks again only the
// members whose keys it lacks (Session.helloDue), and in decentralized rooms a
// number settles before keys are made for it (mesh.js SETTLE_MS).
