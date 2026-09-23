---
title: "Grump: A 4,500-Year-Old Game Meets a Radio Mesh"
slug: "royal-game-of-ur-meshtastic"
meta_description: "Recreating the Royal Game of Ur over Meshtastic: ancient rules, small radio messages, and what it takes to keep two players in sync without the internet."
keyword: "Royal Game of Ur Meshtastic"
secondary_keywords: "Irving Finkel rules, ancient board games, Meshtastic protocol, mesh networking games"
date: "2026-09-22"
author: "Jason Brown"
featured_image: "blog/assets/grump-ur-mesh-cover.png"
featured_image_alt: "A stylized digital Royal Game of Ur board floating above a landscape connected by glowing radio mesh signals."
tags: "meshtastic, python, games, history, side-projects"
draft: false
---

The people who first played the Royal Game of Ur are gone. Their cities became archaeological sites, and the rules had to be pieced back together. But 4,500 years later, we can still sit down and play.

That's what drew me to this project. A game had made it across thousands of years. I wanted to help it make one more trip: across a radio mesh.

I wanted to recreate the Royal Game of Ur using the rules interpreted by Irving Finkel, then play it over Meshtastic. Basically, take one of the oldest games in the world and pair it with a modern way to communicate without cell service or the internet. I thought that would be fun. It also gave me a reason to test different parts of the Meshtastic protocol with something more interesting than another test message.

That became Grump. Tic-tac-toe was the first proof of concept, but Ur was the point.

## The game came first. By a few thousand years.

