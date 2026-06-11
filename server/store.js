const crypto = require('crypto');

const ROOM_TTL = 7200;

let kv;
try {
  if (process.env.KV_URL) {
    kv = require('@vercel/kv').kv;
  }
} catch {}

class RoomStore {
  constructor() {
    this._cache = new Map();
  }

  _key(code) {
    return `room:${code}`;
  }

  async save(code, roomData) {
    this._cache.set(code, roomData);
    if (kv) {
      const serialized = this._serialize(roomData);
      await kv.set(this._key(code), serialized, { ex: ROOM_TTL });
    }
  }

  async load(code) {
    const cached = this._cache.get(code);
    if (cached) return cached;
    if (kv) {
      const raw = await kv.get(this._key(code));
      if (raw) {
        const room = this._deserialize(raw);
        this._cache.set(code, room);
        return room;
      }
    }
    return null;
  }

  async delete(code) {
    this._cache.delete(code);
    if (kv) await kv.del(this._key(code));
  }

  async getAll() {
    if (this._cache.size > 0) return this._cache;
    return this._cache;
  }

  _serialize(room) {
    return {
      ...room,
      players: Array.from(room.players.entries()).map(([id, p]) => [id, p]),
    };
  }

  _deserialize(data) {
    return {
      ...data,
      players: new Map(data.players),
    };
  }
}

module.exports = new RoomStore();
