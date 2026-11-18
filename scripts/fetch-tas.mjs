/*
 * Builds data.json for the Canterbury Taipans dashboard.
 *
 * Runs on a GitHub Actions runner, not in a browser, so the Clipboard API's missing
 * CORS headers are irrelevant here. The resulting data.json is published by GitHub
 * Pages from the same origin as index.html, which is what lets the page fetch it.
 *
 * Usage:  node scripts/fetch-tas.mjs            (writes ./data.json)
 *         node scripts/fetch-tas.mjs --check    (fetches and reports, writes nothing)
 *
 * Needs Node 18 or newer for global fetch.
 */

import { readFileSync, writeFileSync } from "node:fs";

const API = "https://internal-api.clipboard.app/association-api/";
const cfg = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const TZ = (cfg.timezoneOffsetHours ?? 10) * 3600 * 1000;   // Brisbane is UTC+10, no DST
const checkOnly = process.argv.includes("--check");

const pad = (n) => String(n).padStart(2, "0");

async function getJSON(path, attempt = 1) {
  const res = await fetch(API + path, {
    headers: { accept: "application/json", "user-agent": "canterbury-taipans-dashboard" }
  });
  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
      return getJSON(path, attempt + 1);
    }
    throw new Error(`${res.status} ${res.statusText} for ${path.slice(0, 80)}`);
  }
  return res.json();
}

/* ---------- dictionaries, so the published file stays small ---------- */
const o = {}, C = [], G = [], gI = {}, T = [], tI = {},
      A = [], aI = {}, V = [], vI = {}, D = [], dI = {}, H = [], hI = {},
      F = [], B = [], L = [];

const orgIdx = (x) => { if (!x) return -1; o[x.id] = [x.shortName, x.acronym, x.logoType || "png"]; return x.id; };
const gradeIdx = (g) => { if (!g) return -1; const k = g.name;
  if (!(k in gI)) { gI[k] = G.length; G.push([g.name, g.sortOrder]); } return gI[k]; };
const teamIdx = (org, name) => { if (org == null || org === -1) return -1; const k = org + "|" + name;
  if (!(k in tI)) { tI[k] = T.length; T.push([org, name]); } return tI[k]; };
const addrIdx = (a) => { a = a || ""; if (!(a in aI)) { aI[a] = A.length; A.push(a); } return aI[a]; };
const venueIdx = (loc, sub) => { if (!loc) return -1;
  const n = sub || loc.name, k = n + "|" + (loc.fullAddress || "");
  if (!(k in vI)) { vI[k] = V.length; V.push([n, addrIdx(loc.fullAddress)]); } return vI[k]; };
const dateIdx = (d) => { if (!(d in dI)) { dI[d] = D.length; D.push(d); } return dI[d]; };
const timeIdx = (t) => { if (!(t in hI)) { hI[t] = H.length; H.push(t); } return hI[t]; };

const RESULT_TYPE = { W: 1, L: 2, D: 3, NR: 4 };
const num = (v) => { if (v == null) return -1; const n = Number(v); return Number.isNaN(n) ? -1 : n; };

