# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: static HTML, CSS and JavaScript with no build step, for the UI
prototype. Chosen because there is no backend yet, it previews anywhere, and it
keeps the design work separate from the framework decision. Revisit when the
room service and real playback are built.

## Users

Friends who want to listen to music together and who do not all use the same
streaming service. Each person already has a service they pay for and an app
they know. They use syng in two situations, both confirmed:

- In the same room: a party, a car, a dorm. Phones in hand, attention split,
  often dim light.
- Apart: friends in different places listening along at the same time.

Nobody wants to create an account or learn a tool. Most people arrive from a
link or a code a friend sent, and their first job is to add one song.

## Product Purpose

A central music queue that belongs to the room and to no single streaming
service. Anyone in the room, including the person who started it, adds songs
from the service they choose. Success is a friend who uses a different service
than the host adding a song in under a minute without asking how.

## Positioning

Shared queues exist, but each one runs through a single host account on a
single service. In syng the queue is service-neutral: every person searches the
service they use, and a song plays from the account of whoever added it.

## Operating Context

- Joining happens by link, QR code or a short room code.
- Each person picks their streaming service on their own device, so search uses
  the app and catalog they already know.
- Search can also be widened to every service at once.
- In a shared room one screen may be visible to everyone (a TV or laptop).
- Remotely, each person only has their own phone or laptop.

## Capabilities and Constraints

Confirmed:

- One queue per room. Everyone in the room can add to it.
- Each person chooses which service to search, per device.
- A search-everything option exists alongside the per-service search.
- A song plays from the account of the person who added it.
- Works for people in one room and for people who are apart.

Terminology: room, room code, queue, add, bump (move a song up), pick
("Maya's pick").

Undecided, and not to be invented by design work:

- How audio reaches one shared speaker when consecutive songs play from
  different people's accounts.
- What a remote listener hears when the song comes from a service they do not
  have.
- Whether bumping, skipping and removing are open to everyone or host-only.
  The prototype uses a placeholder: anyone can bump, the host can pause, skip
  and remove any song, and a person can skip or remove their own.
- Which services are supported at launch. Research on 2026-10-06 found that
  only Apple Music and YouTube currently offer third-party playback that a new
  app can use; Spotify limits new apps to five users, and Tidal and Amazon
  Music restrict full playback to approved partners. Any service list in the
  prototype is illustrative.

## Brand Commitments

- The name is syng, written lowercase.
- Standing visual preference, chosen by the owner on 2026-10-06: the familiar
  look and conventions of mainstream streaming apps, played straight. syng
  should feel at home next to Spotify, Apple Music and YouTube Music, and match
  their level of polish. It must not borrow any one service's color, logo or
  layout, because the queue is service-neutral.

## Evidence on Hand

None. There are no users, testimonials, partner agreements or usage numbers.
All songs, people and rooms in the prototype are synthetic examples. Do not
show streaming service logos; name services in text.

## Product Principles

1. The queue is the product. Everything else gets out of its way.
2. Meet people in the app they already use. Never ask someone to switch
   services to take part.
3. One song in under a minute. Joining and adding must need no explanation.
4. Always show whose pick it is and where it plays from.
5. Say only what is true. No claimed integrations that do not exist.

## Accessibility & Inclusion

Used one-handed, in dim rooms, by people who are distracted. Large touch
targets, strong contrast and no meaning carried by color alone. WCAG 2.1 AA is
the working target.
