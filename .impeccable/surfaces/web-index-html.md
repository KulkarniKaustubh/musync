---
version: 1
slug: "web-index-html"
primary_target: "web/index.html"
related_targets: []
---

# Room, join flow and big-screen view

Scope: web/index.html (landing, setup, room, big screen). Visitor mode: Operate.

Audience and job: a friend who arrives from a link or code, on a phone, often in a dim room, who wants to add one song from the music app they already use. Task: join, pick a music app once, search it, add, see whose pick plays next. Content: synthetic songs, people and rooms; service names in text only. Constraints: no logos, no claimed integrations, one-handed use, WCAG AA.

Unresolved: audio routing to a shared speaker, what remote listeners hear for a service they lack, who may skip or remove.

## Direction contract

THESIS: A shared queue that looks and behaves like the streaming apps people already know, so nothing needs explaining; it refuses a novelty skin and refuses any single service's identity.

OWN-WORLD: Neutral dark ground with two raised neutral layers, one warm yellow accent used only as a fill with dark text, round initial avatars in soft person colors, square abstract cover tiles, pill buttons, filter chips, one humanist-geometric sans at a fixed scale.

STORY: The visitor sees what is playing and whose pick it is, sees what is next, and adds a song from their own app without being told how.

FIRST VIEWPORT: Phone: sticky room bar (room name, code, people, Invite); "Now playing" with cover tile, title, artist, picker and source account, progress; "Up next" list of three-line rows with a bump pill at right; fixed bottom bar "Add a song from <service>" as the primary action.

FORM: Category standard (the standing exit), chosen by the user over the dealt direction; seed key 9be8544e. Signature interaction: the search sheet's service chips, defaulting to the visitor's own app.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
