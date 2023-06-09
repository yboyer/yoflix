# TorrentManager

- [Jackett](http://localhost:8031)
- [Radarr](http://localhost:8032)
- [Sonarr](http://localhost:8033)

## Setup

1. Fill the `.env` file with an [AllDebrid API Key](https://alldebrid.fr/apikeys/)
2. Start containers

```sh
docker compose up
```

## Config

### Radarr

- Go to <http://localhost:8032/system/backup>
- Restore backup from `services/Radarr/config.zip`

### Sonarr

- Go to <http://localhost:8033/system/backup>
- Restore backup from `services/Sonarr/config.zip`

### Jackett

- Add indexer
- Add YGGtorrent
