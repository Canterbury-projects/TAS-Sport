# Canterbury Taipans sport dashboard

A foyer-screen dashboard of TAS results, built from the public fixtures feed behind
[fixtures.clipboard.app](https://fixtures.clipboard.app/tas/fixtures). Headlines from the latest
round, ladders and a Canterbury win/draw/loss snapshot on the right, results ticker along the bottom,
and a search over every fixture.

## Why it is built this way

The obvious design would be a page that calls the fixtures API directly. That does not work. The API
sends no `Access-Control-Allow-Origin` header, so a browser blocks the response for any page not
served from `fixtures.clipboard.app`. Hosting the page elsewhere does not change that, because CORS
is decided by the API's response, not by where the page lives.

So the fetching happens server side instead. A GitHub Actions runner calls the API (no browser, no
CORS), writes `data.json` into this repository, and GitHub Pages serves that file from the **same
origin** as `index.html`. The page then fetches it with no CORS problem at all.

```
GitHub Actions (hourly)  ->  Clipboard API  ->  data.json committed here
                                                      |
                              GitHub Pages serves index.html + data.json
                                                      |
                                       browser fetches data.json, same origin
```

`index.html` also carries a compressed snapshot of the data inside it. If `data.json` cannot be
fetched (opened straight from disk, offline, or before the first Action run) the page falls back to
that snapshot and marks the timestamp "built-in snapshot" so nobody mistakes old data for live.

## Setting it up

1. Create a new repository on GitHub and upload these files, keeping the folder structure.
   A public repository is simplest. GitHub Pages on a private repository needs a paid plan, and
   Actions minutes are unlimited only on public repositories.
2. **Settings > Pages**: set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
   After a minute the dashboard is at `https://<your-username>.github.io/<repo-name>/`.
3. **Settings > Actions > General**: under "Workflow permissions" choose
   **Read and write permissions**, then Save. Without this the workflow cannot commit `data.json`.
4. **Actions** tab: open "Refresh TAS data" and press **Run workflow** to test it straight away
   rather than waiting for the hour.

After that it looks after itself. The workflow runs hourly, and only commits when the data has
actually changed, so the history stays readable.

## Each new term

Only `config.json` needs changing. Edit it on GitHub, commit, and the workflow runs immediately
because a push to `config.json` is one of its triggers.

```json
{
  "term": "Term 1, 2027",
  "seasons": [
    { "label": "2027 - Trimester 1",
      "associationSeasonId": "...",
      "competitionGroupIds": ["...", "..."] }
  ]
}
```

### Finding the IDs

The season and competition lists are not on a public endpoint, so read them from the site's own
filter panel:

1. Open `https://fixtures.clipboard.app/tas/fixtures` and press F12 for developer tools.
2. Go to the **Network** tab and tick "Preserve log".
3. Click **Filter**, choose the season you want from the Season dropdown, and apply it.
4. Find the request to `internal-api.clipboard.app/association-api/fixtures?...` and read the query
   string. `associationSeasonId` is the season. `competitionGroupIds` is a JSON array holding one id
   per sport.
5. Paste those into `config.json`. Junior TAS is a separate season with its own id and its own set
   of competition groups, so it gets its own entry in the `seasons` array.

Run `node scripts/fetch-tas.mjs --check` locally first if you want to confirm the ids return
fixtures before committing. It prints what it found and writes nothing.

## Using it on the foyer screen

Open the Pages URL in Chrome or Edge and press **F** for full screen. **Esc** or **F** exits.
Other keys: **/** focuses the search, **Esc** clears it.

The Sport and School dropdowns change what is shown, and both remember their setting in that
browser. With "All sports" selected the main panel works through one sport at a time in
alphabetical order, two pages each, so the headline and the cards beneath it always match.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The whole dashboard. Styles, logic, school logo sprite and fallback snapshot are all inline. |
| `data.json` | Fixtures, results and ladders. Rewritten by the Action, not by hand. |
| `config.json` | Which season and competitions to pull. The only file you edit each term. |
| `scripts/fetch-tas.mjs` | Calls the API and builds `data.json`. Node 18+, no dependencies. |
| `.github/workflows/refresh.yml` | The hourly schedule and the commit step. |

## Things to keep an eye on

- GitHub disables scheduled workflows in a repository that has had no activity for 60 days. The
  Action's own commits normally count, but if results stop updating over a long break, check the
  Actions tab for a "this workflow was disabled" notice and re-enable it.
- Scheduled runs are best effort and can be a few minutes late when GitHub is busy. Fine for sport
  results, not for anything time critical.
- On a public repository the data and the page are visible to anyone with the link. The data is
  already public on the TAS site, but an automated hourly pull republished under the school's name
  is worth a quick word with whoever owns the TAS relationship.
- If a new school joins the association its logo will not be in the sprite sheet and it will fall
  back to a coloured chip with its initials. Everything else keeps working.

## Data shape

`data.json` is index-referenced to keep it small. Arrays are looked up by position.

```
o     { orgId: [shortName, acronym, logoType] }
C     [[competitionName, seasonLabel, scoreFieldLabel]]
G     [[gradeName, sortOrder]]
T     [[orgId, teamName]]
A     [addressString]
V     [[venueName, addressIndex]]
D     [date "YYYY-MM-DD"]        Brisbane local
H     [time "HH:MM"]             Brisbane local
F     [[dateIdx, timeIdx, round, gradeIdx, compIdx, forTeamIdx, againstTeamIdx,
       forScore, againstScore, venueIdx, resultType, flags]]
      scores are -1 when unknown. resultType 0 none, 1 win, 2 loss, 3 draw, 4 no result,
      relative to the "for" team. flags bit 2 cancelled, bit 4 start time not set.
B     [[dateIdx, round, gradeIdx, compIdx, teamIdx]]     byes, kept separate to save space
L     [[compIdx, gradeName, sortOrder, poolName, [columnHeaders], [[rank, teamIdx, ...values]]]]
term, asOf
```

Junior TAS records a win or loss without a score, which is why `resultType` is carried alongside the
numbers. Those headlines read "X beat Y" with no scoreline.
