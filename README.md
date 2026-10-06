# syng

A shared music queue for a room full of people. One screen sits next to the
speakers and plays the music. Everyone else adds songs from their phone.

## Status

UI prototype only. It runs on mock data in the browser: there is no backend,
no search API and no real playback yet.

## Run it

```sh
cd web
python3 -m http.server 8000
```

Then open http://localhost:8000. The bar at the top switches between the
landing page, the host screen and the guest phone view.

## Layout

- `web/` the prototype (plain HTML, CSS and JavaScript, no build step)
- `docs/design.md` the design plan: colors, type, layout and wording