async function fetchCompetition(season, groupId) {
  const groupParam = encodeURIComponent(JSON.stringify([groupId]));
  let page = 1, lastPage = 1, rows = [];
  while (page <= lastPage) {
    const j = await getJSON(
      `fixtures?competitionGroupIds=${groupParam}&associationSeasonId=${season.associationSeasonId}` +
      `&page=${page}&pageLength=500`
    );
    lastPage = j.pagination?.lastPage ?? 1;
    rows = rows.concat(j.data || []);
    page++;
  }
  if (!rows.length) { console.warn(`  no fixtures for group ${groupId}, skipping`); return null; }

  const name = rows.find((r) => r.competitionName)?.competitionName || "Unknown";
  const scored = rows.find((r) => r.result && r.result.score);
  const scoreLabel = scored ? Object.keys(scored.result.score.for)[0] : "Score";
  const ci = C.length;
  C.push([name, season.label, scoreLabel]);

  for (const f of rows) {
    const forP = f.forParticipant, againstP = f.againstParticipant;
    const utc = new Date(f.startDateTime.replace(" ", "T") + "Z");
    const local = new Date(utc.getTime() + TZ);
    const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
    const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    const round = Number(String(f.roundName || "0").replace(/\D+/g, "")) || 0;
    const forTeam = teamIdx(orgIdx(forP?.organisation),
      forP?.team ? (forP.team.linkedTeamName || forP.team.freeTextTeam || "") : "");

    if (f.bye) { B.push([dateIdx(date), round, gradeIdx(f.associationActivityGrade), ci, forTeam]); continue; }

    const sub = f.location?.subLocations?.[0]?.name || null;
    let scoreFor = -1, scoreAgainst = -1;
    if (f.result && f.result.score) {
      const key = Object.keys(f.result.score.for)[0];
      scoreFor = num(f.result.score.for[key]);
      scoreAgainst = num(f.result.score.against[key]);
    }
    let flags = 0;
    if (f.cancelled) flags |= 2;
    if (!f.hasSetStartTime) flags |= 4;

    F.push([
      dateIdx(date), timeIdx(time), round, gradeIdx(f.associationActivityGrade), ci, forTeam,
      teamIdx(orgIdx(againstP?.organisation),
        againstP?.team ? (againstP.team.linkedTeamName || againstP.team.freeTextTeam || "") : ""),
      scoreFor, scoreAgainst, venueIdx(f.location, sub),
      f.result ? (RESULT_TYPE[f.result.resultType] || 0) : 0, flags
    ]);
  }

  // ladders are a separate endpoint, one call per competition group
  try {
    const lj = await getJSON(
      `ladders?associationSeasonId=${season.associationSeasonId}&competitionGroupId=${groupId}` +
      `&view=table&type=ladders`
    );
    const headers = lj.data?.ladderConfigHeaders || {};
    for (const grade of lj.data?.ladderData || []) {
      for (const pool of grade.competitionPools || []) {
        const cols = (headers[pool.ladderConfigId] || []).filter((h) => !h.hidden).map((h) => h.label);
        L.push([
          ci,
          grade.associationActivityGrade?.name || "Other",
          grade.associationActivityGrade?.sortOrder ?? 999,
          pool.name,
          cols,
          pool.rows.map((r) => [r.rank, teamIdx(r.team.organisationId, r.team.name)]
            .concat(cols.map((h) => (r.columns[h] == null ? null : r.columns[h]))))
        ]);
      }
    }
  } catch (err) {
    console.warn(`  ladders unavailable for ${name}: ${err.message}`);
  }

  const played = rows.filter((r) => r.result).length;
  console.log(`  ${name} (${season.label}): ${rows.length} fixtures, ${played} with a result`);
  return { name, fixtures: rows.length, played };
}

/* ---------- run ---------- */
const summary = [];
for (const season of cfg.seasons) {
  console.log(season.label);
  for (const groupId of season.competitionGroupIds) {
    const r = await fetchCompetition(season, groupId);
    if (r) summary.push(r);
  }
}

if (!F.length) {
  console.error("No fixtures were returned for any competition. Leaving data.json untouched.");
  console.error("The season or competition group IDs in config.json are probably from a finished term.");
  process.exit(1);
}

const out = {
  o, C, G, T, A, V, D, H, F, B, L,
  term: cfg.term || "",
  asOf: new Date().toISOString()
};

const results = F.filter((r) => r[7] >= 0 || [1, 2, 3].includes(r[10])).length;
console.log(`\n${C.length} competitions, ${F.length} fixtures, ${B.length} byes, ` +
            `${results} results, ${L.length} ladders, ${T.length} teams`);

if (checkOnly) { console.log("--check given, not writing data.json"); process.exit(0); }

writeFileSync(new URL("../data.json", import.meta.url), JSON.stringify(out));
console.log("Wrote data.json");
