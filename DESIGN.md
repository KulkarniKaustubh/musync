---
name: syng
description: One shared music queue that anyone adds to from their own streaming app.
colors:
  bg: "#101011"
  layer-1: "#1A1A1C"
  layer-2: "#262628"
  line: "#333336"
  text: "#F4F4F5"
  text-2: "#B3B3B8"
  text-3: "#8F8F96"
  accent: "#FFD23F"
  accent-press: "#F2C22B"
  on-accent: "#1A1606"
  danger: "#FF8A80"
  bg-light: "#FFFFFF"
  layer-1-light: "#F3F3F4"
  layer-2-light: "#E8E8EA"
  line-light: "#DADADD"
  text-light: "#121214"
  text-2-light: "#55555C"
  text-3-light: "#6C6C74"
  danger-light: "#B3261E"
  person-coral: "#FF8A7A"
  person-sky: "#6CC4F5"
  person-mint: "#7FDCA4"
  person-lilac: "#C4A7FF"
  person-peach: "#FFB37A"
  person-pink: "#FF8FC0"
  person-teal: "#5FD4CF"
  on-person: "#17171C"
typography:
  display:
    fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.3
rounded:
  sm: "6px"
  md: "12px"
  lg: "18px"
  pill: "999px"
spacing:
  gutter: "16px"
  gutter-wide: "32px"
  row: "10px"
  group: "12px"
  section: "28px"
components:
  button:
    backgroundColor: "{colors.layer-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent-press}"
  chip:
    backgroundColor: "{colors.layer-1}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  chip-selected:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
  bump:
    backgroundColor: "{colors.layer-1}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "44px"
  bump-pressed:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  field:
    backgroundColor: "{colors.layer-1}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "52px"
  now-card:
    backgroundColor: "{colors.layer-1}"
    rounded: "{rounded.lg}"
    padding: "14px"
---

# Design System: syng

## Overview

**Creative North Star: "The Familiar Player"**

syng looks and behaves like the streaming apps people already use, on purpose.
The owner chose the category standard over a novelty look so that nobody has to
learn anything: a now-playing block, a list of rows, a search sheet with filter
chips, pill buttons. It should sit comfortably next to Spotify, Apple Music and
YouTube Music without borrowing any one of them, because the queue belongs to
no single service.

The interface is dark by default because it is used on phones in dim rooms and
cars, and it follows the system setting for people listening apart in daylight.

**Key Characteristics:**
- Every song always shows whose pick it is and which account it plays from.
- One accent, yellow, used only as a fill under dark text.
- Flat neutral layers; depth comes from tone, not shadow.
- Streaming services are named in text. No logos, no service colors.

## Colors

A neutral ground with one warm accent and a small set of soft person colors.

