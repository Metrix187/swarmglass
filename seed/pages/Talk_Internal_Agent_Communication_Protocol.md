---
id: Talk:Internal_Agent_Communication_Protocol
title: Talk:Internal Agent Communication Protocol
kind: talk
categories: []
created: 2011-02-03
modified: 2014-10-16
revisions: 19
authors: [mkerrigan, dlopes, tqian, r.osei]
status: current
---
<div class="talk-thread">

## ts should be milliseconds

Seconds is not enough resolution to order results from one forager. {{sig:tqian|2011-02-03}}

<div class="talk-indent">We have `id` for ordering within a sender. `ts` is for humans. Leaving it. {{sig:mkerrigan|2011-02-04}}</div>

<div class="talk-indent">Humans will be confused when two things have the same `ts`. {{sig:tqian|2011-02-04}}</div>

<div class="talk-indent">Humans are confused anyway, see [[Known_Agent_Bugs#Clock_skew]]. Closing. {{sig:mkerrigan|2013-05-01}}</div>

</div>
<div class="talk-thread">

## unknown-field rule

Making "ignore unknown fields" explicit in 1.1. Objections? {{sig:mkerrigan|2011-03-30}}

<div class="talk-indent">None. This is the best decision on this page. {{sig:dlopes|2011-03-30}}</div>

</div>
<div class="talk-thread">

## IACP/2 status

Where are we on the binary framing? Bundles are starting to carry the flag. {{sig:r.osei|2013-09-12}}

<div class="talk-indent">Running on queen02. Not going to prod. The bus already frames; msgpack encoders disagree about `ts`; batching got its own tool. I'll write it up on [[Deprecated_Agent_API]] so people stop asking. {{sig:dlopes|2013-09-14}}</div>

<div class="talk-indent">Written up. Also moved the frame notes to the attachments. {{sig:dlopes|2014-10-16}}</div>

</div>
<div class="talk-thread">

## schema file is wrong about ts

The attached schema says `ts` is a string. It's an integer. Has been since 1.0. {{sig:r.osei|2014-02-19}}

<div class="talk-indent">Known. tqian generated it from a forager that had a bug. Not regenerating it because nothing validates against it. {{sig:mkerrigan|2014-02-19}}</div>

</div>
<div class="talk-thread">

## old meeting notes

The 2012-Q3 meeting where we froze 1.1 for good is in [[Archive:Meeting_Notes_2012-Q3]] if anyone needs the reasoning. {{sig:mkerrigan|2012-10-02}}

</div>
