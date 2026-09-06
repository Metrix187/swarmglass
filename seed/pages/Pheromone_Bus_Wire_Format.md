---
id: Pheromone_Bus_Wire_Format
title: Pheromone Bus Wire Format
kind: article
categories: [Protocols]
created: 2010-06-20
modified: 2012-02-11
revisions: 9
authors: [dlopes]
status: stale
alternates: [txt]
infobox:
  Service: phero
  Framing: 4-byte length prefix
  Payload: IACP JSON line
---
The byte layout of a phero bus frame. Unchanged since 1.0; the 2.0 binary framing ([[Deprecated_Agent_API]]) would have replaced it and did not.

## Frame

```
offset  size  field
0       4     length (big-endian uint32) of payload
4       n     payload: one IACP message, UTF-8 JSON, trailing "\n" included in n
```

That is the entire format.

## Connection handshake

```
client → broker   SUB <trail-prefix> <last-seq>\n
broker → client   OK <current-seq>\n
                  (replay frames if last-seq < current-seq - 1)
client → broker   PUB <trail>\n  followed by a frame
```

`SUB` and `PUB` lines are plain text before the first frame; after that, everything is frames. A client that sends `SUB` after frames get `ERR proto\n` and is disconnected.

## Sequence numbers

Per trail, 64-bit, start at 1, never wrap. Delivered in the frame's IACP `id`? No — that is a separate namespace. The sequence number is prepended to replayed frames as `SEQ <n>\n` and omitted on live frames, which every client handles by ignoring lines starting with `SEQ` unless it is resyncing. This is documented nowhere but here and in the client source.

## Example session

```
SUB queen.assign.forager-07 118\n
OK 121\n
SEQ 119\n
[4-byte len]{"v":"1.1",...}\n
SEQ 120\n
[4-byte len]{"v":"1.1",...}\n
SEQ 121\n
[4-byte len]{"v":"1.1",...}\n
[4-byte len]{"v":"1.1",...}\n        <- live
```

## See also

- [[Agent_Message_Bus]]
- [[Internal_Agent_Communication_Protocol#Envelope]]
