const api = require('fastify')({
  logger: true,
  disableRequestLogging: true,
})
const watch = require('node-watch')
const path = require('path')
const fs = require('fs')
const FormData = require('form-data')
const got = require('got')
const parser = require('parse-torrent')
const natural = require('natural')
require('dotenv').config()

const base = `${process.env.NODE_ENV !== 'production' ? '.' : ''}${path.sep}`

const config = {
  ALLDEBRID_API_KEY: process.env.ALLDEBRID_API_KEY,
  events: ['Upgrade', 'Grab'],
  torrentDir: path.join(base, 'data', 'torrents'),
  fileDir: path.join(base, 'data', 'files'),
}

if (!config.ALLDEBRID_API_KEY) {
  throw new Error('ALLDEBRID_API_KEY environment variable missing')
}

const done = []

async function cleanDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (err) {}
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {}
}

async function createFile({ dir, filename }) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {}
  try {
    fs.writeFileSync(path.join(dir, filename), '')
  } catch (e) {}
}

watch(config.torrentDir, { recursive: true }, async function (evt, file) {
  if (evt !== 'update' || !file.endsWith('.torrent')) return

  const { name } = path.parse(file)
  console.log(`${name} modified`)

  const form = new FormData()
  form.append('files[]', fs.createReadStream(file))

  const searchParams = new URLSearchParams({
    agent: 'TorrentLoader',
    apikey: config.ALLDEBRID_API_KEY,
  })
  try {
    const parsedTorrent = parser(fs.readFileSync(file))

    const res = await got
      .post(
        `https://api.alldebrid.com/v4/magnet/upload/file?${searchParams.toString()}`,
        {
          headers: form.getHeaders(),
          body: form,
        }
      )
      .json()
    console.log('Alldebrid:', res.status)
    if (res.status !== 'success') {
      console.log('Files:', res.data?.files)
    }

    // Create file for radarr
    const index = done.findIndex(
      (d) =>
        d.name === name || natural.JaroWinklerDistance(d.name, name, {}) > 0.95
    )
    if (index > -1) {
      const el = done.splice(index, 1)[0]
      if (el.overwrite) {
        cleanDir(path.join(config.fileDir, el.folder))

        const pathArgs = [config.fileDir, el.folder]
        createFile({
          dir: path.join(...pathArgs),
          filename: `${el.name}.mkv`,
        })
      } else {
        parsedTorrent.files?.forEach((f) => {
          const fileDir = path.dirname(f.path).split('/')
          const pathArgs = [config.fileDir, el.folder, ...fileDir].filter(
            Boolean
          )
          createFile({
            dir: path.join(...pathArgs),
            filename: f.name,
          })
          console.log('Create', path.join(...pathArgs, f.name))
        })
      }
    }

    // Remove torrent file
    fs.unlink(file, () => {})
  } catch (e) {
    console.error(e)
  }
})

api.post('/', async ({ body, log }) => {
  log.info(body)
  if (config.events.includes(body.eventType)) {
    if (body.movie) {
      done.push({
        folder: body.movie.folderPath.replace(config.fileDir, ''),
        name: body.release.releaseTitle,
        overwrite: true,
      })
    }
    if (body.series) {
      done.push({
        folder: body.series.path.replace(config.fileDir, ''),
        name: body.release.releaseTitle,
      })
    }
  }
  return {}
})
api.listen({
  port: 3000,
  host: '0.0.0.0',
})
