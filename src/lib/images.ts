// Profile photos and team logos. Each picture is shrunk on the phone to a
// small square and stored as a base64 data URL in its own JSON file
// (images/people/<id>.json, images/teams/<id>.json). Living in the normal data
// store means the offline queue, cache, ETag refresh and write guard all apply.
// people.json / teams.json carry only a stamp, so they stay light and every
// phone can tell when a picture changed.
import { useEffect } from 'react'
import type { ImageFile, PeopleFile, Person, Team, TeamsFile } from '../types'
import { nowStamp } from './dates'
import { P } from './paths'
import type { Store } from './store'

export const IMAGE_SIZE = 256
/** Upper bound for one stored picture (the data URL text). */
export const MAX_IMAGE_CHARS = 150_000

/** Loads a picked file into an <img>. */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be opened as a picture.'))
    }
    img.src = url
  })
}

/**
 * Centre-crops to a square and scales down to IMAGE_SIZE. WebP where the
 * browser can make it, JPEG otherwise; quality steps down until it fits.
 */
export async function resizeToSquare(file: Blob, size = IMAGE_SIZE): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick a picture (JPG, PNG, WebP or HEIC).')
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (!side) throw new Error('That picture is empty.')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(size, side)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This phone could not process the picture.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    let url = canvas.toDataURL('image/webp', quality)
    // Older Safari ignores webp and returns PNG — use JPEG instead.
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality)
    if (url.length <= MAX_IMAGE_CHARS) return url
  }
  throw new Error('That picture is too large even after shrinking. Try another one.')
}

/** A stored picture is only ever a small raster data URL — never a link or SVG. */
export function isSafeImage(url: unknown): url is string {
  return typeof url === 'string' && url.length <= MAX_IMAGE_CHARS && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(url)
}

function putImage(s: Store, path: string, dataUrl: string | null, stamp: string, message: string): boolean {
  if (dataUrl !== null && !isSafeImage(dataUrl)) throw new Error('That picture could not be saved.')
  const file: ImageFile = { schemaVersion: 1, dataUrl, updatedAt: stamp }
  return s.write(path, file, message)
}

/** Sets or removes (null) a player's photo. False when this user may not change it. */
export function setPersonPhoto(s: Store, personId: string, dataUrl: string | null): boolean {
  const file = s.get<PeopleFile>(P.people)
  const person = file?.people.find((p) => p.id === personId)
  if (!file || !person) throw new Error('Player not found.')
  const stamp = nowStamp()
  const msg = `${dataUrl ? 'Set' : 'Remove'} photo of ${person.name}`
  // The picture first, then the stamp that points at it.
  if (!putImage(s, P.personPhoto(personId), dataUrl, stamp, msg)) return false
  const people = file.people.map((p): Person => {
    if (p.id !== personId) return p
    const next: Person = { ...p, updatedAt: stamp }
    if (dataUrl) next.photo = stamp
    else delete next.photo
    return next
  })
  return s.write(P.people, { ...file, people }, msg)
}

/** Sets or removes (null) a team's logo. Admin only (the write guard refuses everyone else). */
export function setTeamLogo(s: Store, teamId: string, dataUrl: string | null): boolean {
  const file = s.get<TeamsFile>(P.teams)
  const team = file?.teams.find((t) => t.id === teamId)
  if (!file || !team) throw new Error('Team not found.')
  const stamp = nowStamp()
  const msg = `${dataUrl ? 'Set' : 'Remove'} logo of ${team.name}`
  if (!putImage(s, P.teamLogo(teamId), dataUrl, stamp, msg)) return false
  const teams = file.teams.map((t): Team => {
    if (t.id !== teamId) return t
    const next: Team = { ...t, updatedAt: stamp }
    if (dataUrl) next.logo = stamp
    else delete next.logo
    return next
  })
  return s.write(P.teams, { ...file, teams }, msg)
}

/**
 * The picture for `path`, or null. Reads the cached copy right away and checks
 * the repo when the cached one is older than `stamp` (or missing).
 */
export function useImage(store: Store | null, path: string | null, stamp: string | undefined): string | null {
  const file = store && path && stamp ? store.get<ImageFile>(path) : null
  const stale = !!(store && path && stamp && (!file || file.updatedAt < stamp))
  useEffect(() => {
    if (stale && store && path) void store.refresh(path).catch(() => {})
  }, [stale, store, path])
  if (!stamp) return null
  return isSafeImage(file?.dataUrl) ? file!.dataUrl : null
}
