/** A lease on a resource in the {@link RcMap}.
 * When the last lease for a given resource is disposed,
 * the resource is removed from the map and disposed. */
export interface RcMapLease<T> extends AsyncDisposable {
  readonly value: T
}

/** A keyed pool of reference-counted {@link AsyncDisposable} resources. */
export class RcMap<K, V extends AsyncDisposable> implements AsyncDisposable {
  private entries = new Map<K, { value: Promise<V>; count: number }>()

  /** Acquire a lease on the resource at {@link key},
   * creating it with {@link make} if none exists. */
  async acquire(key: K, make: () => Promise<V>): Promise<RcMapLease<V>> {
    let resource = this.entries.get(key)
    if (!resource) {
      resource = { value: make(), count: 0 }
      this.entries.set(key, resource)
    }
    resource.count++
    const value = await resource.value.catch(err => {
      if (--resource.count === 0) this.entries.delete(key)
      throw err
    })
    let released = false
    return {
      value,
      [Symbol.asyncDispose]: async () => {
        if (released) return
        if (--resource.count === 0 && this.entries.get(key) === resource) {
          this.entries.delete(key)
          await value[Symbol.asyncDispose]()
        }
        released = true
      },
    }
  }

  /** Apply `fn` to every resource,
   * awaiting resources that are still being created
   * but skipping any whose creation function throws. */
  async forEach(fn: (value: V, key: K, map: this) => void): Promise<void> {
    await Promise.all(
      [...this.entries].map(([key, e]) =>
        e.value.then(
          v => fn(v, key, this),
          () => {},
        ),
      ),
    )
  }

  /** Dispose all resources at once, regardless of outstanding reference counts. */
  async [Symbol.asyncDispose]() {
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map(async e => (await e.value)[Symbol.asyncDispose]()))
  }
}
