# syng

One shared music queue that anyone adds to from their own streaming app. Each
person picks the app they already use, searches it, and adds songs to the
room's queue. A song plays from the account of whoever added it.

## Status

UI prototype only. It runs on synthetic data in the browser: there is no
backend, no sign-in, no search API and no sound. Songs, people, rooms and the
list of streaming apps are examples. Cover tiles are generated shapes, not real
artwork.

## Run it

```sh
cd web
python3 -m http.server 8000
```

Then open http://localhost:8000. The bar at the top switches between the
landing page, a room, and the big-screen view.

## What is where

- `web/` the prototype (plain HTML, CSS and JavaScript, no build step)
- `PRODUCT.md` what the product is, who it is for, and what is still undecided
- `DESIGN.md` the visual system: colors, type, layout, components, rules
- `.impeccable/` design tooling state (surface brief, design tokens sidecar)
- `.claude/skills/impeccable/` the Impeccable design skill, v4.5.0, Apache 2.0,
  by Paul Bakaus (https://github.com/pbakaus/impeccable)

## Open product decisions

- How audio reaches one shared speaker, and what remote listeners hear, when
  consecutive songs play from different people's accounts.
- Who may skip, pause and remove. The prototype uses a placeholder rule.
- Which streaming apps are supported at launch.
