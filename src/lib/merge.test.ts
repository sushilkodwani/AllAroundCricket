import { describe, expect, it } from 'vitest'
import { mergeFile, mergeLists, mergeObjects } from './merge'

interface R {
  id: string
  v: string
  updatedAt?: string
}
const id = (r: R) => r.id

describe('mergeLists', () => {
  it('keeps a change made on one side only', () => {
    const base = [{ id: 'a', v: '1' }, { id: 'b', v: '1' }]
    const local = [{ id: 'a', v: '2' }, { id: 'b', v: '1' }]
    const remote = [{ id: 'a', v: '1' }, { id: 'b', v: '9' }]
    expect(mergeLists(base, local, remote, id)).toEqual([{ id: 'a', v: '2' }, { id: 'b', v: '9' }])
  })

  it('keeps records added on both sides', () => {
    const base: R[] = []
    const out = mergeLists(base, [{ id: 'l', v: '1' }], [{ id: 'r', v: '1' }], id)
    expect(out.map(id).sort()).toEqual(['l', 'r'])
  })

  it('newest updatedAt wins when both sides changed the same record', () => {
    const base = [{ id: 'a', v: '1', updatedAt: '2026-01-01' }]
    const local = [{ id: 'a', v: 'local', updatedAt: '2026-01-02' }]
    const remote = [{ id: 'a', v: 'remote', updatedAt: '2026-01-03' }]
    expect(mergeLists(base, local, remote, id)[0].v).toBe('remote')
    expect(mergeLists(base, remote, local, id)[0].v).toBe('remote')
  })

  it('a delete on one side wins over no change on the other', () => {
    const base = [{ id: 'a', v: '1' }, { id: 'b', v: '1' }]
    expect(mergeLists(base, [{ id: 'b', v: '1' }], base, id)).toEqual([{ id: 'b', v: '1' }])
    expect(mergeLists(base, base, [{ id: 'b', v: '1' }], id)).toEqual([{ id: 'b', v: '1' }])
  })

  it('delete vs edit keeps the edit', () => {
    const base = [{ id: 'a', v: '1' }]
    expect(mergeLists(base, [], [{ id: 'a', v: 'edited' }], id)).toEqual([{ id: 'a', v: 'edited' }])
    expect(mergeLists(base, [{ id: 'a', v: 'edited' }], [], id)).toEqual([{ id: 'a', v: 'edited' }])
  })
})

describe('mergeObjects', () => {
  it('merges field by field', () => {
    const base = { a: 1, b: 1, c: 1 }
    expect(mergeObjects(base, { a: 2, b: 1, c: 1 }, { a: 1, b: 3, c: 1 })).toEqual({ a: 2, b: 3, c: 1 })
  })
})

describe('mergeFile', () => {
  it('merges credentials by personId so two people setting PINs never collide', () => {
    const base = { schemaVersion: 1, credentials: [{ personId: 'p1', sessionEpoch: 1 }, { personId: 'p2', sessionEpoch: 1 }] }
    const local = { schemaVersion: 1, credentials: [{ personId: 'p1', sessionEpoch: 1, pin: 'A' }, { personId: 'p2', sessionEpoch: 1 }] }
    const remote = { schemaVersion: 1, credentials: [{ personId: 'p1', sessionEpoch: 1 }, { personId: 'p2', sessionEpoch: 1, pin: 'B' }] }
    const out = mergeFile('auth/credentials.json', base, local, remote) as typeof local
    expect(out.credentials).toEqual([
      { personId: 'p1', sessionEpoch: 1, pin: 'A' },
      { personId: 'p2', sessionEpoch: 1, pin: 'B' },
    ])
  })

  it('uses the local copy when the remote file does not exist', () => {
    expect(mergeFile('teams.json', null, { teams: [] }, null)).toEqual({ teams: [] })
  })
})
