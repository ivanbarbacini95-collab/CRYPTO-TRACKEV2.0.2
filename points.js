// /api/points.js
import { put, list, del } from "@vercel/blob";

const MAX_BODY_BYTES = 180_000; // limite anti-abuso (JSON piccolo)
const MAX_POINTS = 2400;        // limite punti per serie

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function bad(res, msg) {
  return json(res, 400, { ok: false, error: msg });
}

function normalizeAddr(a) {
  const s = String(a || "").trim();
  // inj... fino a ~80 char
  if (!/^inj[a-z0-9]{20,80}$/i.test(s)) return "";
  return s;
}

function clampArray(arr, max) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}

function sanitizePayload(p) {
  const out = {
    v: 1,
    t: Date.now(),
    stake: { labels: [], data: [], moves: [], types: [] },
    wd: { labels: [], values: [], times: [] },
  };

  // stake
  if (p?.stake) {
    out.stake.labels = clampArray(p.stake.labels, MAX_POINTS).map(String);
    out.stake.data   = clampArray(p.stake.data,   MAX_POINTS).map(Number);
    out.stake.moves  = clampArray(p.stake.moves,  MAX_POINTS).map(Number);
    out.stake.types  = clampArray(p.stake.types,  MAX_POINTS).map(String);

    // allinea lunghezze
    const n = out.stake.data.length;
    out.stake.labels = out.stake.labels.slice(-n);
    out.stake.moves  = out.stake.moves.slice(-n);
    out.stake.types  = out.stake.types.slice(-n);
    while (out.stake.moves.length < n) out.stake.moves.unshift(0);
    while (out.stake.types.length < n) out.stake.types.unshift("Stake update");
  }

  // wd
  if (p?.wd) {
    out.wd.labels = clampArray(p.wd.labels, MAX_POINTS).map(String);
    out.wd.values = clampArray(p.wd.values, MAX_POINTS).map(Number);
    out.wd.times  = clampArray(p.wd.times,  MAX_POINTS).map(Number);

    const n = out.wd.values.length;
    out.wd.labels = out.wd.labels.slice(-n);
    out.wd.times  = out.wd.times.slice(-n);
    while (out.wd.times.length < n) out.wd.times.unshift(0);
  }

  // t (server overwrite anyway)
  out.t = Date.now();
  return out;
}

async function readLatestBlobText(prefix) {
  const r = await list({ prefix, limit: 1 });
  const item = r?.blobs?.[0];
  if (!item?.url) return null;

  const resp = await fetch(item.url, { cache: "no-store" });
  if (!resp.ok) return null;
  return await resp.text();
}

export default async function handler(req, res) {
  try {
    // basic CORS same-origin friendly
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const address = normalizeAddr(req.query?.address);
    if (!address) return bad(res, "Invalid address");

    const prefix = `inj-points/${address}/`;
    const filename = `data.json`;
    const pathname = `${prefix}${filename}`;

    if (req.method === "GET") {
      const txt = await readLatestBlobText(prefix);
      if (!txt) return json(res, 200, { ok: true, data: null });
      let data = null;
      try { data = JSON.parse(txt); } catch { data = null; }
      return json(res, 200, { ok: true, data });
    }

    if (req.method === "DELETE") {
      // cancella tutti i blob sotto prefix (opzionale)
      const r = await list({ prefix, limit: 1000 });
      const blobs = r?.blobs || [];
      await Promise.allSettled(blobs.map(b => del(b.url)));
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST") {
      // read body safely
      let raw = "";
      await new Promise((resolve) => {
        req.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > MAX_BODY_BYTES) {
            raw = "";
            req.destroy();
          }
        });
        req.on("end", resolve);
      });

      if (!raw) return bad(res, "Empty/Too large body");

      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { return bad(res, "Invalid JSON"); }

      const clean = sanitizePayload(parsed);

      // store in blob (overwrite path)
      const blob = await put(pathname, JSON.stringify(clean), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false, // important: fixed path
      });

      return json(res, 200, { ok: true, url: blob?.url || null, t: clean.t });
    }

    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "Server error" });
  }
}