The Royal Game of Ur comes from ancient Mesopotamia, in what is now Iraq. The British Museum dates its famous twenty-square board to **2600–2400 BC**. Leonard Woolley excavated it at the Royal Cemetery of Ur. Its shell inlays and patterned squares make it look like something someone cared about making, and playing. [British Museum board record](https://www.britishmuseum.org/collection/object/W_1928-1009-378).

Knowing what the board looked like doesn't settle how people played it. Finkel, a British Museum curator and cuneiform specialist, helped make the game playable again through his work interpreting the evidence. The museum also holds a tablet recording rules from **177 BC**, when the game had evolved into a more complicated version involving wagers and five different pieces per player. [British Museum tablet record](https://www.britishmuseum.org/collection/object/W_Rm-III-6-b).

For Grump, I'm targeting the familiar seven-piece Finkel version associated with his demonstration with Tom Scott. It's a playable reconstruction, rather than a claim that we know every rule used by every player in ancient Ur. [RoyalUr explains that distinction](https://royalur.net/rules), and [Masters Traditional Games compares the variants](https://www.mastersofgames.com/rules/royal-ur-rules.htm).

The basic game is a race. Each player starts with seven pieces off the board and tries to bring them all home first. Their routes begin separately, meet on a shared middle track, then split again before the exit. Landing on an opponent in that shared section sends their piece back to the start. You can't land on your own piece, and you need an exact roll to take a piece off the board. [Rules and route descriptions](https://www.mastersofgames.com/rules/royal-ur-rules.htm).

Four pyramid-shaped dice determine movement. Each has two marked corners and two unmarked corners; count the marked corners facing up to get a result from zero to four. That matters for software too: simulating four binary dice gives different probabilities from picking a number uniformly between zero and four. [RoyalUr's dice explanation](https://royalur.net/dice).

The five flower-marked spaces, called **rosettes**, change the pace. Landing on one grants another roll. Four sit on the players' private paths; the fifth is in the shared track, where it also protects its occupant from capture. You can be close to catching someone and still have to wait for them to leave that square. A zero roll, or a roll with no legal move, passes play to the other player. If a legal move exists, you have to make one. [Finkel rules overview](https://royalur.net/rules).

Those details are what make Ur interesting to recreate. A move can change the board, send an opponent backward, or let the same player roll again. The software has to understand all of that.

## Meshtastic gives the moves somewhere to go

[Meshtastic](https://meshtastic.org/docs/introduction/) is an open-source mesh networking project built around LoRa radios. Compatible nodes can exchange messages without cell towers or an internet connection, with other nodes able to relay traffic when needed. Each player's app still needs a connection to its own radio.

There are two connections involved: app to local radio, and radio across the mesh. Meshtastic's [client API](https://meshtastic.org/docs/development/device/client-api/) uses Protocol Buffers and supports serial, TCP, and Bluetooth Low Energy. The mesh handles addressed packets, relaying, and delivery mechanisms. Those are the layers I wanted to explore through an actual application. [Meshtastic routing documentation](https://meshtastic.org/docs/overview/mesh-algo/).

A turn-based game gives each part a practical purpose. Node information helps find an opponent. Direct messages carry invitations and moves. Delivery events tell me something about the network. Disconnecting and reconnecting raises a more useful question than whether a radio is available: do we still agree on the game?

A Meshtastic acknowledgment alone can't answer that. Grump also needs confirmation that the other app accepted the move and updated its state. That's an application-level decision, separate from radio delivery.

## Start with nine squares, then bring in Ur

I started with tic-tac-toe because it made the first test small. The browser app uses React and Vite, with the Meshtastic JavaScript library for the radio connection. A custom text format describes the game actions:

```text
ttt:mov:X-1-2
```

That says player X moved to row 1, column 2. Grump passes it to `sendText`, addressed to the selected peer. The receiving app updates its board. Invitations and resets use messages such as `adm:inv:offer` and `adm:resetboard:request`. Those are visible in the [board component](https://github.com/herdcat/grump/blob/bbb77c299961d2dcc255f549167242dbecc5b615/src/TicTacToeBoard.jsx) and [messaging interface](https://github.com/herdcat/grump/blob/bbb77c299961d2dcc255f549167242dbecc5b615/src/MeshtasticInterface.jsx).

I also added a capture-the-flag prototype, where a move carries a starting position and a destination. That let the same idea cover a larger board before dealing with Ur's rules.

The public checkout contains those prototypes. The Ur messages below are a proposed design extrapolated from the rules, not a claim that these commands are already implemented there.

## What a complete game needs to say

For Ur, sending a piece's destination isn't enough. Both apps need to agree on the rules, the roll, the legal move, and who acts next.

I'd give each match a unique ID and a fixed rules version: seven pieces, the Finkel route, four binary dice, and the rosette behavior described above. For the examples, positions run from `1` to `14` along each player's route. `0` means a piece is waiting to enter, and `15` means it has finished. Positions `5–12` are shared; `4`, `8`, and `14` are rosettes along either player's route. The private rosettes belong to separate physical squares, making five on the board. This numbering is a software convention based on the [fourteen-square route](https://www.mastersofgames.com/rules/royal-ur-rules.htm).

Here is the message set I'd use. The names describe proposed Grump messages carried by Meshtastic.

| Message | What it needs to communicate |
| --- | --- |
| `invite` | Match ID, protocol and rules versions, the two node IDs, player assignments, and dice policy. |
| `accept` / `decline` | Whether the opponent agrees to that exact setup. |
| `opening-roll` | Each player's four dice results, with an opening-round number. Compare totals; repeat ties. |
| `start` | The agreed first player and initial-state checksum. The winner of the opening roll rolls again for the first move. |
| `roll` | The current player's four dice results and a unique roll ID, including rolls earned on rosettes. |
| `move` | The roll being used, piece ID, starting position, and destination. Covers entry, ordinary movement, captures, and finishing. |
| `pass` | The roll being consumed and the reason: zero or no legal move. The receiver verifies the reason. |
| `ack` / `reject` | The event accepted or rejected, resulting state checksum, or a reason such as wrong turn, invalid move, or missing event. |
| `sync-request` / `sync-state` | The last agreed event and the information needed to recover the same game after a gap or reconnect. |
| `resign` | A player's decision to concede. Silence or a timeout doesn't count as resignation. |
| `result` | Confirmation of the winner and final state, checked against seven finished pieces or an accepted resignation. |
| `reset-request` / `reset-accept` / `reset-decline` | Agreement to abandon the current board and begin a new match with a new ID. |

Opening rolls and a fresh first-turn roll follow the [published setup rules](https://royalur.net/rules). The session, confirmation, recovery, and resignation messages are application design choices to make remote play workable.

Every event would also carry a protocol version, match ID, unique event ID, actor, and the state revision it expects. Those fields let the receiver distinguish a new action from a retry or an old message from a previous game. For a first implementation, I'd let the inviter's app order accepted events; either player can submit their own legal actions. That coordinator role would stay fixed for the match.

For instance, with that common envelope omitted for readability:

```text
ur:roll:X:r17:1-1-0-0
ur:move:X:r17:p3:6:8
```

Player X rolled two, then moved piece 3 from position 6 to the central rosette at 8. If that move is legal, both apps can derive the extra roll and the piece's protected status. If the opponent already occupies the central rosette, the move is rejected.

That avoids separate commands for every consequence. **Capturing a piece, granting an extra roll, passing control, and finishing a piece should happen as part of applying the accepted move.** A capture alone doesn't grant another roll in this ruleset. The receiver checks ownership, the recorded roll, occupancy, and exact exit distance before applying anything. The seventh finished piece ends the game.

A zero still needs to cross the mesh:

```text
ur:roll:X:r18:0-0-0-0
ur:pass:X:r18:zero
```

Without that exchange, the other app could sit waiting for a move that will never happen. A blocked nonzero roll uses `pass` too, but only after checking every piece for a legal move. A rejected move leaves the same roll available for a corrected choice; it doesn't give the player another roll.

Retries must reuse their event IDs. Once an event is accepted, receiving it again should return the same acknowledgment without applying it twice. If an acknowledgment is lost, the sender retries that event, rather than inventing a new move. Missing or conflicting state pauses play for synchronization.

A recovery snapshot needs the positions of all fourteen pieces, whose turn it is, any unconsumed roll, the current phase, rules version, result, and last accepted revision. The coordinator can resend accepted events or a versioned snapshot; the other app confirms the checksum before continuing. Larger recovery payloads would need size checks and, if necessary, numbered chunks that are assembled completely before use.

For this prototype design, I'd trust each player's app to generate its dice and record them once. Both apps can verify the total and resulting move. Proving that an opponent didn't manipulate their random generator would require a separate fairness mechanism.

This gives me specific things to test: an invitation reaching the right node, a move arriving once or twice, an acknowledgment going missing, and a game recovering after a connection drops. Ur makes each failure visible on the board.

## Moving the radio connection out of the browser

I've since started migrating Grump to Python because of browser connectivity limitations. USB serial access uses Web Serial, while Meshtastic's BLE connection uses Web Bluetooth. Their availability varies by browser and platform; Meshtastic documents those constraints in its [web client overview](https://meshtastic.org/docs/software/web-client/).

The [Meshtastic Python library](https://python.meshtastic.org/) provides serial, BLE, and TCP interfaces. That lets me keep the game-message idea while handling radio access outside the browser. Operating-system permissions and device setup still matter, but browser API support becomes one less dependency.

The goal is still the one that made me want to build this: recreate a game people were playing thousands of years ago and let its next move travel over a modern radio mesh. Along the way, a rosette becomes a turn-management problem, a capture becomes a shared-state update, and a missed packet becomes something both players can see.

[Grump is on GitHub](https://github.com/herdcat/grump). If ancient games or mesh radios are your kind of project, take a look. I'd be interested in what you'd build—or which part of the protocol you'd try to break first.

<!-- Editorial verification:
Rewritten around the author's explicit clarification that Ur, following Irving Finkel's interpretation, was the original goal; tic-tac-toe was the proof of concept. No claim that Ur has been implemented or tested over hardware.
Repository source reviewed earlier: bbb77c299961d2dcc255f549167242dbecc5b615 (2024-06-06). Public code contains tic-tac-toe and capture-the-flag prototypes. Python migration is author-reported.
Historical dates and tablet contents: British Museum collection records. The seven-piece playable Finkel rules differ from the later tablet's more elaborate game. Rules compared using RoyalUr and James Masters' descriptions, particularly the Finkel vs Tom Scott version. The British Museum video could not be fetched directly in this research pass; no claim to have watched it.
Ur message names, numbering, session fields, coordinator role, recovery design, and dice trust model are proposed application design, not Meshtastic-native message types or implemented Grump features. They cover ordinary rules and remote-session lifecycle, but are not a complete byte-level wire specification.
Current routing documentation describes newer firmware than the 2024 checkout; it establishes capabilities to explore, not historic behavior measured by Grump. No blanket browser support removal established.
Voice follows the supplied Jason Brown guide with the author's requested marketing hook and historical/technical sections.
-->
