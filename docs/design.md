# syng design plan

syng is a shared music queue for a room full of people. One screen sits next
to the speakers and plays the music. Everyone else adds songs from their phone.

## The one idea

Every person in the room gets a color, called their voice. Every song they add
is a solid band in that color. The queue is a stack of those bands, so one
glance at the screen shows whose picks are coming up and whether one person is
hogging the aux.

That stack is the only loud thing in the interface. Everything around it stays
quiet.

## Color

| Token       | Dark      | Light     | Used for                          |
| ----------- | --------- | --------- | --------------------------------- |
| `curtain`   | `#24123A` | `#F3EBF8` | Page background                   |
| `velvet`    | `#33194F` | `#E7DAF1` | Raised surfaces, inputs           |
| `chalk`     | `#F7F0E8` | `#1F0F33` | Text and primary buttons          |
| `chalk-dim` | `#B7A9C2` | `#5B4A70` | Secondary text                    |
| `ink`       | `#1F0F33` | `#1F0F33` | Text on a voice band (both themes) |
| `paper`     | `#FBF6EF` | `#FFFFFF` | The join card behind the QR code  |

Voices, the same in both themes: marigold `#FFBE3B`, flamingo `#FF7A9E`,
pool `#5CC8F5`, pistachio `#8EE0A1`, lilac `#C9A8FF`, tangerine `#FF8E4D`.
All six carry `ink` text at well above 4.5:1.

The background is a real plum, chosen because the host screen lives in a dim
room. It is dark without being black, so the six voices sit on it as a set
instead of one accent popping off a void.

## Type

- **Anybody** (variable width and weight) for song titles, the wordmark and the
  room code. Width carries meaning: the song playing now is set wide, the next
  song is set normal, and everything further down the queue is set narrow. The
  closer a song is to the speakers, the more room it takes.
- **Schibsted Grotesk** for everything you read or tap.

## Layout

Host screen (TV or laptop, next to the speakers):

```
+--------------------------------------+------------------+
|                                      |  Scan to add     |
|   video                              |  [QR]   KQ7M     |
|                                      +------------------+
+--------------------------------------+  Up next         |
|  SONG TITLE, SET WIDE                |  [band        ]  |
|  Artist                 Maya's pick  |  [band        ]  |
|  ====-------------------  1:12 3:51  |  [band        ]  |
+--------------------------------------+  [band        ]  |
|  Pause   Skip                        |                  |
+--------------------------------------+------------------+
```

Guest screen (phone):

```
+----------------------+
| syng     KQ7M   You  |
| +------------------+ |
| | Playing now      | |
| | SONG TITLE       | |
| | ====-----        | |
| +------------------+ |
| Up next              |
| [band           ^3 ] |
| [band           ^2 ] |
| [band           ^0 ] |
|                      |
| [ Add a song       ] |  <- stays at the bottom, in thumb reach
+----------------------+
```

Everything is left aligned. Nothing is centered except the QR code.

## Words

- People **add** a song, and the confirmation says "Added".
- People **bump** a song to move it up. One bump per person per song.
- A song belongs to whoever added it: "Maya's pick", "Your pick".
- The place is a **room**, joined with a **room code**.

## What is deliberately not here

No cards with shadows, no gradients, no album art (the video is the art), no
labels above headings. Motion only happens when someone does something: a band
slides in when a song is added and bands trade places when one is bumped.
