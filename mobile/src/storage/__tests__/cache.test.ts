import { readCache, writeCache } from '../cache'

describe('cache', () => {
  it('renvoie null quand rien n’a encore été mis en cache', async () => {
    expect(await readCache('unknown-key')).toBeNull()
  })

  it('conserve les données et leur date d’écriture', async () => {
    const before = Date.now()
    await writeCache('rooms', [{ id: '1', name: 'Salle A' }])
    const entry = await readCache<{ id: string; name: string }[]>('rooms')

    expect(entry).not.toBeNull()
    expect(entry?.data).toEqual([{ id: '1', name: 'Salle A' }])
    expect(new Date(entry!.cachedAt).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('la dernière écriture remplace la précédente pour la même clé', async () => {
    await writeCache('rooms', ['v1'])
    await writeCache('rooms', ['v2'])

    const entry = await readCache<string[]>('rooms')
    expect(entry?.data).toEqual(['v2'])
  })

  it('isole les clés entre elles', async () => {
    await writeCache('room:a:measurements', ['a'])
    await writeCache('room:b:measurements', ['b'])

    expect((await readCache<string[]>('room:a:measurements'))?.data).toEqual(['a'])
    expect((await readCache<string[]>('room:b:measurements'))?.data).toEqual(['b'])
  })
})
