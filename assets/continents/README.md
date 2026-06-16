# Continents (authored levels)

Drop level `.json` files here. Because `publicDir` is `assets/`, everything in
this folder is copied to the site root under `/continents/`, so a file here is
loadable in the editor or game via:

```
?level=./continents/<name>.json
```

e.g. the bundled example: `?level=./continents/sample.json`.

This is the **publish target** for maps made in the editor: export with **Save**,
then commit the JSON into this folder (see README.md → "Publishing maps back to
GitHub"). The format and the hand-drawn → JSON flow are in `docs/MAP-FORMAT.md`.
