const crypto = require('crypto');

const ROOM_TTL = 7200;
const SUPABASE_TABLE = process.env.SUPABASE_ROOMS_TABLE || 'rooms';
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL || '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

function normalizeSupabaseUrl(url) {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
}

let kv;
try {
  if (process.env.KV_URL || process.env.KV_REST_API_URL) {
    kv = require('@vercel/kv').kv;
  }
} catch {}

const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

class RoomStore {
  constructor() {
    this._cache = new Map();
  }

  _key(code) {
    return `room:${code}`;
  }

  async save(code, roomData) {
    this._cache.set(code, roomData);
    const serialized = this._serialize(roomData);
    if (hasSupabase) {
      await this._supabaseRequest('', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          code,
          data: serialized,
          updated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + ROOM_TTL * 1000).toISOString(),
        }),
      });
      return;
    }
    if (kv) {
      await kv.set(this._key(code), serialized, { ex: ROOM_TTL });
    }
  }

  async load(code) {
    const cached = this._cache.get(code);
    if (cached) return cached;
    if (hasSupabase) {
      const rows = await this._supabaseRequest(`?code=eq.${encodeURIComponent(code)}&select=data&limit=1`);
      if (rows && rows[0] && rows[0].data) {
        const room = this._deserialize(rows[0].data);
        this._cache.set(code, room);
        return room;
      }
    }
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
    if (hasSupabase) {
      await this._supabaseRequest(`?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE' });
      return;
    }
    if (kv) await kv.del(this._key(code));
  }

  async getAll() {
    if (this._cache.size > 0) return this._cache;
    return this._cache;
  }

  hasDurableStorage() {
    return hasSupabase || Boolean(kv);
  }

  storageProvider() {
    if (hasSupabase) return 'supabase';
    if (kv) return 'vercel-kv';
    return 'memory';
  }

  async _supabaseRequest(query = '', options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}${query}`, {
      method: options.method || 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase room store failed: ${res.status} ${text}`);
    }

    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
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
