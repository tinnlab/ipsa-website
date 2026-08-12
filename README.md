# IPSA — Intelligent Platform for Systems-level Analysis

IPSA is a web application for genomic data analysis and visualisation: differential expression,
pathway/gene-set analysis by several methods (ORA, GSA, GSEA, FGSEA, KS, Wilcoxon, PADOG, PGSEA),
meta-analysis and consensus analysis, an extensive visualisation suite (volcano plots, Circos
charts, heatmaps, KEGG pathway maps, pathway networks, Venn diagrams, forest and funnel plots),
GEO import by GSE accession, and optional LLM-assisted interpretation of results. It is developed
by the Tin Nguyen Lab at Wayne State University and is the successor to CPA (Consensus Pathway
Analysis).

Licensed under the [MIT License](LICENSE). Some bundled third-party components carry their own
terms — see [NOTICE](NOTICE).

---

## Contents

- [Quickstart (Docker)](#quickstart-docker)
- [First administrator login](#first-administrator-login)
- [Reference databases](#reference-databases)
- [Optional: local LLM backend](#optional-local-llm-backend)
- [Configuration reference](#configuration-reference)
- [Development](#development)
- [Licence](#licence)

---

## Quickstart (Docker)

### Prerequisites

- Docker Engine 24+ with the Compose v2 plugin (`docker compose version`).
- **~15 GB free disk** and **~8 GB RAM**. The image installs a full conda + R + Meteor toolchain
  from source, so the first build takes roughly **30–45 minutes**. Later builds are cached.
- No GPU is required. The optional local-LLM service is the only part that needs one.

### 1. Clone

```bash
git clone https://github.com/tinnlab/ipsa-website.git
cd ipsa-website
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Every value in `.env.example` already has a working default, so you can leave it untouched for a
local run. Change `APP_PORT` if 18000 is taken, and set `ROOT_URL` to the externally reachable URL
if you are not running on localhost.

### 3. Create the data directories

They must be owned by UID/GID 1000, which is the user the container runs as.

```bash
mkdir -p data/db data/app-data data/tutorial
sudo chown -R 1000:1000 data
```

### 4. Build the image

```bash
docker compose -f docker-compose.prod.yml build
```

### 5. About `data/app-data` — nothing to seed

Nothing to do here, but it is worth knowing how this directory behaves.

`data/app-data` is bind-mounted over `/home/meteorer/app/.data` inside the container and holds
uploaded expression files, R scratch space and reference data. The image ships this directory
**empty**, and the app re-creates any missing subdirectories at startup, so an empty mount is
self-healing.

> ⚠️ The mount *shadows* whatever the image has at that path. So any file you need in `.data` must
> be placed in `data/app-data` **on the host** — copying it into a running container writes into the
> mount, and copying it out of one gets you the mount, not the image. The only file this affects in
> practice is the MitoCarta reference data, covered under
> [Reference databases](#reference-databases).

### 6. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

This starts `app` and `mongo`. The GPU-only LLM service is behind a profile and is *not* started.

### 7. Health check

```bash
curl -fsS --retry 30 --retry-delay 5 --retry-connrefused --retry-all-errors \
  http://localhost:18000/ > /dev/null && echo "IPSA is up"
```

The first boot takes a minute or so while Mongo passes its healthcheck and the app builds indexes.

### 8. Open the UI

<http://localhost:18000>

You now have a running IPSA against an empty database. It has no pathway data yet — see
[Reference databases](#reference-databases).

### Stopping and logs

```bash
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml down
```

---

## First administrator login

Every reference-data import is gated by an administrator check, so this comes first.

On the **first boot against an empty database** the app creates one administrator account. If you
left `ADMIN_PASSWORD` empty in `.env`, a random password was generated and printed once to the app
log:

```bash
docker compose -f docker-compose.prod.yml logs app | grep '\[accounts\]'
```

```
[accounts] Created administrator "admin" with a generated password: <password>
[accounts] Store it now - it is not shown again. Set ADMIN_PASSWORD to choose your own.
```

Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` before the first start if you would rather choose
them yourself. Note that the account is created **only when it does not already exist** — changing
`ADMIN_PASSWORD` later does not update an existing account.

Log in at **<http://localhost:18000/admin/login>**.

### How admin rights are stored

Administrator status is a string in an array on the user document — `profile.roles` must contain
`"admin"` (`server/api/helper/Permission.js`). To promote an existing user, edit the `meteor`
database directly:

```bash
docker compose -f docker-compose.prod.yml exec mongo \
  mongosh meteor --quiet --eval \
  'db.users.updateOne({username: "someuser"}, {$set: {"profile.roles": ["admin", "user"]}})'
```

This grants admin rights to an account you can already log into — it does not recover a lost
password. If you lose the administrator password, set a new one with `Accounts.setPasswordAsync`
from a Meteor shell, or delete the user document and restart the app so the account is seeded again.

Self-service signup is disabled; ordinary visitors are issued guest accounts automatically.

### Admin pages

| Page | Path |
|---|---|
| Login | `/admin/login` |
| Organisms | `/admin/organism` |
| Gene info & ID mapping | `/admin/gene-info` |
| ID types (read-only) | `/admin/id-type` |
| Harmonizome | `/admin/harmonizome` |
| Zoho email (optional) | `/admin/zoho` |

> The admin menu also shows **Gene Set** and one entry per pathway database. Those routes do not
> exist in this release and render a blank page — see
> [Reference databases](#reference-databases) for the working import path.

---

## Reference databases

**There are no ready-made CSV dumps to download for the pathway databases.** IPSA fetches them live
from their upstream providers at runtime, through admin-only import methods. You choose which
organisms and which databases you need, and import those.

Budget for this. A minimal useful setup (NCBI gene info + human KEGG and Reactome) takes roughly an
hour, most of it unattended download and insert time. These are one-time operations — the data
persists in `data/db`.

### Step 0 — the six pathway databases already exist

KEGG, GO (biological process, cellular component, molecular function), Reactome and MitoCarta rows
are created automatically on first boot. Nothing to do.

To see them and get the `_id` values you will need below, open the browser console on any IPSA page
and run:

```js
Meteor.call('database.getAll', (e, r) => console.log(r))
```

The `_id` values are generated per deployment, so they will not match anyone else's.

### Step 1 — NCBI gene info (required, do this first)

Go to **`/admin/gene-info`** and click **Update Gene Info**.

Downloads `https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene_info.gz` (~500 MB compressed) and populates
the gene-symbol → Entrez-ID mapping. **Tens of minutes.**

Everything else depends on this: pathway analysis, the MitoCarta import and the Harmonizome import
all resolve gene symbols through it. Do not skip it.

### Step 2 — organisms

Go to **`/admin/organism`** and click **Add All**. This calls
`https://reactome.org/ContentService/data/species/all` and adds roughly a hundred species. It is
fast.

> ⚠️ Prefer the bulk import over the "add organism" form. The form's Tax Id field is numeric, so a
> hand-added organism is stored with a **number** `taxId`, whereas the bulk importer stores a
> string. Gene-ID-type detection compares against string `taxId`s, so for a hand-added organism it
> finds nothing and the analysis wizard will not advance past the input step. If you do add one by
> hand, make sure `taxId` ends up stored as a string.

### Step 3 — gene sets, per organism × database

The gene-set import has **no admin page** in this release. Run it from the browser console while
logged in as an administrator:

```js
// ids from `organism.getAll` and `database.getAll`
Meteor.call('geneSet.add', {organismId: '<organismId>', databaseId: '<databaseId>'}, console.log)
```

To list organism ids:

```js
Meteor.call('organism.getAll', (e, r) => console.log(r))
```

There is also `geneSet.addAll({organismIds: [...], databaseId})` for several organisms at once.
Only one gene-set import runs at a time per server process.

What each database does, and what it costs:

| Database | Source | Notes |
|---|---|---|
| **KEGG** | `rest.kegg.jp/link/{code}/pathway`, `rest.kegg.jp/list/pathway/{code}`, `rest.kegg.jp/conv/ncbi-geneid/…` | ~350 pathways for human (`hsa`). Minutes; throttled by KEGG's rate limits. **Human is the well-tested path** — see the warning below. |
| **Reactome** | `https://reactome.org/download/current/NCBI2Reactome_All_Levels.txt` | ~90 MB, downloaded once and cached in `.data/tmp` **indefinitely** — delete the file by hand to refresh. ~1–2 minutes per organism after that. |
| **MitoCarta** | *not downloaded* — see below | Human (`hsa`) and mouse (`mmu`) only. |
| **GO** | `http://purl.obolibrary.org/obo/go.obo` | **Does not work out of the box** — see below. |

#### KEGG for non-human organisms

For human, KEGG's gene ids are already Entrez ids, so no conversion runs and the import is sound.
For organisms where conversion *is* needed, the batched ID-conversion code has known defects (it
reuses one organism prefix for every batch after the first, and writes converted batches back at the
wrong offsets), which can produce incorrect gene lists. Check the result before relying on a
non-human KEGG import.

#### MitoCarta

MitoCarta is third-party data with its own terms and is **not redistributed in this repository**.
Download `Human.MitoCarta3.0.csv` and/or `Mouse.MitoCarta3.0.csv` from the Broad Institute
(<https://www.broadinstitute.org/mitocarta>) and place them in your data directory:

```bash
cp Human.MitoCarta3.0.csv Mouse.MitoCarta3.0.csv data/app-data/mitocarta/
sudo chown 1000:1000 data/app-data/mitocarta/*.csv
```

The filenames are exact and case-sensitive. If they are missing the import fails with
`mitocarta-data-missing`. Run the MitoCarta import **after** step 1, since it resolves gene symbols
through the gene-info mapping.

#### GO — known limitation

The GO importer downloads the ontology (`go.obo`) but the code that builds gene→term associations
from NCBI's `gene2go` is **commented out in this release**. What runs instead expects a
pre-existing file per organism and namespace:

```
.data/tmp/go_gene_set_tmp/temp_<taxId>_<namespace>.csv
```

tab-separated, one association per line: `taxId<TAB>geneId<TAB>GO:0000000`. Nothing in the
application creates that directory or file, so **a GO import on a fresh installation will fail**
with `No gene set is found.` unless you supply it yourself.

> ⚠️ If you do supply these files, import one organism at a time and check the result. When the
> expected file is missing the importer returns whatever the previous successful GO import left in
> memory, which can write one organism's gene sets under another. Restart the app between GO
> imports if you are unsure.

### Step 4 — UniProt ID mapping (optional, very large)

Go to **`/admin/gene-info`** → **Update UniProt**, then **Update EntrezIDMapping from UniProt**.

Downloads
`https://ftp.uniprot.org/pub/databases/uniprot/current_release/knowledgebase/idmapping/idmapping.dat.gz`
(~10 GB compressed, billions of rows). The code's own progress log warns that index building
*"can take some hours to a day"*, and a fully populated ID-mapping database runs to hundreds of
gigabytes.

**You can skip this.** Without it IPSA works normally for **gene-symbol input**, which is the
default and what every bundled example uses. What you lose:

- The input ID-type selector offers only `Gene_Name`.
- Pasting RefSeq, Ensembl or UniProt accessions detects **no** ID type, and the analysis wizard
  stops at the input step showing "Please wait for gene ID type detection to complete" — it does not
  report the real cause, so this looks like a hang rather than unsupported input.
- Custom gene sets uploaded in a non-symbol ID space will not map.

Note that IPSA uses two Mongo databases: `meteor` (users, organisms, pathway databases, gene sets
and import logs) and `idmapping` (gene info and the ID-mapping tables). Both are served by the same
mongod and live in `data/db`.

### Step 5 — Harmonizome (optional)

**`/admin/harmonizome`** → **Integrate Harmonizome**. Requires an `hsa` organism and step 1.

This one is fragile: it works by scraping `https://maayanlab.cloud/Harmonizome` HTML, so it breaks
whenever that site's markup changes, and it is capped at 1000 requests per crawl so a full import is
truncated. It also adds roughly a hundred new entries to the shared pathway-database list, visible
to every user of your deployment.

---

## Optional: local LLM backend

AI-assisted interpretation needs an OpenAI-compatible LLM endpoint. IPSA does not require one — all
analysis and visualisation features work without it.

Point `llm.providers.vllm.baseUrl` in `config/settings.json` at any OpenAI-compatible server (vLLM,
llama.cpp, Ollama, TGI, …). From inside the container, a server running on the host is reachable at
`http://host.docker.internal:<port>`.

A bundled Ollama service is available behind a compose profile:

```bash
docker compose -f docker-compose.prod.yml --profile gpu up -d
```

It requires an NVIDIA GPU with the container runtime configured (`docker info | grep -i runtime`
should list `nvidia`) **and** an existing Ollama installation bind-mounted at `OLLAMA_BIN_DIR` —
the image does not install Ollama itself.

---

## Configuration reference

### `.env`

See [`.env.example`](.env.example) — every variable is documented there. The ones that matter:

| Variable | Default | Purpose |
|---|---|---|
| `APP_PORT` | `18000` | Host port for the web UI |
| `ROOT_URL` | `http://localhost:18000` | Externally reachable URL; must be correct behind a proxy |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / *(random)* | First administrator, created on first boot |
| `CPA_DB_PATH` | `./data/db` | MongoDB data directory (legacy `CPA_` prefix, kept so existing deployments keep working) |
| `CPA_DATA_PATH` | `./data/app-data` | Uploads, R scratch space, reference data (same legacy prefix) |
| `TUTORIAL_DIR` | `./data/tutorial` | Optional pre-built tutorial site served at `/tutorial` |
| `TAG` | `latest` | Local image tag; bump it to keep older images for rollback |

Secrets belong in `.env` (gitignored) or the environment — never in a tracked file.

### `config/settings.json`

Meteor settings: file-size limits, retention policy, container-internal paths and LLM provider
configuration. It ships with **all credential fields empty** and is required for the app to boot,
so it is tracked rather than kept as an example file.

Optional credentials can be set here (`GROQ_API_KEY`, `PUBMED_API_KEY`, `PUBMED_EMAIL`) or, for
most of them, through the environment instead — note the environment names do not all match the
settings keys:

| Setting in `config/settings.json` | Environment equivalent |
|---|---|
| `private.PUBMED_API_KEY` | `NCBI_API_KEY` |
| `private.GROQ_API_KEY` | `GROQ_API_KEY` |
| `private.PUBMED_EMAIL` | *(none — settings only)* |

The LLM endpoint is configured only in `config/settings.json`, under `llm.providers`. Remember that
inside the container `localhost` is the container itself — to reach a server running on your host,
use `http://host.docker.internal:<port>`.

A daily job removes expired studies `dataRetentionDays` (default 90) after their expiry. This is a
**hard delete of the whole study** — the uploaded files *and* the associated analyses, results,
configs and logs. Nothing is retained, so raise `dataRetentionDays` in `config/settings.json` if you
need longer-lived studies.

---

## Development

Requires Meteor 3.0.2 and Node 22. **The Docker stack above is the supported way to run IPSA** — a
bare `meteor run` needs extra setup, because the app opens a second Mongo connection and because the
committed settings file points at container paths.

```bash
meteor npm install
# IDMAPPING_URL has no default; Meteor's bundled dev mongo listens on 3001.
IDMAPPING_URL=mongodb://127.0.0.1:3001/idmapping \
  meteor run --settings config/settings.json
```

You will also need to point the `private.*Dir` paths, and `RscriptCmd`, in your settings file at
locations that exist on your machine — as committed they refer to paths inside the container image
(`/home/meteorer/app/...`) and to the conda environment defined in `environment.yml`. Copy
`config/settings.json` and edit it rather than changing the committed file.

Unit and integration tests:

```bash
meteor test --once --driver-package meteortesting:mocha --settings config/settings.json
```

End-to-end tests (Playwright) run against an already-running instance. `@playwright/test` is not a
project dependency, so install it first:

```bash
npm install --no-save @playwright/test
npx playwright install
E2E_BASE_URL=http://localhost:18000 npx playwright test
```

`e2e/chat.spec.js` additionally requires the app to have been started with `CHAT_TEST_STUB=1`.

Pathway-analysis methods run in R. The scripts the application actually executes are generated in
`server/include/rCommand/`, with helpers loaded from `private/R/` and the locally built `GSA`
package from `Rsource/modified-methods/`. `Rsource/src/` holds the wider library of R method
implementations. The container provides the R toolchain through the conda environment defined in
`environment.yml`.

---

## Licence

MIT — see [LICENSE](LICENSE).

Some bundled components are **not** covered by that licence and keep their own terms: the Broad
Institute GSEA R implementation, the GSA R package (LGPL), and ECharts GL derived visualisation
code. The pathway databases IPSA downloads at runtime each carry their own terms of use. All of this
is itemised in [NOTICE](NOTICE) — read it before redistributing.
