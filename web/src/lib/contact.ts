/**
 * The contact address, kept out of the served markup.
 *
 * A plain `mailto:` in the HTML is the single easiest thing for an address
 * harvester to take, and this page is public. So the address is stored
 * base64-encoded in two halves, joined and decoded only when a visitor
 * actually asks for it. Nothing in the bundle or the DOM contains the
 * literal string until that click.
 *
 * This raises the cost of scraping; it does not make it impossible. A
 * crawler that executes the page's JavaScript and clicks the button gets
 * the address like anyone else. The honest description is "not trivially
 * harvestable", which is what was asked for.
 */

const PARTS = ['c2Ftb29zYS4xMDE2', 'OUBnbWFpbC5jb20='] as const

/** Decodes the contact address. Called on demand, never at module scope. */
export function contactAddress(): string {
  return atob(PARTS.join(''))
}
