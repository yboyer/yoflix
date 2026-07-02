# Yoflix

Self-hosted media automation stack built around Jackett, Radarr, Sonarr, FlareSolverr, and two small Node services:

- `bootstrap`: one-shot provisioning for Radarr and Sonarr
- `uploader`: webhook receiver + torrent watcher for the local blackhole flow

## Services

- [Jackett](http://localhost:8031)
- [Radarr](http://localhost:8032)
- [Sonarr](http://localhost:8033)
- `bootstrap`: one-shot job, run manually
- `uploader`: Node service in `services/uploader/index.ts`, intended to listen on port `3000`

## Repository layout

```text
.
├── data/
│   ├── completed/   # blackhole watch folder
│   ├── files/       # Radarr/Sonarr root folder
│   └── torrents/    # blackhole torrent output
├── services/
│   ├── bootstrap/   # Radarr/Sonarr provisioning + config sync
│   └── uploader/    # webhook receiver + torrent watcher
└── docker-compose.yml
```

## Requirements

- Docker + Docker Compose
- an [AllDebrid API key](https://alldebrid.fr/apikeys/)
- at least one configured Jackett indexer

Optional:

- `JACKETT_API_KEY` if you want a fixed Jackett API key on first boot

The current setup expects only the API keys in `.env`. Paths, URLs, webhook target, and category defaults come from `docker-compose.yml` and the bootstrap service.

## Setup

1. Copy `.env.exemple` to `.env`
2. Fill `.env` with:
   - `ALLDEBRID_API_KEY`
   - optional `JACKETT_API_KEY`
3. Start the core services:

```sh
docker compose up -d --build
```

1. Open Jackett and configure at least one indexer
2. Run the one-shot bootstrap job:

```sh
docker compose run --rm bootstrap --build
```

## What bootstrap does

The bootstrap service:

- waits for Jackett, Radarr, and Sonarr to become reachable
- resolves API keys from the live service config when possible
- ensures the Radarr/Sonarr root folder exists at `/data/files`
- ensures a `TorrentBlackhole` download client exists and points to:
  - torrent folder: `/data/torrents/`
  - watch folder: `/data/completed/`
- ensures a webhook notification named `Notifier` points to `http://uploader:3000`
- discovers all configured Jackett indexers
- creates or updates matching Torznab indexers in Radarr and Sonarr
- syncs shared quality profiles and custom formats from `services/bootstrap/config/config.json`

Important: bootstrap does **not** create Jackett indexers for you. If Jackett has no configured indexer, bootstrap fails with `No configured Jackett indexers found`.

## Bootstrap config

Shared bootstrap config lives in:

- `services/bootstrap/config/config.json`

That file is applied to both Radarr and Sonarr.

Supported shape:

- `qualityProfiles[]`
  - `name`
  - `allowed`
  - `cutoff`
  - `formatScores`
  - optional: `upgradeAllowed`, `minFormatScore`, `cutoffFormatScore`, `minUpgradeFormatScore`
- `customFormats[]`
  - `name`
  - `type`: `regex` or `resolution`
  - `value`
  - optional: `negate`, `required`, `includeCustomFormatWhenRenaming`, `specName`

Bootstrap creates or updates resources by name. Extra resources already present in Radarr or Sonarr are left untouched.

## Uploader flow

`services/uploader/index.ts` implements the uploader flow:

- listens for `Grab` and `Upgrade` webhooks from Radarr and Sonarr
- watches `data/torrents` for new `.torrent` files
- uploads those torrent files to AllDebrid
- creates placeholder files under `data/files` so imports can resolve to the expected folder structure

## Useful commands

Rerun bootstrap after changing `.env` or `services/bootstrap/config/config.json`:

```sh
docker compose run --rm bootstrap --build
```
