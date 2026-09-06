---
id: Talk:Tool_Registry
title: Talk:Tool Registry
kind: talk
categories: []
created: 2011-05-11
modified: 2015-09-12
revisions: 16
authors: [dlopes, mkerrigan, r.osei, tqian]
status: current
---
<div class="talk-thread">

## no auth on tools

toolreg trusts the bus, the bus trusts the subnet. That's two "trusts" too many. {{sig:dlopes|2012-03-02}}

<div class="talk-indent">Agreed and not this quarter. Documented on the page under Security model so nobody is surprised. {{sig:mkerrigan|2012-03-02}}</div>

<div class="talk-indent">Three years later: still not that quarter. {{sig:dlopes|2015-01-14}}</div>

</div>
<div class="talk-thread">

## v2 schema

Where does the v2 schema live now? The page moved during the namespace cleanup and I can't find it. {{sig:r.osei|2015-09-12}}

<div class="talk-indent">The manifest carries `$schema` and the mirror's well-known tools file points at the schema page. It was never re-linked from the article. The original discussion about what the manifest should even contain is in [[Archive:Old_Tool_Manifest_Discussion]]. {{sig:mkerrigan|2015-09-12}}</div>

</div>
<div class="talk-thread">

## manifest as HTTP

Can we serve the manifest over plain HTTP for scripts? {{sig:tqian|2011-05-11}}

<div class="talk-indent">Done, `:7423/manifest.json`. {{sig:mkerrigan|2011-05-12}}</div>

</div>
