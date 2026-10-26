/**
 * pdf.js 6.x calls the TC39 `Map.prototype.getOrInsert*` proposal methods,
 * which no shipping browser implements yet. Without them every page render
 * rejects with "getOrInsertComputed is not a function". Install once before
 * pdf.js is imported.
 */
export function installPdfJsPolyfill(): void {
  const proto = Map.prototype as unknown as Record<string, unknown>;

  if (typeof proto["getOrInsert"] !== "function") {
    proto["getOrInsert"] = function <K, V>(this: Map<K, V>, key: K, value: V): V {
      if (!this.has(key)) this.set(key, value);
      return this.get(key) as V;
    };
  }

  if (typeof proto["getOrInsertComputed"] !== "function") {
    proto["getOrInsertComputed"] = function <K, V>(
      this: Map<K, V>,
      key: K,
      compute: (key: K) => V,
    ): V {
      if (!this.has(key)) this.set(key, compute(key));
      return this.get(key) as V;
    };
  }

  const wproto = WeakMap.prototype as unknown as Record<string, unknown>;

  if (typeof wproto["getOrInsert"] !== "function") {
    wproto["getOrInsert"] = function <K extends object, V>(
      this: WeakMap<K, V>,
      key: K,
      value: V,
    ): V {
      if (!this.has(key)) this.set(key, value);
      return this.get(key) as V;
    };
  }

  if (typeof wproto["getOrInsertComputed"] !== "function") {
    wproto["getOrInsertComputed"] = function <K extends object, V>(
      this: WeakMap<K, V>,
      key: K,
      compute: (key: K) => V,
    ): V {
      if (!this.has(key)) this.set(key, compute(key));
      return this.get(key) as V;
    };
  }
}
