# Product

## Register

product

## Users

Two audiences, and the tension between them is the central design problem.

**The primary user** is a small-business owner or bookkeeper, most likely in
the US, UK or Australia, reconciling a month of invoices against their
accounting export. They are not developers. They are handling other
people's financial records and are rightly cautious about where those
files go. They arrive with a folder of PDFs and a spreadsheet, and they
want to know one thing: what doesn't tie out.

**The second audience** is a prospective client evaluating the developer.
They may never reconcile anything. They will form a judgement in about ten
seconds and then look at the code.

The register is `product`, deliberately. Designing for the evaluator
directly produces a demo that performs competence; designing a genuinely
excellent tool and letting them watch it work is the more credible route
to the same outcome. Craft is the argument, not decoration.

## Product Purpose

Match invoice PDFs against a ledger export and surface everything that
does not reconcile: missing payments, undocumented payments, amount
differences, duplicates, and invoices that could not be read at all.

Everything runs in the browser. No upload, no account, no server. This is
a genuine architectural property rather than a marketing line: the files
never leave the machine, and a user can verify that by disconnecting from
the internet and watching it still work.

Success is a visitor going from landing to a reconciled result, on their
own files or the sample set, without instructions.

## Brand Personality

**Precise, honest, unshowy.**

The voice is the interface's existing behaviour made visible. This
codebase already refuses to claim more than it verified: extraction
returns null rather than a plausible guess, "could not verify" is its own
terminal state distinct from "no match found", and findings are called
review items rather than errors because a flag is not proof of a mistake.

The UI should say exactly what it knows and no more. Confidence comes from
accuracy and restraint, never from persuasion. No hero metrics, no
reassuring adjectives, no claims the code cannot back.

## Anti-references

- **The dense navy enterprise look** this project shipped first. Correct
  for an internal audit tool used all day; wrong for a surface a stranger
  meets once.
- **Generic modern SaaS.** Gradient hero, three feature cards, glass
  panels, glowing accents, a "Get started free" button. Reads as templated
  and says nothing true about the product.
- **Dark-mode-as-costume.** Neon terminal green, heavy glow, fake CRT
  texture. Dark here should read as a serious reading surface, not a
  hacker aesthetic.
- **Fintech trust theatre.** Navy and gold, stock photography of
  handshakes, padlock iconography standing in for actual security.
- **Anything that overstates certainty.** Progress bars that fake
  progress, success states for work that only partly succeeded, "100%
  accurate" claims.

## Design Principles

1. **Practice what the code preaches.** The interface must not assert more
   than it verified. If a field could not be read, it says so plainly
   rather than showing a blank that reads as zero.

2. **Show the failure before the result.** Extraction is the fragile step,
   so what was read from each file is displayed before any matching
   happens. A user who never sees extraction fail will blame the matching
   instead.

3. **Type carries the hierarchy, not chrome.** Editorial rather than
   boxed. Structure comes from scale, weight and space; cards, borders and
   panels are used only where they genuinely aid comprehension.

4. **The privacy claim is testable, not decorative.** It is stated once,
   plainly, in language that invites verification rather than asking for
   trust.

5. **Numbers are the subject.** Money right-aligned, tabular figures,
   aligned decimals. Where the design and the legibility of a figure
   conflict, the figure wins.

## Accessibility & Inclusion

- **WCAG 2.1 AA**, with the body-text contrast bar treated as a hard
  floor. Dark themes make this harder rather than easier: mid-grey text on
  near-black routinely fails, so ink values are checked rather than
  assumed.
- **Colour-blind safe.** Flag states never rely on colour alone. Every
  status carries a text label; colour is reinforcement, never the only
  channel. This matters because red, amber and green all carry meaning in
  the results table.
- **Reduced motion respected.** Every animation has a
  `prefers-reduced-motion: reduce` alternative, normally a crossfade or an
  instant state change.
- **Full keyboard access**, including the drop zone, which must be
  operable without a pointer.
