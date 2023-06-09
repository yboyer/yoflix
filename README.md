# TorrentManager

1. Edit the `.env` file
2. Start

```sh
docker compose up
```

- [Jackett](http://localhost:8031)
- [Radarr](http://localhost:8032)
- [Sonarr](http://localhost:8033)

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
