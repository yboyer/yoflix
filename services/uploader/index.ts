import fs from 'node:fs'
import path from 'node:path'

import chokidar from 'chokidar'
import { cleanEnv, str } from 'envalid'
import fastify from 'fastify'
import natural from 'natural'
// @ts-expect-error
import parser from 'parse-torrent'

///

const api = fastify({
  logger: true,
  disableRequestLogging: true,
})

const env = cleanEnv(process.env, {
  ALLDEBRID_API_KEY: str(),
})

const base = `${!env.isProd ? '.' : ''}${path.sep}`

const config = {
  ALLDEBRID_API_KEY: env.ALLDEBRID_API_KEY,
  events: ['Upgrade', 'Grab'],
  torrentDir: path.join(base, 'data', 'torrents'),
  fileDir: path.join(base, 'data', 'files'),
}

const done: { folder: string; name: string; overwrite?: boolean }[] = []

async function cleanDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {}
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

async function createFile({ dir, filename }: { dir: string; filename: string }) {
  try {
    await fs.promises.mkdir(dir, { recursive: true })
  } catch {}
  try {
    await fs.promises.writeFile(path.join(dir, filename), '')
  } catch {}
}

async function sendToAlldebrid(file: string) {
  const form = new FormData()
  form.append('files[]', await fs.openAsBlob(file), path.basename(file))

  const searchParams = new URLSearchParams({
    agent: 'TorrentLoader',
    apikey: config.ALLDEBRID_API_KEY,
  })

  const request = await fetch(
    `https://api.alldebrid.com/v4/magnet/upload/file?${searchParams.toString()}`,
    {
      method: 'POST',
      body: form,
    }
  )
  const res = (await request.json()) as {
    status: 'success' | 'error'
    data?: {
      files?: {
        path: string
        name: string
        error?: {
          code: string
          message: string
        }
      }[]
    }
  }
  if (!res || res.status !== 'success' || res.data?.files?.[0]?.error) {
    console.log('Alldebrid response:', JSON.stringify(res, null, 2))
    throw new Error('Failed to send torrent to Alldebrid')
  }
}

chokidar
  .watch(config.torrentDir, { persistent: true, ignoreInitial: true })
  .on('all', async (evt, file) => {
    console.log('Event:', evt, 'File:', file)
    if ((evt !== 'add' && evt !== 'change') || !file.endsWith('.torrent')) return

    const { name } = path.parse(file)
    console.log(`${name} [${evt}]`)

    try {
      const parsedTorrent = await parser(fs.readFileSync(file))

      await sendToAlldebrid(file)

      // Create file for radarr
      const index = done.findIndex(
        d => d.name === name || natural.JaroWinklerDistance(d.name, name, {}) > 0.95
      )
      if (index > -1) {
        const el = done.splice(index, 1)[0]
        if (el.overwrite) {
          await cleanDir(path.join(config.fileDir, el.folder))

          const pathArgs = [config.fileDir, el.folder]
          console.log('Create', path.join(...pathArgs, `${el.name}.mkv`))
          await createFile({
            dir: path.join(...pathArgs),
            filename: `${el.name}.mkv`,
          })
        } else if ('files' in parsedTorrent && parsedTorrent.files?.length) {
          for (const f of parsedTorrent.files) {
            const fileDir = path.dirname(f.path).split('/')
            const pathArgs = [config.fileDir, el.folder, ...fileDir].filter(Boolean)
            console.log('Create', path.join(...pathArgs, f.name))
            await createFile({
              dir: path.join(...pathArgs),
              filename: f.name,
            })
            console.log('Create', path.join(...pathArgs, f.name))
          }
        }
      }

      // Remove torrent file
      await fs.promises.unlink(file)
    } catch (e) {
      console.error(e)
    }
  })

api.post<{
  Body: {
    eventType: string
    movie?: { folderPath: string; title: string }
    series?: { path: string }
    release: { releaseTitle: string }
  }
}>('/', async ({ body, log }) => {
  log.info(body.release.releaseTitle)
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
