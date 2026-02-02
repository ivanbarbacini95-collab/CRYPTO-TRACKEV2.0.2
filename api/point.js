// /api/point.js
const { put, list } = require("@vercel/blob");

const MAX_BODY_BYTES = 180_000;
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
    v: 1,
    t: Date.now(),
    stake: { labels: [], data: [], moves: [], types: [] },
    wd: { labels: [], values: [], times: [] },
  };

  if (p && p.stake) {
    out.stake.labels = clampArray(p.stake.labels, MAX_POINTS).map(String);
    out.stake.data   = clampArray(p.stake.data,   MAX_POINTS).map((x) => Number(x));
    out.stake.moves  = clampArray(p.stake.moves,  MAX_POINTS).map((x) => Number(x));
    out.stake.types  = clampArray(p.stake.types,  MAX_POINTS).map(String);

    const n = out.stake.data.length;
    out.stake.labels = out.stake.labels.slice(-n);
    out.stake.moves  = out.stake.moves.slice(-n);
    out.stake.types  = out.stake.types.slice(-n);
    while (out.stake.moves.length < n) out.stake.moves.unshift(0);
    while (out.stake.types.length < n) out.stake.types.unshift("Stake update");
  }

  if (p && p.wd) {
    out.wd.labels = clampArray(p.wd.labels, MAX_POINTS).map(String);
    out.wd.values = clampArray(p.wd.values, MAX_POINTS).map((x) => Number(x));
    out.wd.times  = clampArray(p.wd.times,  MAX_POINTS).map((x) => Number(x));

    const n = out.wd.values.length;
    out.wd.labels = out.wd.labels.slice(-n);
    out.wd.times  = out.wd.times.slice(-n);
    while (out.wd.times.length < n) out.wd.times.unshift(0);
  }

  out.t = Date.now();
  return out;
}

function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    let raw = "";
    let ended = false;

    const done = (val) => {
      if (ended) return;
      ended = true;
      resolve(val);
    };

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        // interrompi subito e chiudi in modo "pulito"
        raw = "";
        try { req.destroy(); } catch {}
        done(null);
      }
    });

    req.on("end", () => done(raw || null));
    req.on("close", () => done(raw || null));
    req.on("error", () => done(null));
  });
}

async function readLatestDataJson(prefix, pathname) {
  // prendo un po' di risultati e scelgo il più recente per pathname
  const r = await list({ prefix, limit: 50 });
  const blobs = Array.isArray(r && r.blobs) ? r.blobs : [];
  const same = blobs.filter((b) => b && b.pathname === pathname && b.url);

  if (!same.length) return null;

  // scegli il più recente (uploadedAt)
  same.sort((a, b) => {
    const ta = new Date(a.uploadedAt || 0).getTime();
    const tb = new Date(b.uploadedAt || 0).getTime();
    return tb - ta;
  });

  const url = same[0].url;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) return null;
  return await resp.text();
}

module.exports = async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const address = normalizeAddr(req.query && req.query.address);
    if (!address) return json(res, 400, { ok: false, error: "Invalid address" });

    const prefix = `inj-points/${address}/`;
    const pathname = `${prefix}data.json`;

    if (req.method === "GET") {
      const txt = await readLatestDataJson(prefix, pathname);
      if (!txt) return json(res, 200, { ok: true, data: null });

      let data = null;
      try { data = JSON.parse(txt); } catch { data = null; }
      return json(res, 200, { ok: true, data });
    }

    if (req.method === "POST") {
      const raw = await readBody(req, MAX_BODY_BYTES);
      if (!raw) return json(res, 400, { ok: false, error: "Empty/Too large body" });

      let parsed = null;
      try { parsed = JSON.parse(raw); }
      catch { return json(res, 400, { ok: false, error: "Invalid JSON" }); }

      const clean = sanitizePayload(parsed);

      const blob = await put(pathname, JSON.stringify(clean), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
      });

      return json(res, 200, { ok: true, url: (blob && blob.url) || null, t: clean.t });
    }

    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: "Server error" });
  }
};
