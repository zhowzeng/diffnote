# Copying the Comment Queue hands it off and empties it

Copying the [[Comment Queue]] for a CLI agent clears it: that copy is the hand-off, and a Comment that has been handed off has done its job. Leaving the Comments behind means the next copy sends the agent work it already did, and it is also the only way a Comment outlives the edit it asked for — which is the drift ADR 0013 exists to catch, arriving by a route Diffnote could simply not take. [[Copy Now]] already works this way (ADR 0001); this makes the bulk hand-off agree with it.

## Consequences

A copy that fails, or goes to the wrong window, takes the Queue with it. The toast that reports the hand-off offers to undo it, which is cheaper than confirming every hand-off in advance.

## Considered Options

- **Keep the Comments after copying**: rejected — the next hand-off re-sends Comments the agent already acted on, and nothing marks which those were.
- **Mark handed-off Comments instead of removing them**: rejected — two kinds of entry in the Queue needs a rule for which kind the next copy includes, which is this same decision with more state to carry.
- **Confirm before clearing**: rejected — this is the button pressed once per round, and a dialog on every hand-off costs more than the mistake it prevents.
