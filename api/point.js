// /api/point.js
import { put, list } from "@vercel/blob";

const MAX_BODY_BYTES = 220_000;
const MAX_POINTS = 2400;

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function normalizeAddr(a) {
  const s = String(a || "").trim();
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
    v: 2,
    t: Date.now(),
    stake: { labels: [], data: [], moves: [], types: [] },
    wd: { labels: [], values: [], times: [] },
    nw: { times: [], usd: [], inj: [] }, // ✅ net worth series
  };

  if (p?.stake) {
    out.stake.labels = clampArray(p.stake.labels, MAX_POINTS).map(String);
    out.stake.data   = clampArray(p.stake.data,   MAX_POINTS).map(Number);
    out.stake.moves  = clampArray(p.stake.moves,  MAX_POINTS).map(Number);
    out.stake.types  = clampArray(p.stake.types,  MAX_POINTS).map(String);

    const n = out.stake.data.length;
    out.stake.labels = out.stake.labels.slice(-n);
    out.stake.moves  = out.stake.moves.slice(-n);
    out.stake.types  = out.stake.types.slice(-n);
    while (out.stake.moves.length < n) out.stake.moves.unshift(0);
    while (out.stake.types.length < n) out.stake.types.unshift("Stake update");
  }

  if (p?.wd) {
    out.wd.labels = clampArray(p.wd.labels, MAX_POINTS).map(String);
    out.wd.values = clampArray(p.wd.values, MAX_POINTS).map(Number);
    out.wd.times  = clampArray(p.wd.times,  MAX_POINTS).map(Number);

    const n = out.wd.values.length;
    out.wd.labels = out.wd.labels.slice(-n);
    out.wd.times  = out.wd.times.slice(-n);
    while (out.wd.times.length < n) out.wd.times.unshift(0);
  }

  if (p?.nw) {
    out.nw.times = clampArray(p.nw.times, MAX_POINTS).map(Number);
    out.nw.usd   = clampArray(p.nw.usd,   MAX_POINTS).map(Number);
    out.nw.inj   = clampArray(p.nw.inj,   MAX_POINTS).map(Number);

    const n = out.nw.times.length;
    out.nw.usd = out.nw.usd.slice(-n);
    out.nw.inj = out.nw.inj.slice(-n);
    while (out.nw.usd.length < n) out.nw.usd.unshift(0);
    while (out.nw.inj.length < n) out.nw.inj.unshift(0);
  }

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
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const address = normalizeAddr(req.query?.address);
    if (!address) return json(res, 400, { ok: false, error: "Invalid address" });

    const prefix = `inj-points/${address}/`;
    const pathname = `${prefix}data.json`;

    if (req.method === "GET") {
      const txt = await readLatestBlobText(prefix);
      if (!txt) return json(res, 200, { ok: true, data: null });
      let data = null;
      try { data = JSON.parse(txt); } catch { data = null; }
      return json(res, 200, { ok: true, data });
    }

    if (req.method === "POST") {
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

      if (!raw) return json(res, 400, { ok: false, error: "Empty/Too large body" });

      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { return json(res, 400, { ok: false, error: "Invalid JSON" }); }

      const clean = sanitizePayload(parsed);

      const blob = await put(pathname, JSON.stringify(clean), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
      });

      return json(res, 200, { ok: true, url: blob?.url || null, t: clean.t });
    }

    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "Server error" });
  }
}