### Primary
- **Queue Yellow** (#FFD23F): the one accent. The "Add a song" bar, primary buttons, the selected radio mark, and a bumped pill. Pressed state is #F2C22B. Text on it is #1A1606.

### Neutral
- **Ground** (#101011 dark, #FFFFFF light): page background.
- **Layer 1** (#1A1A1C dark, #F3F3F4 light): cards, inputs, chips, the idle bump pill.
- **Layer 2** (#262628 dark, #E8E8EA light): hover states, default buttons, tags.
- **Line** (#333336 dark, #DADADD light): row dividers and input borders.
- **Text** (#F4F4F5 dark, #121214 light), **Text 2** (#B3B3B8, #55555C), **Text 3** (#8F8F96, #6C6C74).
- **Danger** (#FF8A80 dark, #B3261E light): error text and the "Leave room" action.

### Person colors
Coral #FF8A7A, sky #6CC4F5, mint #7FDCA4, lilac #C4A7FF, peach #FFB37A, pink #FF8FC0, teal #5FD4CF. Avatar fills only, always under #17171C initials, assigned in join order.

### Named Rules
**The Fill Rule.** Yellow is never text, never a border and never an outline. It is a fill with dark text on it.

**The No Service Color Rule.** Nothing in the interface uses a streaming service's brand color or mark.

**The Tint Rule.** The now-playing card mixes 18% of the cover's hue into Layer 1. Text inside it uses Text and Text 2 only, which keeps every cover hue above 4.5:1.

## Typography

**Display and Body Font:** Figtree (with ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto)

**Character:** One friendly geometric sans for everything, in the manner of the reference apps. Hierarchy comes from weight (400, 600, 700, 800) and a fixed rem scale.

### Hierarchy
- **Display** (800, 2.25rem, 1.08; 3rem on desktop landing): landing headline only.
- **Headline** (800, 1.375rem to 1.75rem, 1.15): the now-playing title, setup titles.
- **Title** (800, 1.125rem): section headings ("Now playing", "Up next"), sheet titles, room name.
- **Body** (400 to 700, 1rem and 0.9375rem, 1.4): row titles (700), buttons, fields.
- **Label** (700 or 400, 0.8125rem and 0.75rem): artist lines, picker and service lines, times, chips.

Numbers that change or align (times, bump counts) use tabular figures.

### Named Rules
**The Fixed Scale Rule.** Sizes are fixed rem steps. Only the big-screen view scales type with the viewport.

## Layout

Phone first. One column with a 16px gutter: a sticky room bar, "Now playing", then "Up next". The "Add a song" bar is fixed to the bottom edge, inside thumb reach, and respects the safe area.

At 900px and wider the gutter becomes 32px and the room splits into two columns inside a 1120px container: now playing on the left (sticky, 420px), the add bar and queue on the right.

The big-screen view is exactly one screen tall at 900px and wider and never scrolls. The cover takes the height that is left, and the queue shows only the rows that fit plus an "and N more songs" line.

Spacing rhythm: 10px inside rows, 12px between a heading and its content, 28px between sections.

## Elevation & Depth

Flat. Depth is tonal: Ground, Layer 1, Layer 2. Only things that float above the page carry a shadow.

### Shadow Vocabulary
- **Float** (`0 12px 34px rgba(0,0,0,.5)` dark, `0 10px 30px rgba(18,18,22,.16)` light): sheets and the toast.

### Named Rules
**The Flat Rule.** Cards, rows and buttons never have shadows.

## Shapes

Pills for anything you press (buttons, chips, the bump control, search fields). 18px corners for cards and sheets, 12px for inputs and option lists, 6px for cover tiles. Avatars are circles. Rows are separated by a 1px line, not boxed.

Cover tiles are abstract generated shapes, one hue and one of nine shapes per song. They are placeholders for real artwork and must not imitate real covers.

## Components

### Buttons
- **Shape:** pill (999px), 48px tall; small variant 40px.
- **Primary:** Queue Yellow fill, dark text. One per view.
- **Default:** Layer 2 fill. **Ghost:** transparent, Layer 2 on hover.
- **Hover / Focus:** 150ms color change; press scales to 0.97; focus is a 2px Text-colored outline with 2px offset.

### Chips
- **Style:** Layer 1 pill, 36px tall, bold label.
- **State:** selected chip inverts to Text fill with Ground-colored label. Used for search scope: your app first, then "All apps", then each service.

### Queue row
Cover tile (52px), then three lines: title (700, one line, ellipsis), artist (Text 2), and the pick line with an 18px avatar, the person's name in bold and the service name. The bump pill sits at the right. A remove button appears only for people allowed to remove.

### Bump
- **Style:** 44px pill showing an up chevron and a count.
- **Pressed:** Queue Yellow fill and the chevron becomes a solid arrow, so the state never depends on color alone.

### Now-playing card
Layer 1 tinted from the cover. Cover, title, artist, then an avatar with "Maya's pick" and "Playing from Maya's Spotify", then progress with elapsed and total time. A three-bar indicator next to the "Now playing" heading moves while a song plays and rests when paused.

### Inputs / Fields
- **Style:** Layer 1 fill, 1px Line border, 12px radius, 52px tall. Search fields are pills.
- **Focus:** border and a 1px ring in Text color.
- **Error:** Danger border, message below in Danger, focus returns to the field.

### Sheets
Bottom sheets on phones with a grabber; centered dialogs at 640px and wider. Close with the button, a tap outside, Escape, or a downward swipe on the header. Search opens full height.

### Toast
Inverted pill (Text fill, Ground label) above the add bar, with an optional Undo action.

## Do's and Don'ts

### Do:
- **Do** show the picker and the source account on every song ("Maya's pick", "Playing from Maya's Spotify").
- **Do** name the visitor's own app in the add action ("Add a song from Spotify").
- **Do** keep one yellow primary action per view.
- **Do** pair every color-coded state with a shape or text change.
- **Do** write controls as the action they perform and confirm with the same word ("Add", then "Added").

### Don't:
- **Don't** use streaming service logos or brand colors.
- **Don't** use yellow for text, borders or decoration.
- **Don't** add shadows to cards, rows or buttons.
- **Don't** add explanatory banners to the room; the labels on each song carry the explanation.
- **Don't** claim an integration, a user count or any real availability that does not exist.
