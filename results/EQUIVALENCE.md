# Equivalence snapshots

`eq_upstream.json.gz` and `eq_patched.json.gz` are the differential snapshots produced by
`probe/equivalence.cjs` on the two arms. Both are gzip-compressed JSON (1,200,320 bytes each
after decompression, 32 steps).

Verify they are byte-identical:

```bash
gzip -dc eq_upstream.json.gz | sha256sum
gzip -dc eq_patched.json.gz  | sha256sum
# both must print:
# e233fe3278b87982302b6fcad37417ee67429a2576d876f5214723abb2d368bc  -
```

Or compare directly:

```bash
gzip -dc eq_upstream.json.gz > a.json
gzip -dc eq_patched.json.gz  > b.json
cmp a.json b.json && echo identical
```

Each step in the snapshot records, for the same API call sequence:

- `dom` — every direct child of the list container, one `outerHTML` string per node
- `domCount` — number of direct children
- `visible` — `[name, city, age]` for each `visibleItems` entry, in order
- `matching` — same for `matchingItems`
- `found` / `filtered` — per-item flags, in `items` order
- `json` — `list.toJSON()`

Steps covered: init, multi-prefix search, search reset, filter narrow + reset, sort on three
columns (asc/desc/numeric/`insensitive: false`), paging round-trip, `add`, `remove`, in-place
`values()` rewrite then re-search, rewrite back then re-search, fuzzy search, `reIndex`,
custom `alphabet` sort, custom `sortFunction`.

To regenerate:

```bash
node probe/equivalence.cjs --src . --out out/eq_patched.json
```
